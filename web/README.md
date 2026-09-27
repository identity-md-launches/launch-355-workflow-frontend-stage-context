# Tiers frontend

One static React + TypeScript + Vite page for the deployed Sepolia ETH/TIER pool. Wagmi manages injected browser-wallet connections; viem handles ABI encoding, reads, simulation, and wallet requests. The committed `../dist/` is the deliverable hosted by the publisher. No server, private credentials, WalletConnect project ID, external fonts, or asset CDN is required.

## Install, build, preview

From `web/`, using Node 22:

```sh
npm ci
npm run typecheck
npm run build
npm run check:export
npm run preview -- --host 127.0.0.1
```

`npm ci --offline` also works when the lockfile's packages are already in the local npm cache. A registry mirror or dependency archive is deliberately not included. The worker verified a lockfile installation with its populated cache and network disabled for npm.

The build runs the type checker, validates the pinned contract ABIs, runs Vite with `base: './'`, and generates `dist/imd-deployment.json` **after** export. Its inventory covers every other exported file. Build again after any source/configuration change; never edit a hashed export by hand. `npm run dev` prepares the same runtime configuration before starting Vite.

## Configuration and provenance

- `config/deployment.json` is the supplied deployment handoff, unchanged. `config/network.json` is the supplied network handoff, unchanged.
- `config/routing.json` contains the PoolSwapTest address explicitly assigned to this website. It is merged into the runtime manifest as `routing.poolSwapTest`.
- `scripts/prepare.mjs` reads `docs/abi/<Contract>.json` **from the handoff's exact Git source commit**, compares the working copies, verifies recursive-key-sorted canonical JSON Keccak-256 hashes, and copies the original ABI bytes into `public/abi/`. It does not compile or change contracts.
- `public/imd-deployment.json` is the generated development configuration. Vite copies it; `scripts/manifest.mjs` fills the final export's asset inventory. `src/config.ts` loads the **export's own** manifest and referenced ABI JSON at runtime and verifies ABI hashes. There is no second deployed address/chain/ABI map in the application.
- The supplied `network` and `walletAddChain` objects are retained intact. Public RPC failover, explorer URLs, StateView, quoter, PoolManager and faucet links all come from them. Minimal protocol interfaces live together in `src/config.ts`; deployed token/hook interfaces come only from the hashed ABI files.
- A checkout must retain the pinned source commit so subsequent builds can verify ABI provenance. The static export needs no Git history at runtime.

## Explicit requirement conflicts

The approved workflow and assignment explicitly require PoolSwapTest. The generic network acceptance paragraph calls for all routing addresses to come from `network.uniswapV4`, whose supplied object has Universal Router but **no PoolSwapTest entry**. The implementation follows the named workflow router, keeps `network` unchanged, and centralizes this one exception in `routing.poolSwapTest`. Buys, sells and ERC-20 approvals use that router; quotes use the supplied network quoter. There are no Permit2 or Universal Router approvals. The app verifies PoolSwapTest's `manager()` against the supplied PoolManager before enabling transactions. This interpretation is disclosed rather than silently substituting routers or altering the vetted network block.

The request for repository-root `DESIGN.md` conflicts with the explicit write allowlist. The design document is delivered as `docs/DESIGN.md`. No root configuration or deployed source was changed.

## User flows and contract behavior

Public reads work before connecting. The app verifies the RPC chain, nonempty code for the token, hook, router, manager, StateView and quoter, and manager bindings for the hook/router/lenses. It reads token decimals and symbol and checks them against the handoff. Wallet reads include all four tier views, balances, allowance, and account code. Reads share a block snapshot, refresh every 45 seconds or on demand, and become ineligible for transaction use after 60 seconds.

A wallet on an unknown chain is offered `wallet_addEthereumChain` with the exact supplied parameters after switch error 4902, then switched again. Signing uses the connected provider; public reads use the configured public RPCs. The UI supports discovered injected wallets without a project ID. A direct EOA is required for this form's swaps. Accounts with contract code can view state, but swaps are disabled because a relayed transaction's origin cannot be inferred reliably from an injected provider. This conservatively also excludes delegated accounts with code.

