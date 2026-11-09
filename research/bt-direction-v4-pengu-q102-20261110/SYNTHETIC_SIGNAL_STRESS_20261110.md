# Synthetic signal stress — 2026-11-10

Purpose: verify candidate gate semantics, boundary behavior, AND-condition behavior, and monotonicity using synthetic feature-space scenarios.

**This is not profitability or out-of-sample evidence.** It cannot replace real historical/forward validation; it only verifies that a candidate fires exactly where its mathematical rule says it should.

- Rules tested: 7
- Boundary cases: 39
- Boundary failures: 0
- Metamorphic failures: 0
- Random synthetic cases per rule: 20000
- Logic-shape result: PASS

## Per-rule random activation surface

- V4_REC_X05_TIME_36H [candidate]: 4436/20000 = 22.1800%; boundary failures=0; metamorphic failures=0
- V4_REC_X07_TIME_6H [candidate]: 6500/20000 = 32.5000%; boundary failures=0; metamorphic failures=0
- V4_REC_X11_TIME_48H [candidate]: 9970/20000 = 49.8500%; boundary failures=0; metamorphic failures=0
- PENGU_RECOVERY_V8_2H_RESCUE [research-candidate]: 5299/20000 = 26.4950%; boundary failures=0; metamorphic failures=0
- Q102_FET_PB168 [candidate-small-sample]: 9969/20000 = 49.8450%; boundary failures=0; metamorphic failures=0
- PENGU_SHORT_V20_EXHAUSTION [exploratory]: 4581/20000 = 22.9050%; boundary failures=0; metamorphic failures=0
- PENGU_LONG_V64_OVERHEAT [exploratory]: 9361/20000 = 46.8050%; boundary failures=0; metamorphic failures=0

## Interpretation

- PASS means the coded mathematical gate has no boundary/inclusion or simple monotonicity defect under these synthetic scenarios.
- It does **not** mean the gate predicts the market correctly.
- Candidate promotion still requires historical walk-forward/OOS, threshold-jitter stability, regime splits, false-positive accounting, and integrated 10bps/30bps portfolio BT.
- FET BRK24 is intentionally not included as a candidate gate here because the saved snapshot proves its portfolio importance but does not yet contain a single final causal threshold rule to freeze.
