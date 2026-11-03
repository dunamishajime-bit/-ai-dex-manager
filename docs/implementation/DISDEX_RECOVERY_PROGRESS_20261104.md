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
| V52 source/readiness | Candidate49a47b05 and root helper579b5d23 CI successful; independent FET approval source fix | Not activated; main4d33 retained | Formal root adapter, latest source binding, real strategy ticks, cutover/rollback/audit |
| V4 bounded refresh | ab8e3fe8 preserves sealed legacy proof; explicit bounded contract, safe publication, ten-minute timer | Staged, not activated | Separate refresh-only authority/lease and later trading certification |
| V4 explicit read-only phase, PR418 | a98f8a48 five CI suites, 72 regression tests, typecheck; later dd6ebd2c removes unnecessary fresh-pending fallback dependency | Not activated; old53a0 remains failed; separate89 GET-only monitor retained | Final source CI, immutable candidate, no-order cutover and three actual decision ticks |
| V4 root no-order executor | Independent monitor approval, no refresh/order authority; immutable same-PID loader; durable-state replay/hash preservation; partial metadata rollback contracts | New implementation not installed at this checkpoint | Linux root fixtures, CI, readonly preflight, scoped cutover and audit |
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
