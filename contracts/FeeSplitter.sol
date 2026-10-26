// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Menerima fee swap (ETH atau ERC20) dari pool/locker satu token dan membaginya
/// ke penerima sesuai BPS yang dikunci saat launch. Model pull: setiap penerima klaim sendiri.
contract FeeSplitter {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;

    address[] public recipients;
    uint16[] public shares;

    // asset (address(0) = ETH) => total yang pernah diterima
    mapping(address => uint256) public totalReceived;
    // asset => recipient => sudah diklaim
    mapping(address => mapping(address => uint256)) public claimed;
    // asset => total sudah diklaim semua penerima
    mapping(address => uint256) public totalClaimed;

    event Claimed(address indexed asset, address indexed recipient, uint256 amount);

    constructor(address[] memory recipients_, uint16[] memory shares_) {
        require(recipients_.length == shares_.length && recipients_.length > 0, "length");
        uint256 sum;
        for (uint256 i; i < recipients_.length; ++i) {
            require(recipients_[i] != address(0), "recipient=0");
            for (uint256 j; j < i; ++j) {
                require(recipients_[j] != recipients_[i], "duplicate recipient");
            }
            sum += shares_[i];
        }
        require(sum == BPS, "shares != 100%");
        recipients = recipients_;
        shares = shares_;
    }

    receive() external payable {}

    function recipientCount() external view returns (uint256) {
        return recipients.length;
    }

    function pending(address asset, address recipient) public view returns (uint256) {
        uint256 balance = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        uint256 total = balance + totalClaimed[asset];
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == recipient) {
                return (total * shares[i]) / BPS - claimed[asset][recipient];
            }
        }
        return 0;
    }

    function claim(address asset, address recipient) external {
        uint256 amount = pending(asset, recipient);
        require(amount > 0, "nothing to claim");
        claimed[asset][recipient] += amount;
        totalClaimed[asset] += amount;
        if (asset == address(0)) {
            (bool ok,) = recipient.call{value: amount}("");
            require(ok, "eth transfer failed");
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
        emit Claimed(asset, recipient, amount);
    }
}
