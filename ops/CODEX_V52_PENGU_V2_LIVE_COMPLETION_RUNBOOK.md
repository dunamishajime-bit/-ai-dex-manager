# CODEX V52 + PENGU_DUAL_LS_V2_FINAL production completion runbook

## Purpose

This document is the authoritative handoff for completing the interrupted production work without guessing, bypassing safety gates, or retuning PENGU V2.

The required end state is:

1. Finish every unresolved V52 runtime/lifecycle problem on top of the current Codex work.
2. Reconcile the unresolved Crypto durable-state pending order through an auditable, evidence-based path.
3. Make `DISDEX_V96_OPERATOR_OVERRIDE_AUDIT_SYNC_FAILED` pass by fixing the underlying state mismatch, not by suppressing the gate.
4. Integrate the frozen `PENGU_DUAL_LS_V2_FINAL` production implementation exactly as specified in `research/PENGU_DUAL_LS_V2_FINAL_FREEZE.md`.
5. Prove production/research parity and runtime safety.
6. Push one immutable final Git SHA.
7. Build/install the immutable VPS release for that exact SHA.
8. Run approval/parity/preflight and promote only when every gate passes.
9. Restart/start the official combined service once, then verify V52 + Crypto + PENGU V2 health and that no unintended order/position mutation occurred.

If any gate fails, stop at the first failure and remain fail-closed.

---

## 0. Authoritative starting point

### GitHub

Repository: `dunamishajime-bit/-ai-dex-manager`

Current Codex working branch reported by the operator:

- Branch: `codex/pengu-runtime-safety-fix`
- SHA: `a022b68ff4426c59b922fc78cb61e9225e020d7b`
- Commit message: `Fix V52 market-hour worker lifecycle`
- Parent: `280d2c73f484a82d634450d66aca75603f8e77ff`

The `a022...` change modifies the combined V96/V52 runner and strategy preflight files. Do not discard or overwrite these changes when integrating V2.

Handoff requirements branch:

- `handoff/v52-pengu-v2-live-completion-20260811`

Frozen research source:

- Branch: `research/pengu-dual-ls-v2-20260810`
- Freeze SHA: `f6821440b847a5556bfc4d58c2e32bc6c0ed7d4e`
- Frozen specification copied into this handoff branch as `research/PENGU_DUAL_LS_V2_FINAL_FREEZE.md`

### VPS state reported after the failed activation attempt

Candidate release creation itself succeeded:

- Candidate source SHA: `a022b68ff4426c59b922fc78cb61e9225e020d7b`
- Immutable release: `/home/deploy/disdex-trading/releases/a022b68ff4426c59b922fc78cb61e9225e020d7b`
- Official installer: executed
- helper/systemd unit SHA: matched candidate
- Candidate Preflight: PASS
- Aster authentication: PASS
- Managed Positions: 0
- Open Orders: 0
- orders/cancels/position changes caused by the attempt: 0

First formal blocker:

- `DISDEX_V96_OPERATOR_OVERRIDE_AUDIT_SYNC_FAILED`
- durable Crypto state contains unresolved `pending=true`
- Aster externally reports zero open orders, so local durable state and external state disagree

The prior attempt correctly did **not** manually clear the pending flag.

Final fail-closed VPS state after transaction rollback:

- `current`: old SHA `280d2c73f484a82d634450d66aca75603f8e77ff`
- service: `inactive/dead`
- `MainPID=0`
- shared kill switch: active
- approval/parity: rolled back to old SHA
- candidate `a022...` was not promoted
- LIVE restart was not performed

Treat this as the starting state unless fresh read-only evidence proves otherwise.

---

## 1. Non-negotiable safety rules

1. Do not manually edit durable JSON/state to turn `pending=true` into false.
2. Do not delete, truncate, replace, or fabricate reconciliation/audit records.
3. Do not infer an order is resolved merely because `openOrders=0`.
4. Do not send a new order, cancel an unrelated order, or alter a position merely to make reconciliation pass.
5. Do not suppress, rename, weaken, catch-and-ignore, or hard-code around `DISDEX_V96_OPERATOR_OVERRIDE_AUDIT_SYNC_FAILED` or any later gate.
6. Do not manually modify approval/parity/current/kill-switch files to simulate a successful activation. Use the repository's official mechanisms.
7. Do not retune any `PENGU_DUAL_LS_V2_FINAL` strategy parameter during production integration or parity work. A parameter/family change is a new strategy version and is outside this task.
8. Do not run V1 and V2 as simultaneous PENGU order-producing runners. V2 is the successor. Preserve V1 state/release for rollback evidence, but only one PENGU live runner may own execution after migration.
9. Do not carry an unconfirmed V1 pending order, stale signal, lock, or in-flight execution into the V2 state directory.
10. Do not take over unmanaged Aster positions.
11. Do not promote a SHA different from the SHA that passed final approval/parity/preflight.
12. Do not restart repeatedly to see whether a failure disappears. One official restart/start follows a successful promotion; a failed gate is diagnosed, not retried blindly.
13. Preserve the shared risk controls, portfolio gross caps, daily-loss controls, Aster authentication contract, and fail-closed behavior already present in the repository unless a change is strictly necessary to support V2 and is covered by tests.
14. Any ambiguous external order state is a blocker. Fail closed.

