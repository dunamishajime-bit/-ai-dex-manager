# LIVE approval and rollback audit — 2026-10-06

## Authorization and scope
Explicit user authorization received 2026-10-06 17:35:12 JST named LIVE 4c57efbb86ae0bbfe94bbe7dea4d09f0e1ec6c19 and candidate ebcef8297a30517f3f42c97b80fb0661dc7dc03b.
This candidate descendant modifies deployment, runtime wiring, tests and evidence only. Trading logic, signals, Sizing, exchange execution and risk policy remain byte-identical to LIVE. No manual orders or cancellations are used for verification.

## Verified preflight
Canonical exact-SHA activation on current LIVE was backed up and updated from explicit authorization, including fetCorePreemptionReady. All seven runner activation gates allowed the current SHA.
V52 was previously held by FET_PREEMPTION_EXACT_SHA_APPROVAL_REQUIRED and FLAG_NOT_READY. Runtime wiring plus starting V52 restored its healthy heartbeat. Seven traders and Shared Risk / Margin Guard were subsequently checked against systemd and heartbeat state.
Authenticated read-only exchange diagnostics found no positions and no open orders. Pending exposure entries were RELEASED. Kill Switch was inactive; Shared Risk was fresh and source-complete; Margin Guard was healthy.
Historical ACCOUNT_LOCK_BUSY and Idle rate-budget holds were recorded as fail-closed transients, not claimed absent.

## Candidate defects repaired before deployment
The flat-account helper could return success when called in a Bash conditional even after failed venue diagnostics or nonflat exposure. It now propagates pipeline and reconciliation failures explicitly.
Rollback now stops all writers before fresh account reconciliation. It preserves the latest accounting and order ownership and migrates only verified release identity fields; it does not restore stale financial snapshots.
A durable hash-verified copy of the patched runtime wiring is stored with the cutover backup. Source rollback uses this copy while operator automation is deferred. Safety daemons, traders and exact-SHA healthy heartbeats must verify before automation resumes.
Partial rollback startup failure re-quiesces writers and reports incomplete rollback with runners held. Unsupported exposure, pending orders or unknown state are held for review rather than reported healthy.
The workflow retains a failure rollback step after mandatory postdeployment, retention and public checks, using the durable original cutover script.

## Removed unused settings
FET_BRK48_MAX_GROSS=2.25 and ZEC_LONG_RISK_PCT=4.5 were emitted by old wiring but had no active consumers. Their environment and drop-in emission were removed.
Active HYPE_ZEC compatibility names remain because HYPE still references them. Release, dependency, backup and lock references must be checked before retention deletes artifacts.

## Validation
- Executable Bash/Python rollback regressions and cutover contracts: 14/14 passed on Linux, including nonflat account, outstanding order, process failure, malformed response, latest-history preservation and unknown exposure rejection.
- Updated systemd/readiness/cutover contracts: 25/25 passed.
- Expanded order-path and approval tests previously passed 110/110; two TypeScript builds passed.
- Runtime wiring Python suites: 10/10 passed; Bash syntax and wiring self-test passed.
- Production workflow reruns dedicated regressions, strategy self-tests, compile checks, unchanged-logic proof and runtime verification before success.

## Completion boundary
The earlier sections record predeployment findings; final observed evidence is recorded below. A candidate commit or passing test does not establish deployment completion. Final completion requires an observed LIVE SHA, all runner PIDs/cwd/heartbeats, fresh account and protection reconciliation, guard state, journals and public API evidence. Any unverified rollback is reported incomplete.

## First production attempt and verified rollback
Run 37440371951 switched to 00d2c749 and achieved seven healthy heartbeats with zero startup budget saturation. It correctly failed because the subsequent stock-reference restart propagated a stop to its Requires-dependent V52. Automatic rollback stopped writers, reconciled the flat account, preserved latest financial state, restored all runners and verified source SHA 4c57efbb at 09:09:10 UTC; rollback completed 09:09:19 UTC.
The reference proxy now switches before trading startup. POSTDEPLOY checks ownership without restarting it. Executable regression reproduces the previous extra restart and verifies the corrected order. A separate fixture regression fixes the Idle HP contract: its healthy status is HEALTHY, backed by an exact-SHA LIVE healthy heartbeat, rather than the overview's LIVE label. Updated Linux regressions: 16/16 passed.

## Second attempt: deployed HP contract
Run 37441485173 verified all nine systemd units, seven healthy heartbeats, safety state, Idle certificates and read-only account diagnostics. It rolled back on HP_IDLE_OVERVIEW_NOT_LIVE because the deployed overview lists six formal strategies and exposes Idle through its dedicated status endpoint. Source rollback was verified at 09:18:20 UTC and completed 09:18:29 UTC.
The HP check now validates all six formal overview identities and exact release SHAs, synchronized runtime lineage for all six, and Idle's dedicated exact-SHA LIVE/HEALTHY positive-PID heartbeat. If an Idle overview row exists it must also be valid. It no longer asserts an invented overview row. Fixture tests reproduce the actual six-row response and reject stale overview SHA; the exact updated HP check was also executed against the deployed HP and passed. Strategy and Sizing remain unchanged.

## Final production deployment and live evidence
Production run [37442463051](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/37442463051) completed successfully at 2026-10-06 09:28:55 UTC (18:28:55 JST).
LIVE is **8ed7c2266af33758b0a0f301aefc2457a7a7eab6**. The previous/rollback release is 4c57efbb86ae0bbfe94bbe7dea4d09f0e1ec6c19. This is the nominated candidate's descendant with the operational fixes above, rather than a deployment of the uncorrected ebcef candidate.
All required workflow steps succeeded. Startup rate-budget saturation was zero. GitHub reported no active runs during the final check; the deployment uses GitHub concurrency and the persistent VPS flock to prevent concurrent cutovers. The separate Work UI task cannot be canceled through this remote connector; no claim is made that its UI entry was removed.

