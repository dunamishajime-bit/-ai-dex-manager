# DisDex recovery checkpoint — 2026-11-04 JST

Full trading LIVE is **not verified**. The owner authorized the canonical root
SSH route; no additional owner-signature work is being demanded for that route.
No test orders, cancellations, position changes or manual Kill reset were used.
This is a source/operations checkpoint, not an approval or fresh venue artifact.

| Work | Verified result | Production status | Remaining |
|---|---|---|---|
| Shared Risk strict source, PR424 | SHA2737c30e, signed flat before/after, three actual Risk refreshes, 7.5% preserved | Active PID2017780, old Writer masked; COMMITTED receipt | Full Runner audit remains separate |
| No-order root restart continuity, PR422 | c4f22cd2 committed-receipt restart prestart passes; old approval not re-dated | Installed before pending component | No induced Production failure/rollback was claimed |
| Pending-only maintenance SDK, PR425 | 7b7719c6, four CI suites, Linux root fixtures, GET-only grant/owner rejection, typecheck | Immutable staged and formally installed through root gate5748f2bb, orders disabled | Ongoing freshness/API-budget monitoring |
| Pending scheduled reconciliation | Three signed successful times1793718472925/1793718575246/1793718759121; 34 entries preserved, active pending0, positions/orders0 at those reads | Normal 90s timer; root receipt0400; pins/Runner identities/current/Kill unchanged | One intermediate budget saturation4475ms failed closed; OnFailure fired; email delivery not certified |
| V52 duplicate monitor | Duplicate7b monitor stopped; 0d monitor retained; three readonly preflights | Actual trading4d33 unchanged | Readonly preflight is not a strategy tick |
| V52 source/readiness | Candidate041653b7: independent FET approval, completed-cycle writer, 80 same-PID tick writes + 80 monitor-state writes, failed-read lastTick preservation; 34 local tests and five CI suites pass | Formally committed under protected hold; PID2195629, NRestarts0 | Final trading authority/Kill recovery remains separate |
| V4 bounded refresh | ab8e3fe8 preserves sealed legacy proof; explicit bounded contract, safe publication, ten-minute timer | Staged, not activated | Separate refresh-only authority/lease and later trading certification |
| V4 explicit read-only phase, PR418 | b3468849 five CI suites; genuine read-only dispatch before trading store/adapter; release/runtime/CWD identity independent of LIVE ACK | Formally committed MONITOR_ONLY; PID2131810, NRestarts0, exact source/CWD; old53 masked and standalone89 stopped | Not trading LIVE; full certification, lossless state SHA migration, separate order enable |
| V4 root no-order executor | Gatea10ccbda + monitor module56e6a281 installed; Linux root fixtures, exact scope, source/nonce binding and three actual ticks1793727236122/1793727302972/1793727371089 verified | V4_MONITOR_ONLY_VERIFIED receipt; state hashc3c44d9f... unchanged; peers/Risk/Kill/current preserved | Bounded refresh and trading approvals remain independent |
| V52 root authorization contract, PR423 | 9638a7ef: exact V52-only source/scope/plan/route; no forged Actions provenance, FET grant or Kill-clearance grant; 17 local tests | Source contract only, not an installed V52 executor | Real root execution/rollback/audit and CI |
| Authenticated HP, final order enable | Not certified | No new trading authority added | Phase-aware actual UI/API audit, formal per-Runner trading enable, three final LIVE cycles |

Pending evidence:
`/var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/pending-three-scheduled-cycles-1793718802286.json`.
Scope/plan hash:
`PENDING_RECONCILE_ONLY / a16f431a6f5ae7a5aecef74ff8e025f3436ee53df52b4ce4800f6a871615fda3`.
Receipt:
`/var/lib/disdex/unified-deploy/pending-maintenance/committed/7b7719c65d2c6116d02463fc4603200f28e20762.json`.

The protected Kill remains the existing recoverable V52 Q102-SHA mismatch hold.
It must be resolved by the correct runtime and its normal recovery gate, not
cleared by editing the file. Economic changes and missing annual native history
remain separate from noneconomic safety recovery. Remaining work above is
internal implementation/verification; this checkpoint does not mislabel it as
solely an external owner-approval blocker.

V4 committed receipt:
`/var/lib/disdex/unified-deploy/receipts/v4-monitor-only-b3468849cfee0f334b8a1b6a545dbd6c2e48da9a.json`.
Plan SHA256: `f203d2076234e163c474a5d21f1eb8525f83f6f231caa91cfc1e5d8668acccb6`.
Independent post-commit audit:
`/var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/v4-b346-monitor-only-post-commit-1793727521790.json`.
The root-owned0400 activation authorizes neither trading nor evidence refresh.
Read-only prestart was verified again after commit without restarting the PID
or rewriting approval times. All actual orders/cancels/position mutations in
this procedure remain0. The existing V4 durable journal was replay-validated,
retained byte-for-byte, and mounted read-only for the monitor phase.