---

## 2. Phase A — synchronize and finish V52 work first

Before changing V2 code:

1. Fetch all remote refs.
2. Confirm the current remote HEAD of `codex/pengu-runtime-safety-fix`.
3. If it advanced past `a022...`, inspect all additional commits and continue from the latest remote HEAD; do not reset it back to `a022...`.
4. Read this runbook and `research/PENGU_DUAL_LS_V2_FINAL_FREEZE.md` before editing production code.
5. Inspect the `280d2c73... -> a022b68...` V52 changes and every currently failing test/preflight/runtime log.

The known `a022...` V52 change is specifically a market-hour worker lifecycle fix. The combined runner already models V52 preflight states such as `ACTIVE`, `WAITING_MARKET_CLOSED`, and `BLOCKED_DATA_UNAVAILABLE`. Complete the lifecycle so that:

- V52 worker runs when the market/data state is legitimately ACTIVE.
- Market-closed waiting is not misclassified as an unsafe crash.
- Data-unavailable remains fail-closed and is not silently treated as ACTIVE.
- A V52 worker is not abandoned while an actual V52 position or pending order is unresolved.
- worker start/stop/recheck transitions do not create duplicate workers.
- service restart is idempotent with respect to child processes.
- V52 failure cannot silently disable the shared risk controls.

Run the repository's existing typecheck, self-tests, strategy-specific preflight tests, and lifecycle tests. Inspect package/workflow scripts rather than inventing replacement commands. Fix all real failures before proceeding.

**Phase A exit gate:** no known V52 code/test/runtime blocker remains. If a new blocker appears, fix it and record it; do not proceed by excluding the failing check.

---

## 3. Phase B — formal pending-order reconciliation

The first known activation blocker is an unresolved Crypto durable-state `pending=true` while Aster shows no open orders.

### 3.1 Identify the exact local record

Using read-only inspection, record at minimum when available:

- state file/path and strategy owner
- pending flag / pending object
- symbol
- side
- quantity
- exchange order ID
- client order ID
- creation/submission/update timestamps
- intended action
- any last exchange response/error
- any linked local position or fill record
- current state schema/version

Do not modify it during discovery.

### 3.2 Reconcile against Aster through the existing V3 client/contracts

Use the repository's official authenticated Aster V3 read-only methods and existing reconciliation facilities. Query enough independent evidence to distinguish:

- still-open order
- fully filled order
- partially filled then canceled/expired order
- canceled order
- rejected/expired order
- order that never reached/existed at the exchange
- ambiguous/not provable

`openOrders=0` alone is insufficient. Correlate by order ID/client order ID/symbol/time and, where the existing client supports it, order history/status, fills/trades and position state.

### 3.3 Resolution rules

- If exchange evidence proves the order is still open: keep it pending and stop activation.
- If exchange evidence proves a terminal state: apply the repository's formal reconciliation transition so local durable state reflects the terminal exchange state and any fills/position consequences.
- If evidence proves a fill: durable position/accounting state must match the actual fill before the pending record can be closed.
- If the order cannot be found and there is insufficient evidence that it never existed or is terminal: keep it unresolved and fail closed.
- If the repository currently has no safe formal path for this exact stale-pending case, implement a narrow reconciliation function/tool with deterministic tests and an append-only/auditable result. It must consume external evidence; it must not be a generic `--force-clear-pending` switch.

After reconciliation, reload durable state from disk and re-query Aster read-only state. Require consistency.

### 3.4 Operator Override Audit Sync

Only after durable/external consistency is proven, run the repository's official Operator Override audit/sync/release path.

If the override mechanism itself is incomplete, implement the missing auditable transition; do **not** disable the audit gate.

