# Production continuation ledger

Owner direction: finish V4 LIVE first, then continue all remaining repairs and
verification. Use actual authenticated root SSH; no subagents; preserve existing
strategy economics, positions, STOPs, shared loss limit, budgets and account lock.

## Current V4 Production checkpoint (2026-11-05 evening JST)

V4 is LIVE_VERIFIED on 7e94ad83286af1f4c8f65f17b0c1bdd017a3c650, PID3247958,
NRestarts0, FULL_LIVE/ordersEnabled=true. All nine services active with real
PID/CWD/SHA identity. The old c168 instance is PID0. The scoped transaction
kept the existing eight peer pins, current symlink and Kill unchanged.

Incident: c168 passed its no-signal cycles but first real INJUSDT entry reached
a relative Margin Guard Python path missing from its role release. Its order
dispatcher conservatively stored UNKNOWN; bounded watchdog restarts also
stopped because the same client order ID was unresolved. Existing signed recovery
proved that v12-v4-94d14d04a7ca1d696fd02c2545d9 had no execution, and resolved
that specific intent to TERMINAL/CANCELLED/CLOSED with pending RELEASED.
The helper initially hit EACCES writing its historical audit file after signed
reads; the Root-owned original was preserved in
unknown-entry-recovery-historical-1793866481599616856.jsonl, then the helper ran
with its deploy-owned 0600 audit file and canonical shared budget. No order,
cancel, or position change was sent by recovery.

The same SHA was first restored with its own absolute Margin Guard override
pointing to the unchanged verified 2a source, after deploy-user signed preflight
HEALTHY. The first canonical start failed its certificate/safety check; a
read-only reproduction passed and a bounded retry passed the actual prestart.
Three actual c168 recovery ticks passed under PID3235013. Receipt:
v4-margin-wiring-recovery-1793866730879033908/tick-audit.json.

PR431 was then deployed with a complete 114-file Git-exact release, including
the missing Margin Guard entrypoint/imports and existing unknown-entry tools.
Archive fdda9b9c99250eea3a4b4069dc673cab30b306fe598d8fbb884331fcd446932f.
Release-local Margin Guard self-test and deploy-user signed read-only preflight
HEALTHY; execution/route certification 37 tests, 41 routes, typecheck, plus
8 display/unknown-entry regressions. Parent plan
1e2b0f045a617e8321d7558442fa48e2da78f8b06a6df4e519d4bc92667dcfa3.
Full plan 2b4fd03cf01d6605f1179c03bf9d681939d3b6993bb6876db3655c131faab82d.
Formal receipt /var/lib/disdex/unified-deploy/receipts/v12_v4-7e94ad83286af1f4c8f65f17b0c1bdd017a3c650-68febed5.json.
Actual advancing ticks1793868180922/1793868291610/1793868411131.
All three signed witness rounds flat with zero positions/orders/pending and
7.5% Shared Risk, no unknown/partial STOP, no audit mutations. Actual backend
ALLOWED / NO_SIGNAL with current SHA and 14 ranking observations, none with
the duplicate USDT suffix. No live fill was forced or claimed.

New SHA has an independent, genuine refresh-only lease through Nov6 17:41:39
JST. The 17:46:56 JST natural timer trigger ran successfully and published
signed evidence at17:47:01.610 JST; refresh-only never granted orders.
The scheduled task checks the current pin and lease dynamically.

Prevention: PR422/fc7fa9dd now rejects missing, writable or non-Root Margin
Guard sources before the static certificate can be published. Linux8/8, all
required GitHub CI successful; installed helper SHA256
99e0b6ab768c76ca6eaf242024886813046d52d2169b5e1129a91e6bf99f810c.
No-order install receipt static-margin-contract-install-1793868533683102241/receipt.json.

PR428/429/430 are staged under peer-source-staging in the Root-private audit
area. All three archives match exact Git blobs and the validated dependency
lock. Isolated Linux tests passed: crypto66, Q10274, V5273 Node plus9 Python.
These are SOURCE_READY_NOT_LIVE. The V52 executor still assumes a historical
protected hold and old4d33 SHA; it is incompatible with today's healthy 0416
baseline. Generic peer scoped execution and independent dependent-pin handover
remain internal implementation work. The five legacy peers still lack
Production-certified runner-owned ticks.

