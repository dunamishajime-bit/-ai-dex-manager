# V12 Dynamic Residual 2.0 窶・Production Implementation & LIVE Activation Contract

Date: 2026-09-19
Repository: dunamishajime-bit/-ai-dex-manager
Research source commit: `27f934424b201e4c63986b9b7db64b89ff69b4bb`

## Goal

Implement the validated V12 Dynamic Residual Gross design into the current Production architecture, validate it end-to-end, push the implementation to GitHub, deploy the exact tested SHA to the VPS, and activate LIVE only if every acceptance gate below passes.

This document is the authoritative implementation/LIVE handoff. The research branch itself must not be deployed directly. Resolve the current Production SHA first, branch from that exact source, then port only the required changes.

## Validated target configuration

### V12
- Base aggregate Gross: **1.50x**
- Dynamic residual aggregate ceiling: **2.00x**
- Per-position Gross ceiling: **1.00x**
- Top2
- Do not change the existing signal, score, ranking, entry, exit, stop, cooldown, universe, or BTC regime logic.

### PENGU
- Gross: **0.85x**
- Keep current Short V20 / Recovery V8 and current hard-stop/cooldown behavior.

### Q102
- HIGH_VOL: **1.665x**
- MR: **1.00x**
- BRK: **2.465x**
- REV: **2.50x**
- PB: **2.50x**
- Keep Causal V4 / one-slot behavior.
- Only BRK changes from 2.475x to 2.465x.

### V52
- Stock aggregate Gross: **1.98x**
- Slot Gross ceiling: **1.64x**

### Shared Risk
- Crypto Gross cap: **3.00x**
- Total Gross cap: **3.50x**
- Shared Crypto Daily Loss: **7.5%**
- Keep existing Kill Switch, Margin Guard and Fail Closed behavior.

### Venue
- Preserve existing Aster **5x Cross** requirement.
- Venue leverage and strategy Gross are separate. Do not change venue leverage as part of this task.

## Dynamic V12 contract

Dynamic 2.00x is a ceiling, not a target.

V12 Base allocation remains governed by the existing Production V12 logic and remains capped at 1.50x aggregate.

Only when residual capacity exists may V12 receive an additional lower-priority Dynamic portion, subject to all of:

- Existing V12 signal is already valid.
- No synthetic/additional signal is created.
- Existing requested/risk sizing is not exceeded.
- Per-position total <= 1.00x.
- V12 aggregate total <= 2.00x.
- Crypto Gross <= 3.00x.
- Total Gross <= 3.50x.
- Shared Risk healthy.
- Margin Guard healthy.
- Kill Switch false.
- Runtime/state/reconciliation healthy.
- Venue read-back healthy.
- Aster rate-budget lock healthy.
- 5x Cross verified.
- Required market/reference freshness verified.

If residual capacity is 0.08x, allocate only 0.08x. Never force fill toward 2.00x.

## Priority / preemption contract

Dynamic V12 is lower priority than Core allocation.

Dynamic V12 must never cause a valid Core order to be blocked when trimming Dynamic capacity can make room.

Core includes:
- V12 Base
- PENGU
- Q102
- V52

When a Core entry needs capacity:
1. Re-read latest venue/account/strategy state under the correct shared-risk/serialization boundary.
2. Determine required capacity.
3. Trim only the required Dynamic V12 amount.
4. Use reduceOnly partial close.
5. Read back the venue position.
6. Recalculate Shared Gross from fresh state.
7. Size the Core entry.
8. Submit Core order.
9. Read back and persist state.

Never trim V12 Base before Dynamic V12.

## Partial trim example

Before:
- Base = 0.75x
- Dynamic = 0.20x
- Total = 0.95x

Core requires 0.15x.

After:
- Base = 0.75x
- Dynamic = 0.05x
- Total = 0.80x

Only 0.15x Dynamic is reduced.

## Protective orders

After every Dynamic boost or trim, reconcile protection against actual venue quantity.

Verify:
- actual position qty
- stop qty
- TP qty
- reduceOnly
- stop/TP price
- order status
- read-back qty

If protection cannot be safely resized/rebuilt, Fail Closed. Do not leave an enlarged or residual position partially unprotected.

## State persistence / restart

The runtime must persist the distinction between Base and Dynamic notional because the venue exposes one combined position.

