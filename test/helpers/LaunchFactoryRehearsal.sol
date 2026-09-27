// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TIER} from "../../src/TIER.sol";
import {LoyaltyTierHook} from "../../src/LoyaltyTierHook.sol";
import {HookDeployment} from "./HookDeployment.sol";
import {LaunchParameters} from "./LaunchParameters.sol";

/// @notice Models the specified factory lifecycle; no upstream factory source was supplied.
contract LaunchFactoryRehearsal is IUnlockCallback {
    IPoolManager public immutable manager;
    TIER public token;
    LoyaltyTierHook public hook;
    int24 public lower;
    int24 public upper;
    uint128 public liquidity;
    uint256 public seeded;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function launch(uint160 sqrtPriceX96, uint256 seedAmount) external returns (PoolKey memory key) {
        require(address(token) == address(0), "already launched");
        token = new TIER(); // All supply belongs to this factory, never the transaction sender.
        hook = HookDeployment.deploy(manager);
        key = PoolKey(
            Currency.wrap(address(0)),
            Currency.wrap(address(token)),
            LaunchParameters.LP_FEE,
            LaunchParameters.TICK_SPACING,
            IHooks(address(hook))
        );
        int24 tick = manager.initialize(key, sqrtPriceX96);
        lower = TickMath.minUsableTick(key.tickSpacing);
        upper = (tick / key.tickSpacing) * key.tickSpacing;
        if (tick < 0 && tick % key.tickSpacing != 0) upper -= key.tickSpacing;
        require(upper > lower, "price below seed range");
        // Entire range is at/below the launch price: only currency1 (TIER) is deposited.
        uint256 amount = FullMath.mulDiv(
            seedAmount, 1 << 96, TickMath.getSqrtPriceAtTick(upper) - TickMath.getSqrtPriceAtTick(lower)
        );
        require(amount > 0 && amount <= uint128(type(int128).max), "liquidity out of range");
        liquidity = uint128(amount);
        manager.unlock(abi.encode(key));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager only");
        PoolKey memory key = abi.decode(data, (PoolKey));
        (BalanceDelta delta,) =
            manager.modifyLiquidity(key, ModifyLiquidityParams(lower, upper, int256(uint256(liquidity)), 0), "");
        require(delta.amount0() == 0 && delta.amount1() < 0, "seed must be TIER only");
        seeded = uint256(-int256(delta.amount1()));
        manager.sync(key.currency1);
        token.transfer(address(manager), seeded);
        manager.settle();
        return "";
    }
}
