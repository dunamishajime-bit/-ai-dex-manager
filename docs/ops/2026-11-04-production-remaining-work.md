# Production continuation ledger

Owner direction: finish V4 LIVE first, then continue all remaining repairs and
verification. Use actual authenticated root SSH; no subagents; preserve existing
strategy economics, positions, STOPs, shared loss limit, budgets and account lock.

## Verified milestone

V4 **LIVE_VERIFIED for the backend scoped cutover** on immutable source
`2a6f27c6d2896aee420cbc44fe1ab8103750376c`, PID 2501831, NRestarts 0, enabled.
Scoped owner authorization is ordersEnabled=true via actual CODEX_SSH. Current
decision is healthy NO_SIGNAL, not a permission block; no first live fill has
been claimed or forced. Three actual tick completion times:
1793776692774, 1793776789993, 1793776886205.

Official receipt (root-private VPS evidence):
`/var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/v4-priority-recovery-live-1793776891.json`.
All three signed read-only witnesses reconciled flat positions/orders, STOP
ownership, pending, Gross, Margin, Kill and Shared Risk 7.5%. Other Runner PIDs,
source maps, peer approvals and the single Risk Writer were frozen and verified.

Root control code `3ab755aa8e9f14a4fea6b321f796f42439d6b2e6`, PR 422, five GitHub
CI families passed. Linux root/control 169 tests and actual immutable V4 budget
resilience/priority 38 tests passed. Full V4 uses the canonical shared-file SDK
budget (50ms/5000ms) and account lock. The monitor proxy remains read-only.

The obsolete 25d4... refresh timer was retired after the new LIVE receipt; it
collided with the new no-order updater's flock. No Runner process was changed.
The current 2a6... timer is enabled, interval 10 minutes plus jitter. Its explicit
post-retirement refresh passed at 2026-11-04T07:26:38.008Z. Verify a real scheduled
trigger as well. Refresh lease expiry is 1793847999; renew only through a genuine
fresh approved root SSH request inside the existing final-12-hour window. Never
edit an old approval date/lease or synthesize a local SSH identity.

Fresh resident-stop observation dynamically inherits the actual SHA map:
V4 2a6..., Q102 ef1a..., V52 0416..., other crypto peers 7688...; current native
positions/orphan STOPs/unprotected count are all zero. Preserve this live binding.

## Remaining work groups (not completed by the V4 milestone)

1. **Continuous evidence maintenance:** scheduled refresh verification, bounded
   failure notification/retry behavior, genuine renewal procedure and expiry
   tests. Do not claim permanent renewal merely because the first run passed.
2. **Watchdog and canonical HP monitor:** active watchdog still executes old 53
   source, misreads direct Node V4 and reports TARGET_MISMATCH. In isolated
   `runner-health-phase-recovery-20261104` (PR 426), new uncommitted work accepts
   the exact release-local node --import command, validates canonical DD target
   independently from V4 policy using the complete live map, adds audit-only
   recovery intent, separates decisionPermission, fixes diagnostic evidenceMode
   and enforces exact 7.5% in health. New unit regressions have run RED/GREEN.
   Finish integration/CI/immutable staging and a live-preserving API_MONITORS
   root transaction; it must not restart any trading Runner during certification.
3. **HP authenticated UI and delivery:** browser's existing Production tab is
   logged out at /login. No owner password, OTP or session was fabricated. Finish
   source/server/API checks first; authenticated screen verification remains
   separate. Main worktree is `codex/hide-home-v12-v4-runtime-20261017` at b205...
   with 21 existing tracked UI/API modifications; preserve them and inspect in
   isolation, do not reset/overwrite. Vercel is not a target.
4. **All Runner decision-to-order review:** source parity, current logic reasons,
   independent owner SHAs and existing permissions. Keep Q102 ef1a and V52 0416
   authoritative; do not resurrect older economic drafts. Verify true cadence.
5. **Legacy tick writers:** all other legacy Runners remain explicitly legacy,
   not falsely certified as runner-owned new ticks. Upgrade source and monitor
   together under exact per-Runner approval; never manufacture markers.

### Continuation verification at 2026-11-04 08:06 UTC

V4 still PID 2501831, NRestarts 0, LIVE / ALLOWED, with real completed ticks.
Scheduled refresh succeeded at 07:47 and 07:57 UTC; the exact active timer is
`disdex-v4-dynamic-evidence-refresh@2a6f27c6d2896aee420cbc44fe1ab8103750376c.timer`.
The shorter `disdex-v4-evidence-refresh@...` name does not exist; do not infer
an outage from that unrelated unit name.

PR 426 monitor source ea12de80 passed 7 CI families but the newly added boundary
step ran the Root-owned pin filesystem fixture as nonroot. Its trust check
correctly rejected the fixture. Follow-up de1f1631 runs that one fixture with
actual Root ownership, matching the dedicated observed-phase workflow; no trust
validation was relaxed. Node regression suite 30/30 and Python 13/13 passed.
The actual existing Root-owned V4 full activation passes the new gate without
copying or rewriting it.

