# DisDex causal gate / concentration research checkpoint — 2026-11-10

## Status

**RESEARCH ONLY — NOT PRODUCTION CERTIFIED. No LIVE order, position, STOP, runner, or Production configuration was changed.**

The objective is unchanged: improve win rate and reduce integrated max DD while keeping the portfolio profitable after fees/funding. No fixed CAGR/final-wealth target is used.

## Common research baseline

- Integrated model source SHA256: `c3b72a5d0ad3ebcbac31f74f4464314d3225820bface8b6225d7eb3ee687caf7`
- Target period: 2025-10-01 through 2026-10-01 exclusive.
- Separate round-trip cost cases: 10bps and 30bps.
- Baseline PINNED portfolio:
  - 10bps: final JPY 2,111,834.84; max DD -50.37%; win rate 60.45%.
  - 30bps: final JPY 667,697.91; max DD -60.67%; win rate 57.39%.

These are research-model results, not signed venue execution results.

## Entry filters that survived split-history + forward falsification

### IDLE JUP SHORT
Train-half rule candidate:
- `rel24 >= -0.04089204262472046`

Historical validation and 2026-10-01 onward forward sample both remained profitable after 30bps in the standalone route audit. Forward sample remains small; this is not sufficient for promotion.

### PENGU Recovery V8
Train-half rule candidate:
- `btc24h <= 0.011611625094354983`

Historical validation remained profitable after 30bps. Forward V8 sample was only four trades, so this remains research-only.

### Q102 FET family
Coarse train-half rule:
- `ret14 <= 0.048722800378429465`

This was the only coarse FET-family screen among ret14/strength/margin that remained positive in historical validation and the small forward sample.

## Integrated 3-gate result

Applying the three filters above:

| Cost | Final JPY | Max DD | Win rate | PF |
|---|---:|---:|---:|---:|
| 10bps | 3,561,043.86 | -28.97% | 61.24% | 1.511 |
| 30bps | 1,202,219.01 | -30.92% | 58.20% | 1.387 |

Both profit and DD improve versus the PINNED baseline, but DD <=20% and win rate >=70% are not reached.

## Concentration-risk work

The remaining drawdown was caused more by clustered exposure than by universally bad routes. Several major DD contributors are profitable over the full period:
- V4 REC_Y03 30bps PF ~1.62.
- V4 REC_Y06 30bps PF ~1.75.
- V4 REC_Y07 30bps PF ~1.62.
- Q102 FET PB168 30bps PF ~1.47.

Therefore wholesale route deletion is not justified.

### Best balanced hard-cap research case

On top of the 3 gates:
- V4 `REC_Y*` concurrent MTM gross cap: 0.6x.
- When portfolio current DD <= -12%, shared PENGU + Q102 + IDLE MTM gross cap: 2.0x.
- Candidate exceeding a cap is blocked; no partial fill in this case.

Result:

| Cost | Final JPY | Max DD | Win rate | PF |
|---|---:|---:|---:|---:|
| 10bps | 2,710,806.74 | -25.19% | 60.32% | 1.664 |
| 30bps | 689,399.89 | -28.90% | 57.48% | 1.427 |

This remains above the original baseline final equity in both cost cases, while materially reducing DD. It is **not accepted** because DD remains >20%, win rate remains <70%, and the integrated engine is not full Production parity.

### DD12 dynamic-only concentration case

Keeping the 3 gates but applying the concentration reduction only after a 12% portfolio DD:

| Cost | Final JPY | Max DD | Win rate | PF |
|---|---:|---:|---:|---:|
| 10bps | 3,211,438.25 | -28.61% | 61.05% | 1.561 |
| 30bps | 904,972.25 | -28.90% | 58.06% | 1.435 |

This retains more profit but has worse 10bps DD than the hard-cap balanced case.

### Lower-DD but profit-destructive case

A static fragile-runner shared cap of 2.0x reduced max DD to about -24.17% / -25.70%, but final equity fell below the PINNED baseline in both costs. Per the owner criteria, this is not an acceptable success.

## Rejected / not useful

- IDLE TAO fourth entry gate: improved profit/win rate but slightly worsened DD.
- PENGU V20 entry gate: worsened integrated DD/profit.
- PENGU V20 8h -4%, 3h/8h, and 12h -4% exit overlays: candidate-level changes existed, but affected trades were not admitted in the best integrated book; portfolio result was unchanged.
- IDLE TAO 3/6/9h adverse-exit grid: no rule survived train + validation + forward winner-preservation.
- V4 Recovery-Y uniform gross scaling: less efficient than concurrent family-cap logic.
- Cap clipping to remaining capacity: preserved more profit but worsened DD versus hard blocking.
- Fragile shared cap <2.0x: nonlinear admission reordering caused worse DD despite a stricter nominal cap.

## Current frontier conclusion

- **DD <=20% in both 10bps and 30bps: not achieved.**
- **Win rate >=70% in both: not achieved.**
- **Profit preserved above baseline while DD materially improved: achieved.**
- Best observed worst-cost DD while still keeping final equity above baseline in both cost cases: approximately **28.90%**.

No further parameter should be promoted from this same period merely to force DD below 20%. The next meaningful evidence must come from:
1. independent future/untouched validation,
2. removal of remaining V4 retrospective-candidate contamination,
3. closer Production-parity integration including missing executable-book evidence / model gaps.

## Reproducibility

Machine-readable frontier:
`results/LATEST_RESEARCH_FRONTIER_20261110.json`

Key scripts in this research branch include:
- `portfolio_combined_3gate_integrated_20261110.py`
- `portfolio_3gate_static_v4y_dynamic_fragile12_20261110.py`
- `portfolio_3gate_dynamic_concentration_cap_20261110.py`
- `portfolio_peak_trough_exact_route_attribution_20261110.py`
- `idle_jup_train_validation_forward_gate_search_20261110.py`
- `pengu_v8_train_validation_forward_gate_search_20261110.py`
- `q102_fet_coarse_train_valid_forward_screen_20261110.py`

