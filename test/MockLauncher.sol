// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ILiquidityLauncher} from "../contracts/interfaces/ILiquidityLauncher.sol";

/// @notice Mock adapter untuk test: menyimpan token pool, "beli" 1 wei ETH = 1000 token.
contract MockLauncher is ILiquidityLauncher {
    mapping(address => address) public feeRecipientOf;

    function seed(address token, uint256 amount, address feeRecipient, bytes calldata)
        external
        payable
        returns (address)
    {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        feeRecipientOf[token] = feeRecipient;
        return address(this);
    }

    function buy(address token, address to, uint256 minOut) external payable returns (uint256 out) {
        out = msg.value * 1000;
        require(out >= minOut, "slippage");
        IERC20(token).transfer(to, out);
    }
}
