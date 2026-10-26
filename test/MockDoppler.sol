// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LibClone} from "solady/src/utils/LibClone.sol";
import {DopplerEncodingHarness} from "./DopplerEncodingHarness.sol";

// Mock Doppler untuk test browser. Kode runtime-nya dipasang di alamat kanonik Robinhood
// (evm_setAccountCode), jadi website berjalan tanpa perubahan konfigurasi.
address constant TOKEN_FACTORY = 0x1B37D3a72082029c44B35B604Ea473617580b69a;
address constant POOL_INITIALIZER = 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544;
address constant PROTOCOL_OWNER = 0x00000000000000000000000000000000000d0bb1;

contract MockDopplerToken {
    string public symbol;
    mapping(address => uint256) public vestedOf;

    function initialize(string memory symbol_, address beneficiary, uint256 amount) external {
        require(bytes(symbol).length == 0, "initialized");
        symbol = symbol_;
        vestedOf[beneficiary] = amount;
    }

    function computeAvailableVestedAmount(address beneficiary) external view returns (uint256) {
        return vestedOf[beneficiary];
    }

    function release(uint256 amount) external {
        vestedOf[msg.sender] -= amount;
    }
}

contract MockTokenFactory {
    address public immutable IMPLEMENTATION;

    constructor(address impl) {
        IMPLEMENTATION = impl;
    }

    function create(bytes32 salt, bytes calldata tokenData) external returns (address asset) {
        (, string memory symbol, , address[] memory bens, , uint256[] memory amounts, , , , , ) = abi.decode(
            tokenData, (string, string, DopplerEncodingHarness.VestingSchedule[], address[], uint256[], uint256[], string, uint256, uint48, address, address[])
        );
        asset = LibClone.cloneDeterministic(IMPLEMENTATION, salt);
        MockDopplerToken(asset).initialize(symbol, bens[0], amounts[0]);
    }
}

contract MockInitializer {
    mapping(bytes32 => mapping(address => uint256)) public getShares;

    function setShares(bytes32 poolId, address who, uint256 shares) external {
        getShares[poolId][who] = shares;
    }

    function collectFees(bytes32 poolId) external returns (uint128 fees0, uint128 fees1) {
        return (1 ether, 1000 ether);
    }
}

contract MockAirlock is DopplerEncodingHarness {
    event Create(address asset, address indexed numeraire, address initializer, address poolOrHook);

    function owner() external pure returns (address) {
        return PROTOCOL_OWNER;
    }

    function create(CreateParams calldata p)
        external
        returns (address asset, address pool, address governance, address timelock, address migrationPool)
    {
        require(p.tokenFactory == TOKEN_FACTORY && p.poolInitializer == POOL_INITIALIZER, "unknown module");
        asset = MockTokenFactory(TOKEN_FACTORY).create(p.salt, p.tokenFactoryData);
        this.validate(p, PROTOCOL_OWNER, asset);

        InitData memory d = abi.decode(p.poolInitializerData, (InitData));
        (address c0, address c1) = asset < p.numeraire ? (asset, p.numeraire) : (p.numeraire, asset);
        bytes32 poolId = keccak256(abi.encode(c0, c1, d.fee, d.tickSpacing, POOL_INITIALIZER));
        for (uint256 i; i < d.beneficiaries.length; i++) {
            MockInitializer(POOL_INITIALIZER).setShares(poolId, d.beneficiaries[i].beneficiary, d.beneficiaries[i].shares);
        }
        emit Create(asset, p.numeraire, POOL_INITIALIZER, asset);
        return (asset, asset, address(0xdead), address(0xdead), address(0xdead));
    }
}
