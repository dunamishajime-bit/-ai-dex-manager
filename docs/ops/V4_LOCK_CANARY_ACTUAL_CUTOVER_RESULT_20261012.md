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
