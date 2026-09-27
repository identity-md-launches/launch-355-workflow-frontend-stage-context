// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HookTestBase} from "./helpers/HookTestBase.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {LoyaltyTierHook} from "../src/LoyaltyTierHook.sol";

contract RejectETH {
    receive() external payable {
        revert("recipient rejected ETH");
    }
}

contract ObserveBurn {
    LoyaltyTierHook immutable hook;
    bool public observedZero;

    constructor(LoyaltyTierHook hook_) {
        hook = hook_;
    }

    receive() external payable {
        require(hook.accruedFees() == 0, "claims not cleared before interaction");
        require(hook.burnFees() == 0, "reentry paid twice");
        observedZero = true;
    }
}

contract ClaimDonor is IUnlockCallback {
    IPoolManager immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function donate(address to) external payable {
        manager.unlock(abi.encode(to, msg.value));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (address to, uint256 amount) = abi.decode(data, (address, uint256));
        manager.mint(to, 0, amount);
        manager.sync(Currency.wrap(address(0)));
        manager.settle{value: amount}();
        return "";
    }
}

contract HookAdversarialTest is HookTestBase, IUnlockCallback {
    function test_volumeUint128BoundaryAndOverflowRollBack() public {
        // The only synthetic volume setup: reaching uint128.max ETH in real trades is infeasible.
        // Exercise the boundary through genuine core swaps after verifying the storage write.
        bytes32 inner = keccak256(abi.encode(PoolId.unwrap(key.toId()), uint256(0)));
        bytes32 slot = keccak256(abi.encode(ALICE, inner));
        vm.store(address(hook), slot, bytes32(uint256(type(uint128).max) - 100));
        assertEq(hook.volumeOf(key.toId(), ALICE), type(uint128).max - 100);
        _checked(key, _params(true, -100), abi.encode(ALICE), ALICE, true);
        assertEq(hook.volumeOf(key.toId(), ALICE), type(uint128).max);
        uint256 beforeBalance = ALICE.balance;
        uint256 claims = hook.accruedFees();
        vm.expectRevert(_wrapped(IHooks.afterSwap.selector, LoyaltyTierHook.VolumeOverflow.selector));
        _swap(key, _params(true, -1), abi.encode(ALICE), ALICE);
        assertEq(hook.volumeOf(key.toId(), ALICE), type(uint128).max);
        assertEq(hook.accruedFees(), claims);
        assertEq(ALICE.balance, beforeBalance);
        _assertSettled(key);
    }

    function test_extremeSpecifiedValuesCannotOverflowFeeMath() public {
        int256[4] memory amounts =
            [type(int256).min, type(int256).max, int256(type(int128).max) + 1, int256(type(int128).min)];
        for (uint256 i; i < amounts.length; ++i) {
            vm.expectRevert(_wrapped(IHooks.beforeSwap.selector, LoyaltyTierHook.AmountTooLarge.selector));
            _swap(key, _params(true, amounts[i]), abi.encode(ALICE), ALICE);
        }
        assertEq(hook.accruedFees(), 0);
        assertEq(hook.volumeOf(key.toId(), ALICE), 0);
    }

    function test_failedPayoutRestoresClaimsAndLiabilities() public {
        _checked(key, _params(true, -0.01 ether), abi.encode(ALICE), ALICE, true);
        uint256 amount = hook.accruedFees();
        uint256 managerBefore = address(manager).balance;
        uint256 deadBefore = DEAD.balance;
        vm.etch(DEAD, type(RejectETH).runtimeCode);
        vm.expectRevert();
        hook.burnFees();
        assertEq(hook.accruedFees(), amount);
        assertEq(manager.balanceOf(address(hook), 0), amount);
        assertEq(address(manager).balance, managerBefore);
        assertEq(DEAD.balance, deadBefore);
        vm.etch(DEAD, "");
        assertEq(hook.burnFees(), amount);
        assertEq(hook.accruedFees(), 0);
    }

    function test_claimsZeroBeforePayoutAndReentryCannotDoubleBurn() public {
        _checked(key, _params(true, -0.01 ether), abi.encode(ALICE), ALICE, true);
        uint256 amount = hook.accruedFees();
        uint256 deadBefore = DEAD.balance;
        ObserveBurn observer = new ObserveBurn(hook);
        vm.etch(DEAD, address(observer).code);
        assertEq(hook.burnFees(), amount);
        assertTrue(ObserveBurn(payable(DEAD)).observedZero());
        assertEq(DEAD.balance, deadBefore + amount);
        assertEq(hook.accruedFees(), 0);
    }

    function test_donatedClaimsAreAlsoEmptiedExactly() public {
        _checked(key, _params(true, -0.01 ether), abi.encode(ALICE), ALICE, true);
        uint256 accrued = hook.accruedFees();
        ClaimDonor donor = new ClaimDonor(manager);
        donor.donate{value: 0.0123 ether}(address(hook));
        assertEq(hook.accruedFees(), accrued + 0.0123 ether);
        uint256 deadBefore = DEAD.balance;
        assertEq(hook.burnFees(), accrued + 0.0123 ether);
        assertEq(DEAD.balance, deadBefore + accrued + 0.0123 ether);
        assertEq(manager.balanceOf(address(hook), 0), 0);
        assertEq(hook.accruedFees(), 0);
    }

    function test_claimsCannotBeTransferredOrBurnedByThirdParty() public {
        _checked(key, _params(true, -0.01 ether), abi.encode(ALICE), ALICE, true);
        uint256 amount = hook.accruedFees();
        vm.expectRevert();
        manager.transferFrom(address(hook), BOB, 0, amount);
        vm.expectRevert();
        manager.unlock(abi.encode(uint8(0), amount));
        assertEq(hook.accruedFees(), amount);
        assertFalse(manager.isOperator(address(hook), BOB));
        assertEq(manager.allowance(address(hook), BOB, 0), 0);
    }

    function test_burningDuringAnotherUnlockRevertsWithoutChangingClaims() public {
        _checked(key, _params(true, -0.01 ether), abi.encode(ALICE), ALICE, true);
        uint256 amount = hook.accruedFees();
        vm.expectRevert(IPoolManager.AlreadyUnlocked.selector);
        manager.unlock(abi.encode(uint8(1), amount));
        assertEq(hook.accruedFees(), amount);
        _assertSettled(key);
        hook.burnFees();
        assertEq(hook.accruedFees(), 0);
    }

    function test_smartWalletClaimIsNotBundlerIdentity() public {
        address wallet = address(0x12345);
        token.transfer(wallet, 1 ether);
        vm.deal(wallet, 1 ether);
        vm.prank(wallet, BOB);
        token.approve(address(router), type(uint256).max);
        vm.prank(wallet, BOB);
        router.swap{value: 0.01 ether}(
            key, _params(true, -0.01 ether), PoolSwapTest.TestSettings(false, false), abi.encode(wallet)
        );
        assertEq(hook.volumeOf(key.toId(), wallet), 0);
        assertEq(hook.volumeOf(key.toId(), BOB), 0);
        assertEq(hook.accruedFees(), 0.0001 ether);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (uint8 operation, uint256 amount) = abi.decode(data, (uint8, uint256));
        if (operation == 0) manager.burn(address(hook), 0, amount);
        else hook.burnFees();
        return "";
    }

    function _wrapped(bytes4 callback, bytes4 reason) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            address(hook),
            callback,
            abi.encodeWithSelector(reason),
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }
}
