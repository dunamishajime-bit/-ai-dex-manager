# 2026-11-14: V4 / HYPE immutable release source-diff evidence for BT #481

## Method

Read-only SSH into Xserver VPS, hashing and comparing an allowlisted subset of source files from two immutable release directories, with CRLF/LF normalization. The repeatable script is `scripts/bt_hp_release_source_diff.py`. It does not read credentials, send orders, or alter the running environment. The private full per-file JSON evidence stays on the owner's PC. The script reports SOURCE_SEGMENT_DIFF_UNVERIFIED; it never certifies full strategy economics.

| Logic | Research source label | Current/last running release | Source files sampled | Normalized identical | Changed | Present only in newer |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| V4 | `53a0be396719f0284af4e11b35c66a4ac7d58f79` | `795fefbbbb1c1176c80c7fd8391347578dadd0d5` (currently failed) | 69 | 49 | 11 | 9 |
| HYPE | `7688ed7c93a1918d8b44837339b7da5584a868f5` | `a7eee1f91d86d51f2333da117243d044ae1332dc` | 19 | 15 | 3 | 1 |

Private evidence hashes:
- V4 normalized diff JSON SHA256 `09C7066185F78F6C782E3A661E91860475BD36C87CAD7BDC60F79645E950C425`
- HYPE normalized diff JSON SHA256 `6C2BB964AFACAA6490C5466A41233927AB673222CB50422945E96AA2C2584424`

## V4 findings

Among the 49 identical files are the strategy/market candidate and route definitions (`v12-v4-live-candidate-builder.ts`, `v12-v4-core-candidate.ts`, `v12-v4-native-core.ts`, `v12-v4-four-rule-policy.ts`, `v12-multilogic-v4-shadow.ts`, `v12-v4-v2-shadow.ts`, `v12-x1-all.ts`, runtime `v12X1AllRuntime.ts` and strict portfolio planner).

Changed files include `v12-v4-runner-engine.ts`, `v12-v4-production-runner.ts`, `v12-v4-production-lifecycle.ts`, `v12-v4-certified-gates.ts`, `v12-v4-durable-orders.ts`, `v12-v4-shared-reservations.ts`, `v12-v4-stop-retirement.ts`, `v12-v4-venue-exit.ts`, `v12-v4-peer-account-mark.ts`, flat-lineage migration files. Added files include execution-phase, account-freshness, local entry-rejection, state publication and other runtime safety/ops modules.

**Implication:** Candidate/route source stability narrows the investigation, but LIVE entry timing, risk arbitration, STOP and exit execution changed. V4's observed 19:15 failure is an example of runtime behavior not reproduced by the older model BT. There is no current-SHA fully causal V4 BT certificate.

## HYPE findings

All reviewed signal, sleeve, market-data, priority/capacity and policy modules are identical, including `hype-trend-long-signal.ts`, `hype-zec-long-sleeves.ts`, `hype-zec-long-market-data.ts`, `hype-zec-preemption.ts`, `hype-zec-priority-capacity.ts`, and the three HYPE policy/runtime config modules.

The changed files are `hype-zec-long-runner.ts`, `hype-zec-long-runner-state.ts` and `disdex-hype-zec-long-live-runner.ts`. The new Runner includes shared Kill Switch entry suppression and V4 STOP ownership validation, along with mutation telemetry and state-persistence changes; one new HYPE recovery script is present only in the later release.

**Implication:** The HYPE *signal policy* appears stable in the reviewed source scope, but an old-Gate BT could count entries the current runtime would have blocked. Exact historical Kill Switch, V4 STOP ownership, shared Gross and market-data state must be replayed before any economic parity claim.

## Release-source and BT model boundaries

These comparisons are source-file slices, not an execution-time trace. The historical STABLE4 model is Python research code rather than a native execution of the current TypeScript runners, and its source pins are provenance labels. Matching code files does not prove a matching historical signal/order/fee/STOP stream. The currently failed V4 unit and venue-protected DOGE position are documented separately in `BT_HP_V4_STALE_RUNNER_STOP_PROTECTION_20261114.md`.

Before formal HP deployment: recover/review immutable source provenance in GitHub, build current pinned research adapter with exact gate inputs and lookahead-safe market data, verify 10/30bps integrated fills and per-position Gross, and preserve private OWNER-only review. PR #481 remains research Draft; LIVE state and exchange were not modified.