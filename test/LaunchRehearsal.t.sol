// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {TIER} from "../src/TIER.sol";
import {LoyaltyTierHook} from "../src/LoyaltyTierHook.sol";
import {HookFlags} from "../src/HookFlags.sol";
import {LaunchFactoryRehearsal} from "./helpers/LaunchFactoryRehearsal.sol";
import {LaunchParameters} from "./helpers/LaunchParameters.sol";

contract LaunchRehearsalTest is Test {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    function test_factoryOneSidedSeedAndFirstBuyIntoEthLessPool() public {
        _rehearse(LaunchParameters.SQRT_PRICE_X96, LaunchParameters.SEED_TIER, false);
    }

    function test_factoryFirstExactOutputBuyIntoEthLessPool() public {
        _rehearse(LaunchParameters.SQRT_PRICE_X96, LaunchParameters.SEED_TIER, true);
    }

    /// @dev Explicit arguments keep the rehearsal reusable when a final manifest chooses its price.
    function _rehearse(uint160 initialPrice, uint256 seed, bool exactOutput) internal {
        IPoolManager manager = new PoolManager(address(this));
        LaunchFactoryRehearsal factory = new LaunchFactoryRehearsal(manager);
        PoolKey memory key = factory.launch(initialPrice, seed);
        TIER token = factory.token();
        LoyaltyTierHook hook = factory.hook();
        PoolSwapTest router = new PoolSwapTest(manager);
        address buyer = address(0xbeef);
        (uint160 price,,,) = manager.getSlot0(key.toId());
        assertEq(price, initialPrice);
        assertEq(HookFlags.flagsOf(address(hook)), 0xcc);
        assertEq(key.fee, 3000);
        assertEq(key.tickSpacing, 60);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(address(manager)), factory.seeded());
        assertEq(token.balanceOf(address(factory)), token.totalSupply() - factory.seeded());
        assertLe(factory.seeded(), seed);
        assertGt(factory.seeded(), seed - 100_000);
        assertEq(address(manager).balance, 0, "factory did not seed ETH");
        assertEq(address(hook).balance, 0);
        assertEq(hook.accruedFees(), 0);
        assertLe(TickMath.getSqrtPriceAtTick(factory.upper()), initialPrice);
        vm.deal(buyer, 1 ether);
        int256 amount = exactOutput ? int256(100_000 ether) : -int256(0.001 ether);
        vm.prank(buyer, buyer);
        BalanceDelta delta = router.swap{value: 1 ether}(
            key,
            SwapParams(true, amount, TickMath.MIN_SQRT_PRICE + 1),
            PoolSwapTest.TestSettings(false, false),
            abi.encode(buyer)
        );
        assertLt(delta.amount0(), 0);
        assertGt(delta.amount1(), 0);
        uint256 spent = uint256(-int256(delta.amount0()));
        assertEq(1 ether - buyer.balance, spent);
        assertEq(address(manager).balance, spent);
        assertEq(token.balanceOf(buyer), uint128(delta.amount1()));
        if (exactOutput) {
            assertEq(int256(delta.amount1()), amount);
            uint256 rawEth = spent - hook.accruedFees();
            assertEq(hook.accruedFees(), rawEth / 100);
            assertEq(hook.volumeOf(key.toId(), buyer), rawEth);
        } else {
            assertEq(spent, 0.001 ether);
            assertEq(hook.accruedFees(), 0.00001 ether);
            assertEq(hook.volumeOf(key.toId(), buyer), spent);
        }
        assertEq(manager.getNonzeroDeltaCount(), 0);
        assertFalse(manager.isUnlocked());
        uint256 fees = hook.accruedFees();
        uint256 deadBefore = hook.DEAD().balance;
        assertEq(hook.burnFees(), fees);
        assertEq(hook.accruedFees(), 0);
        assertEq(hook.DEAD().balance, deadBefore + fees);
        assertEq(address(manager).balance, spent - fees);
    }
}
