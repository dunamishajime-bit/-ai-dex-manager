# Task 9 causal replay guard fix (2026-10-21)

## Scope
Research branch only. No Production, VPS, LIVE, HP, account order or operator-approval changes.

## Correctness defects fixed
1. Partial coverage could produce economic metrics when even one row was replayable. Now all observed rows and eight strategy labels must pass, or economic metrics remain null.
2. The allocator event builder omitted source quantity and hardcoded CRYPTO for all strategies, including V52. Missing, nonpositive or nonfinite quantity and unknown asset class now fail closed.
3. Holdout samples entered the IS baseline because non-OOS was treated as IS. IS/OOS/HOLDOUT now have separate allocator and wallet replay streams, and split membership is determined by decision time with explicit label consistency.
4. Empty market marks, missing OOS/HOLDOUT events, and unassigned/contradictory splits now prevent economic metrics.
5. The cumulative gate respects source-blocked cases instead of deriving a positive result from partial replay.

## Remaining blockers
- This is a correctness repair, not the full eight-strategy candidate regenerator.
- Rejected quantity/equity, lot/step/min-notional, allocator chronology, mark series, funding, partial fills and protection evidence remain unproven.
- Existing planned_exit and simulated fixtures are not proof of actual exchange execution.
- Full causal regeneration, dynamic readmission, stop gross reallocation, compounded sizing, execution validation, parity, DD/OOS/holdout must be completed independently.

## Immutable source anchors
- Base commit: 5635a7353f3055a1832ca6aac9b689e39ebcab71
- 10bps input SHA256: eac68287e6f4e644c588b8689ce1dc67226abccea21bea09e29c0aeda0c1a3e2
- 30bps input SHA256: 77087b72c7e9279d001b58e351d7e932a9b3dabcb58d9ccbf7f1a0fd28a7c5d1
- Existing source-recovery replay-ready: 0/3185 at 10bps and 0/3185 at 30bps.
- Safe current classification: BLOCKED_INCOMPLETE_SOURCE_COVERAGE.

## Validation commands
- node --import tsx --test tests/dd-reduction-task9-dynamic-cases.test.ts tests/dd-reduction-source-recovery.test.ts
- node node_modules/typescript/bin/tsc --noEmit
- node node_modules/eslint/bin/eslint.js scripts/dd-reduction/run-task9-dynamic.ts tests/dd-reduction-task9-dynamic-cases.test.ts
- git diff --check