Persist at minimum:
- symbol
- side
- baseQty
- dynamicQty
- totalQty
- baseGross
- dynamicGross
- entry price
- boost timestamp
- boost order id
- latest trim order id
- last trim reason
- protective order ids
- runtime SHA
- state schema version
- reconciliation status

On restart:
- Recover Base/Dynamic state deterministically.
- Prevent duplicate boost/trim.
- Reconcile venue qty/open orders/protection.
- If state and venue cannot be proven consistent, use Fail Closed / OPERATOR_REVIEW_REQUIRED.
- Do not guess ownership of ambiguous quantity.

## Idempotency

Prevent:
- duplicate boost
- duplicate trim
- duplicate protective orders
- duplicate submit after timeout
- restart duplicate order
- resend after accepted-but-readback-failed order

Use the Production architecture's clientOrderId/state token/generation mechanisms as appropriate.

## Concurrency and stale-state rules

Do not size from stale snapshots.

The critical sequence must be serialized consistently with current Shared Risk/Aster locking:
1. latest equity
2. latest positions
3. latest open orders
4. latest strategy state
5. current Gross calculation
6. Dynamic Gross calculation
7. required Dynamic trim
8. trim submit
9. trim read-back
10. Gross recalculation
11. Core sizing
12. Core submit
13. read-back
14. atomic/persistent state update

Do not weaken the existing hardened Aster rate-budget lock/recovery behavior.

## Observability

Expose on runtime snapshot and HP/mobile UI:
- V12 Base Gross
- V12 Dynamic Gross
- V12 Total Gross
- Dynamic active
- available residual Gross
- boost qty
- boost timestamp
- trim qty
- trim count
- last trim reason
- current protective qty
- Crypto Gross
- Total Gross

Preserve the current cockpit UI and mobile layout. Do not regress to an older presentation layer.

## Formal acceptance anchor

Period: 2025-08-10 through 2026-08-10
Initial capital: JPY 10,000
Monthly contribution: JPY 10,000 x12
Compounding: enabled

### NORMAL
- Ending Asset: **270,126,566.3772751 JPY**
- PF: **3.82886822**
- Max DD: **-19.72421906%**
- Trades: **1,237**
- V12 entries: **874**
- PENGU entries: **66**
- V11 entries: **50**
- V50 entries: **93**
- Q102 entries: **69**
- Gross conflicts: **0**

### SEVERE
- Ending Asset: **24,184,641.27364947 JPY**
- PF: **2.79016516**
- Max DD: **-19.97886021%**
- Trades: **1,078**
- V12 entries: **871**
- PENGU entries: **66**
- Q102 entries: **69**
- Gross conflicts: **0**

Mandatory:
- NORMAL DD >= -20%
- SEVERE DD >= -20%
- routing parity PASS
- Crypto Gross <= 3.0x
- Total Gross <= 3.5x
- Gross conflicts = 0

Known failing comparison:
- Dynamic V12 2.0 + Q102 BRK 2.475 => SEVERE DD **-20.02685248%** (FAIL)
- BRK 2.465 => SEVERE DD **-19.97886021%** (PASS)

Do not lower HIGH_VOL/MR/REV/PB to compensate.

## Required implementation tests

Add or extend tests for:
- V12 Base 1.5 contract
- V12 Dynamic 2.0 ceiling
- per-position 1.0 ceiling
- Crypto 3.0 ceiling
- Total 3.5 ceiling
- partial residual allocation
- partial Dynamic trim
- full Dynamic trim
- V12 Base entry competition
- PENGU competition
- Q102 competition
- V52 competition
- Shared Risk race
- restart/recovery
- stale state
- malformed/corrupted state
- venue qty mismatch
- duplicate boost prevention
- duplicate trim prevention
- protective resize
- protection failure Fail Closed
- Kill Switch block
- Margin Guard block
- HTTP 429
- connection reset
- rate-budget lock regression
- accepted order/read-back mismatch
- runtime SHA mismatch
- state migration
- watchdog
- auto-repair
- history sync
- HP/mobile observability
- Formal BT parity

Run all relevant existing regression suites too.

## Git implementation procedure

