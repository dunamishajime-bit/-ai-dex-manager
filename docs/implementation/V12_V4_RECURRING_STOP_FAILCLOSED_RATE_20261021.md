# V12 V4 recurrent failure: bounded rate-budget fail-closed recovery

Date: 2026-10-21 JST. Repair branch: fix/v12-v4-recurring-failclosed-rate-20261021.

## Source evidence / scope
- DisTERMINAL monitoring recorded disdex-v12-v4@cd99d7e2cfab91dd2571cd403bbb95b70c83225d.service alternating ActiveState=failed/MainPID=0 and ActiveState=active multiple times on 2026-10-21, latest fail at 18:17 JST.
- The 'current' release was dd87161165330310df39dd644aa35cd8a6eca6a4. This mixed-SHA deployment is an explicitly supported wiring mode and is NOT itself evidence of a defect.
- VPS journal V4_RUNNER_FAILED_CLOSED / ExecMainStatus could not be read from this authorized ChatGPT path. Do not assert that rate budget was the proven cause.

## Repair delivered in source code
- Precisely identified local shared Aster budget contention (ASTER_GLOBAL_RATE_BUDGET_SATURATED and specified budget lock failures) no longer kills the V4 daemon tick loop when owned legs, in-flight intents, or resident STOPs exist.
- With non-flat execution state, output is status=blocked, orderEnabled=false, safetyState=BLOCKED, reason=V4_RATE_BUDGET_RECONCILIATION_BLOCKED and retry delay >=15 seconds. Existing signed reconciliation of fills and resident STOPs runs at the start of the next tick under the original account lock. No order is submitted from this error branch.
- Flat-state budget contention retains previous observing behavior. Unrecognized errors remain fatal. No protective gate disabled, no position altered, and no false healthy heartbeat written.
- Read-only DisTERMINAL alert includes systemd Result, ExecMainCode, ExecMainStatus, NRestarts.

## Required deployment-time verification (NOT complete)
1. Capture read-only systemctl show (ActiveState, SubState, Result, ExecMainStatus, MainPID, NRestarts) and journalctl --unit for the exact pinned V4 service during the incident, redacting credentials. Preserve evidence.
2. Verify if actual failures are budget saturation or another cause. Do not declare root cause proven from an email alone.
3. Before any cutover, independently verify signed venue positions, orders and resident STOP read-back (including partial fills), pending exposure, Shared Risk, Margin Guard, Kill Switch, operator approval, peer SHA locks, runner singleton and rollback. Never disable protections.
4. This branch is source-only until certified exact-SHA release, operator approval, LIVE reconciliation, restart and sustained healthy monitoring. Do not promote Task 9 research into production V4.
