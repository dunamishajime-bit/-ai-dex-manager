V12 V4 STOP owner integration for production shared-risk code.
Baseline common SHA 7688ed7c93a1918d8b44837339b7da5584a868f5. V4 runs 53a0be396719f0284af4e11b35c66a4ac7d58f79.
Existing primary shared-stop observer misses V4 ledger and reports DOGE SHORT 226 UNKNOWN/UNVERIFIED despite confirmed resident reduce-only STOP.
The new V4 proof function checks exact immutable release marker, journal, heartbeat, one STOP, client ID, qty, side, reduceOnly, live STOP status and a bounded hard stop. Missing evidence leaves position UNVERIFIED.
Tests: old 13 and 16 V4 regression/negative cases = 29 PASS in VPS isolated shadow. No new trade paths, risk-limit changes or orders.
Deployment boundary: source and regression suite are NOT LIVE. Current shared-risk writer must be cut over as a distinct immutable approved release only after proof of all old API and state compatibility; never mutate current release files or bypass risk gates. Existing V4 companion read-only STOP audit remains LIVE and HEALTHY.
Annual BT: exact target Q102 SHA cannot receive a full-year Aster-native economic certificate while Aster native candles are absent for symbols before the requested 181-day warmup start. Review machine-readable source evidence in docs/research/Q102_EXACT_SHA_FULL_YEAR_NATIVE_COVERAGE_BLOCKER_20261028.json.
