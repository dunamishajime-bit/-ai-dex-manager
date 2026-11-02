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
files, and only then replaces them. The CLI now requires exactly one explicit
mode: `--verify-only` or `--apply`; there is no implicit dry-run mode. Apply
also requires the exact root-owned lease at
`/var/lib/disdex/unified-deploy/refresh-leases/v4/<sha>.json`.

`scripts/ops/deploy/disdex_v4_evidence_refresh_activation.py` is the only
lease installer. It verifies the existing Ed25519 owner approval with the new
`V4_EVIDENCE_REFRESH_ONLY` no-order scope and consumes the owner nonce before
publishing a lease. The lease is exact-SHA and V4-only, expires within 24 hours,
cannot alter runner pins/systemd/current, and contains no private key or copied
signature. A refresh carries one generation marker; mixed generations fail
closed after an interrupted rename. The helper has no order, cancel, leverage,
margin, or STOP mutation method.

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

The V4 primary and canary units invoke the release-local `tsx` CLI entrypoint
through `/usr/bin/node` rather than `node_modules/.bin/tsx`. The latter is a
mutable symlink in some deployed dependency trees and can resolve to another
release SHA even while the runner working directory is correct. The unit also
requires the release-local CLI file to be a regular file. This keeps the
runner's executable lineage aligned with its pinned release without changing
order permission or the current release link.

Codex/operator follow-on:
- First read current V4 systemd, journal, current venue positions and STOP
  without changing state. 2026-10-30 13:03 JST email was a past snapshot.
- Install the refresh lease only after a root operator verifies the exact
  release marker, official signed Aster GET, shared risk, Margin Guard, Kill
  Switch, and pending-exposure state. The new
  `disdex-v4-dynamic-evidence-refresh@.timer` invokes the real apply helper
  every 30 minutes only when that exact lease exists; the separate expiry
  watcher remains read-only. Missing/expired lease, stale evidence, or
  rate-budget saturation leaves evidence unchanged and keeps V4 new orders
  blocked.
- The schedule is staged by the separate root-only
  `install-disdex-v4-evidence-refresh --release-root /home/deploy/disdex-trading/releases/<sha>`
  command. It installs only the exact refresh template units, creates the
  root-owned lease directory, and performs `systemctl daemon-reload`; it does
  not enable or start a Runner. After that staging step, the owner-approved
  `disdex-v4-evidence-refresh-activate` wrapper verifies the one-time Ed25519
  approval, installs/replaces only an expired exact-SHA refresh lease, and
  enables the SHA-pinned refresh timer and starts one exact SHA-pinned
  read-only refresh service. The lease also fixes the single
  refresh status output path and the helper rejects symlinked or untrusted
  output files. It never enables a trading Runner or grants order permission.
  The approval token is supplied on stdin from the owner's trusted terminal
  and is never written to the lease or log.
- The Codex SSH adapter maps this scope to the dedicated refresh wrapper; it
  does not send the refresh scope through the full deployment executor. The
  full Production executor remains the path for runner/systemd cutovers.
- Trace real Aster budget consumption across all runners and prioritize
  pending/STOP reconciliation within existing limits; the refresh helper does
  one bounded read round and never bypasses cooldown or retries 418/429.
- Stage and dry-run watcher, refresh, notification, watchdog and fault
  injection separately from PR #302. Verify provider send acceptance; do not
  report inbox receipt without mailbox evidence.
- Trading authorization stays blocked until actual safety proofs pass and the
  owner approves a separate LIVE change.
