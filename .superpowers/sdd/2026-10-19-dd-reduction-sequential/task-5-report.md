# Task 5 report — Sequential runner and reproducible CLI

## Scope

Task 5 adds the research-only sequential runner contract. It does not change Production, VPS, Aster, LIVE, operator, systemd, secret, or runtime settings.

Implemented:

- `scripts/dd-reduction/run-baseline.ts`
  - Explicit runner argument parsing for `--source-root`, `--data-root`, `--production-sha`, `--start`, `--end`, `--output-root`, `--stage`, and `--candidate`.
  - Optional explicit research parameters for capital, deposits, fees, slippage, funding source, and `--frozen-stage`.
  - Deterministic SHA256 run/config IDs derived from source/config lineage and fixed stage/candidate inputs.
  - Canonical source loading and manifest presence checks.
  - Baseline parity evidence requirement; absent baseline ledger returns `BASELINE_PARITY_BLOCKED` and is persisted as a failed research result.
  - Accounting reconciliation failure is fail-closed and produces a non-accepted result.
  - Research output containment: repository and Desktop roots are rejected; output must be under the configured `DISDEX_AI_OUTPUT_ROOT` or the approved `DisDex_AI_Files\\01_BT_Research` hierarchy.
  - Frozen stage JSON loading with cumulative sequential-prefix validation.

- `scripts/dd-reduction/run-stage.ts`
  - Loads only the explicit prior `FrozenStageSet`.
  - Uses the Task 4 direction-specific predeclared grid and an explicit candidate ID; it does not select a candidate from observed results.
  - Replays baseline and candidate through the existing causal emulator, validates accounting, applies fixed acceptance gates, and persists result/frozen-stage/run-manifest artifacts.
  - Emits `ACCEPTED`, `REJECTED`, `NOT_APPLICABLE`, `BASELINE_PARITY_BLOCKED` (fail-closed error path), or `SOURCE_ERROR` (CLI nonzero path) semantics.

- `scripts/dd-reduction/compare-stage.ts`
  - Reports first divergence timestamp, direct PnL, lost prior-logic PnL, fee/funding/slippage deltas, gross conflicts, and DD decomposition.

- `package.json`
  - Added `dd:reduction:source`, `dd:reduction:baseline`, `dd:reduction:stage`, and `dd:reduction:test`.

- `tests/dd-reduction-runner.test.ts`
  - Covers explicit argument validation, deterministic run IDs, cumulative frozen-stage loading, repository/Desktop output rejection, absent baseline parity failure, parity-backed baseline/stage execution, and comparison fields.

- `lib/backtest/dd-reduction/types.ts`
  - Added the runner status contract and optional result lineage/artifact fields.
  - Tightened `FrozenStageSet.stageIds` to `StageId[]`.
  - Added the required comparison-report attribution fields.

## Verification

- `npx tsx --test tests/dd-reduction-runner.test.ts`
  - 8 passed, 0 failed.
- `npx tsx --test tests/dd-reduction-source.test.ts tests/dd-reduction-emulator.test.ts tests/dd-reduction-metrics.test.ts tests/dd-reduction-policy.test.ts tests/dd-reduction-runner.test.ts`
  - 74 passed, 0 failed.
- `npx tsc --noEmit --incremental false`
  - Passed, exit code 0.
- Changed-file ESLint:
  - `npx eslint scripts/dd-reduction/run-baseline.ts scripts/dd-reduction/run-stage.ts scripts/dd-reduction/compare-stage.ts lib/backtest/dd-reduction/types.ts tests/dd-reduction-runner.test.ts`
  - Passed, exit code 0.
- `git diff --check`
  - Passed, exit code 0.

## Research and safety boundary

No large BT output was created in the repository. Test artifacts use temporary directories and an explicit temporary `DISDEX_AI_OUTPUT_ROOT`; production research output remains constrained to the approved research hierarchy. No Production/VPS/Aster/LIVE/operator/systemd/secret/runtime configuration was read, changed, staged, pushed, or deployed.

## Commit

Local commit: `e5f6cf7d` (`feat: add reproducible sequential DD reduction runner`).

The two pre-existing untracked plan documents in `docs/superpowers/plans/` were left untouched and unstaged.

## Independent-review remediation

The independent review identified eight lineage/acceptance issues. The remediation now:

1. Routes every accepted or `NOT_APPLICABLE` stage through Task 4's `freezeAcceptedStage` transition and rejects skipped, duplicate, inconsistent, or out-of-order stages before replay.
2. Preserves frozen replay policies by `strategy:direction`, so same-direction strategies cannot overwrite one another.
3. Requires explicit hashed evaluation evidence for normal/severe/OOS/walk-forward DD, PF, trade-count/capacity, safety, cost stress, and no-future-selection gates. Missing or invalid evidence fails closed.
4. Compares production baseline parity against the complete canonical ledger identity, including open/closed status, IDs, fills, exits, quantities, fee/funding/slippage, and realized PnL with explicit numeric normalization, in addition to replay open-position reconciliation. Missing, extra, or mismatched ledger evidence blocks with `BASELINE_PARITY_BLOCKED`.
5. Uses exclusive run-directory creation under `<output-root>/<stage>/<runId>` so concurrent identical runs have one artifact winner; ordinary reruns remain immutable and rejected.
6. Binds external evaluation evidence to source/config/frozen-stage hashes, stage/candidate identity, time window, equity/deposits, fee/slippage/funding inputs, gate-manifest hash, and a complete evidence hash. Substituted windows or frozen inputs fail closed.
7. Represents every completed stage in per-stage frozen lineages, including `NOT_APPLICABLE`, and stores a separate aggregate frozen-set hash. Accepted policies validate against their own stage lineage, allowing cumulative accepted-stage reloads and NA-then-accepted progression.
8. Calculates lost prior-logic PnL from strategy-level replay trade evidence instead of hardcoding zero.
9. Propagates canonical aggregate, shared-risk, per-strategy, and per-symbol gross limits into the emulator, while preserving distinct prior frozen strategy policies.
10. Propagates emulator manual-review safety markers to the stage boundary and fails closed for uncausal, out-of-window, unadmitted, or unknown execution evidence.

The causal emulator now accepts an explicit strategy-specific protection policy list with direction fallback, preserving distinct strategy policies in integrated replay.

Remediation verification:

- `npx tsx --test tests/dd-reduction-runner.test.ts` — 23 tests passed, 0 failed.
- Combined Task 1–5 DD-reduction suite — 89 tests passed, 0 failed.
- `npx tsc --noEmit --incremental false` — passed, exit code 0.
- Changed-file ESLint — passed, exit code 0.
- `git diff --check` — passed, exit code 0.

Latest remediation verification covers two accepted stages plus reload, `NOT_APPLICABLE` then accepted plus reload, substituted evaluation windows, full canonical parity fields, concurrent same-run artifact creation, manual-review propagation, and differing prior/current cap fixtures.

Remediation commits: `4239aa2e` (`fix: close sequential runner lineage and parity gaps`), followed by the current local repair commit.
