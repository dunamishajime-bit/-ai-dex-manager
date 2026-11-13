# All-Runner LIVE cutover — measured 2026-11-01 JST

STATUS: BLOCKED_PENDING_SAFE_PRODUCTION_CUTOVER. **No trading mutation has been performed by this handoff.**

## Observed production identity and exchange proof

- `/home/deploy/disdex-trading/current/.disdex-release-sha`: `7688ed7c93a1918d8b44837339b7da5584a868f5`.
- Aster single signed GET: `ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS`; DOGEUSDT SHORT 226, entry 0.08052; exactly one BUY STOP_MARKET, qty 226, reduceOnly=true, status NEW, clientOrderId `v12-v4-98ded39746ed3502a4d7b0e26ef9`. No orders/cancels/position mutations from diagnosis.
- Shared Kill Switch active: `HOLD_PROTECTED`, reason `V52 recoverable tick error: IDLE_RESIDUAL_CORE_PREEMPT_HELPER_FAILED ... IDLE_RESIDUAL_STATE_RUNTIME_OR_SCHEMA_MISMATCH`. Keep it active until the exact formal recovery checks pass.
- Shared crypto risk `sourceComplete=true, tripped=false`; margin guard `stage=HEALTHY, ordersAllowed=true`; all inspected pending-exposure entries RELEASED (re-check exact count before any cutover).
- Read-only flat-state repair already succeeded with formal HP/GitHub approval, Action #41216486213. The IDLE residual file is schema v1, owner SHA `7688...`, position/pending/manualReview null, but its timestamp was updated at 2026-11-01 00:47 JST and is stale again against time-based LIVE startup/recovery gates. Do not silently renew it.

## Live processes versus true new-entry eligibility

- PENGU `disdex-pengu-dual-ls-v2@7688....service`: active.
- FET `disdex-fet-brk48@7688....service`: active; separate preemption audit BLOCKED `FET_PREEMPTION_V52_HEARTBEAT_INVALID`.
- V52 old `disdex-v52-aster-only@97830672e2f139b39f7194166d7dc8c36e8c8933.service`: active; US stock market closed; no new orders while Kill Switch active.
- Q102 `disdex-quality102-causal-v1@ef1ab178e26a7bf5bddb6473467765edba242e1d.service`: active but `blocked-local` from shared Kill Switch / Aster rate budget.
- V4 `disdex-v12-v4@53a0be396719f0284af4e11b35c66a4ac7d58f79.service`: failed due to active Kill Switch; STOP crosscheck read-only job BLOCKED due missing V4 heartbeat.
- IDLE `disdex-idle-priority-short@7688....service`: failed due `IDLE_RESIDUAL_STATE_STALE`; systemd restart limit.
- HYPE `disdex-hype-long@7688....service`: inactive; recent `HYPE_ZEC_UNMANAGED_OPEN_ORDER_BLOCK`, `ASTER_GLOBAL_RATE_BUDGET_SATURATED`, manual-review. Don't assume the single Aster open order settles HYPE internal ownership/state without reconciliation.

## First corrective deployment: approved V52 hotfix

- Exact **staged** release `4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81`, commit `fix(v52): validate IDLE residual state against pinned owner SHA`.
- Its service is installed but inactive. Old V52 `978306...` remains active.
- Owner activation JSON exists at `/var/lib/disdex/shared/operator-activation/v52-4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81.json`: `approvedSha=4d33...`, `approvedRunners=[V52,FET_BRK48_RESIDUAL]`, `ordersEnabled=true`, `operatorAcknowledgement=I_ACK_REAL_MONEY_LIVE_ACTIVATION`, `fetCorePreemptionReady=true`.
- V52 hotfix **read-only** `disdex-fet-preemption-readiness-guard.py --prestart` with actual staged systemd env: `HEALTHY`. Exact V52 operator activation gate: `OPERATOR_ACTIVATION_READY`.
- Current V52 pin file `/etc/disdex/current-runtime/v52-current.env` still identifies OLD `978306...`.
- Restricted `/usr/local/sbin/disdex-idle-residual-kill-recovery` requires NEW V52 `4d33...` sole active V52, fresh owner-SHA flat state, healthy shared risk/margin, zero active reservations, three stable signed Aster GETs, protected DOGE STOP; read-only invocation returns `BLOCKED: V52_HOTFIX_NOT_ACTIVE` now.
- **Do not start two V52 services together.** Use an existing approved operator-controlled cutover/rollback route; verify the production SHA, exact operator artifact and tests, no other modified source, all old positions and resident STOPs and correct Q102/FET ownership before switching. Preserve Kill Switch during V52 cutover. The source must be exact approved `4d33...` and current-pinned V52 identity must transition atomically; rollback to `978306...` if new service/health fails. No test orders.

## Required order after V52 activation (not executed)

1. Read-only post-deploy: verify sole V52 PID, release pin, truthful heartbeat and FET audit. Reject unexpected activity/mismatches.
2. Refresh IDLE *only via the approved exact-SHA formal stale-flat-state repair* (owner HP email OTP and bound GitHub Action, if stale); three NEW signed Aster GETs; backed-up root-only state; do not wipe pending exposure or manual-review data.
3. Require `/usr/local/sbin/disdex-idle-residual-kill-recovery` READ-ONLY proof to pass before any execution. Then use the exact approved formal recovery authorization; preserve/re-arm HOLD on failure. Do not force `active=false` on Kill Switch to simulate readiness.
4. V4: verify correct operator certification and source SHA, signed Aster venue state, resident STOP ownership, route count/health, active release and rollback. Restore only under those gates; ensure `disdex-v4-resident-stop-crosscheck` is healthy.
5. IDLE: start exactly one approved unit after fresh proof, ensure no duplicate owner, no stale-state restarts.
6. HYPE: resolve ZEC unmanaged order / stale internal state and API budget with read-only venue/account and owner-ledger reconciliation before enabling. Never cancel a foreign STOP/order to make it pass.
7. Q102, PENGU, FET, V52: inspect live-mode and ordersEnabled for each separately; re-run Q102/FET readiness/heartbeat and shared gross/margin gating. No claim that active process = trading authorized.
8. Final four-way validation: runner PIDs + exact source SHA, signed Aster positions/orders/STOP protection, shared risk/Kill Switch/pending exposure and HP current 7-runner display. If ANY gate fails, fail-closed with precise blocker.

## Approval boundary

Owner says: make all runners LIVE, while keeping no test orders, no blind STOP/cancel changes, and a formal owner HP email-OTP → GitHub Actions workflow; owner asks assistant to handle the downstream GitHub environment review using the authenticated owner identity. The previous HP approval and GitHub run #41216486213 were **IDLE stale-state repair only** and must NOT be reused as blanket authorization for V52, risk/Kill release, or all LIVE. Prepare the exact owner-approved operation for each new scope, do not bypass signature/nonce/TTL or CI/release gates.

Only report `FULL_LIVE` when every required gate, runner and signed venue check succeeds; otherwise report `BLOCKED` and reason. No deployment/execution was performed in this handoff.
