# PR #34 Research Verdict

## Final state

```text
WIN80_ULTRA90_TOP1_V1 = FROZEN / LIVE_BLOCKED
REGIME_NATIVE_ENTRY_V1 = REJECTED
STABILITY_CONSENSUS_ROTATION_V2 = REJECTED
MULTI_HORIZON_REGIME_ROTATION_V3 = HOLDOUT_REJECTED
PARAMETER_BAGGED_ROTATION_V4 = TEMPORAL_STRESS_REJECTED
PRECOMPUTED_MULTI_REGIME_ROTATION_V6 = ADAPTIVE PAPER CANDIDATE ONLY
FIXED_V6_ROBUSTNESS_AUDIT_V7 = REJECTED
HYSTERESIS_EXECUTION_STABILIZED_V8 = REJECTED
FROZEN_V6_FRESH_FORWARD_V9 = NO_FORWARD_SIGNAL / SAMPLE_BUILDING
realTradingEnabled = false
```

## Best research candidate

Frozen variant:

```text
BAG_V50_S0_TV45_G1.1_CNONE
+ H_BTC_S60_M30_G0.4
+ Bear confirmation 4 x 12h bars
```

V6 historical/adaptive result:

- 2023-2025: 586 cycles, CAGR 59.89%, PF 1.42, Stress PF 1.37, DD -25.62%
- 2026H1 temporal stress: 66 cycles, +9.42%, PF 1.28, Stress PF 1.21, DD -12.53%
- Component dropout: 10/10 pass
- Neighbor parameters: 38/39 pass
- Execution stress: 7/9 pass
- Severe combined stress: -5.67%, PF 0.98; therefore V7 rejected

The candidate is structurally stronger than the previous WIN80 family, but it is not certified as robust enough for Paper promotion yet.

## Fresh Forward

The V6 conditions were frozen before the new period.

- Forward period starts 2026-07-01
- Current result through 2026-07-18: 0 signal bars / 0 cycles
- Status: `NO_FORWARD_SIGNAL`
- Interpretation: cash waiting, not a loss and not a pass
- Continue without changing conditions

## Promotion gates

- 30 Forward cycles: Paper review eligibility
- 100 Forward cycles: minimum Live review sample
- PF >= 1.20
- Stress PF >= 1.00
- Positive expectancy after actual costs
- Aster execution Spread/Slippage verified
- CIO and safety approval

## Safety

- PR remains Draft and must not be merged into production.
- Production strategy, VPS, `.env`, existing live positions, and real-trading flags were not changed.