Two rejected V4 attempts were real fail-closed operations, not PASS results:
the first exposed repeated systemd EnvironmentFiles being discarded by the
parser; the second exposed monitor dispatch calling the LIVE ACK reader.
Both were fixed from failing tests, pushed and CI-verified. Rollback readback
confirmed pins/current-plan/state/Kill and all other trading Runners unchanged.
The V4-only standalone monitor was restarted on the second rollback. The final
b346 attempt completed its three actual cycles on one stable PID.

## V52 executor continuation (2026-11-04 JST)

PR423 bc2c00c9 supplied the protected-hold engine. Only the new module and its
contract tests were transferred to PR422; divergent histories were not merged.
PR422 code851c786b connects the canonical root dispatcher/read-only preflight,
installer and Linux CI. All73 Linux root tests pass without skips, including
partial metadata rollback, exact permissions, old enablement restoration and
no durable-journal rewind. V52 was subsequently switched through the installed canonical root gate; see committed result below.

V52 candidate041653b7 is staged with exact-lockfile Node dependencies and owned
immutable release-local Python dependencies. Source archive SHA256:
4b1b4f267c3a648584a4f0bb448281032c0239051710bc232d329e90bb9e234a.
Root plan SHA256: b5d7d63276a1aeb7a05fab0bad04006987dcc6b2fd28a12b22791ebec5d20a71.
Read-only preflight passed under genuine root SSH using normal rate budget,
fresh signed flat GET and strict existing protected hold. It does not consume
a deployment nonce or grant runtime authority.

Two incorrect assumptions in the new executor were corrected from evidence:
- Actual old/candidate V52 Gross constants and running environment are
  Crypto3.0/stock4.0/portfolio4.25 (stock slot2.0), not the older report's
  3.0/1.5/3.5. The executor compares every dataclass cap and observed preflight
  caps against actual old source, rejecting economic changes/NaN. No cap changed.
- Healthy Margin Guard polls every300seconds. The existing no-order witness
  accepts at most15minutes. The new two-minute assumption was removed for
  protected-hold deployment only; fresh pre-order Margin checks are unchanged.

Real rejected preflights included normal local-budget saturation, pending age
and stock quote age. Failure categories reveal no signed URL, response body
or credential. Quote threshold remains5000ms; no clock retimestamping or
freshness relaxation was used. A successful preflight followed genuine quote
updates. This does not certify reference availability throughout a trading day.

## Committed V52 protected-hold cutover

Actual source041653b7b808fd46be2fef408c8e41a1c6d3a55b, PID2195629,
NRestarts0. Old4d33 service stopped. Three actual decision ticks:
1793735709944 / 1793735739810 / 1793735767414. Each was independently
SHA/PID/CWD/service-validated and paired with fresh signed flat GET.
The root851c786b executor passed73 Linux root tests and all five CI suites.
Status: V52_PROTECTED_HOLD_VERIFIED_NOT_FULL_LIVE. V52-only runtime authority
is ordersEnabled=true; effective newOrdersAllowed=false under the unchanged
HOLD_PROTECTED. This grants neither peer authority nor Kill clearance.
Receipt: /var/lib/disdex/unified-deploy/receipts/v52-protected-hold-041653b7b808fd46be2fef408c8e41a1c6d3a55b.json.
Receipt SHA256: ed889612d201370e873c4061f999179c1acbe406f75eeb8c0e43b1e8d989d8ae.
Independent audit: /var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/v52-041653b7-post-commit-1793735812447.json.
Peers, Shared Risk7.5%, pending, Kill and current7688 symlink were preserved.

## Monitor source and executor recovery

PR426 candidate3bdcf63cd9c06630614186bfbb04a4f789b1fd08 now passes all six
GitHub CI suites. Local14 tests cover canonical HP source/target/authentication,
actual tick identities and MONITOR_ONLY authority separation. Canonical HP
publication and exclusive atomic writes are retained, alongside Production's
Q102 operator flag guard. Missing canonical ticks are not inferred from the
supervisor time. Legacy state timestamps are explicitly unverified.