**Phase B exit gate:**

- unresolved pending orders for the affected Crypto runtime: 0
- local state consistent with Aster evidence
- managed positions: known and consistent
- open orders: known and consistent
- `DISDEX_V96_OPERATOR_OVERRIDE_AUDIT_SYNC_FAILED`: no longer occurs
- official Operator Override Audit Sync: PASS
- no reconciliation-time order/cancel/position mutation unless an existing explicit repository contract required it and it was separately authorized

Record evidence in the final report.

---

## 4. Phase C — integrate `PENGU_DUAL_LS_V2_FINAL` exactly

### 4.1 Source of truth

`research/PENGU_DUAL_LS_V2_FINAL_FREEZE.md` on this handoff branch is the production-integration specification. The research source is frozen at `f6821440b847a5556bfc4d58c2e32bc6c0ed7d4e`.

Do not optimize against the recent-year results. The production task is implementation parity only.

### 4.2 Production architecture requirements

Implement V2 as a first-class production strategy, not as ad-hoc edits to V1 constants. Prefer explicit V2 names, modules, flags, state and tests, for example the repository-equivalent of:

- `lib/pengu-dual-ls-v2.ts`
- `scripts/disdex-pengu-dual-ls-v2-live-runner.ts`
- dedicated V2 config/schema/tests

Exact filenames may follow repository conventions, but V2 must not masquerade as V1 in runtime state or audit logs.

Required isolation:

- dedicated V2 strategy ID
- dedicated V2 state directory (do not overwrite `.../pengu-dual-ls-v1`)
- dedicated V2 runner lock
- dedicated V2 enable/live-execution environment flags
- clear runtime/version telemetry reporting `PENGU_DUAL_LS_V2_FINAL`
- V1 state retained for rollback/audit but not used as writable V2 state

Migration rule:

- V1 may remain untouched while code is built/tested.
- At live migration, V1 order production must be disabled before V2 order production is enabled.
- Do not start V2 if a PENGU-managed position/pending order/open order is unresolved.
- Do not transfer a stale V1 signal/pending order into V2.
- If no PENGU position/pending order exists, V2 starts from a clean initialized V2 durable state while retaining V1 history read-only.
- If a PENGU position exists at migration time, fail closed unless an explicit, tested migration contract for that exact position exists. Do not improvise takeover.

### 4.3 Frozen signal/execution semantics

Implement every rule from the freeze file exactly, including:

- H1 decisions and next-H1-open entry semantics
- Short 72h regime, 24h impulse, pullback arm/invalidation, rebreak and filters
- Long 72h strong-up regime and breakout filters
- Short/Long max-hold differences
- hard stops
- trailing activation/retrace behavior
- Short priority
- 6h cooldown
- maximum one PENGU position
- ATR-based gross sizing clipped to `[0.60, 0.75]`

Define and test intrabar precedence explicitly so backtest and runtime cannot disagree when stop/trailing/timeout conditions overlap.

### 4.4 Shared portfolio/risk integration

V2 remains inside the existing combined runtime and must respect the existing shared controls. Confirm, rather than assume:

- portfolio/crypto sleeve gross caps
- shared kill switch
- daily-loss state and limits
- Aster account/margin/leverage readiness
- no unmanaged-position takeover
- idempotent order submission/reconciliation
- restart recovery
- V52 coexistence
- V96 coexistence/state isolation

V2 gross sizing may never be used to bypass a tighter shared portfolio cap.

---

## 5. Required V2 tests before any VPS promotion

At minimum add/execute deterministic coverage for:

### Signal logic
- Short 72h regime boundary
- Short -7% impulse boundary
- 24h setup expiry
- +1.25% arm and >+6% invalidation boundaries
- previous-1h-low rebreak
- EMA72/EMA168 conditions
- BTC relative weakness
- volume ratio `[0.25, 3.0]` boundaries using last 6h / prior 36h
- BTC/PENGU 24h guards
- RSI boundary
- Long +15% 72h regime
- prior-18h-high breakout without look-ahead
- Long 24h/relative/BTC/RSI/volume/ATR/EMA filters
- rising-edge behavior

### Execution/exit
- next-open entry, no same-bar fill
- Short max hold 72h
- Long max hold 120h
- Short hard stop +8% adverse
- Long hard stop -8%
- Short trailing +15% / 4%
- Long trailing +10% / 3%
- intrabar stop/trail/timeout precedence
- cooldown 6h
- Short priority

