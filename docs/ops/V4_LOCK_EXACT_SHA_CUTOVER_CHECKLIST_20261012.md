# V12 V4 shared-lock remediation — immutable candidate cutover checklist (2026-10-12)

## Decision and scope

The owner instructed to continue fixing V4 shared-account-lock conflicts and preserving attributable owner evidence. Changes must be a separate, exact-SHA, fail-closed Canary candidate until independent operator/venue authorizations permit trading. **No unconditional LIVE release or permission bypass.**

This branch modifies lock timing/market prefetch for V4 and flat Idle only. It does not change scoring, trade entry/exit formulae, win-rate gates, return thresholds, route catalog, gross caps, STOP pricing or BT datasets.

## Completed proof

- Full V4 regression from earlier candidate: 45 test files, **146/146 passed**, TypeScript `tsc --noEmit` passed.
- Idle regression: 73 cases, **71 passed, 2 pre-existing skipped**, TypeScript passed.
- Subsequent observation-ledger SHA-rebind library introduced with 3 focused tests plus regression; **9/9 passed**, TypeScript passed.
- Read-only experiment on a copied **real active V4 store**: `READONLY_SHA_BRIDGE_STAGING_PASS`. The original source had **301 observation-only ACCOUNT_MARK journal events**, zero owned intents, no leg ownership, no STOP. All journal events were preserved in an isolated candidate copy under a new exact SHA; new `V4ExecutionStore` readback succeeded; temp copy removed; original production ledger untouched.
- The rebind pure function `rebindV4ObservationLedger` refuses *any* owned order intent, leg, protective record, historical non-ACCOUNT_MARK journal, wrong SHA or protected/nonflat initial state. It grants no authority and does no writes.
- The independent lock holder recorder is running; the FET BRK48 runner continues to protect its exchange position. Do not interpret offline tests as measured LIVE contention-rate improvement.

## Real cutover must preserve the following

1. Confirm actual active SHA, current/previous releases, V4 exact old SHA, active unit PIDs/restarts, watcher, signed GET-only positions/orders/STOP readback, shared risk, Margin Guard, Kill Switch, pending exposure, account/rate-budget locks, disk and rollback.
2. Keep FET LONG and its reduceOnly exchange STOP untouched. **Do not initialize the new V4 store with `--init-signed-flat` while FET remains open**; that initializer requires the whole signed account to be flat.
3. An actual cutover of an observation-only old V4 store must be a **controlled offline transaction**: freeze old service, re-read the latest old store and exchange account, confirm zero V4 intents/protections/legs and only ACCOUNT_MARK history, make hashed owner-preserving backups, atomically switch the exact-SHA store only after approved operator runbook conditions, validate journal replay under new SHA, then activate the new V4 service. The pure helper is not a migration executor.
4. Obtain new SHA-specific root-managed one-entry permit (valid 24 h max) and V12_V4 operator activation artifact. Do not auto-transfer authorization from previous SHA.
5. Verify actual readiness before first new order, and require the original signed venue lifecycle, partial-fill, STOP retirement/restart, 41-route source/causal evidence. Passing mock tests does not replace exchange lifecycle evidence.
6. Never start old and new V4 at the same time. Do not alter the current symlink or other runners for a V4-only Canary.
7. Roll back only after confirming new V4 owned execution state is empty or independently reconciled, preserving exact-order client IDs and resident STOPs. Rollback of a state containing actual new V4 orders is not a blind file copy.
8. Measure old vs new V4 `locked`/total ticks over equivalent time windows, and lock-holder journal percentiles; report actual measurement rather than forecasting improvement.

## Current fixed artifacts

- `lib/v12-v4-lock-contention-observer.ts`: bounded lock retries and structured conflict journal, including owner fingerprint, duration, outcome.
- `lib/v12-v4-runner-engine.ts`: flat-only pre-lock completed-candle fetch with H2 rollover and protection-first guard.
- `scripts/v12-v4-production-runner.ts`: 15-second safe recheck after unresolved lock, preserving signal expiry.
- `lib/idle-priority-short-runner.ts`, `lib/idle-residual-long-runner.ts`, `lib/idle-lock-safe-market.ts`: completed H1 fetch outside the lock only while locally flat, revalidated after locking.
- `lib/v12-v4-observation-ledger-rebind.ts`: pure offline SHA migration transform, refuses all owned trade history.
- `scripts/ops/root/disdex-v4-account-lock-recorder.py` and `.service`: active independent production forensic monitor.

Status at authoring: **STAGED_CODE_TESTED; NEW_SHA_OPERATOR_AUTHORIZATION_PENDING; LIVE_PATCH_NOT_ACTIVE**.