Root18d1fd73da204211b25d22f1961c0a8731e06a77 implements API_MONITORS with
ordersEnabled=false, exact unchanged Runner map, its own source/root binding,
consumed nonce, immutable recovery journal, target-only snapshot systemd
configuration, three actual V4/V52 decision observations and CAS rollback.
All90 Linux root tests pass. Component installed with hash-CAS and backup;
Runner services have not been changed by this monitor executor installation.
Plan fdb0af65ceff53acb7062004cb2799c9f1f14c94512155c6e6f931ca7ee529ef
passed actual no-order preview. Root18d1 CI completion and the monitor service
cutover/three-cycle audit remain separate until recorded as committed.

## Formally committed no-order monitor source cutover

Snapshot source3bdcf63cd9c06630614186bfbb04a4f789b1fd08 is Production's
actual snapshot systemd WorkingDirectory/ExecStart. All six source CI suites
passed; executor d9a010906f56d21fd91e7ae7d9337f88e9f0e43c passed91 Linux
root tests and all five CI suites. This replaces only the snapshot service.
No Runner was restarted and no Runner pin or trading approval changed.
The existing shared Kill remains HOLD_PROTECTED.

One initial cutover failed its effective source readback because historic
systemd drop-ins sorted after the fixed new filename. The actual VPS had
a near-NAME_MAX run of z characters. It rolled back its own configuration;
V4/V52 PID and NRestarts remained unchanged. The corrected executor chooses
a bounded-length filename after every observed override, validates the final
loaded source, retains per-attempt immutable journals and records rollback
outcomes. The rejected attempt's original journal/nonce were not rewritten.
A new actual root SSH authorization and fresh single-use nonce were consumed.

Committed result: MONITOR_SNAPSHOT_VERIFIED_NOT_TRADING_AUTHORITY.
Scope API_MONITORS, ordersEnabled=false, authorizesTrading=false,
authorizesKillClearance=false. Three snapshot cycles1793740531606 /
1793740552060 /1793740623727 each observed distinct actual V4/V52 ticks.
V4 modeMONITOR_ONLY/processHealthy=true/tickVerified=true/newOrdersAllowed=false.
V52 modeLIVE/processHealthy=true/tickVerified=true/newOrdersAllowed=false
under its preserved protected hold. Legacy peers explicitly have unverified
state timestamps rather than manufactured canonical decision ticks.

Receipt: /var/lib/disdex/unified-deploy/receipts/monitor-snapshot-3bdcf63cd9c06630614186bfbb04a4f789b1fd08.json.
Plan: fdb0af65ceff53acb7062004cb2799c9f1f14c94512155c6e6f931ca7ee529ef.
Journal: /var/lib/disdex/unified-deploy/monitor-transactions/3bdcf63cd9c06630614186bfbb04a4f789b1fd08-9aec4c9b0c544feaa8b1baa98e8e4a26.json.
Independent post-commit audit: /var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/monitor-3bdcf63c-post-commit-1793740680598.json.
Fresh post-cutover signed GET1793740680231: positions0/openOrders0,
orders/cancels/position mutations0. Risk7.5%, trippedfalse. V4 committed
no-order prestart passed without restarting or re-dating approval.

Authenticated HP browser audit was attempted using the existing browser.
Computer Use stopped because it could not reliably identify the current URL
to enforce its browser policy. Browser input stopped; no password, cookie
secret or owner approval was synthesized. Authenticated UI remains unverified.

Full trading LIVE remains BLOCKED_FULL_LIVE_NOT_VERIFIED. Remaining work is
not solely operator approval: V4 state SHA migration/full certificate and
root refresh contract deployment/lease continuity; exact protected-hold
recovery; remaining Runner decision-to-order/API/Gross safety verification;
authenticated HP and notification delivery; per-Runner order enable and final
three LIVE cycles. Economic changes remain separate and unadopted.

Post-monitor Shared Risk restart continuity was also checked without restarting
the Writer. The first bare SSH invocation lacked the guard's required
systemd environment and correctly returned SHARED_RISK_PRESTART_ENVIRONMENT_MISMATCH.
Reading only the two non-secret required values from the actual pinned Writer
PID/CWD and using them in the read-only guard produced
SHARED_RISK_COMMITTED_NO_ORDER_RESTART_READY, inheritedLatchTripped=false,
inheritedRiskUpdatedAt1793740783977, ordersEnabled=false, limit7.5% retained.
No approval timestamp, receipt, state or service was changed by that check.


## V4 lossless migration and fresh static certification (staging only)

PR418 candidate9da6c2ce24d1a1920fa7b3e12b8ace2112730446 passed all five
GitHub CI suites. Its immutable release is staged, not the running V4 source.
The migration preserves historical legs, terminal intents, closed STOP records,
realized PnL, cooldown and replay journal. Publication uses an exclusive UUID
temporary, exact-byte backup, fsync and one atomic replace; crash/CAS tests
preserve a valid old or new ledger. Signed migration transport is GET-only.
No Production ledger rebind or migration apply has been performed.