After the owner logged in, the real HP showed a false SHA_MISMATCH. Its
SHA-bound V12 primary compatibility file still named retired53a although
the exact current V4 unit, heartbeat and canonical approval matched7e94.
The formal monitor-only CAS transaction changed only PRIMARY_SHA. Receipt
hp-primary-pin-1793868980551734713/receipt.json, plan
815eefd9b1c30a27f1b7eadec6000845cdb08b8ec08eb95eb9ef934df1e82fba.
Authenticated home and decision-status now show LIVE confirmed7e94; all
eleven checked desktop navigation links rendered in the authenticated session.
The observed actual UI service CWD/marker is b882bd1b, while current-plan
registers737ec050. The legacy live UI directory failed the existing Root
immutable-release check; the stale registry was not overwritten with that
unverified root. Proper immutable UI staging/registry reconciliation remains.

Control f2c3c740 passed all CI. Its scoped V4 upgrade helper now adds the
HP compatibility pin to the same planned CAS wiring and refuses a mismatched
legacy baseline. HP_ONLY plan validation permits UI-root changes while rejecting
any change of runner or monitor root. Linux V4 tests25/25 and plan tests17/17.
Both modules installed under genuine no-order Root authorization, receipt
hp-pin-controls-install-1793869381554527388/receipt.json. Installed V4 helper
verified read-only against the actual corrected HP config. Trading and UI
processes were not restarted by the HP configuration/control repairs.

## Earlier verified milestone (2026-11-05 daytime)

V4 is LIVE_VERIFIED on c16859dcfab218b4a8c14d691e756da8819f8845,
PID3066811, NRestarts0. Formal scoped Root activation is FULL_LIVE/ordersEnabled=true.
The three advancing actual ticks and signed venue proofs are recorded in
v4-reviewed-root-upgrade-1793846156446242421.json. All other runner pins and
the current symlink are unchanged. This does not certify a first live fill.

Refresh-control79ab07e41fec26450a3927a33effff054906bb37 passed all five Git CI
families and Linux111/111. Its one Root helper was CAS-installed under genuine
API_MONITORS/ordersEnabled=false authority at1793849218030. Installed digest
99b3b39b34bf4eac9d4352685ade52195781ae3f5ef42ee5621f7122662e9353;
receipt directory refresh-control-e89b7e58c4d54556843a398df7ff7b9f.
The natural timer trigger12:30:51 JST published genuinely fresh evidence at
03:30:55.987 UTC. The next actual healthy decision tick1793849491896 followed
on the same PID without a restart. Root-private receipt:
v4-automatic-refresh-baecb26d458f418ab4139cc9f4f755e5.json,
AUTOMATIC_REFRESH_AND_NEXT_REAL_TICK_VERIFIED. Verification sent zero orders,
cancels or position mutations. Lease expires Nov6 11:36:50 JST; this successful
scheduled cycle is not an indefinite self-renewal claim. Normal budget saturation
can still defer entries; it does not revoke the existing Root activation.

Independent telemetry audit reproduced INJUSDTUSDT/AVAXUSDTUSDT in the gate
projection: base-symbol observations were joined with quote-qualified execution
pairs. PR431/ac4a19ef fixes only that join, stacked on the exact deployed V4
branch. Linux test RED before fix, GREEN4/4 after fix; input snapshots and actual
candidate direction remain unchanged. SOURCE_READY_NOT_LIVE pending CI and any
separate scoped deployment. Live native LONG source and derived SHORT route
must not be conflated or changed to force an entry.

Continuation: PR431 now7e94ad83 passed all three CI jobs. Its strict source-parity
test permits exactly the three telemetry join replacements, with occurrence
counts, while preserving every other reviewed runtime byte. No blanket lineage
check was removed. Production V4 remains c168; display-source repair is not LIVE.

