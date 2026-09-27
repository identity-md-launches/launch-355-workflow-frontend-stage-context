// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {LoyaltyTierHook} from "../../src/LoyaltyTierHook.sol";
import {HookFlags} from "../../src/HookFlags.sol";

library HookDeployment {
    function mine(address deployer, bytes32 initCodeHash) internal pure returns (bytes32 salt, address predicted) {
        for (uint256 i; i < 1_000_000; ++i) {
            salt = bytes32(i);
            predicted = address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", deployer, salt, initCodeHash)))));
            if (HookFlags.matches(predicted, HookFlags.LOYALTY)) return (salt, predicted);
        }
        revert("salt search exhausted");
    }

    function deploy(IPoolManager manager) internal returns (LoyaltyTierHook hook) {
        bytes32 hash = keccak256(abi.encodePacked(type(LoyaltyTierHook).creationCode, abi.encode(manager)));
        (bytes32 salt, address predicted) = mine(address(this), hash);
        hook = new LoyaltyTierHook{salt: salt}(manager);
        require(address(hook) == predicted, "CREATE2 mismatch");
    }
}