The static evidence helper now counts actual TAP passes, rejects missing/zero/
ambiguous test summaries, disables incremental typecheck writes and uses the
candidate's actual tsconfig.v4-release-candidate.json. Root staging generated
41-route parity, 37 real test passes and successful typecheck for exact9da6.
Source helperc907afeee2cc9cf8878af7afb20adfefd1bce389. Staging evidence:
/var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/v4-9da6-static-evidence-1793744018569.
No Production certificate, approval, lease or order permission was changed.

Existing Production certificate remains schema v3, approvedSha53a0be39,
validUntil2026-11-03T20:55:21.606Z (expired at observation). Five existing
/etc/disdex/v12-v4-evidence files instead bind3524e367, not currentb346 or
candidate9da6; refresh-commit.json is absent. These are genuine historic
artifacts but cannot be re-labelled or re-dated as current approval.

## V4 full cutover real decision audit correction (source only)

The old full executor counted three signed GET captures one second apart as
three audit cycles. It now waits for three distinct completed strategy ticks
from the actual process, binds runtime/expected SHA, service, PID, systemd and
/proc CWD, rejects restarts, old/pre-cutover/future/stale markers and checks
heartbeat publication against lastTickAt. A bounded wait handles missing markers
and the tick-before-heartbeat atomic publication window. It never writes a tick.
Healthy full-LIVE NO_SIGNAL is accepted without requiring a test order;
MONITOR_ONLY, CANARY and unhealthy states cannot certify full LIVE.
Venue heartbeat validation likewise no longer demands orderEnabled=true for
a healthy NO_SIGNAL. Order permission must still be a consistent boolean.

Linux root isolated tests: full cutover39, venue8, static evidence3 and existing
monitor-only7 all pass (57 tests, no Linux skips). Test archiveSHA256:
37b78aa1ea5d5d7f33ca219ba497b5d7c345dce5a9de9c0f1f8b7345e66ad064.
Staging test source:
/var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/v4-real-decision-root-tests-37b78aa1.
No active root helper or Runner unit was replaced by these tests.

This is not certification of the remaining full executor: safe rollback after
possible newly owned exposure, formally scoped ledger migration, bootstrap of
the bounded v4 certificate/refresh contract and exact protected-hold recovery
are still open implementation tasks. Full LIVE remains unverified.

Production read-only check2026-11-03T22:18:55Z: V4b346 PID2131810,
V520416 PID2195629, Risk2737 PID2017780; all active/NRestarts0.
Disk48G/40G used/8.2G available83%. Remote master still6bb84dc9.


## Conservative full-LIVE failure recovery and refresh path alignment

A failing Linux test reproduced the old executor restarting the old V4 SHA
after a new full-LIVE process had run. This cannot prove STOP/intent ownership
compatibility. After any candidate start attempt, the corrected executor stops
and masks the candidate, keeps the old unit masked, retains candidate pins,
ledger and runtime identity, and records RECOVERY_REQUIRED_PROTECTED. It issues
no venue mutation and never restores an old approval artifact to authorize a
new lineage. A failed start is also ambiguous and uses the same isolation.
Automatic old-source restart remains possible only before candidate execution
has been attempted. A compatible recovery or re-enable still requires fresh
venue, durable lineage and exact-scope authority; this change does not pretend
that an arbitrary old release is a certified trading rollback.

The refresh-only approval helper's outputPath now matches candidate9da6's
root-managed /var/lib/disdex/unified-deploy/v4-evidence/evidence-refresh-last.json,
not the runner-writable state directory. This changes the exact refresh plan
hash; existing approvals/leases are not rewritten or copied. This source helper
must be installed together with the matching candidate worker/contract. It has
not replaced the currently installed Production refresh helper.

Linux isolated suites after these changes: V4 cutover40, venue8, refresh lease11,
static3, monitor-only7, common root gate42; all pass, no Linux skips. Executions
include imported shared fixtures; do not interpret the sum as unique test cases.
Test archive1be374d84953d35fdb2d864e978e204bdd73a450bfdbed7ea64aea974558290f.
Isolated source /var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/v4-recovery-green-1be374d8.

Fresh normal-budget signed GET verifiedAt1793744719705: positions0/openOrders0;
orders/cancels/positionChangesSent0; pending beforeHash==afterHash. Root audit:
/var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/current-readonly-venue-1793744719756.json.
Risk7.5%, sourceComplete=true, UTC2026-11-03, risk age13834ms, tripped=false.
Existing shared Kill remains active with the exact V52/Q102 mismatch reason.
No trading authority or service state changed during this read-only diagnosis.