Monitor31aa8fd88e27cac6c848937f39007ade19976b7c passed all eight CI families,
Linux21 tests and formal Root API_MONITORS preflight. Immutable role archive
ecae53f30e6dacc1bb45a7fb08312d3efa9892ff61662bcedb4027d03afe7c4b.
The formal no-order monitor transaction completed with plan
12e88cd7b91374faefd37756e6581b9a0c07ad80ad5091717792e6cc4a090996,
three snapshots1793850047355/1793850089040/1793850206723. Both real V4/V52 ticks
advanced between counted snapshots. All runner PIDs/pins, approval hashes, Kill,
and current symlink remained unchanged; own mutations0. Receipt under
/var/lib/disdex/unified-deploy/receipts/monitor-snapshot-31aa8fd88e27cac6c848937f39007ade19976b7c.json.

A subsequent direct signed SDK read failed/deferred and was NOT reported PASS.
Rather than bypass budgets or repeatedly call the exchange, waited for the next
regular10-minute timer. Fresh native capture1793850700 then passed the existing
formal bounded witness validator without another API call. Receipt
post-monitor-natural-signed-witness-1793850701912013293.json: empty positions,
orders and pending, unknownStops0/partialStops0, loss limit0.075, healthy Margin,
Kill, account lock and exact runner map. Source capturedAt/expiresAt preserved.

Q102 root-cause audit: actual ef1a runner already publishes decision-snapshot.json
and last-tick.json, but monitor reads pending/position only. Flat latest reason
was therefore LEGACY_STATE_TIMESTAMP instead of QUALITY102_CAUSAL_V4_NO_SIGNAL.
PR432/c5e9da24 adds a no-follow, producer-owner/SHA/freshness checked reader.
It explicitly preserves tickVerified=false and authorizesTrading=false; real
selection metadata and final execution reason are separate. No proximity score
is invented as a strategy score. Four regressions RED/GREEN; Linux29/29 including
existing monitor contracts and actual ef1a read-only preview passed; all CI jobs
passed. Immutable archive52644aba134f38749a1ec6fa9fe2bf382bc6aed858481152470ef4a653e68c43.
Formal preflight passed with plan
11bd994771cd603165ebaee69441ba08342c0122a65e1fc68240a27c3a47f2d2.
The formal monitored transaction completed: MONITOR_SNAPSHOT_VERIFIED_NOT_TRADING_AUTHORITY,
snapshots1793850745337/1793850755832/1793850882230, both real V4/V52 ticks
advancing, priorTradingAuthorityPreserved=true, livePreserving=true, mutation
counters0. Receipt /var/lib/disdex/unified-deploy/receipts/monitor-snapshot-c5e9da24faf960050a6bc0785b45f60fb8d3115d.json.
Current health snapshot service source is c5e9da24; watchdog remains8dd with the
certified serialization wrapper, unchanged by this snapshot-only transaction.
Actual public Q102 projection now reports the correct completed no-signal reason
with sourceShaef1a, authorizesTrading=false, tickVerified=false. No-signal has no
selected family/layer/score; these remain null instead of invented values.

Actual peer decisions at this checkpoint: PENGU base Long/Short conditions inactive;
HYPE TREND_ALIGNMENT_NOT_MET; FET FET_NO_BRK48_R72_SIGNAL;
IDLE GENERIC_CANDIDATE_NOT_SELECTED_ROUTE; V52 US_EQUITY_SESSION_CLOSED.
All seven trading services are active with ALLOWED canonical authority, but five
legacy writers are not yet certified as real ticks. These are observed reasons,
not a claim that every no-entry period in history had the same cause.

Final identity read this checkpoint: all nine services active, NRestarts0,
marker/CWD/pinnedSHA match. PIDs: V43066811; Q102805183; V522195629;
PENGU1384509; FET2869793; HYPE544225; IDLE2881468;
SharedRisk2017780; Margin3064744. V4 actualtick1793850875594,
heartbeat1793850944361, canonical ALLOWED / decision NO_SIGNAL. Disk48G total,
39G used,9G available,82% (read earlier this continuation; no new cleanup claimed).

### Remaining six work groups (not an owner-authorization-only blocker)

