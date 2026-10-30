# V4 evidence expiry - preventive warning (2026-10-30)

SOURCE ONLY. NO LIVE DEPLOYMENT, NO RUNNER RESTART, NO ORDER OR STOP CHANGES.

This isolated branch is based on the trading development branch, not Codex's
PR #302 branch. It keeps the strict 24-hour expiry for mutable account/risk
evidence while separating it from immutable release evidence. Existing
dynamic evidence must still be revalidated from original signed sources by an
authorized root operator. No signature, SHA, approval, or expiry is created
locally; monitoring and refresh planning are not permission to enable orders.

The five records are classified as follows:

- static release proof: `routeSourceParity`, `v4ExecutionTests`. These are
  SHA-bound to the immutable release and are reused until the release SHA
  changes; a 24-hour wall clock does not make them stale.
- dynamic account/risk proof: `establishedAsterOrders`, `signedAsterAccount`,
  `sharedRiskAndPeers`. These expire after 24 hours and the earliest dynamic
  expiry controls the gate.

`scripts/ops/root/disdex-v4-dynamic-evidence-refresh.ts` is the root-only
refresh path. It reads the static proof without writing it, verifies the
release marker, takes one ordered Aster read-only round (server time, balance,
positions, open orders) with rate-limit retries disabled, reads the canonical
root shared-risk state, validates the full bundle, stages the three dynamic
files, and only then replaces them. `--apply` is explicit. A refresh carries
one generation marker; mixed generations fail closed after an interrupted
rename. The helper has no order, cancel, leverage, margin, or STOP mutation
method.

The watcher reads all five root-owned, non-symlink, non-group-writable proof
files. It warns 12 hours before the earliest dynamic expiration with exit code
3, and reports expired/invalid proof with exit code 2. The optional systemd
timer can run every 30 minutes; it only starts the monitor, never V4.
`disdex-runner-health-alert.ts` now folds the same expiry status into its
existing two-observation / 15-minute retry state machine and sends the warning
through the already configured provider. The mail explicitly says that new
orders remain BLOCKED and never claims renewal. Provider acceptance is an
observable transport result; inbox receipt still requires access to the
recipient mailbox and must not be inferred from the send log.

V4 process liveness is independent from order permission. A stale dynamic
proof or a bounded read-only transport failure produces a current heartbeat
with `processState=RUNNING`, `safetyState=BLOCKED`, and
`orderPermission=BLOCKED`; the daemon waits and retries. SHA drift, proof
tamper, protection/STOP drift, or an unknown exception remains the fatal
exit-code-2 path. The watchdog now treats exit code 2 as fatal even during a
transient systemd `auto-restart` state and holds instead of issuing another
restart. `RestartPreventExitStatus=2` remains in the unit.

Codex/operator follow-on:
- First read current V4 systemd, journal, current venue positions and STOP
  without changing state. 2026-10-30 13:03 JST email was a past snapshot.
- The refresh helper must be run only after a root operator verifies the
  exact release marker, official signed Aster GET, shared risk, Margin Guard,
  Kill Switch, and pending-exposure state. It remains read-only unless the
  owner-approved root operation explicitly supplies `--apply`.
- Trace real Aster budget consumption across all runners and prioritize
  pending/STOP reconciliation within existing limits; the refresh helper does
  one bounded read round and never bypasses cooldown or retries 418/429.
- Stage and dry-run watcher, refresh, notification, watchdog and fault
  injection separately from PR #302. Verify provider send acceptance; do not
  report inbox receipt without mailbox evidence.
- Trading authorization stays blocked until actual safety proofs pass and the
  owner approves a separate LIVE change.
