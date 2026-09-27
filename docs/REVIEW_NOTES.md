# Implementation review notes

These notes and tests are the source contributor's checks. They do not substitute for the separate
independent adversarial review of the accepted source and final manifest.

| Attack surface | Implementation and evidence |
| --- | --- |
| Wrong hook address flags | Constructor validates all 14 permissions; real CREATE2 deployment and invalid-bit deployment test |
| Forged callbacks | Both swap callbacks and redemption callback check the immutable manager; direct calls revert |
| Borrowed tier | Exact 32-byte, canonical, nonzero origin claim only; mismatched high-tier address, missing/zero/malformed/router identity and wallet/bundler cases tested |
| Rate chosen after crossing | No volume changes in beforeSwap; afterSwap prices before writing volume; exact boundaries and old/new rates asserted |
| Reentry between rate reads | beforeSwap calls only trusted core mint, which does not call recipients; core swap calculation makes no untrusted calls before afterSwap |
| Volume overflow | Checked uint128 total, explicit error and atomic rollback; real swaps exercise synthetic near-maximum history |
| Private-pool farming | State includes full PoolId; discounted private pool leaves launch pool at 100 bps |
| Fee sign and rounding | Positive specified/unspecified deltas only; all four modes compared with raw manager Swap events and actual user balances; dust and fuzz cases |
| No-op / confiscation | Specified fee is at most 1%; core gets remaining input or requested output plus fee; full-fill assertion rejects an incomplete pool swap |
| First-buy settlement | Claims minted instead of taking ETH in callbacks; factory-shaped ETH-less seed succeeds with exact-in and exact-out first buys |
| Liability drift | No duplicate accrued-fee counter; actual ETH claim balance is authoritative, and donated claims burn too |
| Arbitrary payout or theft | No hook approval, withdrawal, recipient parameter or sweep; third-party claim transfer/burn attempts fail |
| CEI and failed payout | Entire claim balance burned before take; reentrant burn sees zero; failed ETH delivery restores all claims atomically |
| Stateful accounting | Random all-mode/identity swaps and burns compare an event-derived ghost ledger to claims, volume, sink receipts and zero transient deltas |
| Mutable code / supply | No owner, proxy, delegatecall, selfdestruct, public mint or mutable economics; deployed-runtime opcode scans and admin selector rejection tests |

The identity rule is intentionally not signature authentication. It binds a pricing claim to the
transaction origin, not to asset ownership. Integrating routers must provide their own authorization
and slippage protection. Token pools other than TIER are not allowlisted: every native currency0 pool
uses the same per-pool rule. Non-native currency0 pools are untouched. Unusual third-party token
behavior is outside the TIER launch, whose token is a standard ERC-20 without transfer fees/hooks.

Remaining launch inputs for independent review are the final manifest's price/allocation/range,
actual factory CREATE2 deployer and constructor bytes, and the selected frontend router. These were
not included in the source assignment. The explicit local defaults are documented in DEPLOYMENT.md.
The local suite establishes behavior with a real vendored core manager; it is not evidence of a
Sepolia transaction, factory-source equivalence, a fork rehearsal, admission or an independent audit.

Foundry's static lint flags the required `tx.origin` comparison, narrowing casts and external-call
ordering. The comparison is only a pricing claim, casts are preceded by explicit magnitude/total
bounds, and the swap-time external call is trusted core mint with no recipient callback. Payouts
clear all claims before transferring ETH. These reasons are checked by the identity, overflow,
settlement and reentrancy tests rather than disabling the corresponding project-wide lint rules.
