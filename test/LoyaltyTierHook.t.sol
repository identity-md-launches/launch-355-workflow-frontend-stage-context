// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HookTestBase} from "./helpers/HookTestBase.sol";
import {Vm} from "forge-std/Vm.sol";
import {HookDeployment} from "./helpers/HookDeployment.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {LoyaltyTierHook} from "../src/LoyaltyTierHook.sol";
import {HookFlags} from "../src/HookFlags.sol";

contract LoyaltyTierHookTest is HookTestBase {
    using StateLibrary for IPoolManager;

    function test_exactPermissionsAndMinedAddress() public view {
        Hooks.Permissions memory expected;
        expected.beforeSwap = true;
        expected.afterSwap = true;
        expected.beforeSwapReturnDelta = true;
        expected.afterSwapReturnDelta = true;
        assertEq(abi.encode(hook.getHookPermissions()), abi.encode(expected));
        assertEq(HookFlags.flagsOf(address(hook)), 0xcc);
        assertEq(address(hook.poolManager()), address(manager));
    }

    function test_wrongAddressBitsFailConstructor() public {
        bytes32 initHash = keccak256(abi.encodePacked(type(LoyaltyTierHook).creationCode, abi.encode(manager)));
        bytes32 salt;
        address predicted =
            address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", address(this), salt, initHash)))));
        assertFalse(HookFlags.matches(predicted, HookFlags.LOYALTY));
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, predicted));
        new LoyaltyTierHook{salt: salt}(manager);
    }

    function test_zeroManagerRejected() public {
        vm.expectRevert(LoyaltyTierHook.InvalidPoolManager.selector);
        new LoyaltyTierHook(IPoolManager(address(0)));
    }

    function test_exactInputBuy() public {
        _checked(key, _params(true, -0.003 ether), abi.encode(ALICE), ALICE, true);
    }

    function test_exactOutputBuy() public {
        _checked(key, _params(true, 0.003 ether), abi.encode(ALICE), ALICE, true);
    }

    function test_exactInputSell() public {
        _checked(key, _params(false, -0.003 ether), abi.encode(ALICE), ALICE, true);
    }

    function test_exactOutputSell() public {
        _checked(key, _params(false, 0.003 ether), abi.encode(ALICE), ALICE, true);
    }

    function test_dustAllModesAndFeeRounding() public {
        uint256[5] memory amounts = [uint256(1), 2, 99, 100, 101];
        for (uint256 i; i < amounts.length; ++i) {
            for (uint256 mode; mode < 4; ++mode) {
                bool buy = mode < 2;
                int256 amount = mode % 2 == 0 ? -int256(amounts[i]) : int256(amounts[i]);
                (uint256 fee, uint128 leg) = _checked(key, _params(buy, amount), abi.encode(ALICE), ALICE, true);
                assertEq(fee, uint256(leg) / 100);
            }
        }
    }

    function test_eachThresholdExactlyAndOneWeiBelow() public {
        uint128[3] memory thresholds = [uint128(0.01 ether), 0.1 ether, 1 ether];
        for (uint256 i; i < thresholds.length; ++i) {
            uint256 amount = thresholds[i] - 1 - hook.volumeOf(key.toId(), ALICE);
            _checked(key, _params(true, -int256(amount)), abi.encode(ALICE), ALICE, true);
            assertEq(hook.volumeOf(key.toId(), ALICE), thresholds[i] - 1);
            assertEq(hook.tierOf(key.toId(), ALICE), i);
            assertEq(hook.feeBpsOf(key.toId(), ALICE), 100 - i * 25);
            assertEq(hook.nextTierAt(key.toId(), ALICE), thresholds[i]);
            _checked(key, _params(true, -1), abi.encode(ALICE), ALICE, true);
            assertEq(hook.volumeOf(key.toId(), ALICE), thresholds[i]);
            assertEq(hook.tierOf(key.toId(), ALICE), i + 1);
            assertEq(hook.feeBpsOf(key.toId(), ALICE), 75 - i * 25);
            assertEq(hook.nextTierAt(key.toId(), ALICE), i == 2 ? 0 : thresholds[i + 1]);
        }
    }

    function test_eachCrossingPaysOldRateAndNextSwapGetsNewRate() public {
        uint128[3] memory thresholds = [uint128(0.01 ether), 0.1 ether, 1 ether];
        for (uint256 i; i < thresholds.length; ++i) {
            uint256 amount = thresholds[i] - 1e12 - hook.volumeOf(key.toId(), ALICE);
            _checked(key, _params(true, -int256(amount)), abi.encode(ALICE), ALICE, true);
            (uint256 fee,) = _checked(key, _params(true, -2e12), abi.encode(ALICE), ALICE, true);
            assertEq(fee, 2e12 * (100 - 25 * i) / 10_000);
            (fee,) = _checked(key, _params(true, -2e12), abi.encode(ALICE), ALICE, true);
            assertEq(fee, 2e12 * (75 - 25 * i) / 10_000);
        }
    }

    function test_crossingFromAfterSwapPathAlsoPaysOldRate() public {
        _checked(key, _params(true, -0.009 ether), abi.encode(ALICE), ALICE, true);
        (uint256 fee, uint128 leg) = _checked(key, _params(false, -0.002 ether), abi.encode(ALICE), ALICE, true);
        assertEq(fee, uint256(leg) / 100);
        assertEq(hook.tierOf(key.toId(), ALICE), 1);
        (fee, leg) = _checked(key, _params(true, 0.001 ether), abi.encode(ALICE), ALICE, true);
        assertEq(fee, uint256(leg) * 75 / 10_000);
    }

    function test_volumeInPrivatePoolCannotDiscountLaunchPool() public {
        PoolKey memory privatePool = key;
        privatePool.fee = 500;
        _seed(privatePool);
        _checked(privatePool, _params(true, -2 ether), abi.encode(ALICE), ALICE, true);
        assertEq(hook.feeBpsOf(privatePool.toId(), ALICE), 25);
        assertEq(hook.volumeOf(key.toId(), ALICE), 0);
        assertEq(hook.feeBpsOf(key.toId(), ALICE), 100);
        (uint256 fee,) = _checked(key, _params(true, -0.001 ether), abi.encode(ALICE), ALICE, true);
        assertEq(fee, 0.00001 ether);
        assertEq(hook.volumeOf(privatePool.toId(), ALICE), 2 ether);
        assertEq(hook.volumeOf(key.toId(), BOB), 0);
    }

    function test_missingMismatchedZeroMalformedAndRouterIdentityAreAnonymous() public {
        _checked(key, _params(true, -1 ether), abi.encode(ALICE), ALICE, true);
        bytes[7] memory data = [
            bytes(""),
            abi.encode(ALICE),
            abi.encode(address(0)),
            hex"aabb",
            abi.encode(ALICE, BOB),
            abi.encode(address(router)),
            abi.encode(type(uint256).max)
        ];
        uint128 aliceVolume = hook.volumeOf(key.toId(), ALICE);
        for (uint256 i; i < data.length; ++i) {
            for (uint256 mode; mode < 4; ++mode) {
                _checked(
                    key,
                    _params(mode < 2, mode % 2 == 0 ? -int256(0.001 ether) : int256(0.001 ether)),
                    data[i],
                    BOB,
                    false
                );
            }
        }
        assertEq(hook.volumeOf(key.toId(), ALICE), aliceVolume);
        assertEq(hook.volumeOf(key.toId(), BOB), 0);
        assertEq(hook.volumeOf(key.toId(), address(router)), 0);
    }

    function test_missingDataDoesNotUseOriginsExistingDiscount() public {
        _checked(key, _params(true, -1 ether), abi.encode(ALICE), ALICE, true);
        (uint256 fee,) = _checked(key, _params(true, -0.01 ether), "", ALICE, false);
        assertEq(fee, 0.0001 ether);
        assertEq(hook.volumeOf(key.toId(), ALICE), 1 ether);
    }

    function test_nonEthPoolAllModesZeroDeltasAndNoVolume() public {
        MockERC20 a = new MockERC20("A", "A", 10_000_000 ether);
        MockERC20 b = new MockERC20("B", "B", 10_000_000 ether);
        (a, b) = address(a) < address(b) ? (a, b) : (b, a);
        PoolKey memory other =
            PoolKey(Currency.wrap(address(a)), Currency.wrap(address(b)), 3000, 60, IHooks(address(hook)));
        a.approve(address(liquidityRouter), type(uint256).max);
        b.approve(address(liquidityRouter), type(uint256).max);
        _seed(other);
        a.transfer(ALICE, 100 ether);
        b.transfer(ALICE, 100 ether);
        vm.startPrank(ALICE, ALICE);
        a.approve(address(router), type(uint256).max);
        b.approve(address(router), type(uint256).max);
        vm.stopPrank();
        uint256 claims = hook.accruedFees();
        for (uint256 mode; mode < 4; ++mode) {
            SwapParams memory params = _params(mode < 2, mode % 2 == 0 ? -int256(1 ether) : int256(1 ether));
            vm.recordLogs();
            BalanceDelta delta = _swap(other, params, abi.encode(ALICE), ALICE);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            for (uint256 i; i < logs.length; ++i) {
                assertTrue(logs[i].emitter != address(hook), "no hook events");
                if (logs[i].emitter == address(manager) && logs[i].topics[0] == SWAP_EVENT) {
                    (int128 raw0, int128 raw1,,,,) =
                        abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                    assertEq(BalanceDelta.unwrap(delta), BalanceDelta.unwrap(toBalanceDelta(raw0, raw1)));
                }
            }
            assertEq(hook.volumeOf(other.toId(), ALICE), 0);
            assertEq(hook.accruedFees(), claims);
            _assertSettled(other);
        }
        // Even a partial fill on a non-ETH pool must keep the ordinary v4 behavior.
        SwapParams memory limited = SwapParams(true, -100 ether, Q96 - Q96 / 1_000_000);
        (uint160 current,,,) = manager.getSlot0(other.toId());
        limited.sqrtPriceLimitX96 = current - current / 1_000_000;
        BalanceDelta partialDelta = _swap(other, limited, "", ALICE);
        assertGt(int256(partialDelta.amount0()), limited.amountSpecified);
        assertEq(hook.accruedFees(), claims);
    }

    function test_directCallbacksRefuseNonManager() public {
        SwapParams memory params = _params(true, -1 ether);
        vm.expectRevert(LoyaltyTierHook.OnlyPoolManager.selector);
        hook.beforeSwap(ALICE, key, params, abi.encode(ALICE));
        vm.expectRevert(LoyaltyTierHook.OnlyPoolManager.selector);
        hook.afterSwap(ALICE, key, params, toBalanceDelta(-1 ether, 1 ether), abi.encode(ALICE));
        vm.expectRevert(LoyaltyTierHook.OnlyPoolManager.selector);
        hook.unlockCallback(abi.encode(BOB));
    }

    function test_partialFillAllModesRevertsAndRollsBackEverything() public {
        for (uint256 mode; mode < 4; ++mode) {
            bool buy = mode < 2;
            SwapParams memory params = _params(buy, mode % 2 == 0 ? -int256(100 ether) : int256(100 ether));
            params.sqrtPriceLimitX96 = buy ? Q96 - Q96 / 1_000_000 : Q96 + Q96 / 1_000_000;
            uint256 nativeBefore = ALICE.balance;
            uint256 tokenBefore = token.balanceOf(ALICE);
            vm.expectRevert(
                abi.encodeWithSelector(
                    CustomRevert.WrappedError.selector,
                    address(hook),
                    IHooks.afterSwap.selector,
                    abi.encodeWithSelector(LoyaltyTierHook.PartialFill.selector),
                    abi.encodeWithSelector(Hooks.HookCallFailed.selector)
                )
            );
            _swap(key, params, abi.encode(ALICE), ALICE);
            assertEq(ALICE.balance, nativeBefore);
            assertEq(token.balanceOf(ALICE), tokenBefore);
            assertEq(hook.accruedFees(), 0);
            assertEq(hook.volumeOf(key.toId(), ALICE), 0);
            (uint160 price,,,) = manager.getSlot0(key.toId());
            assertEq(price, Q96);
            _assertSettled(key);
        }
    }

    function test_burnFeesEmptiesAllClaimsOnlyToDeadAndCanRepeat() public {
        for (uint256 mode; mode < 4; ++mode) {
            _checked(
                key,
                _params(mode < 2, mode % 2 == 0 ? -int256(0.005 ether) : int256(0.005 ether)),
                abi.encode(ALICE),
                ALICE,
                true
            );
        }
        uint256 amount = hook.accruedFees();
        uint256 deadBefore = DEAD.balance;
        uint256 bobBefore = BOB.balance;
        uint256 managerBefore = address(manager).balance;
        vm.expectEmit(false, false, false, true, address(hook));
        emit LoyaltyTierHook.FeesBurned(amount);
        vm.prank(BOB);
        assertEq(hook.burnFees(), amount);
        assertEq(DEAD.balance, deadBefore + amount);
        assertEq(BOB.balance, bobBefore);
        assertEq(address(manager).balance, managerBefore - amount);
        assertEq(hook.accruedFees(), 0);
        assertEq(manager.balanceOf(address(hook), 0), 0);
        assertEq(hook.burnFees(), 0);
        assertEq(DEAD.balance, deadBefore + amount);
        _checked(key, _params(true, -0.005 ether), abi.encode(ALICE), ALICE, true);
        amount += hook.burnFees();
        assertEq(DEAD.balance, deadBefore + amount);
        _assertSettled(key);
    }

    function testFuzz_allModesAndRates(uint96 amountSeed, uint8 modeSeed, uint8 tierSeed) public {
        uint256 tier = bound(tierSeed, 0, 3);
        uint128[4] memory volumes = [uint128(0), 0.01 ether, 0.1 ether, 1 ether];
        if (tier != 0) _checked(key, _params(true, -int256(uint256(volumes[tier]))), abi.encode(ALICE), ALICE, true);
        uint256 amount = bound(amountSeed, 1, 10 ether);
        uint256 mode = bound(modeSeed, 0, 3);
        _checked(
            key, _params(mode < 2, mode % 2 == 0 ? -int256(amount) : int256(amount)), abi.encode(ALICE), ALICE, true
        );
    }

    function testFuzz_mismatchedIdentityNeverBorrowsTier(uint96 amountSeed, address claimed) public {
        vm.assume(claimed != BOB);
        _checked(key, _params(true, -1 ether), abi.encode(ALICE), ALICE, true);
        uint256 amount = bound(amountSeed, 1, 1 ether);
        _checked(key, _params(true, -int256(amount)), abi.encode(claimed), BOB, false);
        assertEq(hook.volumeOf(key.toId(), claimed), claimed == ALICE ? 1 ether : 0);
    }

    function test_noEscapeOpcodesOrAdminSelectors() public {
        bytes memory runtime = address(hook).code;
        assertLe(runtime.length, 24576);
        for (uint256 i; i < runtime.length; ++i) {
            uint8 op = uint8(runtime[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff);
        }
        string[5] memory signatures =
            ["sweep(address)", "withdraw(address,uint256)", "setFee(uint256)", "pause()", "upgradeTo(address)"];
        for (uint256 i; i < signatures.length; ++i) {
            (bool ok,) = address(hook).call(abi.encodeWithSignature(signatures[i], ALICE, 1 ether));
            assertFalse(ok);
        }
    }
}
