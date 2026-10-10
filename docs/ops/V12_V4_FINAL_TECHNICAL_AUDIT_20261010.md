# V12 V4 final technical audit — 2026-10-10

Source branch: codex/v12-v4-production-cert-20261009
Source SHA: 6cf40779cad57addc968af10ecd5ae44dc30a33e
Existing production: ce1edeead8d0f9e5d88e829d415057117502a335

STATUS: BLOCKED_V4_TIME_ROUTE_STOP_CONTRACT_AND_EXECUTION_CERTIFICATION

## Operator scope preserved

V2_M150_D05_CORE_NATIVE, all 41 routes, frozen ranking/entry/exit/sizing,
Recovery/V12/Crypto/Total caps 2.50/3.00/3.50/4.75 and DD limit21% remain unchanged.
Independent-period PF weakness is recorded as research risk, not represented as a
new DD failure or resolved by a code test. Technical authorization still requires
the actual source, execution, safety and release evidence.

## Reproduced and repaired

The real exit feed supplied nextOpen only at the holding deadline. The native
exit evaluator needs the observed next opening price at every completed H2
trailing update. A REC_G3_LATE_BTC_REL case reproduced NATIVE_NEXT_OPEN_REQUIRED
before the deadline although the matching observed opening price was in feed.
The fix supplies only the matching boundary open, without replacing missing data
with a close or accepting a future open. RED:1failed/1passed. GREEN:2/2passed.
Hand-checked case:entry100/ATR10, H1 highs110/111, next open108 => native stop109,
TRAILING_CROSSED_BEFORE_REPLACEMENT at108. Missing/future opens still fail closed.

## Actual remaining certification gaps

- Runtime exit catalog:41 total = 37 TIME, 3 ATR, 1 NATIVE.
- The actual requiredResidentStop callback throws
  V4_TIME_ROUTE_RESIDENT_PROTECTION_NOT_DEFINED for every TIME route. No approved
  stop-price blueprint exists in the handoff for these37 routes. Inventing a
  fixed-price stop would change the approved TIME-only exit behavior. A contract
  decision and evidence are required; silently enabling unprotected entries is
  not acceptable.
- assertSourceParity and assertAuthority still explicitly reject in the production
  entrypoint. They cannot become success callbacks without independent source
  evidence and exact-release operator/safety wiring.
- Multi-leg same-symbol exit/STOP resizing is explicitly uncertified in the
  runner (V4_SHARED_SYMBOL_STOP_RESIZE_NOT_CERTIFIED). Partial STOP completion
  and native resident trailing amendments require more implementation evidence.
- reconcileFunding exists but the permanent runner does not invoke it. A helper
  unit test does not certify the running account funding journal.
- Shared Risk/Margin Guard/Kill Switch/available-margin/5xCross checks must be
  concretely supplied by authority wiring before any entry. Missing authority
  callbacks are not evidence that those integrations are implemented.
- No V4-specific systemd unit appears in the candidate ops/systemd tree.
  Existing watchdog/recovery readiness is not V4 activation attestation.
- Existing source/exit parity proves a subset and H1 modeled fills, not a fresh
  complete41-route/Aster execution certificate.

## Fresh validation and live readback

- Baseline candidate V4 tests:98/98 PASS; baseline root TypeScript exit0.
- Exact baseline SHA CI:37989464018 SUCCESS (checks-only).
- After native-feed fix:root and research TypeScript both exit0.
- Whole Windows root Node discovery:679 tests,665passed,11failed,3skipped.
  Failures are POSIX monitor/deploy/rollback cases (bash ENOENT, POSIX paths,
  Windows backslash interpolation). Full local suite is NOT green. Preserve
  .v4-final-root-tests.log local evidence; exact-commit Linux CI is required.
- Signed Aster GET observedAt1791582132880:wallet72.47855158USDT,
  available72.46602777, positions[],openOrders[],diagnostic mutations0.
- Existing V12 active/running,PID2919664,NRestarts0,current remains ce1edeea.

No production code/config/current/artifact/restart or trading mutation was made.
This audit and native-feed regression fix are not a LIVE certificate.


## 2026-10-10 addendum: independent execution work after ec7fcee

**Still BLOCKED. This is not a LIVE certificate and requires no current
Production artifact, VPS release, order, position or STOP mutation.**

- Investigated candidate approved STOP sources:
  `docs/implementation/DD1296_RESIDENT_STOP_IMPLEMENTATION_20261005.md`,
  `docs/implementation/V12_V4_EXECUTION_BUILD_PLAN_20261009.md`,
  `docs/implementation/V12_V4_V2_M150_PRODUCTION_GATE_20261009.md`,
  and `lib/v12-resident-stop-lifecycle.ts`.
  The 2026-10-05 resident implementation is for *existing PENGU and Q102*
  using each strategy's actual existing stop fractions; **none of these
  grants a formula/threshold for the V4 TIME 37 route family**.
  Do not misapply PENGU/Q102 stops to V4 TIME or invent an ATR multiplier.
- Connected `V4OrderCycle.reconcileFundingUpTo()` into the live daemon
  before any restored STOP/EXIT reconciliation. Each bounded 24h segment
  is persisted as `FUNDING_SCAN` in the replay-validated event journal.
  Signed income trade IDs remain idempotent across process restarts. Missing
  >1,000-row pagination and multi-leg allocation remain FAIL CLOSED.
