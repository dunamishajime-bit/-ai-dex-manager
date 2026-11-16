# STABLE4 Q102 native state parser: offline proof (2026-11-17 JST)

## Scope and verdict

**PASS_OFFLINE_NATIVE_STATE_PARSE_ONLY** at candidate source SHA `4216fba9dcb1e10e2a57f2c658cb182bd3b476c2`, using only owner PC private historical state and the checked-out candidate Native engine. **NOT** Root/parser source trust certification, Q102 old-writer exclusion, bootstrap installation, approval or LIVE readiness.

New isolated reader: `scripts/stable4-q102-offline-native-parser-check.ts`.

- The supplied `--source-sha` must be a full 40-hex Git HEAD and checked-out native engine and both seed files must reproduce the exact pinned Git blob. Windows CRLF checkout is accepted **only if byte-for-byte LF normalization reproduces that Git blob**; this cannot authorize a VPS release.
- Private input state, its summary, and rolling H1 source must be existing regular files under the explicit local `C:\tmp` (or Unix `/tmp`) evidence root. No real `/var/lib/disdex` state is accepted.
- Native `Stable4Q102OnlineEngine` is instantiated in `mode:'OFF'`. No `observe()` or `refreshOutcomes()` is invoked. It reads state and both pinned seeds and checks exact model frontier and counts against the private summary and input rolling H1 cache SHA256.
- It independently re-reads the original state, requiring identical SHA256, file size, modification and change timestamps after parsing. No private input bytes are printed to standard output and no files are written.
- Current private state SHA256 `a1a5bb448311631ff3b42a846e8e85c9434f2c93a4a677b1c114ec0f8a922067`, observedThrough `1794826800000`, **52 pending**, 0 completed, 0 unresolved. All agree with previously persisted PC observation summary.
- Synthetic negative tests: 3 PASS (missing parameters, invalid commit, nonprivate path). Repository `npm run typecheck` PASS.

The check proves only that **this** read-only Native decoder can parse **this** private observation state with the source pinned in the test. It deliberately emits `writerExclusionCertified=false`, `bootstrapInstallationAuthorized=false`, `sourceClosureCertified=false`, `productionReady=false` and `ordersSent=0`.

## Remaining hard gates

Q102 still has 52 uncompleted causal outcomes. The separate public-M5/funding request plan (7 symbols) is stored privately and has not been collected. Before any source or state install: independently collect public evidence through the approved immutable SDK and shared API budget, reproduce source evidence hashes, settle or label each outcome, perform cross-process old/new writer exclusion and Root parser trust review, transaction/rollback proof, and exact owner-approved source/risk/DD certification. Existing `DRAFT_BLOCKED` statements are unchanged.

No live Runner, VPS, order, position, STOP, Kill Switch, authorization or learning state has been modified.