1. Implement and test healthy-LIVE scoped peer upgrade executors, including
   independent activation-map/consumer bindings and lossless state handover.
   Q102/FET/HYPE/IDLE generic executor absence is internal unfinished engineering,
   not missing owner consent. Never call the obsolete protected-hold-only V52
   path against the current healthy baseline or clear Kill to fit its assumptions.
2. Stage and independently certify peer safety sources PR428/429/430, then deploy
   only with their matching formal scope contract, current venue/state proof and
   three actual ticks. They remain SOURCE_READY_NOT_LIVE; approved old sources
   currently continue with their existing authorities.
3. Upgrade the five legacy real-tick writers together with their direct Node
   systemd loaders and monitoring; never flip monitoring alone to tick-v1.
4. Deploy PR431 producer telemetry join in a separately verified V4 release when
   performing the next required runtime change; no cosmetic hot-edit/restart of
   the newly stable immutable c168 release. Source tests/CI are already complete.
5. Complete actual authenticated owner UI inspection. Backend snapshot proofs
   are complete; no owner cookie/session/login was fabricated. Main UI worktree
   changes remain untouched. Do not call anonymous200 authenticated UI evidence.
6. Continue regular shared API-load/cooldown accounting and bounded refresh
   operation. Refresh now works naturally and rejects stale evidence, but occasional
   budget deferrals still occur. The c168 refresh lease expires1793932610
   (Nov6 11:36:50 JST); genuine new Root SSH approval can renew only inside the
   existing final12-hour window. Never edit dates, spoof SSH context or schedule
   an indefinitely self-authorizing renewal. This is an operational renewal
   condition, not a claim of perpetual authorization.

Separate research/economic blockers: missing native annual warmup and unapproved
Gross/timing changes remain outside these safety deployments; not blanket V4 gates.

## Historical verified milestone

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

## 2026-11-05 V4 recurrence and owner-directed 120-second repair

V4 is currently healthy/LIVE/ALLOWED at 2a, PID2813424, with actual ticks. Do not
claim uninterrupted PID2501831: systemd history shows fatal exits at 01:01:43
and 03:00:46 JST, both FRESH_SHARED_ACCOUNT_LEDGER_REQUIRED. INJ SHORT candidates
were present; two ENTRY intents never received venueOrderIds, recovered terminal
with CANCELLED zero-quantity/zero-reservation legs. Native current positions and
open orders zero in official signed proof. At preparation marks were 52,322ms
and 47,624ms old; at fatal rejection about 68,230ms and 63,475ms.

Candidate PR427 c16859dcfab218b4a8c14d691e756da8819f8845 now implements the
owner's explicit 120-second account-ledger limit through one common constant.
Also fixes terminal-history prefetch reuse, genuinely refreshes signed inputs
after cold scans, preserves signed source timestamps independently of journal
append time, blocks expired entry preparation before intent persistence, and
retries exact read-only freshness errors without killing the daemon. All other
economic files/caps/STOP rules are unchanged. Tests35/35 and typecheck passed;
strict lineage3/3; all four GitHub CI families success. Not deployed: current
Production 2a still has the old thirty-second source.

Root refresh-only lease was genuinely renewed with a new Root-session nonce,
same SHA and ordersEnabled=false. approvedAt1793822489, expiresAt1793908889,
2026-11-06 05:01:29 JST. Trading activation dates/scope were not changed.

Monitor snapshot AND watchdog 8ddce642869acce24ab7575307ff84105b9cd6ef are
Production verified. Snapshot plan8beef613d2fa5fb79230c24247ba5bc5eb3b34a3a502be4a40ffb72d19549cc3,
cycles1793800456998/1793800533113/1793800640596. Watchdog plan
ee4112a8260657df0f63e362377ae48b5f481f03a8c337d546485f814eb14fcb,
cycles1793800690214/1793800764633/1793800891090, bounded recovery restored,
one stale read deferred/not counted. All frozen pins/permissions/peer PIDs were
preserved at those cutovers. Current monitor source-only numeric fix31aa8fd8
preserves unknown STOP/ranking values and real zero Q102 score; local9/9 passed.