### Sizing/risk
- ATR sizing formula
- floor 0.60
- cap 0.75
- shared cap can reduce/block V2
- one PENGU position maximum
- daily-loss / kill-switch blocks entry

### State/idempotency
- unique V2 lock; no V96/V1 lock collision
- duplicate decision/restart does not duplicate an order
- clean V1->V2 zero-position migration
- stale V1 pending/signal is not adopted
- unresolved external/local state blocks V2
- no unmanaged-position takeover
- process crash between submit/ack is reconciled safely
- durable state survives restart

### Combined runtime
- V52 market-hour lifecycle tests from Phase A remain green
- V96 + V52 + PENGU V2 supervisor startup
- child failure behavior remains fail-closed
- no simultaneous V1+V2 live order-producing workers

---

## 6. Production/research parity gate

Before deployment, replay the production V2 implementation against the same frozen research inputs/artifacts wherever available.

The objective is trade-ledger parity, not merely similar aggregate return.

Compare at least:

- signal timestamp
- side
- entry timestamp
- entry price
- exit timestamp
- exit price
- exit reason
- gross used
- per-trade return

Required result:

- trade count and sides must match the frozen reference for the same dataset/window
- entry/exit timestamps and reasons must match except for a documented representation-only difference
- aggregate return/max-DD should agree within 0.05 percentage point and PF within 0.01 after applying the same fee/funding assumptions

If parity fails, locate the **first divergent trade** and correct the implementation/semantics. Do not change frozen parameters to make aggregates match.

At minimum keep the freeze evidence visible:

- OKX recent-year: 32 trades, +134.77%, PF 2.904, DD -11.31%
- Aster recent-year: 30 trades, +135.37%, PF 2.962, DD -16.17%
- Bitget untouched external: 33 trades, +147.49%, PF 2.990, DD -11.31%

These numbers are evidence baselines, not optimization targets.

**Phase C exit gate:** V2 tests + combined runtime tests + parity gate PASS.

---

## 7. Phase D — create one final immutable Git candidate

After Phases A-C pass:

1. Commit all V52 completion work, reconciliation support, V2 production code, tests, runbook-relevant config/service changes.
2. Push to `codex/pengu-runtime-safety-fix` or a clearly named production-candidate branch based on its latest HEAD.
3. Record the exact final 40-hex commit SHA as `FINAL_SHA`.
4. Ensure working tree is clean.
5. Re-run CI/typecheck/self-tests on `FINAL_SHA`.
6. Do not amend/change code after recording `FINAL_SHA`. Any code change creates a new candidate SHA and all SHA-bound gates must be rerun.

The old `a022...` release is evidence of the interrupted attempt, not automatically the final V2 release.

---

## 8. Phase E — immutable VPS release and activation transaction

Use only the repository's official installer/promotion/approval/preflight mechanisms.

### 8.1 Release

For `FINAL_SHA`:

- create `/home/deploy/disdex-trading/releases/<FINAL_SHA>` as a real immutable directory, not a symlink
- verify the release marker contains exactly `FINAL_SHA`
- verify deployed tree corresponds to `FINAL_SHA`
- run the official installer
- verify helper/systemd unit artifacts correspond to `FINAL_SHA`

Do not switch `current` yet unless the official promotion transaction does so after gates.

### 8.2 Candidate checks

On the exact same `FINAL_SHA`, require:

- official read-only Aster authentication PASS
- candidate Preflight PASS
- V52 status valid for current market conditions
- Crypto durable/external reconciliation PASS
- Operator Override Audit Sync PASS
- PENGU migration readiness PASS
- no unresolved managed pending order
- managed positions/open orders consistent with Aster
- no unknown/unmanaged position is taken over
- approval/parity generated for **the exact `FINAL_SHA`**

A market-closed V52 status may legitimately be a waiting state if the official contract defines it that way; do not fake ACTIVE. Data-unavailable remains a blocker if the contract says so.

### 8.3 Promotion

Promote only after all gates above pass in the same transaction/context expected by the official tooling.

Require after promotion:

- `current` resolves to release `<FINAL_SHA>`
- release marker/tree/unit SHA all equal `FINAL_SHA`
- approval/parity still bind to `FINAL_SHA`

Do not manually move `current` to bypass promotion.

### 8.4 Official service restart/start

After successful promotion, perform **one official restart/start** of the combined service.

Do not start V1 and V2 as separate live PENGU services. The combined supervisor must own exactly the intended production children.

Immediately verify:

- systemd service `active/running`
- `MainPID` non-zero and stable
- runtime reports `FINAL_SHA`
- combined child set is exactly expected
- PENGU runtime identifies V2, not V1
- no V1 live order-producing child remains
- V52 health/lifecycle is correct for current market state
- Crypto/V96 child healthy
- V2 state path/lock are the dedicated V2 locations
- Aster authentication remains PASS
- managed positions/open orders equal expected state
- no duplicate order or duplicate PENGU position appeared after restart
- no unintended order/cancel/position mutation occurred during activation
- shared kill-switch/risk state is in the officially expected post-activation state; do not edit it manually
- logs contain no repeated crash/restart loop, reconciliation error, stale-state warning, duplicate-worker warning, or approval/SHA mismatch

Allow enough observation cycles for each child to execute at least its normal health/recheck path, but do not wait for or manufacture a trading signal.

---

## 9. Failure and rollback rules

### Before promotion

If any check fails:

- stop at the first formal blocker
- leave `current` on the previously promoted release
- keep service stopped/fail-closed if that is the safe state
- keep the shared kill switch active if the official transaction left it active
- report the exact error and evidence
- do not repeatedly retry a mutation

### After promotion but before/after restart health proves stable

If a critical runtime or SHA/safety mismatch appears:

1. activate/retain the official fail-closed/kill-switch mechanism according to repository procedure
2. stop the affected service through the official service mechanism if necessary
3. use the official rollback procedure, not manual symlink/state edits
4. target the last known-good release only after its own state/preflight conditions are safe
5. verify `current`, service status, PID, runtime SHA, open orders/positions and audit state after rollback

`280d2c73f484a82d634450d66aca75603f8e77ff` is the current pre-attempt release pointer, but do not assume restarting it is safe while unresolved durable/external state exists. Reconciliation/state safety takes precedence over code rollback.

---

## 10. Definition of DONE

Do not report `LIVE_ACTIVATION_SUCCESS` until all of the following are true:

- [ ] all V52 runtime/lifecycle errors resolved
- [ ] typecheck/self-tests/CI pass on `FINAL_SHA`
- [ ] unresolved Crypto pending state formally reconciled
- [ ] Operator Override Audit Sync PASS
- [ ] PENGU V2 production implementation matches frozen spec
- [ ] V2 unit/state/idempotency/combined tests pass
- [ ] production/research parity PASS
- [ ] immutable release exists for exact `FINAL_SHA`
- [ ] official installer/unit SHA matches exact `FINAL_SHA`
- [ ] Aster authenticated read-only preflight PASS
- [ ] managed positions/open orders consistent and no unknown takeover
- [ ] approval/parity bind exact `FINAL_SHA`
- [ ] candidate Preflight PASS
- [ ] official promotion succeeds
- [ ] `current` == `FINAL_SHA`
- [ ] one official service restart/start succeeds
- [ ] service active/running, `MainPID != 0`, runtime SHA == `FINAL_SHA`
- [ ] PENGU V2 is the only PENGU order-producing live runner
- [ ] V52 and Crypto/V96 healthy
- [ ] no duplicate/unintended order, cancel, or position change caused by activation
- [ ] post-restart logs/state are clean

If any item is false, status remains `LIVE_ACTIVATION_FAIL_CLOSED` and the first blocker must be reported.

---

## 11. Required final evidence report

Return a compact final report with exact values, not just `done`:

```text
STATUS: LIVE_ACTIVATION_SUCCESS | LIVE_ACTIVATION_FAIL_CLOSED

Git:
  branch:
  FINAL_SHA:
  CI/typecheck/selftest:
  V2 parity:

V52:
  lifecycle fix status:
  market/preflight status:
  worker status:

Reconciliation:
  original pending record identifier:
  external evidence used:
  terminal resolution:
  unresolved pending count:
  operator override audit sync:
  orders/cancels/position mutations during reconciliation:

VPS:
  release path:
  release marker SHA:
  installed unit/helper SHA:
  candidate preflight:
  approval/parity SHA:
  current SHA:
  service state:
  MainPID:
  runtime SHA:

Aster:
  auth:
  managed positions:
  open orders:
  unexpected/unmanaged positions:

PENGU:
  active strategy: PENGU_DUAL_LS_V2_FINAL
  V1 live worker present: yes/no
  V2 state path:
  V2 lock path:
  pending:
  position:

Safety:
  kill switch state:
  duplicate orders:
  unintended order/cancel/position changes during deployment:
  first blocker if FAIL_CLOSED:
```

Do not claim success if any field required to prove the activation is unknown.