- Separated V4 from the legacy seven-runner `--all` operator validation.
  A proposed separate runner scope `V12_V4` now requires the exact active
  SHA and an explicit approvedRunners entry. It **cannot be approved by a
  legacy `V12_X1_ALL` artifact**.
- Added a *candidate* V4 systemd unit at
  `deploy/systemd/disdex-v12-v4@.service`; requires an independent env
  file, release marker, mutual exclusion, root-signed operator gate and
  coherent release. Unit is **not installed, enabled or started**.
- Missing V4 TIME resident STOP blueprint, actual 41/41 parity,
  same-symbol virtual-leg STOP replacement, signed Aster execution and
  any independent forward-period policy gate remain blockers.


## Research-only TIME family STOP sensitivity, 2026-10-10

The unchanged formal integrated 41-route 10bps baseline was reproduced to
JPY291,326,102.6203428, maximum DD -20.420013795%, 1,222 trades. Historical
Aster normalized H1 includes the full 2025-08-10..2026-08-10 sample. All
37 TIME routes have 746 accepted V12 trades, with **0 mismatches** between
their selected planned exit timestamp and entry + route-specific TIME hours.

Full multi-strategy Gross, compounded equity and DD recomputation with an
additional emergency STOP shows:
- fixed 8% 10bps: JPY282,646,704, PF4.1126, DD -19.5264%, 1,228 trades;
- fixed 8% 20bps: JPY228,069,633, PF3.783, DD -19.974%, 1,228 trades;
- fixed 8% 30bps: JPY162,548,087, PF3.342, DD -18.189%, 1,223 trades.
- Unchanged 20bps: JPY231,193,740, DD -20.9659%.
- Unchanged 30bps: JPY174,749,524, DD -18.3888%.

The 8% emergency limit is a candidate, NOT an approved V4 TIME Exit contract,
and is strictly research-only in lib/v12-v4-time-emergency-stop-research.ts.
No changes to existing TIME route Exit policy or live authority have occurred.
Historical STOPs use H1 high/low with adverse-open gap convention; intrabar
sequencing, actual Aster resident STOP fills, exchange filters and Aug-Oct
out-of-sample performance are NOT certified.

Formal outputs: docs/research/results/v4-time-stop-integrated-20261010/
Runner TIME protection remains Fail Closed until explicit STOP approval,
exact real-fill stop normalization, shared-symbol ownership and source/venue
execution certification.


### Runner entry-fill STOP reconciliation hardening

Prior runner calculated the resident STOP once using a pre-trade quote.
The revised runner still verifies that a valid protection blueprint exists
before admission, then **recomputes the actual resident STOP from the
independently reconciled average signed ENTRY fill** before submitting
STOP_MARKET. The mock Aster regression uses a price-100 reservation
and price-99 fill; STOP matches price-99, not the stale price-100 quote.
No live order authority is granted by this change.


### TIME37 candidate STOP implementation after research

A deterministic fixed 8%-of-actual-signed-fill STOP formula is now wired to
the production runner **only through a separate non-symlink, root-owned,
root-owned non-writable (root:deploy 0640 or root:root 0644), exact-release SHA operator approval artifact**:

/etc/disdex/v12-v4-time-stop-approval.json

The exact schema/policy/37-route acknowledgement is validated by
lib/v12-v4-time-stop-approval.ts. No such approval artifact was created;
therefore TIME routes continue to FAIL CLOSED. The normal TIME Exit remains
unchanged when no STOP fires. Neither assertSourceParity nor assertAuthority
has been bypassed; both continue refusing production mutations pending
independent venue/route certification. No VPS service changes were made.


### 2026-10-10 additional code closure and remaining execution blockers

- The frozen accepted original 10bps V12 ledger contains exactly 828 V12
  trades spanning **all 41 routes**: TIME 746, ATR 44, Native 38.
  All 746 planned TIME deadlines match the frozen route durations.
  Historical coverage is NOT signed live route Entry/Exit parity.
- Historical ledger exposes **261 overlapping same-symbol V12 leg pairs**.
  Grouping by symbol and asserting a single STOP is unsafe.
  New independent `v12-v4-resident-stop-owners.ts` proves exactly one
  exchange reduce-only STOP with correct remaining quantity for EACH leg.
  Same-symbol manual EXIT/STOP cancellation race is still blocked.
- Corrected Native Exit evidence to follow the catalog NATIVE route
  `REC_G3_LATE_BTC_REL` rather than incorrectly attaching it to the
  TIME `FAILED_BREAK_REV_SHORT_6H` candidate.
- Corrected post-fill protective STOP to obey actual signed average fill,
  exchange tick normalization and signed STOP readback price/quantity.
- Removed production-entry boolean hard denial, replacing it with an
  explicit independent 41-route/root-managed exact-SHA production
  certification at `/etc/disdex/v12-v4-production-certification.json`.
  No such certification was manufactured or installed.
  Existing signed V4 EXIT/protection can be reduce-only even after
  the time-limited new-entry certificate expires, but cannot open a
  position absent the certification.
- TIME emergency policy artifact was relocated out of deploy-writable
  `/var/lib/disdex/shared` into root-owned `/etc/disdex`.
  No operator approval has been given or installed.
- Source parity, H2 Native forward evidence, same-symbol partial exit
  interlock, venue-verified STOP/funding/fill behavior, shared-risk
  multi-runner readback, and independently reviewed forward-period
  certificate remain mandatory before LIVE.
