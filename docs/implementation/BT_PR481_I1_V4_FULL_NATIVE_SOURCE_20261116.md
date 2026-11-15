# BT-481-I1 | Frozen V4 native all-route source reconstruction (offline)

Research evidence date: **2026-11-16 JST**. Owner PC isolated BT worktree, PR #481 Draft. No LIVE, VPS, Codex source worktree, real order, STOP or account action.

## Evidence and provenance

- **Reference Git SHA:** `9118eeaa6c209dc6e37887cf5be139b3baaa005d` (pre-Codex source snapshot). **This is NOT a current LIVE SHA certification.**
- `lib/bt-verification/pinned-native-v4-full/source-manifest.json` pins nine upstream source blobs (candidate builder, native source calculation, production feature adapter, V2 route selector, catalog, X1 policy/config, and policy JSON inputs) with their exact original Git blob SHA256.
- `scripts/bt-hp-v4-full-source-integrity-selftest.py` fetches each original blob *locally via Git object*, independently calculates SHA256, reverses only the explicitly declared import-path changes and compares source bodies exactly after normalization of Windows line endings. No source logic is rewritten.
- The shared H2 `v12-v4-native-core.ts` is source-identical apart from **a type-only import redirection**; `integratedProductionRiskPolicy.ts` is source-identical after line-ending normalization. Source checks PASS.
- `h1-bar-types.ts` and `dd1296-entry-policy.ts` are isolated type declarations to avoid loading LIVE lifecycle, order and STOP paths. They are **not** represented as untouched original full modules.
- `inspectV4FullNativeSynthetic` only passes completed, gap-checked H1 candles and adapted synthetic quote-volume/base-volume into the original pure `buildV4LiveDecisionBatch` function. No venue import at runtime, no orders or portfolio state mutation.

## Offline artificial source evaluation

Test: `scripts/bt-hp-v4-full-native-source-selftest.ts`. Synthetic v4 33-symbol feed, seed `20261115`, scenario `rotation`, interval **2025-10-01 00:00Z to 2025-10-23 00:00Z exclusive**.

| Metric | Observed source-only result |
|---|---:|
| H2 scheduled boundaries | 264 |
| Warmup/incomplete 245-H1 boundaries | 122 |
| Complete frozen source evaluations | 142 |
| Source candidate rows, **not fills** | 118 |
| Distinct source route names | 23 |
| Source-reported filtered rows | 9 |
| Native H2 core events in complete source period | 2 |
| Source verified executable entries | 0 |
| Orders / fills / positions / Gross / PnL | **0 / 0 / 0 / N/A / N/A** |

The earlier isolated FAILED_BREAK H2 probe showed **3** events over the longer 61-H2 warmup, while the complete source builder only has **2** in its shorter 245-H1-as-of history; those counts are *not interchangeable*. The sample route outputs include REC_X09 and REC_Y06 but repeated H2 candidates are not separate executable orders or modeled trades.

Strict negative tests reject missing source symbols, fewer than 245 H1 bars, duplicated/gapped timestamp, future/unfinished candle, NaN quote and off-H2 decision time. The original method's data-only result is checked against independently injected H1 data at the same clock time, and never grants order authority.

Saved inspectable evidence: `reports/bt-verification/BT_PR481_I_V4_FULL_SOURCE_20261116.json`, including SHA of its source manifest.

## FAIL-CLOSED caveat — do not promote to production

Original source `V12_V4_V2_STATUS` is **`BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06`**. The source reconstruction does not resolve this leakage or prove external Y06's forward causal validity. Also, synthetic H1 input derives approximate base volume from quote volume. Exit policies, actual market reference quote, transaction costs, STOP and admission were not executed.

Therefore 118 source candidates cannot be counted as integrated STABLE4 portfolio entries, wins or profit. The operator-approved current V4 pin may differ from `9118eeaa6`; a read-only source comparison and independent out-of-sample anti-leakage test are required before any economic claim.

## Continuation

BT-481-I1 is a completed *source reconstruction subtask*. BT-481-I remains open for **current V4 pin reconciliation, source-fresh candidate semantics and time-causal Y06 independent verification**. Tasks J/K/L/M/N are also open. No main-branch merge or HP release is authorized or implied.
