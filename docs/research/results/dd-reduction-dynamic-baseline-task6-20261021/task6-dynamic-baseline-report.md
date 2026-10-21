# Task 6 — overlay-free dynamic baseline

Status: `BLOCKED_WITH_EVIDENCE` / `BLOCKED_INCOMPLETE_SOURCE_COVERAGE`

The runner and first-divergence comparator are research-only and use the Task 1–5 single causal reducer. The baseline policy is explicitly overlay-free: no Task 9 adverse-stop rule is accepted or applied. Conditions are 2025-08-10 through 2026-08-10 UTC, initial wallet ¥10,000, no deposits, compounding, H1 price-model replay, and separate 10bps/30bps cost cases.

The available source is the exact 3,185-row candidate-decision artifact for each cost case and covers all eight logic IDs. It is not sufficient for causal replay: every row is fail-closed by the existing source normalizer because the artifact does not provide the canonical required `validity` and `entry_price` fields. The runner therefore replayed zero candidates, preserved the source SHA/byte metadata, and did not synthesize missing values. This is not formal parity.

| Cost | Observed | Normalized | Fail-closed | Replayable | Classification | Result hash |
|---:|---:|---:|---:|---:|---|---|
| 10bps | 3,185 | 0 | 3,185 | 0 | `BLOCKED_INCOMPLETE_SOURCE_COVERAGE` | `9a5a791acbdafbff028a59bb57b4f4e46f7cde26bf995269b2496f5711c11f2d` |
| 30bps | 3,185 | 0 | 3,185 | 0 | `BLOCKED_INCOMPLETE_SOURCE_COVERAGE` | `322622a44cec90ffc8e5c16bc41af539d206ce8349b3289078266a785d1a1ab7` |

Both CLI cases were run with `--verify-determinism`; the independent replay result and all five ledger hashes matched within each cost case. Since the historical anchors provide scalar results but no event ledger, the first divergence is metric-level (`final_equity_jpy`, dynamic ¥10,000 versus the corresponding anchor), with event/candidate/allocator fields recorded as unavailable rather than invented.

Verification evidence:

- focused `tests/dd-reduction-dynamic-baseline.test.ts`: 7/7 pass;
- full `npm run dd:reduction:test` through the permitted PowerShell runner: 16/16 files pass, 0 failed, 0 skipped, 0 todo;
- `npx tsc --noEmit --incremental false --pretty false`: exit 0;
- targeted ESLint for the two scripts and test: exit 0;
- `git diff --check`: exit 0.

Large JSONL outputs are retained only under `C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-21_dynamic_baseline_task6\`; only this compact report and manifest are intended for Git.
