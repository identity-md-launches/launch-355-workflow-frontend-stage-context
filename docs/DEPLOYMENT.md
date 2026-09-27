# Deployment inputs and responsibilities

The intended network is **Sepolia, chain ID 11155111**, with PoolManager
`0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`. The hook constructor ABI is
`constructor(address manager)`; pass only that PoolManager address. `TIER` has no constructor
arguments. The contracts deliberately do not hardcode a chain ID, so the same creation code can
be rehearsed against a real local PoolManager. Choosing the network and correct manager is the
deployment service's responsibility.

| Input | Value / source |
| --- | --- |
| Token artifact | `src/TIER.sol:TIER` |
| Hook artifact | `src/LoyaltyTierHook.sol:LoyaltyTierHook` |
| Token mint | 1,000,000,000 × 10^18 units, all to its immediate deployer |
| Currency 0 | Native ETH: zero address, not WETH |
| Currency 1 | Deployed TIER address, learned from each pool key |
| Pool LP fee | 3000 pips (0.3%), static |
| Tick spacing | 60 |
| Hook permission mask | `uint160(hook) & 0x3fff == 0x00cc` |
| Hook constructor args | ABI-encoded Sepolia PoolManager only |
| Fee destination | `0x000000000000000000000000000000000000dEaD` |
| Compiler | Solidity 0.8.26, optimizer enabled / 200 runs, Cancun, metadata bytecode hash none |
| Site label for later services | `lab-loyalty-tier-hook` |

The input workflow does not supply a numeric initial price, factory address/source, token split or
liquidity range. No `launch.json` was supplied. The following are **explicit rehearsal defaults** in
`test/helpers/LaunchParameters.sol`, proposed for the separate manifest contribution:

| Rehearsal input | Default |
| --- | --- |
| Initial `sqrtPriceX96` | `792281625142643375935439503360000` = 10,000 × 2^96 |
| Initial TIER / ETH ratio | 100,000,000, since both amounts use 18 decimals |
| Initial ETH / TIER price | 0.00000001 ETH |
| TIER seed budget | Entire 1,000,000,000 TIER supply |
| Lower tick | `TickMath.minUsableTick(60)` = -887220 |
| Upper tick | Floor of the initialization tick to spacing 60; 184200 at the default price |
| Liquidity | `floor(seedAmount * 2^96 / (sqrt(upper) - sqrt(lower)))` |

The range lies entirely at or below the initial price, so only TIER is deposited. PoolManager's
amount rounding may leave token dust in the factory. The first zeroForOne buy crosses any empty gap
to the upper tick and trades against the seeded range. The rehearsal asserts zero ETH before that
buy and exact specified amounts afterward. It tests exact-in and exact-out first buys separately.
`LaunchFactoryRehearsal.launch(uint160 sqrtPriceX96, uint256 seedAmount)` accepts explicit inputs;
the test calls it directly without a script sender or environment dependency. It models the factory
behavior described in the workflow, not undisclosed production factory code. It is a test helper,
not a deployable replacement factory. Final source/constructor/price/seed disagreements remain
review findings until the source rehearsal and manifest agree.

CREATE2 deployment procedure:

1. Compile the exact reviewed hook source using the pinned settings. Append
   `abi.encode(IPoolManager(sepoliaManager))` to its creation code.
2. Hash this full init code. For the **actual CREATE2 deployer address**, search salts whose
   `keccak256(0xff ++ deployer ++ salt ++ initCodeHash)` ends in an address matching mask 0x00cc.
   `test/helpers/HookDeployment.sol` implements the same mining and address assertion locally.
3. The deployment service uses that deployer, salt, creation code and constructor argument unchanged.
   Changing any one changes the address and requires re-mining. The constructor rejects mismatched
   permission bits. No `vm.etch`, constructor bypass or permissions override is used to deploy the hook.
4. The factory deploys TIER to itself, initializes the native ETH/TIER pool, and seeds the reviewed
   one-sided range. Initialization and liquidity callbacks are disabled, so the hook does not veto them.
5. Validate the live code/ABI, pool ID/key, initialization price and seed against the reviewed inputs
   before the later frontend starts. Use the frontend's separately supplied Sepolia router address;
   tests use a local upstream `PoolSwapTest`. The router's slippage/input authorization remains an
   integration responsibility, not a hook feature.

The source contributor supplies contracts, tests and `docs/abi/TIER.json` /
`docs/abi/LoyaltyTierHook.json`. The manifest contributor writes only `launch.json`. Independent
review inspects both accepted source and manifest without implementing changes. Policy decisions
and signed artifact linkage belong to the publishing/attestation/admission/deployment services;
their later outputs are not prerequisites for this source contribution.

Operationally, anyone may trigger `burnFees()` periodically; no keeper identity or reward is needed.
Call it as its own operation while PoolManager is locked. There is no withdrawal right, sweep,
upgrade or emergency admin. Forced native ETH or foreign tokens sent directly to the hook are not
its ETH claims and have no recovery path; ordinary direct ETH sends are rejected. Claim donations
are included in `burnFees`. Monitor `VolumeAdded`, `FeesBurned` and the manager's claim balance.

An identified swap whose lifetime volume would exceed `uint128.max` reverts `VolumeOverflow`
without wrapping or silently changing tiers. Amount magnitudes above `int128.max` revert
`AmountTooLarge`; exact-out ETH plus its hook fee must also fit core's signed delta limits. Like
PoolManager's take/burn operations, a single payout assumes a claim balance no greater than
`int128.max` wei, vastly above the native supply available on the intended network. No external
oracle, VRF, token-decimal inference or dynamic-fee pool key is used.
