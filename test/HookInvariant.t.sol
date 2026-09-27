// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {HookTestBase} from "./helpers/HookTestBase.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {LoyaltyTierHook} from "../src/LoyaltyTierHook.sol";

/// @dev Ghost accounting uses the pool event, not hook storage, as its fee/volume oracle.
contract LoyaltyHandler is Test {
    bytes32 constant SWAP_EVENT = keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    IPoolManager immutable manager;
    LoyaltyTierHook immutable hook;
    PoolSwapTest immutable router;
    address immutable user;
    PoolKey key;
    uint256 public paid;
    uint256 public burned;
    uint128 public volume;
    uint256 public swaps;

    constructor(
        IPoolManager manager_,
        LoyaltyTierHook hook_,
        PoolSwapTest router_,
        PoolKey memory key_,
        address user_
    ) {
        manager = manager_;
        hook = hook_;
        router = router_;
        key = key_;
        user = user_;
    }

    function trade(uint96 seed, uint8 modeSeed, bool identified) external {
        uint256 size = bound(seed, 1, 0.2 ether);
        uint256 mode = uint256(modeSeed) % 4;
        bool buy = mode < 2;
        int256 specified = mode % 2 == 0 ? -int256(size) : int256(size);
        uint256 bps = 100;
        if (identified) {
            if (volume >= 1 ether) bps = 25;
            else if (volume >= 0.1 ether) bps = 50;
            else if (volume >= 0.01 ether) bps = 75;
        }
        vm.recordLogs();
        vm.prank(user, user);
        BalanceDelta delta = router.swap{value: buy ? 1 ether : 0}(
            key,
            SwapParams(buy, specified, buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1),
            PoolSwapTest.TestSettings(false, false),
            identified ? abi.encode(user) : bytes("")
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        int128 rawEth;
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(manager) && logs[i].topics[0] == SWAP_EVENT) {
                (rawEth,,,,,) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                found = true;
            }
        }
        assertTrue(found);
        bool ethSpecified = buy == (specified < 0);
        uint256 leg = ethSpecified ? size : uint256(rawEth < 0 ? -int256(rawEth) : int256(rawEth));
        uint256 fee = leg * bps / 10_000;
        assertEq(int256(delta.amount0()), int256(rawEth) - int256(fee));
        assertEq(int256(ethSpecified ? delta.amount0() : delta.amount1()), specified);
        paid += fee;
        if (identified) volume += uint128(leg);
        ++swaps;
    }

    function burn() external {
        uint256 expected = paid - burned;
        uint256 beforeBalance = hook.DEAD().balance;
        assertEq(hook.burnFees(), expected);
        assertEq(hook.DEAD().balance, beforeBalance + expected);
        burned += expected;
    }
}

contract HookInvariantTest is HookTestBase {
    LoyaltyHandler handler;
    uint256 deadAtStart;

    function setUp() public override {
        super.setUp();
        handler = new LoyaltyHandler(manager, hook, router, key, ALICE);
        deadAtStart = DEAD.balance;
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = LoyaltyHandler.trade.selector;
        selectors[1] = LoyaltyHandler.burn.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
        targetContract(address(handler));
    }

    function invariant_feesVolumeAndSettlementRemainConserved() public view {
        assertEq(hook.accruedFees(), handler.paid() - handler.burned());
        assertEq(manager.balanceOf(address(hook), 0), handler.paid() - handler.burned());
        assertEq(DEAD.balance, deadAtStart + handler.burned());
        assertEq(hook.volumeOf(key.toId(), ALICE), handler.volume());
        assertEq(hook.volumeOf(key.toId(), BOB), 0);
        assertGe(address(manager).balance, hook.accruedFees());
        _assertSettled(key);
    }

    function afterInvariant() public {
        handler.burn();
        assertEq(hook.accruedFees(), 0);
        assertEq(DEAD.balance, deadAtStart + handler.paid());
    }
}