Peer PR428009a5349 contains actual 7688 atomic fixes, genuine completed tick
wrappers for PENGU/FET/HYPE/IDLE and unknown-mutation logging corrections. All
three CI families success; peer combined65/65 and individual new log RED/GREEN.
Q102 PR42904f8b09a adds the same completion wrapper to its actual ef1 lineage,
73/73 plus fatal-log RED/GREEN, all four CI families success. V52 PR430c4fc0041
73Node+9Python, all three CI success. These remain SOURCE_READY_NOT_LIVE.

The required V4 upgrade preparation is an internal implementation task, NOT
missing owner authorization. The old priority helper assumes obsolete HOLD
clearance and old static producer overwrites global /etc evidence. Do not use
them unchanged for the healthy LIVE baseline. New source adds explicit Root
private candidate-bound static staging, exclusive no-overwrite publication and
tests. Seven actual Linux Root tests pass, zero skips; default legacy API stays
compatible. CI/install/staging are next. New-SHA cutover must preserve inactive
Kill, stage certificates away from current LIVE, coordinate terminal state and
pin/wiring under legitimate scoped authority, and audit three genuine ticks.

Continuation checkpoint: the static helper a273391b passed all five CI families
and was installed with a private backup and exact digest check. Candidate c168
build2 contains 106 exact Git blobs, immutable existing dependencies and marker;
private static evidence passed 37 tests, 41 routes and typecheck. This is staging
evidence only and does not grant trading authority. Production is still 2a.

Healthy-LIVE upgrade support is currently UNCOMMITTED and NOT INSTALLED. Local
priority/scope Python tests: 27 run, four Windows-specific skips, no failures.
Bootstrap Node tests: six run, four pass, two Windows-specific skips. Root Linux
verification remains required for those filesystem cases. The new preserve-Kill
branch rejects an active Kill. Effective layered monitor wiring now supports only
the explicitly scoped V4/V52 prefixes, retaining unrelated values. Preflight,
old-writer stop before durable migration, failure recovery and explicit CLI
binding are not finished; do not execute this partial healthy-upgrade mode.

Owner reaffirmed 120 seconds. This is signed account-ledger admission freshness,
not API timeout, refresh-lease lifetime or permission to redate evidence. Candidate
tests accept exactly 120000ms and reject 120001ms; genuine 65-second preparation
remains admissible and 121-second preparation fails closed before intent creation.

Further continuation: the source now binds an explicit candidate/private static
directory, derives the old SHA from real pins, verifies the old FULL_LIVE
activation and real decision process, and updates every effective V4 monitor
layer without changing peer keys. New-source upgrade and protected same-source
recovery are separate CLI modes. Old PID0 and unchanged protected context are
required before signed-flat recheck and durable migration. Before migration,
rollback can start only the original SHA with unchanged pins/approval/certificate,
valid terminal history and fresh signed/risk proof. After state ownership changes,
the old source must remain stopped; a protected recovery receipt records this.
Inactive Kill is preserved, never cleared by this mode. The superseded V4 refresh
timer is retired under the deployment lock after verified cutover (or retained
stopped after a migrated failure), preventing two refresh generations publishing.

The actual read-only preview exposed a separate audit-wait defect: a genuine
SHARED_ACCOUNT_LOCK_BUSY cycle caused immediate failure. The reader now defers
only a fresh, correctly identified, orders-disabled locked cycle within its
existing deadline. Such a cycle never counts as a healthy audit. Unknown blocks,
bad identity/permissions/future timestamps still reject. New tests failed first,
then passed. Linux fixture upgrade-unit-final.log: 86/86, no skips. Bootstrap
Linux tests: 6/6, no skips. Updated helper CI/install and final Production
preview/cutover remain pending; these test results are not LIVE certification.

The actual preflight correctly timed out without a healthy tick. Investigation
found an orphan lock, not a legitimate long-running owner: ownerId
IDLE_PRIORITY_SHORT:2866857:1793823882471, acquired1793823882472,
expired1793824002472, reservations empty, /proc/2866857 absent. The existing
recovery parser treated the trailing timestamp as the PID. New parser recognizes
this exact reviewed IDLE format and rejects oversized/ambiguous PID forms.
Recovery apply additionally requires Root and an exact approved file SHA256;
archive checks the inode/metadata/bytes again before rename. It does not disable
the account lock or restore a live/unknown owner. Isolated baseline tests fail
for PID parsing and wrong approved hash; patched Linux tests7/7, no skips.

