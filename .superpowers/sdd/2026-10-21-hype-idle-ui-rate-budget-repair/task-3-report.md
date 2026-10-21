# Task 3 report — Idle residual freshness and HYPE/Idle observability

## Status

Implemented locally in the isolated Task 3 worktree. No deployment, credential access, VPS/LIVE mutation, order submission, or trading-policy change was performed.

## Root cause

- `lib/idle-residual-long-state.ts` normalized residual state shape and runtime SHA, but silently defaulted malformed `updatedAt` values and did not enforce a documented heartbeat age or future-timestamp policy. The runner could therefore reach its normal flat path with an old state file; SHA drift raised a generic load failure but had no public health envelope.
- A bounded Aster rate-budget error in the residual runner was classified only for a flat state. The protected-position path fell through to manual review, even when durable ownership and protection were already present. Flat deferral also returned without persisting a fresh heartbeat.
- HYPE state storage accepted malformed/future heartbeat timestamps, and HYPE/Idle UI adapters exposed raw state without consistently publishing deferral reason, protection state, or explicit order-permission status. Idle core and residual state were not represented as independent health owners.

## Changes

- Added strict residual timestamp validation, a documented three-hour freshness policy, future/malformed timestamp rejection, precise SHA/staleness errors, and fresh heartbeat helpers.
- Made residual flat and protected rate-budget deferrals bounded, no-order `held` outcomes that preserve position/protection state and persist a current heartbeat; pending/manual-review state remains fail-closed.
- Added HYPE state freshness validation and a protected rate-budget heartbeat helper; the HYPE runner now preserves protected state during read-only rate deferral and still sends unresolved/unprotected cases to fail-closed review.
- Added an independent Idle runtime health evaluator and API envelope exposing core/residual status, runtime/state SHA, last decision, deferral reason, pending/position/manual-review state, protection status, and explicit order permission. Added HYPE-side heartbeat/state freshness, protection, deferral, and order-permission fields and surfaced them in the HP panel.
- Updated the preemption fixture to use its injected current clock instead of an intentionally future-dated timestamp that the new fail-closed contract must reject.

## Tests and verification

Focused TDD red checks were observed before implementation: the new tests initially failed with missing exports/modules (`assertIdleResidualLongStateFresh`, `heartbeatIdleResidualRateBudgetDeferral`, `heartbeatHypeZecRateBudgetDeferral`, and the new observability adapter).

Final focused command:

```text
node node_modules/tsx/dist/cli.mjs --test <HYPE/Idle state, recovery, rate-budget, runner-gate, and observability test files>
```

Result: **94 tests, 92 passed, 0 failed, 2 skipped**. The two skips are the existing POSIX-root-only residual baseline admission cases on Windows.

Root TypeScript check:

```text
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

Result: **exit 0**.

The separate `apps/production-ui/tsconfig.json` check remains red on existing project-wide dependency/type-contract issues: repeated `next/link` JSX incompatibilities between installed React type copies and existing `style jsx` prop errors. No diagnostic was reported for the new `idle-runtime-observability.ts` or the changed HYPE server adapter logic. The focused production-UI HYPE/Idle tests pass.

`git diff --check` completed without whitespace errors.

## Changed files

- `lib/idle-residual-long-state.ts`
- `lib/idle-residual-long-runner.ts`
- `lib/hype-zec-long-runner-state.ts`
- `lib/hype-zec-long-runner.ts`
- `apps/production-ui/lib/server/idle-runtime-observability.ts`
- `apps/production-ui/lib/server/hype-idle-health.ts`
- `apps/production-ui/lib/server/hype-runtime-observability.ts`
- `apps/production-ui/lib/server/hype-zec-runtime-observability.ts`
- `apps/production-ui/app/api/system/idle-priority-status/route.ts`
- `apps/production-ui/components/features/HypeDecisionPanel.tsx`
- `app/decision-status/idle-priority/page.tsx`
- `tests/idle-residual-long-contract.test.ts`
- `tests/idle-residual-long-preemption.test.ts`
- `tests/hype-zec-long-state.test.ts`
- `apps/production-ui/tests/hype-idle-runtime-observability.test.ts`
- `apps/production-ui/tests/hype75-hp-state.test.ts`

## Commit

Commit SHA: `fb4e9375` (`fix: harden hype idle runtime freshness observability`).

## Known limitations

- The UI project-wide typecheck still requires the repository's existing React/Next type alignment repair; this Task 3 change did not broaden that unrelated work.
- The public health evaluator is read-only observability. It does not certify venue read-back, shared risk, Margin Guard, Kill Switch, or order authority; those remain runner-side fail-closed checks.
- The three-hour age policy is intentionally an observability/runner-state freshness bound. It does not alter entry conditions, Gross, STOP thresholds, leverage, shared risk, operator gates, or order paths.
