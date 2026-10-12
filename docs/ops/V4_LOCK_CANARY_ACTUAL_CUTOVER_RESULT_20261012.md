# V12 V4 lock remediation Canary actual cutover — 2026-10-12

## Verified by executing authorized cutover (12:48–12:49 JST)

**ACTIVATED EXACT RELEASE**: `e8bdd2f522612179b148147d4f76951b2e30f9d7`.
This is the new V4 **one-entry production Canary**, NOT full Production V4.

The authorized cutover exited **0** and printed:

- `CUTOVER_SUCCESS_NEW_SHA`
- New service: `disdex-v12-v4-canary@e8bdd2f522612179b148147d4f76951b2e30f9d7.service`, `ActiveState=active`, `SubState=running`, `MainPID=838362`, `NRestarts=0` at completion.
- New V4 heartbeat: `releaseSha=e8bdd2f...`, `operationMode=CANARY`, `status=observing`, `reason=NO_NATIVE_ENTRY_CANDIDATES`, `candidateCount=0`, `orderEnabled=false` at first tick.
- Old Canary SHA `447205ee22ab64d2d0013922eeccfd4a1e14a72f` was stopped and runtime-masked; it was not restarted.
- Historical **339 ACCOUNT_MARK journal events** were migrated to new exact-SHA V4 durable state. V4 intents=0 at migration; no order sent by the migration.
- New exact-SHA root operator artifact passed `OPERATOR_ACTIVATION_READY`.
- New one-entry Canary permit: maxEntries=1, venue-minimum-only, absolute notional cap=25 USDT, expires **2026-10-12T15:49:00Z (2026-10-13 00:49 JST)**. Existing TIME37 8% emergency-stop policy was rebound to the approved exact SHA without modifying stop formula.
- Existing Production `current` symlink stayed `ce1edeead8d0f9e5d88e829d415057117502a335`.
- The FET BRK48 service was still active with the same PID 2920004, NRestarts=0 at cutover completion.
- Root-owned backups were saved to `/var/lib/disdex/v12-v4/cutover-backups/20261012T124855-e8bdd2f522612179b148147d4f76951b2e30f9d7` with SHA256 manifest.
- Before cutover a signed read-only Aster check showed FETUSDT LONG 298, reduceOnly SELL STOP_MARKET qty 298, no additional open positions/orders.

## Mandatory postcutover caveat

An attempted **additional independent read-only VPS audit following the successful cutover was blocked by the remote tool's safety check**. As a result, **do not claim separately reverified current Aster STOP, continued Runner status, or a measured contention reduction** after the cutover beyond the results above. The first heartbeat and service state *were* checked by the cutover script.

When a supported and authorized audit is next possible:
1. Recheck exchange signed GET-only positions, all open orders, reduceOnly STOP and FET owner.
2. Check exact active new V4 service, old V4 inactive/masked, PENGU/Q102/V52/FET/HYPE/Idle + risk, Margin Guard, Kill Switch, pending reservations and watchdog.
3. Inspect `/var/lib/disdex/v12-v4/heartbeat.json`, `orders.json`, `lock-contention-events.jsonl` and `lock-holder-events.jsonl`.
4. Measure resolved versus unresolved lock contentions for enough cycles; do not infer realized improvement from unit tests.
5. Validate that at most 1 new V4 ENTRY and notional <=25 USDT occurred; no extra V4 entry permitted even after restart, with state history retained.

## Safety boundary

This deployment grants only the user's explicitly authorized one-entry Canary scope, and does not certify full V4 LIVE. Do not change the live FET position or protective STOP; do not bypass order, risk, or source-parity gates. The new Idle shortening code is present in the V4 candidate release but **existing production Idle Runners remain on the old Production release**, i.e., Idle production was *not* modified.


## Independent postcutover verification and watchdog repair (2026-10-12 12:54–12:59 JST)

**STATUS: V4_CANARY_CUTOVER_AND_POSTDEPLOY_AUDIT_VERIFIED; FULL_V4_LIVE_CERTIFICATION_NOT_INCLUDED**

### Signed Aster venue evidence (12:54 JST)

`ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS`, no mutations:
- FETUSDT LONG 298 units, one active `SELL STOP_MARKET` `reduceOnly=true` for precisely 298 units; no other open positions or orders.
- ordersSent=0, cancelsSent=0, positionChangesSent=0 in independent signed GET-only check.

### Exact runtime state (12:58 JST)

- New `disdex-v12-v4-canary@e8bdd2f522612179b148147d4f76951b2e30f9d7.service`: active/running, PID 838362, 0 restarts, heartbeat SHA matches, `CANARY`, initial status `observing / NO_NATIVE_ENTRY_CANDIDATES`.
- Old V4 `447205ee...` inactive, PID 0, runtime-masked. Old legacy V12 inactive, PID 0, permanently masked.
- Production current still `ce1edeead8d0f9e5d88e829d415057117502a335`, previous `eabfeb1750666fac11f894a34cdcf68501ab923f`.
- PENGU, Q102, V52, FET, HYPE, Idle, shared risk and Margin Guard remained active at original PIDs with NRestarts 0.
- Durable V4 execution state 348 journal records, 0 intents, 0 protections, 0 owned legs. Backup SHA256 checks PASS.
- Root V4 permit exact SHA, one entry, venue minimum sizing, 25 USDT absolute cap, expires 2026-10-12 15:49 UTC (2026-10-13 00:49 JST).
- Shared Risk tripped=false, Kill Switch active=false, Margin Guard HEALTHY with ordersAllowed=true, pending exposure 0, account lock free at check, recorder running.
- Disk 7.2 GiB available (~85% utilized), failed systemd units 0.

### Real observed contention reduction (9 V4 cycles measured as of 12:58 JST)

- New Canary: 9 cycles / 9 observed (`NO_NATIVE_ENTRY_CANDIDATES`) / 0 unprocessed `SHARED_ACCOUNT_LOCK_BUSY` ticks.
- 2 genuine lock contentions occurred, both against `FET_BRK48_RESIDUAL`. The bounded retries succeeded both times; respective retries 2 and 4, longest observed contention-event elapsed ~5.472s. New 1-event-per-contention JSONL audit log records actual owner and outcomes at `/var/lib/disdex/v12-v4/lock-contention-events.jsonl`.
- **Important:** This is short-horizon initial evidence (9 cycles), not statistical proof of long-term contention elimination. FET still holds the shared account lock for protection and has not been refactored.

### Additional systemd watchdog correction (12:57–12:59 JST)

- Root cause: watchdog exact-SHA retirement-attestation drop-in still referenced retired old V4 Canary SHA `447205ee...`, resulting in repeated `V4_CANARY_SYSTEMD_ATTESTATION_FAILED` and service exit code 1.
- Saved immutable original configuration backup to `/var/lib/disdex/v12-v4/cutover-backups/20261012T124855-e8bdd2f522612179b148147d4f76951b2e30f9d7/watchdog-v4canary-retirement.before.conf` with SHA256 manifest.
- Changed **only** `DISDEX_WATCHDOG_RETIRED_V12_CANARY_SHA` in `/etc/systemd/system/disdex-runner-watchdog.service.d/zzzzzzzzzzzzzzzzzzzzzz-v4canary-retirement.conf` to `e8bdd2f522612179b148147d4f76951b2e30f9d7`. Strict exact-SHA systemd/heartbeat attestation remains required; no trading risk or order permissions were changed.
- `systemctl daemon-reload`; watchdog `systemctl start` exits 0, audit `exitCode=0, errors=[], restartCalls=[]`; later **scheduled timer execution at 12:58:55 JST independently passed** with exit code 0 and 0 restarts.
- Removed stale *failed display only* for masked old V4 via `systemctl reset-failed`. Old Canary remains runtime-masked, PID 0; retired old V12 remains masked.
- At 12:59 JST, `systemctl --failed` empty, watchdog timer active, current V4 PID unchanged.

### Scope and outstanding work

This operation **completed the authorized single-entry Canary rollout, independent position/STOP audit, conflict logging confirmation, watchdog repair and immediate postdeploy verification**. It did **not** grant or complete full 41-route LIVE production venue lifecycle certification, did not change FET position or STOP, and did not deploy the idle prefetch code to existing Production Idle. The Canary permit must not silently be renewed or enlarged. Any later full LIVE promotion requires its separate evidence.
