STATUS: LIVE_RUNTIME_FULLY_VERIFIED
Verified: 2026-10-05 09:30:41 UTC / 18:30:41 JST

Production implementation branch: codex/dd1296-resident-stop-hp-live-20261005
Production SHA: ba38937cb2a22316b8fa2c6b11d3a07eebf7daca
GitHub remote SHA: ba38937cb2a22316b8fa2c6b11d3a07eebf7daca
Remote parity: PASS (rechecked after deployment)
Previous / rollback SHA: e9f69394dacbf9abac63829529462714e8316c56
Current release path: /home/deploy/disdex-trading/releases/ba38937cb2a22316b8fa2c6b11d3a07eebf7daca
Primary Handoff: db0ee5def97e8194f55aa77fa5b7326fa938d456
Modern HP base preserved: 05e3fd30f9f7dedc556f82bea0055597f2acfa08
Research branch was not deployed directly. Implementation integrated onto actual latest Production e9f69394, preserving its safety, locking, state/recovery and support corrections. Modern HP was retained under apps/production-ui with its own Next 16 dependencies; root trading dependency contract unchanged.

Services

All nine services below are active/running, enabled at boot, NRestarts=0, actual /proc cwd and DISDEX_RUNTIME_SHA=ba38937cb2a22316b8fa2c6b11d3a07eebf7daca. Service names are exact; suffix abbreviation in prose is not a runtime identity assertion.

| Runner | Service | PID | NRestarts |
|---|---|---:|---:|
| V12 | disdex-v12-x1-all@ba38937cb2a22316b8fa2c6b11d3a07eebf7daca.service | 3611876 | 0 |
| PENGU | disdex-pengu-dual-ls-v2@ba38937cb2a22316b8fa2c6b11d3a07eebf7daca.service | 3611989 | 0 |
| Q102 | disdex-quality102-causal-v1@ba38937cb2a22316b8fa2c6b11d3a07eebf7daca.service | 3612239 | 0 |
| V52 | disdex-v52-aster-only@ba38937cb2a22316b8fa2c6b11d3a07eebf7daca.service | 3613059 | 0 |
| FET | disdex-fet-brk48@ba38937cb2a22316b8fa2c6b11d3a07eebf7daca.service | 3612551 | 0 |
| HYPE | disdex-hype-long@ba38937cb2a22316b8fa2c6b11d3a07eebf7daca.service | 3612692 | 0 |
| IDLE + RESIDUAL/DOGE/AVAX | disdex-idle-priority-short@ba38937cb2a22316b8fa2c6b11d3a07eebf7daca.service | 3612847 | 0 |
| Shared Risk | disdex-shared-crypto-risk@ba38937cb2a22316b8fa2c6b11d3a07eebf7daca.service | 3611372 | 0 |
| Margin Guard | disdex-v12-v52-margin-guard@ba38937cb2a22316b8fa2c6b11d3a07eebf7daca.service | 3611396 | 0 |

HP: ai-dex-manager-ui.service active/running, PID3613063, NRestarts0; cwd ba38937cb2a22316b8fa2c6b11d3a07eebf7daca/apps/production-ui/.next/standalone. Public and internal decision-status HTTP200, actual runtimeSha matches Production.

Support: watchdog, runtime-coherence guard, position recovery, health snapshot, health alert, fill notifier, and history sync last runs exit0/success. Their execution paths are current Production. Timers active/waiting or active/running as appropriate; successful oneshots are correctly inactive between runs. Ranking observer singleton targets new SHA. Stock reference proxy restarted against current source. Host runtime wiring/coherence helpers are preserved operational tools. Separately installed read-only decision gateway is unchanged. Shared node_modules/.venv2 are intentionally pinned to verified dependency release 7e80cf8a4458f6f6fe9316aa144c1d743ef51a93; actual strategy source is new SHA.

Logic

PENGU: COMBINED_FILTERED Gross1.00 for accepted ordinary entries, limited2% structural re-break retained, Recovery V8/Q60/DD Governor retained. No broad PENGU72h<=-4% gate. Ordinary Long/Short resident reduce-only STOP uses actual fills, existing stop width, durable intent/order IDs, exact read-back, restart adoption, replacement-before-retirement, cumulative actual fill reconciliation and once-only accounting. Existing quarantine/cooldown and riskOverlay preserved exactly in migration. Currently flat; no synthetic entry or STOP was sent just to demonstrate protection.

HYPE: HYPE75 existing Entry/Exit/Gross/stop logic preserved. Stop/TP read-back and full venue fill recovery corrected, including partial normal-exit races and once-only history/notification. Capacity reduction preserves actual owned HYPE75 stop/TP prices, never substitutes legacy stop width. Currently flat.