Independent signed native GETs at1793831818597/1793831820574/1793831824930
confirmed positions0/openOrders0, each with zero orders/cancels/position mutations.
Raw original responses remain in orphan-lock-native-1793831814694928409 under
the Root audit base. Orphan bytes SHA256
c9aeae65ca4191e62253a0e6c8296969aee602f178024544458732c343b5b3a7
were unchanged through all reads. This is a recovery prerequisite, not three
healthy V4 decision cycles. Orphan archival and new V4 cutover are still pending.

Later checkpoint: orphan archival was completed by the formal reviewed helper
after three new sequential signed reads and fresh risk/margin/pending checks.
Receipt directory orphan-lock-root-recovery-75f6083587fd49a4aa3660b2944b670f;
archived original hash exactly c9aeae65ca4191e62253a0e6c8296969aee602f178024544458732c343b5b3a7.
Pins, old V4 activation, certificate and Kill hashes remained unchanged. No
order/cancel/position mutation. An earlier parallel batch failed closed at GET2
and did not archive anything. The existing valid 2a refresh-only service then
succeeded, and the actual 2a runner returned HEALTHY/NO_FRESH_NON_DUPLICATE_CANDIDATE.

Candidate build2 was unused and lacked the operator-gate mjs and mutual-exclusion
shell preflight. Preserved it in rejected-unused-v4-builds/...-build2-ccaf4f343c40413d98ea69813779e7df,
then staged build3:108 exact Git blobs, archive
4661a6d2596ccd0fef99e3e8ad5c562c6f552416f6409f6d37d3ad7439e11391.
New private static evidence cc5743cad4df4657a835a0a5c9d004d4/c168...:
37 tests,41 routes,typecheck,operator-gate import and shell syntax all pass.

Control modules a4ff359f installed with exact hash CAS and private backup
v4-control-before-a4ff-1793832102420534805. All five CI families b5907ca3 passed,
including the newly wired orphan recovery tests. V4 remains 2a, not c168.
New-source attempt consumed its genuine Root nonce but stopped BEFORE stopping
old V4: daemon-reload changed systemd's transient ExecStart telemetry. The old
fingerprint also collapsed repeated ExecStartPre lines, losing earlier guards.
New strict fingerprint retains every configured command/ignore-errors flag and
strips only the exact runtime timestamp/PID/exit suffix. Real PID/state/restarts/
cwd remain independently frozen. Malformed formats fail closed. Idempotent unit
staging avoids unnecessary daemon-reload. Both defects reproduced RED then GREEN.
Linux execution-fingerprint-tests.log:97/97,no skips; real all-nine systemd
configuration parsing passes. Latest source CI and scoped two-module install
remain pending. Existing old LIVE, terminal state and inactive Kill are intact.

Control c453a597 subsequently passed all five CI families and its two modules
were installed with CAS backup v4-control-before-c453-1793833466544619207.
The next command was not executed because automatic approval review reached its
usage limit; no alternate route was used. On Nov5 11:02 JST, after the stated
10:00 reset, normal Root SSH review resumed. Pins were unchanged; existing 2a
had automatically recovered under a newer PID, and its marker briefly belonged
to the prior process, so the old marker was not accepted as current proof.

Fresh preflight then approved exact V4 plan739be78f..., but systemctl stop was
cancelled/replaced and old V4 was active again with another PID. Pin, certificate
and durable state all remained 2a. The real watchdog service still executed the
immutable8dd Node script directly, without the common deployment flock; this
left a recovery/cutover race. New Root wrapper holds shared deployment lock for
the full native watchdog child; an exclusive formal transaction defers without
running recovery or writing a fake marker. Normal bounded recovery, approvals,
sourceSHA and audit-only mode are unchanged. Future watchdog cutover rendering
uses the wrapper and binds its hash; installer provisions it too. Linux focused
tests104/104,no skips, including real kernel flock and malformed-path/permissions
rejection. Two unrelated complete-installer checks could not run in this reused
fixture (missing public example and legacy CRLF fixture); full Git CI must check
those. Wrapper CI, Root scoped installation and actual deferred/native execution
evidence remain pending. No V4 c168 LIVE claim is made.

