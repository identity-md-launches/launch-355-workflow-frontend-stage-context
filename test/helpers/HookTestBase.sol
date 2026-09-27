// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {TIER} from "../../src/TIER.sol";
import {LoyaltyTierHook} from "../../src/LoyaltyTierHook.sol";
import {HookDeployment} from "./HookDeployment.sol";

abstract contract HookTestBase is Test {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    address internal constant ALICE = address(0xa11ce);
    address internal constant BOB = address(0xb0b);
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint160 internal constant Q96 = 1 << 96;
    bytes32 internal constant SWAP_EVENT =
        keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    bytes32 internal constant VOLUME_EVENT = keccak256("VolumeAdded(bytes32,address,uint128,uint128,uint8)");

    IPoolManager internal manager;
    TIER internal token;
    LoyaltyTierHook internal hook;
    PoolSwapTest internal router;
    PoolModifyLiquidityTest internal liquidityRouter;
    PoolKey internal key;

    struct Observation {
        uint256 nativeBefore;
        uint256 tokenBefore;
        uint256 claimsBefore;
        uint128 volumeBefore;
        uint16 rate;
        BalanceDelta delta;
        int128 raw0;
        int128 raw1;
        uint256 fee;
        uint128 ethLeg;
        uint128 volumeAfter;
    }

    function setUp() public virtual {
        manager = new PoolManager(address(this));
        token = new TIER();
        hook = HookDeployment.deploy(manager);
        router = new PoolSwapTest(manager);
        liquidityRouter = new PoolModifyLiquidityTest(manager);
        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), 3000, 60, IHooks(address(hook)));
        vm.deal(address(this), 100_000_000 ether);
        token.approve(address(liquidityRouter), type(uint256).max);
        _seed(key);
        _fund(ALICE);
        _fund(BOB);
    }

    function _fund(address user) internal {
        vm.deal(user, 1_000_000 ether);
        token.transfer(user, 10_000_000 ether);
        vm.prank(user);
        token.approve(address(router), type(uint256).max);
    }

    function _seed(PoolKey memory pool) internal {
        manager.initialize(pool, Q96);
        liquidityRouter.modifyLiquidity{value: 2_000_000 ether}(
            pool, ModifyLiquidityParams(-887220, 887220, 1_000_000 ether, 0), ""
        );
    }

    function _params(bool buy, int256 amount) internal pure returns (SwapParams memory) {
        return SwapParams(buy, amount, buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);
    }

    function _swap(PoolKey memory pool, SwapParams memory params, bytes memory data, address user)
        internal
        returns (BalanceDelta)
    {
        vm.prank(user, user);
        return router.swap{value: params.zeroForOne ? 1000 ether : 0}(
            pool, params, PoolSwapTest.TestSettings(false, false), data
        );
    }

    /// @dev Independent oracle uses the real manager's Swap event, before the hook delta is applied.
    /// Checks user balances, exact specified amount, fee signs, claim minting and settled deltas.
    function _checked(PoolKey memory pool, SwapParams memory params, bytes memory data, address user, bool credited)
        internal
        returns (uint256, uint128)
    {
        Observation memory o;
        o.nativeBefore = user.balance;
        o.tokenBefore = token.balanceOf(user);
        o.claimsBefore = hook.accruedFees();
        o.volumeBefore = hook.volumeOf(pool.toId(), user);
        o.rate = credited ? hook.feeBpsOf(pool.toId(), user) : 100;
        vm.recordLogs();
        o.delta = _swap(pool, params, data, user);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool sawSwap;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(manager) && logs[i].topics[0] == SWAP_EVENT) {
                (o.raw0, o.raw1,,,,) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                sawSwap = true;
            }
        }
        assertTrue(sawSwap, "real manager swap event");
        {
            bool ethSpecified = params.zeroForOne == (params.amountSpecified < 0);
            o.ethLeg = uint128(_abs(ethSpecified ? params.amountSpecified : int256(o.raw0)));
            assertEq(
                int256(ethSpecified ? o.delta.amount0() : o.delta.amount1()), params.amountSpecified, "specified exact"
            );
        }
        o.fee = uint256(o.ethLeg) * o.rate / 10_000;
        assertEq(int256(o.delta.amount0()), int256(o.raw0) - int256(o.fee), "ETH fee sign");
        assertEq(int256(o.delta.amount1()), int256(o.raw1), "TIER is fee-free at hook");
        assertEq(int256(user.balance) - int256(o.nativeBefore), int256(o.delta.amount0()), "ETH user settlement");
        assertEq(int256(token.balanceOf(user)) - int256(o.tokenBefore), int256(o.delta.amount1()), "TIER settlement");
        assertEq(hook.accruedFees(), o.claimsBefore + o.fee, "claim accrual");
        assertEq(manager.balanceOf(address(hook), 0), hook.accruedFees(), "claim liability");
        o.volumeAfter = credited ? o.volumeBefore + o.ethLeg : o.volumeBefore;
        assertEq(hook.volumeOf(pool.toId(), user), o.volumeAfter, "volume");
        _checkVolumeEvents(pool.toId(), user, credited, o, logs);
        _assertSettled(pool);
        return (o.fee, o.ethLeg);
    }

    function _checkVolumeEvents(PoolId id, address user, bool credited, Observation memory o, Vm.Log[] memory logs)
        internal
        view
    {
        uint256 volumeEvents;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == VOLUME_EVENT) {
                ++volumeEvents;
                assertEq(logs[i].topics[1], PoolId.unwrap(id));
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(user))));
                (uint128 leg, uint128 cumulative, uint8 tier) = abi.decode(logs[i].data, (uint128, uint128, uint8));
                assertEq(leg, o.ethLeg);
                assertEq(cumulative, o.volumeAfter);
                assertEq(tier, hook.tierOf(id, user));
            }
        }
        assertEq(volumeEvents, credited ? 1 : 0, "identity events");
    }

    function _assertSettled(PoolKey memory pool) internal view {
        assertEq(manager.currencyDelta(address(hook), pool.currency0), 0);
        assertEq(manager.currencyDelta(address(hook), pool.currency1), 0);
        assertEq(manager.currencyDelta(address(router), pool.currency0), 0);
        assertEq(manager.currencyDelta(address(router), pool.currency1), 0);
        assertEq(manager.getNonzeroDeltaCount(), 0);
        assertFalse(manager.isUnlocked());
        assertEq(address(hook).balance, 0);
        assertEq(address(router).balance, 0);
    }

    function _abs(int256 amount) internal pure returns (uint256) {
        return uint256(amount < 0 ? -amount : amount);
    }

    receive() external payable {}
}
