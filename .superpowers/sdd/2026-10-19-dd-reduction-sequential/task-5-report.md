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

- `npx tsx --test tests/dd-reduction-runner.test.ts` — 29 tests passed, 0 failed.
- Combined Task 1–5 DD-reduction suite — 95 tests passed, 0 failed.
- `npx tsc --noEmit --incremental false` — passed, exit code 0.
- Changed-file ESLint — passed, exit code 0.
- `git diff --check` — passed, exit code 0.

Latest remediation verification covers two accepted stages plus reload, `NOT_APPLICABLE` then accepted plus reload, substituted evaluation windows, full canonical parity fields, concurrent same-run artifact creation, manual-review propagation, and differing prior/current cap fixtures.

## Second independent-review remediation

The second review found six additional gaps in the first remediation. The runner now also:

1. Persists every decision, including rejected attempts, and binds an accepted or `NOT_APPLICABLE` frozen lineage to an explicit `decisionIndex`; reload validation therefore preserves rejected-then-accepted retry history instead of assuming decision-array and lineage-array positions match.
2. Builds a replay-side complete baseline trade ledger, including closed entries and current projections for open entries, and requires its canonical identity to match the production baseline ledger before baseline or stage acceptance.
3. Rejects every non-empty legacy frozen policy set that lacks normalized `stageLineages` and `aggregateHash`; only an empty initial frozen state can use the legacy shape.
4. Loads and validates protection-order read-back evidence against source, configuration, frozen-stage, stage, candidate, and evidence hashes. A filled candidate cannot replay without bound positive read-back evidence; missing read-back is covered by a negative regression test.
5. Creates an authoritative source-level cap manifest for aggregate, strategy, and symbol limits, rejects conflicting declarations, and validates frozen policy caps against that manifest rather than allowing last-writer-wins behavior.
6. Adds a multi-strategy, multi-symbol lost-prior-logic regression proving attribution is matched by strategy and symbol and does not cross-contaminate PnL.

Second-remediation verification:

- `npx tsx --test tests/dd-reduction-runner.test.ts` — 29 tests passed, 0 failed.
- Combined Task 1–5 DD-reduction suite — 95 tests passed, 0 failed.
- `npx tsc --noEmit --incremental false` — passed, exit code 0.
- Changed-file ESLint, including emulator and policy modules — passed, exit code 0.
- `git diff --check` — passed; Git reported only normal LF-to-CRLF working-copy normalization warnings.

Remediation commits: `4239aa2e` (`fix: close sequential runner lineage and parity gaps`), followed by this second-pass local repair commit.

## Third independent-review remediation

The next review identified three P1 issues, now addressed:

1. Replay baseline ledgers are derived from actual replay positions, including closed baseline positions, rather than copying closed entries from the canonical source. Complete parity therefore rejects omitted or mutated replay trades; the runner suite covers both cases.
2. Baseline replay constructs the same source-wide authoritative cap manifest used by stage replay. Multi-strategy baseline coverage verifies distinct per-strategy caps and fail-closed behavior for conflicting aggregate declarations.
3. Protection read-back is now a full replay-bound evidence object. Each filled candidate must have exactly one read-back order bound by candidate ID, client order ID, symbol, side, quantity, and price. The read-back content hash participates in config/evaluation identity without a hash cycle, and the full evidence object is passed into replay. Tests cover missing evidence, multiple fills with one order, candidate mismatch, quantity mismatch, and price mismatch.

Third-remediation verification:

- `npx tsx --test tests/dd-reduction-runner.test.ts` — 32 tests passed, 0 failed.
- Combined Task 1–5 DD-reduction suite — 98 tests passed, 0 failed.
- `npx tsc --noEmit --incremental false` — passed, exit code 0.
- Changed-file ESLint, including source parsing and emulator tests — passed, exit code 0.
- `git diff --check` — passed; Git reported only normal LF-to-CRLF working-copy normalization warnings.

## Fourth independent-review remediation

The final review identified two P1 issues, now addressed:

1. Source-wide cap normalization now computes effective total and crypto caps for every strategy using the same fallback order as `policyFromSource` (`totalGrossCap`, `aggregateGrossCap`, then `grossCap`; `cryptoGrossCap`, then effective total). Any cross-strategy effective-cap conflict, including an implicit `grossCap` conflict, fails closed. The normalized per-strategy total/crypto declarations are included in the cap manifest hash.
2. Closed baseline trades are no longer seeded into `state.positions`. They are reconstructed through generated entry/exit lifecycle executions and kept separate from source-seeded open exposure. Complete closed-trade reconstruction requires entry, exit, fill, cost, source-hash, quantity, and realized-PnL consistency; missing or inconsistent lifecycle evidence fails closed. Parity regressions cover closed-trade omission, mutation, source deletion after independent replay, and incomplete lifecycle evidence.

Fourth-remediation verification:

- `npx tsx --test tests/dd-reduction-runner.test.ts` — 33 tests passed, 0 failed.
- Combined Task 1–5 DD-reduction suite — 100 tests passed, 0 failed.
- `npx tsc --noEmit --incremental false` — passed, exit code 0.
- Changed-file ESLint — passed, exit code 0.
- `git diff --check` — passed; Git reported only normal LF-to-CRLF working-copy normalization warnings.
