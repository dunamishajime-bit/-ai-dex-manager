# DisDex LIVE Top2/V8/Q102 1.0x Design

## Goal

Port the validated `V12_TOP2_1.5 + PENGU_V20_V8 + V52_TOP2 + Q102_1.0_1SLOT` portfolio semantics onto the current production lineage rooted at `922668f8a6702e3c7fceea740ee812f5ecbe501b`, without changing strategy signals or weakening fail-closed safety.

## Sources of truth

- Research handoff commit: `acf12079509b806809407b454c5c1a115b859907`
- Runtime production base: `922668f8a6702e3c7fceea740ee812f5ecbe501b`
- Historical V12 Top2 implementation reference: `053828cefa48f6fb331f14b4e027de311d35b5f9`
- Current UI lineage: `e0bf22ba1cad269129fe0d72ae289df0c453145a`

The research commit supplies evidence and acceptance contracts. It is not merged wholesale because it predates current Aster rate-budget, recovery, notification, watchdog, and runtime-lineage safety changes.

## Current-state findings

- The current production Q102 TypeScript runtime already resolves `maximumGross=1.0`, `maximumPositions=1`, `cryptoGrossCap=2.0`, and `totalGrossCap=2.5`.
- The production Q102 executor receives planner-approved Gross and verifies actual notional against pending `targetGross`.
- Stale 0.5x assumptions remain in the Q102 runtime environment example and Python cross-runner state validation.
- Historical frozen Quality102 contracts intentionally remain at 0.5x and must not be rewritten.
- The current UI already displays Q102 `1.0x / CAUSAL_V4 / 1 slot`.
- The current production V12 runtime still has one active position. The validated target requires two independently protected positions, each capped at 1.0x and collectively capped at 1.5x.
- VPS inspection before implementation found the current V12 and watchdog units failed. Deployment is prohibited until their causes are diagnosed and preflight is clean.

## Architecture

### V12 Top2

Extend the existing V12 state and execution engine rather than replace the runner.

- `maximumPositions=2`
- `perPositionEntryGrossCap=1.0`
- `aggregateEntryGrossCap=1.5`
- Preserve current signal generation, ranking, ATR/risk sizing, order locking, protection orders, shared-risk checks, Aster rate budget, and fail-closed handling.
- Persist `activePositions` while retaining the legacy primary `active` field for backward-compatible migration.
- Reconcile every active position and its protection orders independently after restart.
- Admit the second-ranked distinct symbol only from fresh account/exchange state and only for residual V12, Crypto, and Total Gross.
- Reject duplicate symbols, more than two positions, per-position Gross above 1.0x, aggregate Gross above 1.5x, malformed state, unowned positions, or unknown orders.

The older `053828ce` implementation is used as a semantic reference only. Its unrelated authentication, workflow, and obsolete routing changes are not imported.

### Q102 1.0x / one slot

Keep the existing causal V4 selector and current TypeScript planner/executor path. Close only the remaining contract gaps:

- Live Q102 requested and persisted `targetGross` may be greater than 0.5x but never greater than 1.0x.
- A second Q102 position remains rejected.
- Historical `QUALITY102` remains fail-closed and retains its 0.5x research contract.
- Q102 remains lower priority than V12/PENGU/V52.
- Base admission may trigger only the required Q102 MTM reduce-only amount, using verified current mark evidence, followed by Gross recalculation.
- Malformed/stale ownership, state, price evidence, pending order, or reconciliation data remains fail-closed.

### PENGU and V52

No signal changes are permitted.

- PENGU remains Dual LS V2 with Short V20 and supplemental Recovery V8.
- Recovery is evaluated only after normal Long/Short is not selected.
- Recovery Gross, delayed partial, stops, trailing, max hold, and 24-hour hard-stop cooldown remain unchanged.
- V52 remains Top2 with existing stock and portfolio risk gates.

### Shared portfolio controls

The existing strict planner remains authoritative:

- Q102 <= 1.0x and one position
- V12 <= 1.5x aggregate, <= 1.0x per position, <= 2 positions
- PENGU <= 0.75x
- Crypto Gross <= 2.0x
- Stock Gross <= 1.5x
- Total Gross <= 2.5x
- Shared Crypto Daily Loss = 5%

All admission decisions use current positions plus planned orders before mutation. No configuration-only bypass is accepted.

## State compatibility and migration

- Existing one-position V12 state loads as a one-element `activePositions` view.
- New saves keep `active` synchronized to the first ranked position.
- No state file is hand-edited.
- Any production migration is byte-backed-up and performed only when exchange positions, open orders, pending state, and managed ownership reconcile.
- Q102 state schema is retained; only the accepted live target-Gross bound changes from 0.5x to 1.0x where stale validation remains.

## Testing strategy

Tests are written first and observed failing before implementation.

1. V12 Top2 configuration, two-position state, duplicate rejection, 1.0x per-position cap, and 1.5x aggregate cap.
2. V12 second-entry residual sizing under V12/Crypto/Total Gross limits.
3. Restart reconciliation and protection ownership for two V12 positions.
4. Q102 1.0x end-to-end runtime, planner, persisted pending target, executor sizing, and one-slot enforcement.
5. Base-priority Q102 MTM reduction with verified marks and zero post-plan Gross conflicts.
6. Malformed/stale Q102 and V12 state fail-closed behavior.
7. PENGU V20/V8 precedence and 24-hour hard-stop cooldown regression.
8. V52 Top2 regression.
9. Current UI/observability verification for Q102 1.0x and V12 Top2 labels.
10. Typecheck, production build, strategy self-tests, watchdog, ownership, and preflight contracts.

## Deployment gate

After tests and Push, deployment may proceed only after read-only Aster/VPS checks confirm:

- current positions, open orders, protection orders, account balance, shared-risk lock, managed state, and runner ownership reconcile;
- no stale pending order, unmanaged position, duplicate current/old daemon, or split runtime SHA exists;
- Kill Switch and safety services are healthy without being bypassed;
- V12/PENGU/V52/Q102/Shared Risk/Margin Guard are in an acceptable state;
- no test, synthetic, dummy, cancel, flatten, or migration order is generated.

If any gate fails, retain fail-closed state, do not restart into LIVE, and report the exact blocker. Natural strategy signals after a verified deployment are the only permitted source of new orders.
