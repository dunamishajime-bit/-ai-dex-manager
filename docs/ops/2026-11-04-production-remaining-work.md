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

## Continuation checkpoint: 2026-11-04 evening JST

Watchdog 3c965981 is now formally verified after bounded freshness waiting:
cycles 1793795706032, 1793795831635, 1793795894299, two stale reads deferred
without being counted. Receipt journal d33293480eb64d08ba9d6f3343fbcdf1,
plan e3d916c6c7e30718430a2d419bae9a92fa898ab2ae2c0ac50cba2731cc0e5b12.
All Runner PIDs/pins/permissions were preserved and bounded recovery restored.

Pending maintenance later reported ACCOUNT_LOCK_BUSY and its timestamp aged
about eight minutes. No account lock was removed. One normal official service
cycle succeeded once free, signed/native reconciliation updated the timestamp,
and V4's HP ALLOWED state recovered. Backend V4 stayed PID 2501831 / no restarts
/ CERTIFIED NO_SIGNAL throughout. Source audit also found the global deployment
exclusive lock pauses the SDK's shared maintenance lock during monitor audits.
New kernel serialization keeps API monitor mutations exclusive to one monitor
transaction and excludes every trading cutover, while allowing the existing
shared read-only maintenance lease. Account lock and API budget are unchanged.
All non-monitor deployment scopes retain the exclusive global lock. Four actual
Linux Root kernel tests prove these boundaries; full suite 246/246 passed.
This serialization change is source-tested, not yet deployed at this checkpoint.

The HP classifier had incorrectly added a five-minute header requirement even
when every entry was RELEASED. Fix 6e31626cf70a3bb8efb2568aca0493200fe691eb
separates closed history from unresolved pending, preserves actual timestamps,
and keeps unresolved stale/UNKNOWN/nonfinite/future values blocked. Gross/STOP
still need the separate fresh signed receipt. Node 34/Python13 passed; all eight
CI families success. Stage and deploy this no-order monitor revision next.

Snapshot renderer now binds its prestart to its own new marker instead of the
old 53 release. Unknown prestart guards are rejected for review, never erased.
These tests are included in the 246-test control suite.

PR427 head 43c8cb75547cef810be7e398a716f227d842c087: V4 atomic + absent-lock
retry, 120 fixture tests and all three CI families passed; not LIVE. PR428 head
4999977da8e5fae4431692923ef2b381f5d1dd8d: 7688 minimal safety candidate,
53 fixture tests and atomic/V12 CI passed, but legacy PENGU parity CI failed
trade 9 entry-time equality by one hour. Its unchanged parity harness downloads
Bitget research data for 2025-08-10..2026-08-10; this is not Aster certification.
Investigate the exact baseline/data/reference discrepancy; do not alter trading
rules or golden metrics just to mark CI green. No new PENGU source is deployed.

### Follow-up verified fixes

Control 53cc30d17ea083e5be75c17a974925faf1dc00d3 passed all five CI families
and was deployed as four explicitly versioned control modules, not a blanket
Runner SHA. Actual kernel coexistence was verified by keeping the monitor
shared lease while the official pending service completed signed reconciliation
at 1793797376367. The service is Type=exec: systemctl start confirms launch,
not completion. Wait for the actual completed source timestamp before reporting
success, rather than reading its previous health record as the current result.

The snapshot prestart was actually pinned to the old scoped monitor marker
`runner-health-snapshot/scoped-v52/0b480f0e...`, rather than the release directory.
The new migration guard initially rejected this unreviewed root. Inspection
confirmed only the legacy marker test/grep pair. Add that exact legacy root
pattern to the reviewed migration allowance; unrelated guards still reject.
The new unit checks only its own immutable release marker. Linux suite remains
246/246. This last source correction still needs CI/control deployment.

PENGU parity discrepancy resolved without runtime logic changes: the reviewed
independent reference already corrected the missing adopted 2% SHORT re-break.
Reuse the existing reference from 3bdcf63c; engine/config are byte-identical to
7688. Exact reference replay passed on 9,263 Bitget bars per symbol. PR428
latest 2f6777c917a725891b57cd5ff5145c11b914664f now has all three CI families
success. It remains a source-only safety candidate; Bitget research parity is
not Aster-native LIVE economic proof. Q102/V52 candidate deltas remain pending.

## Authoritative checkpoint: 2026-11-04 13:30 UTC

Later entries supersede historical incomplete statuses above; original failure
evidence remains intact. V4 stays PID 2501831 / NRestarts 0, immutable 2a6f27c6,
LIVE / ALLOWED / NO_SIGNAL with genuine fresh tick-v1. Latest refresh systemd
completion observed 2026-11-04 22:16:43 JST, Result=success. No lease date edit.

Snapshot 6e31626cf70a3bb8efb2568aca0493200fe691eb is now Production verified.
Receipt: `/var/lib/disdex/unified-deploy/receipts/monitor-snapshot-6e31626cf70a3bb8efb2568aca0493200fe691eb.json`.
Actual snapshot cycles: 1793798013332, 1793798065046, 1793798157813. Plan:
72b5d99bd633f963fccaa0afd8f5705e293aa8dd117511c3499aaa64c511dd90.
All peer PIDs, nine pins, actual operator hashes, single Risk Writer, Kill and
prior trading authority preserved; deployment orders/cancels/position changes 0.
The unit's effective prestart now checks its own immutable 6e marker, not an old
V4/scoped release. Control e8a59a2c source is deployed and five CI families pass.
Watchdog remains the separately certified 3c965981 source; it is not relabeled
as 6e merely because the snapshot changed. Its reviewed program is compatible.

Latest independent snapshot: all seven Runners HEALTHY/LIVE/ALLOWED; V4/V52 real
ticks verified. Five legacy peers remain explicitly tick-unverified, with actual
state update times and no fabricated tick marker. Fresh official signed proof
shows flat/no open orders, pending activeCount 0, Gross 0/0, exact caps 3/4/4.25
and stock slot 2. Shared Risk fresh UTC, loss 0, max 7.5, not tripped; Kill false.
This does not certify the first nonflat fill or authenticated browser display.

Q102 candidate PR429 head 8ea0065f207b37f380f80d0b461074e1369e0249, actual ef1
base: baseline five RED / one pass; patched 66 Linux tests, zero skips. All three
GitHub CI families success. Source only, actual Q102 remains ef1/PID805183.
V52 candidate PR430 head c4fc0041e6526a458ba7d7193a5863c217f7aade, actual 0416
base: baseline five RED / one pass; patched 73 Node plus nine Python tests,
zero skips. CI pending at this checkpoint; source only, actual V52 unchanged.
Both candidates preserve exact economic engine/config and independent pins.

One broad public-source directory archive/transfer was rejected by automatic
review because private-file exclusion was unproven. It was not executed. The
safe continuation individually inspected six source/test files (zero sensitive
literal matches), transferred only those, and copied required public dependencies
locally on VPS through an explicit allowlist. No env/key/private config transfer.

Remaining internal work is NOT an operator-auth blocker: independently approved
candidate release/certificate/state migration/cutover preparation, legacy tick
writers plus monitor parity, remaining scope executors/rollback and complete
decision-to-order/nonflat contracts. Authenticated HP owner session and Aster
annual native source gaps remain distinct external evidence limitations.
