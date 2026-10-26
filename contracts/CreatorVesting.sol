// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Vesting linear dengan cliff untuk porsi supply creator.
/// Sebelum cliff: 0 bisa diklaim. Setelah cliff: rilis linear sejak `start` sampai `start + duration`.
/// Beneficiary ditetapkan saat launch dan tidak bisa diganti.
contract CreatorVesting {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable beneficiary;
    uint64 public immutable start;
    uint64 public immutable cliff;
    uint64 public immutable duration;
    uint256 public immutable totalAllocation;
    uint256 public released;

    event Released(uint256 amount);

    constructor(IERC20 token_, address beneficiary_, uint256 total_, uint64 cliff_, uint64 duration_) {
        require(beneficiary_ != address(0), "beneficiary=0");
        require(duration_ > 0 && cliff_ <= duration_, "bad schedule");
        token = token_;
        beneficiary = beneficiary_;
        totalAllocation = total_;
        start = uint64(block.timestamp);
        cliff = cliff_;
        duration = duration_;
    }

    function vestedAmount(uint64 timestamp) public view returns (uint256) {
        if (timestamp < start + cliff) return 0;
        if (timestamp >= start + duration) return totalAllocation;
        return (totalAllocation * (timestamp - start)) / duration;
    }

    function releasable() public view returns (uint256) {
        return vestedAmount(uint64(block.timestamp)) - released;
    }

    function release() external {
        uint256 amount = releasable();
        require(amount > 0, "nothing to release");
        released += amount;
        token.safeTransfer(beneficiary, amount);
        emit Released(amount);
    }
}
