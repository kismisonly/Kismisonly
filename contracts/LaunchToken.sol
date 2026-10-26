// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Token ERC20 polos: supply tetap, dimint sekali ke launchpad saat deploy.
/// Tidak ada pajak transfer, tidak ada fungsi mint/owner. Fee hanya terjadi di pool swap.
contract LaunchToken is ERC20 {
    string public tokenURI;

    constructor(string memory name_, string memory symbol_, string memory uri_, uint256 supply_, address to_)
        ERC20(name_, symbol_)
    {
        tokenURI = uri_;
        _mint(to_, supply_);
    }
}