Final machine inspection at 09:32:16 UTC (18:32:16 JST) reconciled current/release markers, systemd MainPID/cwd/restart counters, seven exact-SHA fresh healthy LIVE heartbeats, eight financial-state files, risk state, operator approval, journals and HP APIs.
See [sanitized machine evidence](live-approval-audit-20261006-evidence.json). Full account diagnostics remain root-readable on the VPS; credentials and balances are excluded from Git evidence.

| Service | MainPID | Status | Restarts |
| --- | ---: | --- | ---: |
| V12 | 320831 | active / HEALTHY | 0 |
| PENGU | 321104 | active / HEALTHY | 0 |
| Quality102 | 321421 | active / HEALTHY | 0 |
| V52 | 321614 | active / HEALTHY | 0 |
| FET | 321842 | active / HEALTHY | 0 |
| HYPE | 322060 | active / HEALTHY | 0 |
| Idle | 322313 | active / HEALTHY | 0 |
| Shared Risk | 320255 | active | 0 |
| Margin Guard | 320278 | active / HEALTHY | 0 |

All nine processes use the exact LIVE release directory. No duplicate active trading instances were found. Watchdog, position recovery, coherence guard, health snapshot, three-hour health check and FET readiness audit timers are active.
Kill Switch is inactive; Shared Risk is fresh, source-complete and untripped; Margin Guard is healthy and permits orders. Nine pending-exposure entries are RELEASED, with zero active pending exposure and no manual-review holds.
All seven canonical operator gates permit this exact SHA. Canonical approval is root-owned mode 0600. FET readiness is HEALTHY with no reasons, and the FET process receives the derived readiness flag. A deliberately mismatched SHA was blocked with exit 2 and OPERATOR_LIVE_ACTIVATION_REQUIRED:SHA_MISMATCH, with zero order/cancel/position mutations.

Read-only venue reconciliation at 09:32:57 UTC found **positions 0, open orders 0**, and zero orders, cancellations or position changes sent by verification.
Journal scans of all nine new-SHA units from 09:21:00 UTC through the audit found zero ACCOUNT_LOCK_BUSY, rate-budget holds, HTTP 429, SHA mismatch, fatal or protective-order-failure matches. This bounded observation does not erase the earlier fail-closed transients recorded above.
V52 remains subject to its existing US-market-hours gate; a market-closed/no-order decision is expected, not a failed Runner.

## Decision-to-protection validation and limits
The successful workflow verified unchanged strategy/Sizing source and decision-to-order contracts, ran five Node suites totaling 114/114 tests (53+32+20+2+7; zero failures), strategy/runner/execution/protective-order/account-lock/routing/Shared Risk self-tests, compile checks and runtime-wiring self-tests.
Decision and native gates, exact-SHA approval, account lock, pending exposure, final pre-order risk checks and protective-order behavior were checked through these source contracts and isolated self-tests, then reconciled with actual runtime/account/shared state.
The account is flat: no real entry or protective order was deliberately created. Consequently this audit establishes current readiness, no orphan exposure/orders and tested protection paths; it does not claim observation of a new production fill and its resulting stop order.
A final fresh Git diff of lib/ and config/ against original LIVE was empty; the workflow's stricter runtime-only allowlist proof also passed. Signal logic, Sizing and order/risk policy were unchanged.

## HP verification
The preserved UI release reads the current LIVE SHA. Runtime lineage is synchronized; the dedicated Idle endpoint is HEALTHY with an exact-SHA LIVE healthy heartbeat.
Quality102 supplies 19 symbol rows and 19 diagnostic records. Realtime ranking supplies 49 rows. The score-100 all-required-gates/freshness invariant passed; there were no score-100 rows at inspection. AVAX displayed Idle Long 80, V12 59 and Q102 56, all fresh.
The public decision-status, realtime and history routes returned HTTP 200. The deployed overview intentionally exposes six formal strategies; Idle is additionally checked through its dedicated endpoint.

## Reference-aware cleanup
Unused FET_BRK48_MAX_GROSS=2.25 and ZEC_LONG_RISK_PCT emission was removed. The final live processes contain no unused MAX_GROSS override; base env/drop-in scans found neither obsolete setting.
After checking process cwd/exe/cmdline/environment/open files, systemd/config references, current state and active approval, 15 superseded paths were removed: eight temporary cutover/wiring/source files, four obsolete temporary parity certificates and three staged approvals. Staged approvals were archived root-readable before removal. Each deleted path's hash and empty operational-reference list is retained in the evidence.
Retention dry-run and apply both passed and touched no protected runtime/state/approval/Kill Switch path. Older releases with rollback/dependency/reference or retention protections were retained; no unreferenced eligible release was found for deletion. The currently referenced UI, durable rollback scripts/wiring backups and active HYPE_ZEC compatibility state were retained.
The persistent /run/lock/disdex-idle-production-redeploy.lock was retained because deployment still references its inode. Deleting an idle but referenced coordination lock could allow duplicate owners.

## Result and recurrence controls
All operational fixes are pushed. This final evidence-only commit is intentionally not redeployed: the LIVE code SHA remains 8ed7c2266af33758b0a0f301aefc2457a7a7eab6.
Two failed attempts were automatically rolled back and verified before retry. Their dependency-order and HP-contract causes were repaired with executable regressions. The final attempt succeeded.
Exact-SHA approval, FET readiness, unchanged-source proof, serialized deployment, fresh account/pending-exposure reconciliation, mandatory HP/runtime verification and failure rollback remain enforced. The ongoing timers provide runtime coherence and health monitoring.
