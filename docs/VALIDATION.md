# Frontend validation and Better Interface review

## Scope and assumptions

One static English-language ETH/TIER page, implemented under `web/` and exported to `dist/`, for the handoff's existing Sepolia contracts. Existing Solidity, vendored contracts, root build files and root documentation are unchanged. No keys, deployment, wallet broadcast, source publication, IPFS pinning or naming were performed.

The pinned workflow, deployment/network handoffs, Better Interface workflow and six domain cores, design-documentation section, implementation source, ABI exports and supplied protected tests were read. The protected Foundry suites describe the already deployed implementation; they were not changed or rerun for this frontend-only task.

Two assignment conflicts are explicit:

1. Root `DESIGN.md` is outside the write allowlist. Its complete content is delivered at [DESIGN.md](DESIGN.md).
2. The specific website/workflow requires PoolSwapTest, while the generic network routing clause names an unchanged object that contains no PoolSwapTest address. The explicit router was used, centralized in runtime `routing.poolSwapTest`; the supplied `network` block is unchanged. Quotes use its quoter and pool reads use its StateView. Approvals target the assigned PoolSwapTest, with no Permit2/Universal Router approvals. This exception is also explained in [the frontend README](../web/README.md).

The page supports direct EOA swaps through injected wallets. Accounts with code have live reads but cannot use this swap form; this also conservatively excludes delegated accounts. This avoids presenting an EOA-origin quote as valid for a relayed smart-wallet transaction.

## Commands and results

