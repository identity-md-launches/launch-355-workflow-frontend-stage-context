# Tiers (TIER) and LoyaltyTierHook

Tiers is a Sepolia test toy. TIER and any associated pot have no value; nothing here promises a return.
This contribution contains the token, hook, Foundry tests and ABI exports. Services handle source
publication, attestation, admission and deployment after the contract stage. The separate manifest
contributor owns `launch.json`; an independent contributor reviews the accepted source and manifest.

`src/TIER.sol` is an OpenZeppelin ERC-20 named **Tiers**, symbol **TIER**, with 18 decimals. Its
argument-free constructor mints exactly **1,000,000,000 TIER** to `msg.sender` (the factory when
factory-deployed). There is no subsequent mint, owner, pause, upgrade, transfer tax or burn entrypoint.

`src/LoyaltyTierHook.sol` takes exactly one constructor argument, `IPoolManager`. All economics are
source constants. The hook has no admin, setter, pause, upgrade, arbitrary payout, approval or sweep.
Its address must carry exactly the four permission bits **0x00cc** in its low 14 bits:
`beforeSwap`, `afterSwap`, `beforeSwapReturnDelta`, `afterSwapReturnDelta`. The constructor calls
`Hooks.validateHookPermissions`. Both swap callbacks and `unlockCallback` require the configured
PoolManager. Unadvertised callbacks have no implementation and revert if called directly.

| Tier | Lifetime ETH volume in this pool | Hook fee |
| --- | --- | --- |
| 0 | Below 0.01 ETH | 100 bps |
| 1 | At least 0.01 ETH, below 0.1 ETH | 75 bps |
| 2 | At least 0.1 ETH, below 1 ETH | 50 bps |
| 3 | At least 1 ETH | 25 bps |

Volume is a checked `uint128` counter per `(PoolId, identity)`. The rate always uses volume **before**
this swap; volume and `VolumeAdded` update afterward. A crossing swap pays the old rate. Tier views
use inclusive thresholds. Reaching a tier costs the fees paid on the way, so ordinary size trades
cannot farm tiers for free. Fees intentionally round down: individual dust fees can be zero, but
there is no rounding-up minimum. Gas and the pool's LP fees also affect trading costs. Activity in
a private pool cannot discount a different pool, even if both use this hook and the same tokens.

The eligible identity is `abi.decode(hookData, (address))` only when the data is exactly 32 bytes,
canonically encoded, nonzero and equal to `tx.origin`. All other data, including missing, malformed,
router or mismatched identity data, receives 100 bps and credits nobody. **hookData is unauthenticated**;
this check confirms only the transaction origin's claim for pricing. It never authorizes moving
funds, proves who funded a trade, or grants withdrawal rights. Relayed or bundled smart-contract
wallets naming their wallet address never earn a discount. A router must encode the connected EOA
as `abi.encode(wallet)` and must enforce its own user authorization and slippage limits. A relayer
claiming its own origin would earn volume for that origin, not for its customer's wallet.

For native-ETH pools, a buy is `zeroForOne` and a sell is `oneForZero`:

| Mode | Fee base / recorded ETH leg | Returned fee delta | Effect |
| --- | --- | --- | --- |
| Exact-in buy | Absolute specified ETH input | Positive specified delta in `beforeSwap` | Pool gets input less hook fee; user pays exactly specified ETH |
| Exact-out sell | Specified ETH output | Positive specified delta in `beforeSwap` | Pool outputs requested ETH plus hook fee; user receives exactly specified ETH |
| Exact-out buy | Absolute raw pool ETH input | Positive unspecified delta in `afterSwap` | Hook fee adds to ETH owed; specified TIER output is exact |
| Exact-in sell | Raw pool ETH output | Positive unspecified delta in `afterSwap` | Hook fee reduces ETH received; specified TIER input is exact |

Every hook fee is `floor(ethLeg * bps / 10_000)`, independent of the pool's 3000-pip LP fee.
The full-fill check compares the raw specified delta to the original amount adjusted by any
specified hook fee. A partial fill reverts with `PartialFill`, including when a price limit or
exhausted liquidity prevents execution. The PoolManager wraps callback errors in `WrappedError`.
Dust fees of zero are accepted. A pool whose `currency0` is not native ETH gets zero hook deltas,
no volume, no events and no additional full-fill restriction.

Fees become ERC-6909 ETH claims via `poolManager.mint` inside swaps. No ETH is withdrawn in a swap
callback, so the first buy succeeds with no ETH initially in the PoolManager. `accruedFees()` reads
the hook's claim balance directly: the manager's claims are the single liability ledger, including
unsolicited claim donations. Anyone may call `burnFees()` outside another manager unlock. The hook
opens its own unlock, burns **all** claims first, then takes the corresponding ETH directly to
`0x000000000000000000000000000000000000dEaD`. This zeroes its liability before the external transfer.
Failed transfers revert both the burn and payout. Empty calls return zero. There is no caller reward
and no choice of recipient. Sending to dEaD is a sink transfer, not a reduction of native ETH supply.

Views are `volumeOf`, `tierOf`, `feeBpsOf`, `nextTierAt` and `accruedFees`. `nextTierAt` returns the
next **absolute** threshold in wei, or zero at tier 3; subtract `volumeOf` for the remaining volume.
`VolumeAdded(poolId, user, ethLeg, total, tier)` indexes the pool and user and reports the **new** tier.
`FeesBurned(amount)` reports the amount sent to dEaD. See [ABI documentation](docs/ABI.md).

Run with Foundry and Solidity **0.8.26**:

```sh
forge build
forge test
forge fmt --check
python3 tools/export_abi.py --check
```

All imported Solidity dependencies are ordinary vendored files under `lib/`; compilation and tests
need no network, RPC, environment variables, FFI or filesystem cheatcodes. The compiler is pinned by
version, targets Cancun, uses optimizer runs 200 and `bytecode_hash = "none"`. Install that compiler
in the normal Foundry compiler cache before running offline. Tests deploy genuine v4 PoolManagers
and CREATE2-mine actual hook deployments; they do not relocate or bypass hook validation.

The suite covers a factory-shaped one-sided TIER seed and both first-buy modes into an ETH-less pool;
all four swap modes and their settlements; dust; thresholds at and 1 wei below; old-rate crossings;
pool and identity isolation; non-ETH pools; direct callback rejection; partial-fill rollback; bounded
fuzzing; volume overflow; claim donations; failed and reentrant payouts; token success/failure cases;
and stateful fee, volume and settlement conservation. The overflow test alone injects an otherwise
unreachable historical volume with `vm.store`, then tests genuine swaps at the `uint128` boundary.

The supplied workflow has **no numeric manifest price, liquidity allocation or factory source**.
The rehearsal therefore exposes these inputs and records explicit defaults; it cannot claim an
exact comparison with a manifest that has not been supplied. The manifest contributor can adopt the
documented values or align the rehearsal to its chosen values. See [deployment parameters and
responsibilities](docs/DEPLOYMENT.md) and [review notes](docs/REVIEW_NOTES.md).
