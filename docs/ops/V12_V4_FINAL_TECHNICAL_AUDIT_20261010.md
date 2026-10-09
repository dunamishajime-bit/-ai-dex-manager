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