1. Resolve current Production source SHA and current VPS runtime SHA.
2. Confirm no mixed runtime lineage before using it as base evidence.
3. Create a new implementation branch from the exact current Production source.
4. Use research commit `27f934424b201e4c63986b9b7db64b89ff69b4bb` as evidence/specification only.
5. Implement against current Production architecture.
6. Run unit/integration/migration/regression/static/build/formal replay.
7. Commit and push.
8. Verify `git rev-parse HEAD` equals the remote branch HEAD exactly.

Suggested branch:
`codex/v12-dynamic-residual-live-20260919`

## VPS deployment contract

Only after all code/test/BT gates pass:

1. Snapshot current Production SHA/release.
2. Preserve rollback release.
3. Backup affected state files.
4. Build/install a new immutable release; do not edit the existing release in place.
5. Record current symlink before/after.
6. Run state migration.
7. Run reconciliation.
8. Run Aster read-only checks.
9. Verify 5x Cross, positions, open orders, equity, Shared Gross, Kill Switch, Margin Guard.
10. Verify all services point to one runtime SHA.
11. Run preflight/readiness.

Existing positions must not be closed/recreated just to simplify migration.

For an existing pre-Dynamic V12 position, initialize `dynamicQty=0` only if evidence proves it originated before this feature and contains no Dynamic allocation. Otherwise Fail Closed.

## LIVE activation gates

Activate LIVE only if all are true:
- exact GitHub SHA deployed
- immutable release created
- current symlink correct
- rollback release preserved
- migration PASS
- reconciliation PASS
- protective order contract PASS
- Shared Risk healthy
- Margin Guard HEALTHY
- Kill Switch false or safely cleared only after the original blocking cause is resolved
- Aster read-only consecutive success
- rate-budget lock healthy
- watchdog healthy
- history sync healthy
- HP snapshot freshness healthy
- no mixed old/new runtime SHA

Never clear Kill Switch merely to force activation.

## LIVE cutover order

Use the existing Production-safe cutover mechanism. At minimum:
1. safely stop entry-producing services
2. snapshot positions/open orders/state
3. flush state
4. switch current symlink to new immutable release
5. daemon-reload if required
6. start/verify Shared Risk
7. start/verify Margin Guard
8. start strategy services
9. start/verify watchdog/history sync
10. reconcile
11. Aster read-only verification
12. verify PID/NRestarts/runtime SHA
13. verify Kill Switch
14. verify LIVE mode

Old and new strategy runtimes must not run simultaneously.

## Post-activation verification

Do not generate a synthetic market order just to prove LIVE.

Verify the normal decision/planner/order pipeline with existing safe preflight/dry-run/read-only facilities and then observe natural runtime behavior.

Verify runtime invariants:
- baseGross <= 1.5
- dynamicGross >= 0
- V12 total <= 2.0
- Crypto Gross <= 3.0
- Total Gross <= 3.5

Dynamic Gross = 0 is valid when no residual capacity exists.

Monitor:
- NRestarts
- fatal logs
- 429
- connection resets
- reconciliation mismatch
- state mismatch
- duplicate orders
- protective mismatch
- stale snapshots
- Gross violations
- Kill Switch reactivation
- Margin Guard
- watchdog
- history sync

Rollback on material safety regression.

## Completion status

Only report:

`STATUS: V12_DYNAMIC_RESIDUAL_LIVE_FULLY_VERIFIED`

when every implementation, test, BT, deployment, migration, reconciliation, safety, runtime and observability gate above has passed.

Otherwise report:

`STATUS: LIVE_ACTIVATION_BLOCKED`

and leave Fail Closed in place with exact blockers and current safe state.

## Required final report

Include:
- implementation branch
- implementation commit SHA
- remote SHA
- previous Production SHA
- new Production SHA
- rollback SHA
- current release path
- previous release path
- changed files
- tests and counts
- Formal BT NORMAL/SEVERE
- routing parity
- Gross conflicts
- V12 Base/Dynamic values
- Q102 family caps
- V52 Gross
- Crypto/Total Gross
- Daily Loss
- migration
- reconciliation
- protective orders
- service states
- PID/NRestarts
- runtime SHA
- Kill Switch
- Margin Guard
- Shared Risk
- watchdog
- history sync
- Aster read-only
- current positions/open orders
- HP/mobile observability
- rollback verification
- remaining issues

The task is not complete at implementation or Push. The endpoint is a fully verified LIVE runtime or a safely blocked activation with explicit blockers.
