# PR #34 Research Verdict

See this document as the authoritative research status for PR #34.

```text
WIN80_ULTRA90_TOP1_V1 = FROZEN / LIVE_BLOCKED
REGIME_NATIVE_ENTRY_V1 = REJECTED
STABILITY_CONSENSUS_ROTATION_V2 = REJECTED
MULTI_HORIZON_REGIME_ROTATION_V3 = HOLDOUT_REJECTED
PARAMETER_BAGGED_ROTATION_V4 = TEMPORAL_STRESS_REJECTED
PRECOMPUTED_MULTI_REGIME_ROTATION_V6 = FROZEN FORWARD WATCH ONLY
FIXED_V6_ROBUSTNESS_AUDIT_V7 = REJECTED
HYSTERESIS_EXECUTION_STABILIZED_V8 = REJECTED
FROZEN_V6_FRESH_FORWARD_V9 = NO_FORWARD_SIGNAL / SAMPLE_BUILDING
realTradingEnabled = false
```

## Frozen watch candidate

```text
BAG_V50_S0_TV45_G1.1_CNONE
+ H_BTC_S60_M30_G0.4
+ Bear confirmation 4 x 12h bars
```

- 2023-2025: 586 cycles, CAGR 59.89%, PF 1.42, Stress PF 1.37, DD -25.62%
- 2026H1 temporal stress: 66 cycles, +9.42%, PF 1.28, Stress PF 1.21, DD -12.53%
- Component dropout: 10/10 pass
- Neighbor parameters: 38/39 pass
- Execution stress: 7/9 pass
- Severe combined stress: -5.67%, PF 0.98; V7 rejected

The candidate is stronger than WIN80 but is not Paper-approved. It remains frozen for future-only observation.

## Fresh Forward

- Starts: 2026-07-01
- Through 2026-07-18: 0 signal bars / 0 cycles
- Status: `NO_FORWARD_SIGNAL`
- Meaning: cash waiting; neither pass nor loss
- Conditions remain unchanged

## Promotion gates

- 30 Forward cycles: Paper review eligibility
- 100 Forward cycles: minimum Live review sample
- PF >= 1.20
- Stress PF >= 1.00
- Positive net expectancy with actual costs
- Aster Spread/Slippage verified
- CIO and safety approval

## Safety

PR remains Draft. Do not merge. Production strategy, VPS, `.env`, existing live positions, and real-trading flags are unchanged.
