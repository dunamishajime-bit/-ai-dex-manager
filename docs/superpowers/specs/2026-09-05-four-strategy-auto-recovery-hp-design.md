# Four-Strategy Auto-Recovery and Quality102 HP Integration Design

## Decision

Add operational auto-recovery for the V12, PENGU Recovery V8, V52, and `QUALITY102_CAUSAL_V1` runners, while keeping all trading safety gates fail closed. Add Quality102 to the existing HP status and 判定条件 surfaces through the same typed status source used by the runtime/API.

Auto-recovery means recovery from an operational failure: process exit, hung runner, stale heartbeat, or release drift. It does not mean bypassing a trading safety stop. A runner may return to LIVE only after its normal preflight and reconciliation pass.

The historical Quality102 selector parity flags remain unchanged. The deployed sleeve remains the causal `DERIVED_HIGH_VOL_ONLY` implementation; missing historical HIGH_VOL 525-to-30 and BRK-strength provenance is not inferred or represented as proven.

## Scope

The change covers:

- V12, PENGU V8, V52, and Quality102 liveness reporting.
- A bounded watchdog/recovery mechanism for each runner.
- Exact release SHA and working-directory drift detection.
- Restart-time reconciliation and duplicate-order protection.
- A shared HP/API status model containing all four strategies.
- Quality102 target-symbol and decision-condition display.
- Unit, integration, API, UI, build, and deployment verification.

It does not change strategy entry/exit formulas, position ownership, Gross caps, or account-level risk policy. It does not force-close positions, cancel existing orders, or issue probe orders.

## Recovery State Machine

Each runner writes an atomic heartbeat/status record containing:

- strategy identity and service instance;
- runtime/release commit SHA;
- process identity and expected working directory;
- mode and explicit live-enabled state;
- last successful tick and heartbeat timestamps;
- last preflight/reconciliation timestamps and result;
- safety state (`LIVE`, `WAITING`, `FAIL_CLOSED`, `MANUAL_REVIEW`, or `KILL_SWITCH`);
- bounded recovery-attempt metadata and last failure class.

The watchdog checks service state, process command line, `/proc/<pid>/cwd`, heartbeat freshness, and release identity. Heartbeats use atomic replacement so a partial write is never treated as healthy.

Recovery is eligible only for:

- an unexpected process exit;
- a process that is alive but no longer emits a heartbeat within the configured operational timeout;
- an executable or working-directory drift from the pinned release;
- a runner startup failure that is safe to retry.

Recovery is not eligible to clear:

- kill switch or daily-loss latch;
- stale or incomplete market/account data;
- failed reconciliation;
- unresolved or ambiguous order state;
- manual review;
- unknown safety state.

Those states remain fail closed. If the underlying condition clears, the normal preflight/reconciliation path can transition the runner back to LIVE without a manual order or state mutation.

Restarts use bounded exponential backoff and a maximum attempt window. Exhaustion records an operator-visible `RECOVERY_EXHAUSTED` state and leaves the affected sleeve unable to submit. A Quality102-local recovery failure must not stop V12, PENGU, or V52. Shared account, lock, reconciliation, or global risk uncertainty continues to block all new orders through the existing global gate.

## Startup and Reconciliation Contract

Before a recovered runner evaluates a new signal, it must verify:

1. The service is using the expected immutable release SHA and working directory.
2. The configured mode and live arm are internally consistent.
3. Account positions and open orders reconcile successfully.
4. Local pending state is consistent with exchange state.
5. The strategy ownership lock is held exactly once.
6. Gross and risk calculations are complete and fresh.
7. No existing order or position is force-modified by recovery.

Only after these checks pass may the existing signal-to-planner-to-executor path resume. Recovery itself never submits a synthetic, test, or replacement order.

## HP/API Integration

Extend the existing status API with a typed record for each strategy rather than creating a Q102-only hardcoded widget. Every record contains:

- display name and strategy ID;
- service state and last heartbeat;
- operational state and safety reason;
- runtime SHA and release SHA match result;
- last decision/trigger state;
- current managed position and pending-order summary, without secrets;
- Gross cap and current Gross where available;
- recovery state and last recovery event.

The Quality102 record additionally exposes:

- selector mode (`DERIVED_HIGH_VOL_ONLY`);
- whether historical selector parity is proven (false remains explicit);
- Quality102 cap `0.50x`, Crypto cap `2.00x`, and Total cap `2.50x`;
- the effective target-symbol list read from the runtime configuration/status source;
- symbol eligibility, data freshness, and fail-closed reason.

The 判定条件 page and relevant positions/strategy status surfaces consume this same API response. Target symbols are not duplicated as independent UI constants. If the runtime status is unavailable or stale, the HP displays `要確認`/safe status and does not imply that the strategy is LIVE.

## Safety and Compatibility

- V12, PENGU V8, and V52 signal and sizing behavior remain unchanged.
- Quality102 remains an independent lowest-priority sleeve and cannot block base strategy orders.
- Existing Kill Switch, daily-loss control, stale-data gate, reconciliation, account lock, duplicate-order prevention, and strategy isolation remain active.
- Historical fixed CSVs and historical timestamps are never used as live signal inputs.
- No private key, secret, or raw environment value is exposed in HP, logs, commits, or artifacts.
- No Vercel deployment is used; the HP and runtime deploy through the XServer release path.

## Tests

Tests must cover:

- atomic heartbeat write/read and stale-heartbeat detection;
- process exit, hung process, command/cwd drift, restart backoff, and recovery exhaustion;
- no automatic clearing of kill-switch, daily-loss, stale-data, reconciliation, or manual-review states;
- automatic return after a recovered condition passes fresh preflight and reconciliation;
- Quality102-local failure isolation from the three base strategies;
- exact SHA and single-runner ownership after restart;
- duplicate-order and pending-state protection;
- all four strategy records in the status API;
- Quality102 selector mode, target symbols, caps, and safety state on HP;
- unavailable/stale status renders safe `要確認` state;
- existing strategy regression tests, TypeScript typecheck, production build, and CI.

All tests are no-order tests. No live, synthetic, or test order is used for verification.

## Deployment

1. Add tests and the recovery/status design implementation on an isolated `codex/` branch.
2. Run local tests, typecheck, and production build.
3. Push and require GREEN CI at the exact commit.
4. Build an immutable XServer release and install the watchdog/systemd units and HP assets.
5. Perform read-only preflight and verify all four services, exact release SHA/cwd, heartbeat, reconciliation, Gross settings, disk headroom, and zero order activity.
6. Restart only the affected services in a controlled sequence if required by the release; do not alter positions or orders.
7. Verify that stopping/restarting a runner through a no-order harness recovers it, while safety-latched states remain fail closed.

The final report must state changed files, commit SHA, CI run, service and heartbeat status, HP/API status, Q102 target symbols, recovery test results, and whether any live/test/synthetic orders were sent. Expected order counts are all zero.
