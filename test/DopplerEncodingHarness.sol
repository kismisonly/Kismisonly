// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LibClone} from "solady/src/utils/LibClone.sol";

/// @notice Men-decode data hasil web/src/doppler.js dengan struct Doppler yang sama, lalu menjalankan
/// aturan validasi yang disalin dari source Doppler (DopplerHookInitializer, Multicurve,
/// BeneficiaryData, DopplerERC20V1). Kalau ini lolos, Airlock tidak akan revert karena format/aturan ini.
contract DopplerEncodingHarness {
    uint256 constant WAD = 1e18;
    uint96 constant MIN_PROTOCOL_OWNER_SHARES = uint96(WAD / 20);
    int24 constant MIN_TICK = -887272;
    int24 constant MAX_TICK = 887272;
    uint24 constant MAX_LP_FEE = 100_000;
    uint256 constant MAX_PRE_MINT_WAD = 0.8 ether;
    uint256 constant MIN_VESTING_DURATION = 1 days;

    struct Curve { int24 tickLower; int24 tickUpper; uint16 numPositions; uint256 shares; }
    struct BeneficiaryData { address beneficiary; uint96 shares; }
    struct InitData {
        uint24 fee; int24 tickSpacing; int24 farTick; Curve[] curves; BeneficiaryData[] beneficiaries;
        address dopplerHook; bytes onInitializationDopplerHookCalldata; bytes graduationDopplerHookCalldata;
    }
    struct VestingSchedule { uint64 cliff; uint64 duration; }
    struct CreateParams {
        uint256 initialSupply; uint256 numTokensToSell; address numeraire; address tokenFactory; bytes tokenFactoryData;
        address governanceFactory; bytes governanceFactoryData; address poolInitializer; bytes poolInitializerData;
        address liquidityMigrator; bytes liquidityMigratorData; address integrator; bytes32 salt;
    }

    function predict(address impl, bytes32 salt, address factory) external pure returns (address) {
        return LibClone.predictDeterministicAddress(impl, salt, factory);
    }

    function validate(CreateParams calldata p, address protocolOwner, address asset)
        external
        pure
        returns (uint256 vested, address creator)
    {
        (vested, creator) = _validateToken(p);
        require(vested + p.numTokensToSell == p.initialSupply, "supply != vested + pool");
        _validatePool(abi.decode(p.poolInitializerData, (InitData)), asset < p.numeraire, protocolOwner);
    }

    function _validateToken(CreateParams calldata p) internal pure returns (uint256 vested, address creator) {
        (, , VestingSchedule[] memory schedules, address[] memory bens, uint256[] memory ids, uint256[] memory amounts, , uint256 maxBal, uint48 balEnd, , ) =
            abi.decode(p.tokenFactoryData, (string, string, VestingSchedule[], address[], uint256[], uint256[], string, uint256, uint48, address, address[]));
        require(maxBal == 0 && balEnd == 0, "balance limit aktif");
        require(bens.length == ids.length && bens.length == amounts.length, "ArrayLengthsMismatch");
        for (uint256 i; i < schedules.length; i++) {
            require((schedules[i].duration == 0 || schedules[i].duration >= MIN_VESTING_DURATION) && schedules[i].cliff <= schedules[i].duration, "InvalidSchedule");
        }
        for (uint256 i; i < bens.length; i++) {
            require(bens[i] != address(0) && amounts[i] > 0, "InvalidAllocation");
            require(ids[i] < schedules.length, "UnknownScheduleId");
            require(amounts[i] <= p.initialSupply * MAX_PRE_MINT_WAD / WAD, "MaxPreMintPerAddressExceeded");
            vested += amounts[i];
        }
        require(vested <= p.initialSupply * MAX_PRE_MINT_WAD / WAD, "MaxTotalPreMintExceeded");
        creator = bens[0];
    }

    function _validatePool(InitData memory d, bool isToken0, address protocolOwner) internal pure {
        require(d.dopplerHook != address(0) || d.fee <= MAX_LP_FEE, "LPFeeTooHigh");
        require(d.tickSpacing > 0, "tickSpacing");
        int24 lower = MAX_TICK;
        int24 upper = MIN_TICK;
        uint256 total;
        for (uint256 i; i < d.curves.length; i++) {
            Curve memory c = d.curves[i];
            require(c.numPositions > 0, "ZeroPosition");
            require(c.shares > 0, "ZeroShare");
            if (!isToken0) (c.tickLower, c.tickUpper) = (-c.tickUpper, -c.tickLower);
            require(c.tickLower % d.tickSpacing == 0 && c.tickUpper % d.tickSpacing == 0, "TickNotAligned");
            require(c.tickLower < c.tickUpper, "TickRangeMisordered");
            require(c.tickLower >= MIN_TICK && c.tickUpper <= MAX_TICK, "tick out of range");
            if (lower > c.tickLower) lower = c.tickLower;
            if (upper < c.tickUpper) upper = c.tickUpper;
            total += c.shares;
        }
        require(total == WAD, "InvalidTotalShares(curves)");
        if (isToken0) {
            require(d.farTick >= lower && d.farTick < upper, "UnreachableFarTick");
        } else {
            int24 far = -d.farTick;
            require(far <= upper && far >= lower, "UnreachableFarTick");
        }

        address prev;
        uint256 shares;
        bool found;
        for (uint256 i; i < d.beneficiaries.length; i++) {
            BeneficiaryData memory b = d.beneficiaries[i];
            require(prev < b.beneficiary, "UnorderedBeneficiaries");
            require(b.shares > 0, "InvalidShares");
            if (b.beneficiary == protocolOwner) {
                require(b.shares >= MIN_PROTOCOL_OWNER_SHARES, "InvalidProtocolOwnerShares");
                found = true;
            }
            prev = b.beneficiary;
            shares += b.shares;
        }
        require(d.beneficiaries.length > 0, "pool tidak terkunci");
        require(shares == WAD, "InvalidTotalShares(beneficiaries)");
        require(found, "InvalidProtocolOwnerBeneficiary");
    }
}