All commands ran on this worker with Node 22.23.2 and npm 10.9.8. They are worker evidence, not independent certification.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm --prefix web ci --offline --cache /tmp/tiers-npm-cache --no-audit --no-fund` | Passed using the populated worker cache; 463 packages installed from lockfile | No dependency archives or cache included in Git; transitive deprecation/peer notices did not block installation |
| `npm --prefix web run build` | Passed; includes `tsc --noEmit`, pinned ABI checks, Vite production build and final manifest generation | [build.log](frontend/build.log) |
| `npm --prefix web test` | 28 production-browser checks passed, with five mocked transaction requests and zero real broadcasts | [interaction-results.json](frontend/interaction-results.json), [interaction.log](frontend/interaction.log) |
| `npm --prefix web run check:live -- 11791541` | Passed chain/code/manager checks, pinned state reads, seed/event queries, a live quoter call and read-only router simulation | [live-check.json](frontend/live-check.json) |
| `npm --prefix web run check:export` | Passed exact handoff fields/contract set, unchanged network/wallet parameters, pinned canonical ABI hashes, complete SHA-256 inventory, safe paths and relative base | [export-check.json](frontend/export-check.json) |
| Source/packaging checks | Only allowed delivery paths; no submodules or packaged dependencies/caches; complete scratch validation Git bundle below 8 MiB | [submission.json](frontend/submission.json) |

The production export is approximately 0.55 MiB, plus its small manifest, with six listed assets. The final report gives exact bytes. Each exported asset is far below 8 MiB; the count is below 128 and the total is comfortably below the HTTP response-budget ceiling. The runtime manifest excludes itself from its SHA-256 inventory.

ABIs were read with `git show fb1d145d61b1c427f180f852ba60ddab5840e44f:docs/abi/<Contract>.json`, compared to the existing export files, and checked against the exact handoff hashes:

- TIER: `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee`
- LoyaltyTierHook: `2b055d178e44e04a5eade61e4ea7f490d295c2d2b98190a3d2dec78fa7d4d7d9`

## Browser and interaction evidence

The supplied browser MCP returned `Transport closed`. A foreground Playwright script instead launched the installed Chromium **154.0.8037.0**, served the final export under `/preview/`, and closed the browser/server before exiting. Chromium's writable crash/cache locations were set under `/tmp`; no permission escalation was used.

Browser checks used actual production JavaScript with intercepted JSON-RPC and an isolated fake injected wallet. Screenshots therefore show **mocked chain values**, not live user balances. No real wallet or real funds were used. Primary checks include:

- Disconnected and missing-wallet guidance; user rejection; wrong network; the exact add-chain payload followed by a successful switch.
- All tier views and next-volume calculations; validation of negative/over-precision amounts and focus; exact-input buy and sell quote encoding; connected-wallet `hookData`.
- Quote invalidation/expiry; simulated router rejection including a real ABI-shaped nested `WrappedError(PartialFill)`; exact buy fee display.
- Native-value buy, separate exact token approval, zero-value sell, acknowledgement before burn, confirmation links and reverted receipts.
- Account changes, stale/expired eligibility, contract-code checks, mismatched manager/RPC chain, RPC outage/retry, unavailable smart-account swaps and fail-closed ABI tampering.
- Successful event decoding and bounded 500-block RPC chunks; a zero-current-liquidity pool remains eligible for a quote.
- Keyboard-only wallet connection, switching, form navigation and quote submission. Native focus rings were checked and visible screenshots inspected. Reduced-motion mode removes the optional transition.
- Zero uncaught browser errors or failed static assets. Widths 1440, 900, 390 and 320 CSS pixels had no document overflow. Root text enlargement to 200% also had no document overflow; this is not browser-native zoom.

Rendered screenshots were opened and visually inspected for hierarchy, layout, labels, wrapping, clipped content and focus:

- [Desktop disconnected](frontend/desktop-disconnected.png)
- [Desktop with quote and current tier](frontend/connected-quote.png)
- [Desktop event list](frontend/desktop.png)
- [390px mobile](frontend/mobile-390.png)
- [320px mobile](frontend/mobile-320.png)
- [Skip-link focus](frontend/keyboard-focus.png)
- [Amount-field focus](frontend/input-focus.png)

Axe WCAG 2 A/AA and 2.1 AA scans found **zero violations** at all four widths: [1440](frontend/axe-1440.json), [900](frontend/axe-900.json), [390](frontend/axe-390.json), [320](frontend/axe-320.json). Remaining automated contrast-review items concern decorative, aria-hidden symbol characters; they are recorded, not silently counted as passes. These scans do not establish full accessibility compliance.

## Better Interface: all six domains

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native buttons/fields/table/progress/details; named direction group; connected labels/errors; keyboard quote flow; visible skip/input focus; reduced motion; axe scans. No screen-reader or physical assistive-technology session. |
| Layout | Checked | Desktop two-column grouping, intermediate width, stacked mobile at 390/320px; screenshots and overflow assertions; long contract values wrap in source. No RTL/translated locale or native 200% browser zoom test. |
| Writing | Checked | Action labels state connect, switch, quote, approve, confirm and burn; errors preserve reason and recovery; pool-price limits are not described as minimum output; fee economics, identity and irreversible burn are explicit. |
| Typography | Checked | Descending heading roles, system serif/sans contrast, numeric stability, wrapping, 16px+ fields and final screenshot inspection. Platform-specific font substitution was not independently audited. |
| Colors | Checked | Semantic palette and rendered computed pairs measured; current tier/status have text cues; seven sampled text pairs exceed 4.5:1. Decorative symbols and disabled controls are excluded from the text-pair claim. Only the implemented light theme exists. |
| UI | Checked | Direction selection, focus, loading, rejection, errors, empty/populated events, approval/swap steps and disabled prerequisites exercised. Modals, media, draggable controls, theme changes and staged animations are not applicable. Native mobile Safari behavior and animation-panel playback were not performed. |

[contrast.json](frontend/contrast.json) records measured foregrounds/backgrounds: hero 11.76:1, accent hero 6.93:1, secondary text on panel 6.23:1, primary action 8.72:1, burn text 5.29:1, error text 6.83:1, current row 10.70:1. Transparent elements were resolved to their actual opaque ancestor background. This is a sample of rendered roles, not a claim that every possible browser state was exhaustively measured.

## Findings, corrections and rechecks

Source locations refer to the final source; the described defect was corrected there.

| Severity / domain | Location | Finding and impact | Correction and recheck |
| --- | --- | --- | --- |
| High / UI | `web/src/App.tsx:38` | Connecting on an unknown chain could leave a wallet-client query tied to the configured chain, so an apparently eligible confirmation had no signer. Reproduced by switching after 4902. | Query follows the actual connected chain and is enabled on the supported chain; controls require a wallet client. Full add-chain → quote → swap mock passed. |
| High / UI | `web/src/App.tsx:228` | A blanket zero-active-liquidity guard would block the real launch's first buy, although its adjacent seeded range is reachable. | Keep uninitialized-pool blocking; allow quotes at zero active liquidity with an explanation. Live tiny quote and limited router eth_call succeeded; browser regression passed. |
| Medium / writing | `web/src/chain.ts:47` | Generic RPC short messages concealed actionable revert details; v4 additionally wraps hook errors. | Preserve RPC details and decode nested revert bytes with the runtime hook ABI. Encoded WrappedError/PartialFill test gives a smaller-amount/price-limit recovery message and no wallet request. |
| Medium / accessibility | `web/src/App.tsx:472` | A labeled generic direction container was flagged for manual ARIA review. | Added native-button group semantics. Final axe scans no longer report that item. |
| Medium / writing and typography | `web/src/App.tsx:575` | Six-digit display formatting cut an included buy fee of 0.0000075 ETH to 0.000007 ETH. | Render the fee's complete wei-derived decimal value. Browser assertion and final quote screenshot rechecked. |
| Medium / UI | `web/src/App.tsx:250` | A quote whose simulated origin is a smart wallet cannot reliably predict a bundled transaction's identity discount. | Keep its live reads but disable swaps from accounts with code, with explicit direct-EOA guidance. Browser smart-account regression passed. |

No known blocking implementation finding remains in the chosen scope. No design redesign, contract modification or deployment was needed.

## Live-chain evidence and limitations

At pinned block **11,791,541**, pool `0x14fee65af69b83594081174ae11f2bfbe9b16cee1bb1c31d82fba8ac9d94f231` had sqrtPriceX96 `560227709747861399187319382274582`, active liquidity zero, LP fee 3000 and zero accrued hook fees. The deployment's seed event at block **11,791,391** placed liquidity between ticks **−887220 and 177240**. No hook volume/burn events were found in the complete queried deployment-to-snapshot window.

The live quoter returned **49.133859246231437308 TIER** for a **0.000001 ETH** exact-input buy. The assigned PoolSwapTest also completed an **eth_call** at the same pinned block with a 0.5% price movement limit. That simulation temporarily overrode the synthetic sender's native balance to 1 ETH; it neither funded a real account nor broadcast a transaction. The negative packed BalanceDelta and exact inputs are preserved in the report. Reproduce with the checked-in live script and pinned block argument. The script uses the configured public RPCs and records every attempted method/endpoint.

Unperformed: real signed wallet-extension transactions, live token sell/approval/burn with actual funds, mempool behavior or price movement while a transaction is pending, screen-reader/native-device sessions, native browser zoom, other browser engines and publication checks. Local expiry is not an onchain deadline. The test router has no output-minimum parameter. Public RPC availability, historical state support and user gas funding remain runtime dependencies.

Git staging in the working repository was attempted and rejected with `Unable to create .git/index.lock: Read-only file system`. No commit was created in the working repository. A temporary repository under the explicitly allowed `test/scratch/` was used only to construct and measure a complete Git validation bundle. The deliverable remains in the working tree for the network submission process.

Completion: **implementation, export and validation complete for the frontend worker scope; working-repository commit blocked by read-only Git metadata**, subject to the two disclosed contradictory requirements above. The publisher and independent control-plane checks have not run and are not claimed as worker evidence.
