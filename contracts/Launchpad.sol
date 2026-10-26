// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {CreatorVesting} from "./CreatorVesting.sol";
import {FeeSplitter} from "./FeeSplitter.sol";
import {ILiquidityLauncher} from "./interfaces/ILiquidityLauncher.sol";

/// @notice Factory launchpad model Bankr/Doppler:
///   supply tetap -> sebagian ke pool (LP terkunci di adapter), sebagian ke vesting creator,
///   fee swap porsi creator+platform dialirkan ke FeeSplitter per token.
/// Konfigurasi global bisa diubah owner, tapi setiap token yang SUDAH launch memakai nilai
/// yang terkunci saat launch (immutable di FeeSplitter / CreatorVesting).
contract Launchpad is Ownable {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_VEST_BPS = 2_000; // creator maksimal 20% supply
    uint16 public constant MAX_PLATFORM_FEE_BPS = 5_000; // platform maksimal 50% dari fee

    struct Config {
        uint256 totalSupply; // mis. 100_000_000_000e18
        uint16 vestBps; // mis. 1_500 = 15%
        uint64 vestCliff; // mis. 30 days
        uint64 vestDuration; // mis. 365 days
        uint16 platformFeeBps; // bagian platform dari fee yang masuk ke splitter
        address platformTreasury;
    }

    struct LaunchParams {
        string name;
        string symbol;
        string uri;
        address creator; // penerima vesting + fee creator
        bytes32 salt;
        bytes poolData; // diteruskan ke adapter (kurva/quote token)
        uint256 devBuyMinOut; // dipakai jika msg.value > seedValue
        uint256 seedValue; // ETH yang dibutuhkan adapter untuk seed (biasanya 0)
    }

    struct LaunchInfo {
        address token;
        address pool;
        address vesting;
        address feeSplitter;
        address creator;
        uint64 launchedAt;
    }

    ILiquidityLauncher public launcher;
    Config public config;
    mapping(address => LaunchInfo) public launches;
    address[] public allTokens;

    event Launched(
        address indexed token,
        address indexed creator,
        address pool,
        address vesting,
        address feeSplitter,
        uint256 poolAmount,
        uint256 vestAmount,
        uint256 devBuyOut
    );
    event ConfigUpdated(Config config);
    event LauncherUpdated(address launcher);

    constructor(address owner_, ILiquidityLauncher launcher_, Config memory config_) Ownable(owner_) {
        launcher = launcher_;
        _setConfig(config_);
    }

    function setConfig(Config calldata config_) external onlyOwner {
        _setConfig(config_);
    }

    function setLauncher(ILiquidityLauncher launcher_) external onlyOwner {
        launcher = launcher_;
        emit LauncherUpdated(address(launcher_));
    }

    function launchCount() external view returns (uint256) {
        return allTokens.length;
    }

    function launch(LaunchParams calldata p) external payable returns (LaunchInfo memory info) {
        require(p.creator != address(0), "creator=0");
        require(msg.value >= p.seedValue, "seed value");
        Config memory c = config;

        // 1. Deploy token, seluruh supply dimint ke launchpad.
        IERC20 token = IERC20(address(new LaunchToken{salt: p.salt}(p.name, p.symbol, p.uri, c.totalSupply, address(this))));
        info.token = address(token);
        info.creator = p.creator;
        info.launchedAt = uint64(block.timestamp);

        // 2. Porsi creator -> kontrak vesting (cliff + linear).
        uint256 vestAmount = (c.totalSupply * c.vestBps) / BPS;
        info.vesting = address(new CreatorVesting(token, p.creator, vestAmount, c.vestCliff, c.vestDuration));
        token.safeTransfer(info.vesting, vestAmount);

        // 3. Fee splitter: creator vs platform, terkunci untuk token ini.
        info.feeSplitter = _deploySplitter(p.creator, c);

        // 4. Sisa supply -> pool lewat adapter (Doppler). LP dikunci oleh adapter.
        uint256 poolAmount = c.totalSupply - vestAmount;
        token.forceApprove(address(launcher), poolAmount);
        info.pool = launcher.seed{value: p.seedValue}(info.token, poolAmount, info.feeSplitter, p.poolData);
        require(token.balanceOf(address(this)) == 0, "leftover supply");

        // 5. Dev buy opsional: sisa ETH dipakai beli, token langsung ke creator (tidak di-vesting).
        uint256 devBuyOut;
        if (msg.value > p.seedValue) {
            devBuyOut = launcher.buy{value: msg.value - p.seedValue}(info.token, p.creator, p.devBuyMinOut);
        }

        launches[info.token] = info;
        allTokens.push(info.token);

        emit Launched(info.token, p.creator, info.pool, info.vesting, info.feeSplitter, poolAmount, vestAmount, devBuyOut);
    }

    function _deploySplitter(address creator, Config memory c) internal returns (address) {
        address[] memory recipients = new address[](2);
        uint16[] memory shares = new uint16[](2);
        recipients[0] = creator;
        shares[0] = BPS - c.platformFeeBps;
        recipients[1] = c.platformTreasury;
        shares[1] = c.platformFeeBps;
        return address(new FeeSplitter(recipients, shares));
    }

    function _setConfig(Config memory c) internal {
        require(c.totalSupply > 0, "supply=0");
        require(c.vestBps <= MAX_VEST_BPS, "vest too high");
        require(c.vestDuration > 0 && c.vestCliff <= c.vestDuration, "bad vest schedule");
        require(c.platformFeeBps <= MAX_PLATFORM_FEE_BPS, "platform fee too high");
        require(c.platformTreasury != address(0), "treasury=0");
        config = c;
        emit ConfigUpdated(c);
    }
}
