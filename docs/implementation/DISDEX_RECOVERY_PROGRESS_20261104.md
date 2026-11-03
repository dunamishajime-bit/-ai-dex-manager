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
| V52 source/readiness | Candidatebc874c94: independent FET approval, completed-cycle writer, 80 same-PID tick writes + 80 monitor-state writes, failed-read lastTick preservation; 32 local tests and five CI suites pass | Not activated; main4d33 retained | Formal root execution engine, immutable stage, actual strategy ticks and cutover/rollback/audit |
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
