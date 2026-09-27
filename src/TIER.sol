// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed supply Sepolia demonstration token. The deployer receives the entire supply.
contract TIER is ERC20 {
    constructor() ERC20("Tiers", "TIER") {
        _mint(msg.sender, 1_000_000_000 ether);
    }
}