V4 LIVE checkpoint (Nov5 JST): all five CI families4f21a6e8 passed. The three
Root helpers were CAS installed under a genuine API_MONITORS/ordersEnabled=false
Root-session approval. Watchdog serialization receipt:
watchdog-serialization-44578ccd3e62412c94b56d4d812f0768/receipt.json;
plan891a872f430d4ae4656f3ff602d754a17b18a0ed9836b44e94c69a9e2b1a8e30.
Actual systemd invocation deferred under exclusive deployment lock without
executing the native child or advancing its marker; all peer processes unchanged,
watchdog timer restored. Later three native watchdog journal invocations completed
with exit0/restarts0; latest all seven decisions and both dependencies NOOP.

V4 c168 build3 was formally deployed through Root issuer/full executor. Parent
plan9b1161e669fe0940e044bf0b34a1cfcad7d19db47043d68bf1f82a23f806e731;
full executor plan15a73db5192f4f9ad4d58f0db9432f549a4ae5d7419dde3aa541ee2137ed210d.
Receipt v4-reviewed-root-upgrade-1793846156446242421.json:
V4_LIVE_CUTOVER_VERIFIED, targetc16859dcfab218b4a8c14d691e756da8819f8845,
PID3066811,NRestarts0. Genuine advancing decision ticks:
1793846280109 /1793846388106 /1793846497334
(11:38:00.109 /11:39:48.106 /11:41:37.334 JST). Each corresponding signed venue
proof reconciles empty positions/protective orders/pending, unknownStops0,
partialStops0, dailyLossLimit0.075, healthy Margin/Kill/account lock/Gross and
exact runner map. All deployment order/cancel/position mutation counters0.
Old2a is PID0/masked; current symlink remains7688; all eight other pins unchanged.
Fresh Root-owned0600 activation targets DD1296_FINAL_ALLIN_10BPS, V12_V4 only,
FULL_LIVE/ordersEnabled=true, ROOT_SSH_SESSION, approved02:36:52 UTC. It was
genuinely issued, not an owner Ed25519 signature/copy. HP backend snapshot verifies
tick/actualSHA and separates ALLOWED authority from NO_SIGNAL decision.

Separate genuine refresh-only lease targets c168, ordersEnabled=false, expires
1793932610 (Nov6 11:36:50 JST). New timer active, old timer inactive. However the
first scheduled refresh rounds failed: broker logs explicitly record
ASTER_GLOBAL_RATE_BUDGET_SATURATED:4519 /:4250 on weight40 reconciliation;
the old proxy renders its negative response as V4_BUDGET_PROXY_RESPONSE_INVALID.
No malformed response was accepted. At 15-minute commit expiry, entry correctly
became BLOCKED while the same daemon stayed alive. Formal read-only refresh under
maintenance serialization succeeded at03:10:34.666 UTC; no date was fabricated.
Do NOT claim continuous automatic refresh yet. New Root-control source retries
only rejected, explicitly readOnly/no-trading rounds at most3 times with15/30s
backoff plus0..5s jitter. Every attempt invokes the same immutable validating CLI;
lease/SHA/risk/unknown failures stop immediately, including expiry after a prior
deferral. No budget/lock/sandbox/approval is relaxed and failed partial data is
never republished. Linux111/111 tests pass, zero skips. CI/install/natural scheduled
refresh proof for this last control fix remain pending; actual runner code staysc168.

Remaining source-only peers: PR428009a5349 (PENGU/FET/HYPE/IDLE),
PR42904f8b09a (Q102), PR430c4fc0041 (V52), and PR42631aa8fd8 numeric projection.
Authenticated owner browser UI remains unverified. Latest backend ranking also
shows an extra INJUSDTUSDT observation row; audit its projection vs true decision
inputs before fixing. Do not alter trading conditions/terminal deduplication to
force a trade. Annual native history gaps and uncertified economics remain separate.
