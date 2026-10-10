# V12 V4 handoff debc: final read-only certification audit

Source: `debc5a878c32e6e65d15d7139879ba487e5e117e` on
`codex/v12-v4-production-cert-20261009`.

STATUS: BLOCKED_TIME37_OPERATOR_APPROVAL_AND_INDEPENDENT_VENUE_CERTIFICATION.
This is an audit, not an activation artifact or signed execution certificate.

## Research and code validation

Read the final request and its five named primary documents in full. The
accepted retrospective 16-route source/Entry/Exit evidence is 212/212; the
additional preformal sample is 178/178 across 11 of those routes. Five remain
unobserved out of fit. Do not claim 41/41 independent external observations.
Research-only preflight checks all pass and intentionally returns exit 2.

Exact-source CI run 38038812138 / job 114174784978 succeeded, including Linux
full root regression, root type checks, UI contracts and production build.
Root TypeScript was independently rerun successfully on this Windows PC.

Windows V4 tests first returned 119/120: source evidence digest failed because
Git core.autocrlf converted canonical LF JSON into CRLF. Git blob SHA256 and
recorded digest both equal
1878185b60b769f2e8039001ff6cf8f37c2970a7ad3f7846fad0a9ad862eefd3.
CRLF checkout SHA256 was
6f7e45897593366998469e608b8e45ec43676855844767347fe08adf298887a3.
Added one exact-path LF attribute and restored LF formatting only. No JSON
content, recorded digest or test expectation changed. Rerun: 120/120 PASS.
This packaging fix requires exact-final-SHA CI before deployment.

## VPS read-only observation

Current symlink and release marker remain
`ce1edeead8d0f9e5d88e829d415057117502a335`.
All seven trading services and both safety services are active/running,
NRestarts=0, WorkingDirectory at the current release. Trading PIDs:
V12 2919664, PENGU 2920260, Q102 2920216, V52 2920314,
FET 2920004, HYPE 2919841, IDLE 2919716.
RESIDUAL is an IDLE sub-owner, not a separate service.

Signed Aster diagnostic observedAt 1791622870880 passed: balance
72.47855158 USDT, available 72.46602791, positions=[], openOrders=[],
ordersSent=0, cancelsSent=0, positionChangesSent=0.
Margin Guard HEALTHY/ordersAllowed=true; shared daily risk 7.5%,
sourceComplete=true; shared Kill Switch inactive.
Trading state files observed deploy UID/GID 1000, 0600, not symlinks.
Legacy PENGU/V52 state lacks runtimeCommitSha; the prepared new serializers
must emit their actual new SHA during a subsequently certified rollout.

The TIME37 approval and production certificate files under /etc/disdex
are absent. Existing root-owned regular 0600 operator artifact approves the
current legacy SHA and seven legacy scopes, not V12_V4.
No files were created to fabricate those approvals.

HP service active/running, PID3102062, at
ui-releases/ui-studio-15-b297c883dfda; public homepage HTTP200.
No V4 HP deployment performed. Root filesystem 83%, approximately 8.4GB free.
There are eight unrelated/legacy failed units: seven UI preflight services
and logrotate.service. They were not deleted or cleared to conceal failures.

## Remaining gates

- TIME37 fixed8 emergency STOP requires separate explicit operator adoption;
  implementation computes LONG average signed fill*0.92 / SHORT*1.08.
  H1 model sensitivity is not signed stop execution proof.
- Independent Aster proof of same-symbol partial STOP/EXIT race, cancel/rearm
  and crash recovery has not been established by a flat signed GET or mocks.
  Official API documentation establishes supported fields, not this runner's
  atomic handling of the race.
- Root-managed current-SHA source/execution/portfolio/protected-same-symbol
  certification and separate V12_V4 operator scope remain required.
- All-peer final-SHA runtime/state, risk and actual-margin rollout proof
  remains pending. Do not stop the old V12 merely to make peer checks pass.

No Production switch, restart, artifact write, order, cancel, position mutation
or HP deployment was executed. Existing release and positions are preserved.
Final review: self-review (no subagent review tool available); change limited
to canonical evidence byte preservation and this audit, no strategy change.