API_MONITORS control now has a separate live-preserving observation validator:
exact existing permissions, pins, PID/systemd identity, operator artifact hashes,
single Risk Writer and Kill state remain frozen. Only volatile pending file
digest is excluded from identity equality; monitor neither grants nor mutates
pending or trading authority. Protected-hold validation remains unchanged.
Existing and new Linux Root fixtures: 234 tests passed. This is source/test
verification, not yet a monitor Production cutover or whole-project completion.

### Canonical monitor Production cutover completed

The monitor-only source `de1f163180ded8ffbe31af462152abb10deb6231` passed all
eight GitHub CI families and was staged as a Root-owned immutable role release
(archive SHA256 f462b77e2043e0e307b80c83c07d771d89c63d0653dd051345a7758868f50024).
Root no-order API_MONITORS approval bound to plan
20eb513bf5ac5b7bb52342884ed8f727df06dd0469c55fb41ab45bd0962cd0c9
was consumed once. The official monitor receipt records distinct actual tick
snapshot cycles 1793779559702, 1793779641864, 1793779744556. V4 stays LIVE and
ALLOWED with decisionPermission NO_SIGNAL; diagnostic evidenceMode is tick-v1.
All peer PIDs/pins/approvals, current symlink, single risk Writer and Kill stayed
unchanged. Orders/cancels/position mutations by this deployment: 0.

Watchdog read-only preview using that immutable source produced NOOP for all
seven Runners plus both safety daemons, no errors/restarts/trading effects. The
old watchdog has not yet switched. A separate exact-plan Root SSH scoped
transaction is being added: watchdog-only config allowlist, audit-only first,
three real V4 tick cycles, then restore existing bounded recovery. It cannot
start/restart/stop a trading service from the deployment control boundary.
New source and installer fixtures passed in the Linux Root suite, 239/239.

### Latest source-backed HP observations and safe continuation

Snapshot source 3c965981224c3eb9658e88873ae3381d42ea3c3f passed eight CI
families and completed scoped Production snapshot cycles 1793794541554,
1793794562127, 1793794644342. V4 is still PID 2501831 / NRestarts 0 / LIVE.
The canonical projection now reads existing signed maintenance proof: actual
flat Gross 0/0, available 3.0 crypto / 4.0 stock within total 4.25, pending 0,
STOP NOT_REQUIRED_FLAT and 14 genuine ineligible V4 symbol observations. This
does not certify an authenticated browser screen or a nonflat trade.

The subsequent watchdog-only alignment to 3c965981 failed closed on a canonical
snapshot older than the unchanged 60-second audit freshness bound. Its new
config files were removed; the previously verified de1f1631 bounded watchdog
and the 3c965981 snapshot/V4 LIVE remained in place. Fix: wait for a genuinely
fresh snapshot within the existing transaction deadline and do not count stale
reads as audit cycles. Invalid/future timestamps still reject. Rollback now also
emits a separate immutable outcome record. Linux Root suite: 240/240 passed.

Actual deployed atomic source audit found UUID/exclusive publication fixes in
Shared Risk 2737c30e but older implementations in V4/7688/Q102/V52. PR 427 is a
minimal V4 candidate based exactly on current 2a6f27c6, with 119 local VPS
fixture tests and all three GitHub CI families successful. PR 428 is a separate
7688 peer candidate, with four RED collision regressions, deterministic absent
lock handoff RED and 53 GREEN tests; source/CI/cutover remain separate. No new
Runner SHA has yet been activated for either candidate. Q102/V52 need minimal
hunks against their exact independent baselines; do not copy older whole files.
6. **Shared API/state concurrency:** 80-writer tests, real multi-Runner contention,
   crash/recovery, unique temp files, cooldown/backlog/lock ownership diagnostics.
   Preserve budgets, STOP monitoring priority and unknown/pending fail-closed.
7. **STOP/partial-fill/restart protection:** exercise unknown/partial/restoration
   failure paths against each current owner. Flat LIVE evidence is not proof of
   a new non-flat fill. Verify graceful stop timing (old 30s unit limit killed a
   sleeping flat process during failed certification); protect journals/STOPs.
8. **Gross/reservations:** finite values and final common admission truth. Preserve
   approved economic caps. Priority transfer/economic changes require separate
   certification; no dynamic Gross allocation and no automatic draft #402 merge.
9. **Unified deployment scopes:** current executor supports selected scopes;
   complete scoped engines, adapters and rollback for remaining individual
   Runners/HP without widening ordersEnabled=false authority. Both Root SSH and
   Actions routes remain valid under their own formal contract.
10. **Integration and final all-Runner audit:** reconcile remaining PR sources,
    appropriate CI, immutable markers/digests, actual pins/PIDs/cadence, native
    signed GET, risk/Gross/pending/Kill and authenticated HP. Retire obsolete
    deployment routes only after both replacement/recovery paths are certified.
11. **Native-history economic evidence:** keep annual eight-logic warmup/source
    gaps explicitly blocked; no synthetic/Binance substitution. This does not
    block unchanged-economics safety repairs above.

Do not convert source-ready, tests or successful V4 backend cutover into a claim
that all groups or authenticated HP/all Runner LIVE certification are complete.
