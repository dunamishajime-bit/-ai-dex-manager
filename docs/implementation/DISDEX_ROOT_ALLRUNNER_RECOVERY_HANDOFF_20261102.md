# DisDex root-level all-runner recovery — verified handoff (2026-11-02)

Status: **BLOCKED_FULL_LIVE_NOT_VERIFIED**. Source fixes and operational pin correction have been performed, but no all-runner production cutover was made.

## Authorized operator route

- Repository: `dunamishajime-bit/-ai-dex-manager`
- Production: `professional-dismanager.net`
- Target: `DD1296_FINAL_ALLIN_10BPS`
- Direct root SSH was available using the owner's existing desktop key; a root session by itself does not waive signed venue, order protection, or risk gates.
- All actions must preserve existing positions, protective STOP orders, Kill Switch, pending exposure, and runner-specific immutable release identity. No tests may submit real orders.

## Source changes prepared

- PR #412: strict signed venue and UTC-day Shared Risk evidence, explicit flat-state and margin/pending checks, workflow YAML fix, unverified monitor-only starts fail closed.
- PR #413: stronger snapshot safety validation, accurate blocked LIVE reporting, UUID atomic heartbeat writing and transient rename retry.
- PR #414: integrated #412 + #413 on independent `fix/allrunner-integrated-safety-20261102`, including fail-closed unsupported legacy tick evidence and new CI source boundary.
- Isolated Windows Node tests: **8/8 PASS**, including 80 concurrent heartbeat writes.
- CI on PR #414: runner-pin, snapshot v2, all-runner final safety, V4 IDLE HYPE safety, order-enable safety, and HP approval contract tests passed on their individual jobs. Verify current conclusion for the exact latest SHA before promotion.
- These checks do **not** prove production trading readiness.

## Root VPS observations

- Initial systemd: V4 `53a0be3967...` failed, PENGU `7688ed7c93...` inactive, FET `7688ed7c93...` failed. HYPE, IDLE, Q102, V52, Shared Risk and Margin Guard were active. Active is not necessarily order-capable.
- Root filesystem 48 GiB / 45 GiB used / 2.8 GiB available (95%). FET's previous journal explicitly reported `ENOSPC` when creating `/var/lib/disdex/shared/aster-rate-budget.json.lock`. No unverified archives or audits were deleted.
- Root-owned runner-pin manifest remains **schema v1** (not yet upgraded to the safe v2 wire schema). Its V52 entry had been stale `97830672...`; it was corrected transactionally to `4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81`, after verifying the exact active systemd unit, real process CWD and release marker. Other runner entries were preserved. A private root backup was written under `/var/lib/disdex/ops-backups/v52-pin-correction-20261102/`. Read-only reinspection confirmed the new V52 SHA. No V52 restart or order mutation was part of this change.
- Old V4 execution-store file: root:root, 0600, 1,595,122 bytes; revision 10877, `releaseSha=53a0be39...`; 3 CLOSED legs, 9 TERMINAL intents, 3 CLOSED protections. This state **cannot** be blindly reused by a new SHA or a deploy-user daemon. The source needs a transactional, immutable-lineage migration.
- Signed Aster GET returned `ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS`, observedAt `1793614431412`; positions 0, openOrders 0, ordersSent 0, cancelsSent 0, positionChangesSent 0. This is only point-in-time evidence and must be refreshed before any cutover.
- Existing pending registry contained 34 entries, all `RELEASED`; Shared Risk UTC day `2026-11-02`, cap 7.5%, sourceComplete=true, tripped=false; Margin Guard HEALTHY, Kill Switch inactive at the inspection instant.

## Remaining blockers before order-enabled activation

1. The current master/PR #412 does **not** contain the complete V4 runtime source and its transitive dependencies; the closed, divergent PR #407 contains candidates. Selectively reconcile required reviewed files instead of merging #407 wholesale.
2. Implement actual **non-order-capable** V4 startup and prove it cannot submit, cancel, amend or place STOP orders. V4 must use its exact pinned runtime loader and effective systemd environment. The old candidate `3524e367...` lacked a complete SHA-specific runtime env and still had loader/ownership issues.
3. Transactionally migrate V4 history to an approved exact SHA after fresh signed flat-state, STOP, pending and immutable lineage checks, retaining root-only backup and deploy-readable runtime permissions.
4. Safely restore PENGU/FET only after isolated monitor-only execution and their own independently verified peer, state and risk gates. Do not use `systemctl start` on an order-enabled runner as an observability test.
5. Bind real runner ticks to the running process, exact SHA, systemd CWD, and trusted persisted tick. The unmerged #407 writer currently emits schema `disdex-runner-tick-heartbeat/v1` while the v2 supervisor expects `disdex-runner-tick/v1` with main PID and CWD. Fix the writer/reader contract **before** declaring a real tick verified.
6. Complete distinct real-tick/venue/risk checks over 3 consecutive cycles. Three signed GETs without native ticks do not pass.
7. Test staging and immutable release checks, CI, updated root-owned manifest v2 wiring, rollback, HP status, API locking, gross limits and real STOP ownership. Obtain fresh signed venue evidence immediately before any order permission.
8. Address persistent 95% disk pressure and the previously observed FET ENOSPC without deleting unknown audit, backup or active state files.

## Explicit non-actions

No new order, order cancellation, position change, STOP amendment, Kill Switch change, unreviewed service restart, production operator activation, or full-LIVE declaration was executed as part of this handoff. Remain fail closed until evidence and authorization conditions are independently satisfied.