Q102 Family×Side Gross:
| Family | LONG | SHORT/default |
|---|---:|---:|
| HIGH_VOL |1.00|0.60|
| REV |1.50|1.25|
| PB |2.00|2.50 SHORT*|
| MR |0.75|0.75|
| BRK |0.75|0.75|

*Primary final ledger contains six PB SHORT trades at2.50; Handoff override is PB LONG2.00. PB SHORT2.50 was retained explicitly to match the authoritative research contract. It is not inferred from Family-only PB LONG sizing.

Central config flows through signal/candidate, snapshot, reservation, Gross/Margin planner, execution, persisted accepted Gross, recovery and HP. Q102 BRK FET SHORT72h<=-0.12 exhaustion block retained; boundary and non-target cases tested. Resident STOP uses actual qty/avg and existing stop width; durable intents and fill ledger handle partial fills, ambiguous response, restart and market-exit races. Currently flat; live protection lifecycle for a new Q102 position was not artificially triggered.

FET: completed causal72h return>=+2% Gate; observed +14.06779661%, Gate PASS. Any exit starts durable24h cooldown. Currently still holding valid pre-deployment position, so cooldown until0/remaining0, PASS; no exit was fabricated. Existing 24h hold,5% hard stop and +0.5% floor after +5% retained. Existing Gross1.9527283278647238 position grandfathered, not resized/flattened for new-entry cap1.00. STOP read-back VERIFIED.

V12: same-side6 realized net losses→6h independent cooldown, realized same-side win resets that side; explicit close accounting includes actual fees/funding and forced/preempt closes once according to retained BT contract. LONG losses0/until0 and SHORT losses0/until0 preserved exactly through migration.
AVAX Rank1 SHORT: BTC3h<0 and directional relative3h<=-0.0075 block.
ATOM: directional relative3h>=0.00603 block.
AVAX Rank1 LONG: directional24h<=0.0165 block.
Causal boundary/availability tests reject future and incomplete H1 data. This live cycle had no eligible target signal; gate configuration/reasons are visible, target gate firing is verified by tests rather than falsely reported as a live trade. Existing stop/state behavior maintained.

V52: dynamic Basis Stop maintained, basisStopMultiple=1.75. Fixed Entry Yahoo/reference resident emergency STOP DISABLED. No Phase2 stop experiment deployed. Market closed at verification; this is normal and new equity entry remains blocked by the existing calendar.

IDLE/Overlay: existing strategy/Gross/ownership/exit logic and STOP behavior retained. Flat now. Historical frozen parity certificates preserve original proof with current source lineage and unchanged-source scope; no new integrated Idle BT is claimed.

Safety

Kill Switch=false. Margin Guard=HEALTHY, ordersAllowed=true, latest post-start check current. Shared Risk sourceComplete=true, tripped=false, daily loss0%, fresh. Existing portfolio DD Governor remains active; its observed historical live drawdown21.3296% is not the research MTM DD12.96% and was not reset or weakened.
Account order lock free at verification; shared Aster rate-budget owner PID alive and timestamp fresh. No ACCOUNT_LOCK_BUSY loop, rate-limit error or HTTP429 observed since switch.
Pending exposure active0; historical entries RELEASED retained. Ownership conflict0, duplicate logical runners0, stale previous-SHA cwd processes0, unmanaged positions0/orders0, unprotected0/orphanSTOP0.
Migration preserved V12 ledger, PENGU riskOverlay/Q60/DD/cooldowns, FET active position/STOP, HYPE/Idle/Residual state and pending registry.
Exact-commit operator artifact approves new SHA and user-authorized runners. Automatic repair was deferred until atomic switch and state reconciliation. No safety gate was removed.

Position reconciliation

Only FETUSDT LONG515; actual entry average0.2407, cross leverage5.
Only open order: STOP_MARKET SELL, reduceOnly=true, qty515, trigger0.241900, orderId568441254, clientOrderId fet-stop-6b4f4d99ff49833efe3b46, NEW, executed0.
Owner FET; verified by authenticated venue read-back and independent current-SHA protection observer. Existing STOP reused, no duplicate created, no deployment-driven forced exit. V52 flat, no new fixed STOP. Read-only postflight ordersSent0/cancelsSent0.

Tests

Exact immutable candidate on VPS: TypeScript compile PASS; 509/509 tests PASS; Python state tests PASS; 12 relevant strategy/locking/risk/stop selftests PASS; Margin Guard mocked selftest PASS.
Modern HP: TypeScript PASS,71 tests PASS, auth-persistence selftest PASS, read-only-surface selftest PASS, production build PASS.
Cloud had two platform-only failures (Unix deploy identity and /proc namespace), resolved by full509/509 exact VPS run. HP initial768MiB heap build failed;1536MiB low-priority VPS retry completed successfully with live risk healthy throughout.
Static checks / git diff --check PASS before commit. One independent fresh review returned seven Important issues; all fixed with regression coverage in one pass. No deferred review issues.

