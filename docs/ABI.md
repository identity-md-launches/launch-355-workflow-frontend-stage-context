# Contract ABIs

The machine-readable arrays are exported by the pinned compiler:

- [TIER.json](abi/TIER.json): constructor, ERC-20 views, transfers, approvals, errors and events.
- [LoyaltyTierHook.json](abi/LoyaltyTierHook.json): constructor, views, callbacks, burn operation,
  constants, errors and events.

Regenerate with `python3 tools/export_abi.py`, or compare without modifying files using
`python3 tools/export_abi.py --check`. The script runs `forge inspect ... abi --json`, uses only the
Python standard library and does not access any RPC, secrets or environment configuration.

| Hook view | ABI return | Meaning |
| --- | --- | --- |
| `volumeOf(bytes32 poolId,address user)` | `uint128` | Cumulative fee-base ETH in wei |
| `tierOf(bytes32 poolId,address user)` | `uint8` | Tier 0, 1, 2 or 3 |
| `feeBpsOf(bytes32 poolId,address user)` | `uint16` | 100, 75, 50 or 25 |
| `nextTierAt(bytes32 poolId,address user)` | `uint128` | Absolute next volume threshold, or 0 at maximum |
| `accruedFees()` | `uint256` | Entire current ERC-6909 ETH claim balance |
| `poolManager()` | `address` | Immutable manager |
| `getHookPermissions()` | `Hooks.Permissions` tuple | Exactly before/after swap and their return deltas |

`PoolId` is the core hash of the entire pool key, including its currencies, fee, tick spacing and
hook address. Supplying another pool's ID intentionally reads independent volume. The fee view
describes a valid claim by that user; anonymous/mismatched hookData still pays 100 bps even if the
queried user's view shows a discount.

`burnFees()` is permissionless and returns the ETH amount sent to dEaD. `beforeSwap` and `afterSwap`
are manager-only v4 callbacks. The `BeforeSwapDelta` and `BalanceDelta` ABI representations are
packed `int256` values; callers should use v4's type libraries for their signed 128-bit components.
`unlockCallback(bytes)` is manager-only and services the hook's fee redemption; its return is
`abi.encode(uint256 amount)`. There are no public token- or claim-approval entrypoints on the hook.

```solidity
event VolumeAdded(bytes32 indexed poolId, address indexed user, uint128 ethLeg, uint128 total, uint8 tier);
event FeesBurned(uint256 amount);
```

VolumeAdded's `tier` is the post-swap tier, not the fee tier applied to that swap. ETH leg and total
are denominated in wei. Identified dust swaps may emit a zero leg; anonymous and non-ETH-pool swaps
emit no VolumeAdded. A nonempty successful burn emits FeesBurned; an empty `burnFees()` returns
zero without emitting it.

Custom hook errors are `OnlyPoolManager`, `InvalidPoolManager`, `PartialFill`, `AmountTooLarge`
and `VolumeOverflow`. Invalid deployment bits use core's `HookAddressNotValid(address)`. During
a PoolManager swap, callback errors appear inside core's `WrappedError`; decode its reason field
with the hook ABI. Core liquidity, price-limit, settlement and signed-cast errors can also propagate.
