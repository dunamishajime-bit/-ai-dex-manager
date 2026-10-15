# CODEX urgent handoff — live V52 false Kill Switch vs Idle DOT/JUP, 2026-10-15

**Severity: production outage, fail closed. DO NOT clear Kill Switch or restart V4 in loops without fixing and confirming protection.**

## Observed actual production (last read-only audit 2026-10-15 23:08:33 JST)
- Common current release SHA: `8b67d2efecf92e1a3d9305eceec45ae02c20da4d`.
- Common previous rollback release SHA: `9df89474b36f01608ed6155697de342f861d3626`.
- Independent V12 V4 release SHA: `6f97d2cf03877674ec1a845f6c08414f32899f36`.
- UI separate source: `ui-route-single-cce756b3c5ba`.
- Shared Kill Switch: ACTIVE, action HOLD_PROTECTED, recoverable true; written 2026-10-15 22:59:59 JST by V52 after `Unknown non-flat Aster symbol requires manual review: DOTUSDT`. Grace 10min until 23:09:59 JST; source `scripts/disdex_v52_aster_only_legacy_engine.py` logs operator manual review on expiry, does not auto-clear or auto-flatten in that expiry path.
- V12 V4 repeatedly errors `SHARED_KILL_SWITCH_ACTIVE`. At 23:08 JST `systemctl show` ActiveState **failed**, MainPID=0, NRestarts=5. Do not present V4 as LIVE order-operational.
- Shared Risk not tripped (prior observation), Margin Guard HEALTHY ordersAllowed TRUE, pending entries zero; Kill Switch independently prevents new exposure.
- Idle LIVE state `/var/lib/disdex/idle-priority/state.json` has two SHORT positions: JUPUSDT qty225 entry0.3048; DOTUSDT qty65.9 entry1.087, with local `protectionVerified=true`, STOP/TP IDs, pending=null and manualReview=null. **Real venue positions/openOrders/protective STOP readback NOT independently freshly verified:** signed GET-only Aster diagnostic fails with shared budget `ASTER_GLOBAL_RATE_BUDGET_SATURATED:4046`. No lock bypass, no blind position closure, no order/STOP changes.
- Direct cause: Python V52 gross planner `scripts/disdex_strict_portfolio_planner.py::quality102_crypto_notional_from_positions` treated valid Idle symbols as unknown non-flat. TypeScript classifier already recognizes them; Python did not. A simple whitelist is NOT sufficient. Validate signed venue symbol/side/qty/entry price against SHA-matched protected Idle state before counting as known crypto.

## Fix branch, tested but NOT deployed
Branch `fix/v52-idle-ownership-guard-20261015`, starting from current live SHA `8b67d2...`.
- `scripts/disdex_strict_portfolio_planner.py` adds strict ownership verification for DOT/JUP/TAO/TIA/RENDER only, matching LIVE runtime SHA, schema v2, SHORT qty and entry price, exactly one venue position, no pending/manualReview, local protectionVerified with deterministic STOP and TP client IDs, bounded fresh state/hold. Unknown symbols and mismatches still fail closed.
- `tests/test_disdex_v52_idle_owned_position.py` includes protected good and unprotected/wrong/unknown fail closed cases. Tested isolated on Windows PC: Python compile PASS, 6/6 tests PASS, original planner selftest PASS.
- Dedicated GitHub Actions SUCCESS: <https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/38748315540>. Workflow checks ownership behavior and makes no venue calls.
- **NOT a release-certified candidate.** Obtain GitHub exact final SHA, runtime bytes comparison, initial/partial-fill/STOP/restart validations, operator artifact bound to new SHA and rollback checks. Do not hot-edit immutable current release.

## Notification root cause, actual mitigation
- Missing notification flags in live Idle, FET, HYPE, V12 V4 process environments; PENGU/Q102/V52 enabled.
- Existing trade-fill notifier timer and Gmail credentials work.
- Idle protected JUP and DOT entries were absent from inbox queue. Both were backfilled from verified local Idle protected state into `/var/lib/disdex/shared/trade-fill-notifications/inbox.jsonl` using deterministic entry IDs with delayed label, 0 order/cancel/venue mutations.
- Notifier journal `sent=2` and Gmail confirmed both reached the user's Inbox unread around 22:55 JST.
- Temporary root-owned bridge source is on branch `fix/trade-fill-notifier-idle-recovery-20261015` `scripts/ops/root/disdex-idle-protected-fill-recovery.mjs`; installed at `/usr/local/libexec/disdex-idle-protected-fill-recovery.mjs` SHA256 `6f1ad3a8ad51c7351da3ef9e87cb35ca0c4b4fcc5c78ff18584d6c2f1b2cf7fd`.
- Registered as `ExecStartPre=-/usr/bin/node ... --enqueue` in `disdex-trade-fill-notifier.service.d/99-idle-protected-fill-queue-recovery.conf`, root:root. 15s notification timer keeps running. State and spool dedupe passed `wouldQueue=0 alreadySeen=2` after backfill. **Covers only new Idle ENTRY notifications from live state, not exits; do not claim every strategy notification fixed.**
- No trading Runners restarted by this notification fix. Four drop-ins staged (Idle, FET, HYPE, V4) `90-fill-notification-env.conf` with ENABLED=true, MODE=live, spool location and strategy ID, but process env requires future approved safe restart. Source changes to future exact SHA release should persist in systemd wiring, not solely one-off drop-ins.
- Do not send duplicate historical notifications. Prefer updating actual order event enqueue path to report `queued:false:DISABLED` as telemetry, and correctly enable using SHA-bound wiring. Review FET/HYPE/V4 actual entry/exit paths before claiming complete integration.

## Required safe recovery actions for Codex
1. Re-read root `AGENTS.md` and `docs/ops/DISDEX_VPS_SSH_ACCESS_20261012.md`; use verified owner-PC Git SSH to VPS; no user credentials in output.
2. **Treat current Kill Switch as active.** Get current release and operator SHA, list ALL positions/openOrders/protective reduce-only STOP via signed GET-only Aster when legitimate shared rate budget permits. Verify JUP/DOT exact qty/entry, local STOP/TP IDs and resident venue readback. If rate budget denies request, keep blocked and report no certificate.
3. Validate V52 Python owner check against actual live env and complete signed venue rows, no unintended whitelist, correct actual crypto gross and other sleeve accounting. Retest with peer workloads and partial-fill/restart transitions. Confirm protected exits never suppressed by hold.
4. Stage immutable new release containing fix, preserve independent V4 release; prove GitHub tree/SHA, margin/shared Gross/Kill Switch/account/rate lock, all Runner owners, pending exposure, watchdog, operator and STOP artifacts, protected position migration and rollback. Obtain operator SHA approval without bypass.
5. Only after exact venue readback and approved release, safely switch V52/peer release through governed process. After verifying no unknown mismatch, follow documented recovery procedure for the **recoverable** Kill Switch; do not unilaterally remove/rewrite it or restart V4 until certified.
6. Recheck V4 actual PID and no repeated fail/restart, all 8 peers, V52 zero false unknown failures, live JUP/DOT protection, notifier delivery for next actual fill, and all website SHA/runner statuses.
7. Return final status with exact runner PIDs/NRestarts, current/previous SHA, venue open positions/orders/STOPS, stale GET limits, rollback, and actionable blockers.

**No LIVE mutation or user order requested by this handoff itself.**