Buy/sell is exact input. Quotes call `quoteExactInputSingle` through `simulateContract` at the reviewed state block, with the connected wallet canonically ABI-encoded in `hookData`. Quotes expire locally after 60 seconds and are invalidated by amount, direction, tolerance, wallet or chain changes. A token sell first requires an explicit exact-amount `TIER.approve(PoolSwapTest, amount)`. Approval is simulated, signed and confirmed separately. Native ETH buys approve nothing. Every swap is simulated against the router before requesting a wallet signature; the two test settings are false. Negative `amountSpecified` means exact input. Buys send exactly the input as transaction value; sells send zero.

**Price protection:** PoolSwapTest accepts `sqrtPriceLimitX96`, but no minimum-output or deadline parameter. The form therefore labels its control “Pool-price movement limit,” not output slippage. It calculates the integer square root of `snapshotSqrtPrice² × (10,000 ± basisPoints) / 10,000`, decreasing on buys and increasing on sells. This bounds price movement from the reviewed snapshot, including the trade's own impact. The hook reverts partial fills. Estimated receive is not a contractual minimum; local quote expiry cannot cancel an already signed transaction. A quote can succeed while the limited router simulation fails, for example if the trade must cross a larger empty range. The failure is shown before signing.

Zero active liquidity at the current tick does not imply the pool is untradeable: the one-sided seed can be reached by a buy. The page explains this and allows a read-only quote. An uninitialized pool, missing code, wrong manager, wrong RPC chain, stale reads, wrong wallet chain and unresolved prerequisites block transactions.

Hook fees are priced from lifetime volume **before** the swap: 1%, 0.75%, 0.5%, 0.25% at 0, 0.01, 0.1 and 1 ETH respectively, with inclusive thresholds. LP fees are separate. Exact-input buys deduct the floor-rounded hook fee from the ETH input; exact-input sells deduct it from the ETH output leg. Fees paid to reach a tier are real costs in test ETH, so tiers cannot be farmed for free. Pool volume is isolated by PoolId. `hookData` is unauthenticated; the hook checks its claimed nonzero address against `tx.origin` only for pricing. Relayed/bundled smart-contract wallets do not earn discounts. This is a Sepolia toy with no token value or promised return.

`burnFees()` is the hook's other public user action. Its control shows accrued claims and requires explicit acknowledgement of the irreversible transfer to the fixed dEaD address. The caller gets no reward and pays gas. Manager-only callbacks are not presented as user actions. The token has no mint, pause or administrative action.

Activity decodes `VolumeAdded` for this pool and `FeesBurned` for the hook in a bounded recent window: at most 2,000 blocks, queried in chunks of at most 500, with the latest 12 events shown. The exact visible range and post-swap tier semantics are stated. This is not a complete historical index. Refresh errors are visible and retryable; partial event scans are not presented as complete.

## Validation

```sh
npm test
npm run check:live -- 11791541
npm run check:export
```

`npm test` starts its own temporary subpath preview, runs Chromium against the production export, and closes both within one foreground process. It uses an isolated mocked EIP-1193 provider and intercepted JSON-RPC, never a real wallet. Set `CHROMIUM_PATH` if Chromium is installed elsewhere. The worker default is `/opt/imd-tools/ms-playwright/chromium-1246/chrome-linux64/chrome`. Evidence is saved under `docs/frontend/`. The supplied browser MCP transport was unavailable; installed Chromium was used instead.

`check:live` is read-only and uses the manifest RPCs with `curl`. Its optional argument pins the state block. It records chain/code/manager checks, views, bounded events, the seed event, a tiny quoter call and a router `eth_call` with a clearly recorded temporary **balance state override**. It neither holds keys nor broadcasts. The mock browser tests cover sell approvals, sell swaps, burn, receipts and rejection; actual signed live swaps, wallet-extension dialogs, live sell/burn, publication, IPFS naming and post-publication verification were not performed.

See `docs/VALIDATION.md`, `docs/DESIGN.md` and the machine-readable reports/screenshots under `docs/frontend/`. These are worker checks, not independent certification.