BT/parity

Research anchor was freshly reproduced:
2025-08-10..2026-08-10, round-trip10bps;
final JPY4,067,358,397.424793, PF2.960180377096512,
MTM DD-12.96457052048714%,1358trades,
V12995/643wins/352losses, ownership0/accountingPASS.
Formal ledger SHA256 JSONL181ccbf04c0c82f7381276d4fda40e629504e7bcc01f4deedeb046b91337821a, CSV9fc77d9e2ad3de9ee6cd3e47b260de685232e5268bd47b5dd64d1b1849247840. Manifest matches the original CRLF export; GitLF content normalization was checked.
Anchor result differences0. This is research engine reproduction plus implementation boundary/integration tests, not a complete tick-level live execution BT. Real resident STOP fill timing, spread/slippage and partial executions can differ; exact market-PnL equality is not claimed. V52 fixedSTOP remains absent, so that rejected stop model contributes no new logic change.

HP / observed decision cycle

/api/system/decision-status HTTP200 externally and internally; dd1296 runtimeSha matches. Family×Side Gross table, candidate applied Gross, FET72h Gate/cooldown, V12 side counters and gate thresholds/reasons, resident STOP orderID/qty/price/read-back/fresh timestamp and V52 disabled fixedSTOP all confirmed.
After activation: PENGU tick09:21:14UTC cooldown/no-change; V12 snapshot09:21:19UTC no new confirmed2h bar; HYPE tick09:21:32UTC no accepted entry; Q102 snapshot09:21:43UTC no causal signal; IDLE/Residual cycle current new SHA no generic/relative entry; FET repeatedly held/protected; V52 market-closed ticks; fresh Shared Risk and Margin checks. No bar cursor was reset and no forced entry was used.
Full decision/state/risk/protection/service/lock proof retained in /var/lib/disdex/deployment-backups/resident-stop-cutover-ba38937cb2a22316b8fa2c6b11d3a07eebf7daca/decision-cycle-evidence.json and final-runtime-summary.json.

Deployment corrections

Coherence diagnostic found Shared Risk and Margin Guard were running but not enabled at boot. Enabled both; no process restart needed. Canonical enabledRunners was added to exact-commit artifact alongside preserved legacy approvedRunners. Coherence check and subsequent watchdog/support runs now PASS. Neither fix changes strategy logic or weakens safety.

Recorded engineering rulings

1. Keep modern HP as apps/production-ui with independent Next16 lock; wrong-path risk addressed by exact standalone cwd/sourceSHA checks.
2. PB SHORT2.50 follows six authoritative ledger trades; Family-only2.00 would break parity.
3. One independent review completed before Push/live, seven findings fixed; no repeat review or deferred findings.
4. Cloud platform test failures required exact VPS verification; they were not waived.
5. Research anchor reproduction does not prove live/tick resident STOP parity.
6. HYPE capacity protection retains actual owned stop/TP prices; legacy recalculation would alter HYPE75.
7. HP heap retry changed build resource only; no strategy/cap changes.

Rollback

Rollback release: /home/deploy/disdex-trading/releases/e9f69394dacbf9abac63829529462714e8316c56
Old HP: /home/deploy/disdex-trading/ui-releases/ui-ranking-reasons-05e3fd30f9f7
Guarded rollback command (prepared, syntax checked, NOT executed):
sudo bash /var/lib/disdex/deployment-backups/resident-stop-cutover-ba38937cb2a22316b8fa2c6b11d3a07eebf7daca/rollback.sh

It stops automation and runners, performs fresh authenticated read-only reconciliation, and only permits the captured compatible flat-other-runners/FET515+STOP568441254 state. If positions/orders have changed or pending/manual review exists it fails closed, leaves venue STOPs intact and requires explicit state compatibility reconciliation. It preserves current trading accounting/cooldowns rather than restoring stale snapshots, updates exact activation to rollbackSHA, restores unchanged Idle certificate lineage, uses existing migration helper, atomically switches current, restores previous HP config, starts services/support, then checks coherence. A fresh venue/state/risk/HP audit is still mandatory after rollback. Do not blindly restore old state or cancel STOPs after new trades.

Evidence / rollback backups: /var/lib/disdex/deployment-backups/resident-stop-cutover-ba38937cb2a22316b8fa2c6b11d3a07eebf7daca
Candidate test/build logs: /var/lib/disdex/deployment-backups/resident-stop-candidate-ba38937cb2a22316b8fa2c6b11d3a07eebf7daca
Preaudit: /var/lib/disdex/deployment-backups/resident-stop-preaudit-20261005

This report is an audit artifact on a separate evidence branch. It does not change the live Production SHA.
