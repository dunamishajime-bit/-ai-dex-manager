# Canonical research-gate A/B — 2026-11-11

Baseline: locked current-implementation parity simulator. Research only; no Production mutation.

| Case | 10bps Final | 10bps DD | 10bps Win | 10bps PF | 30bps Final | 30bps DD | 30bps Win | 30bps PF |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | ¥235,605.78 | -58.08% | 56.73% | 1.187 | ¥77,865.09 | -65.05% | 54.35% | 1.123 |
| IDLE_JUP | ¥262,375.28 | -59.04% | 57.30% | 1.211 | ¥87,343.98 | -65.42% | 54.72% | 1.140 |
| PENGU_V8 | ¥293,533.55 | -52.52% | 57.43% | 1.221 | ¥142,450.38 | -59.49% | 55.81% | 1.177 |
| Q102_FET | ¥296,278.65 | -56.25% | 57.91% | 1.230 | ¥96,356.63 | -56.51% | 55.42% | 1.169 |
| IDLE_JUP__PENGU_V8 | ¥359,237.00 | -49.01% | 58.01% | 1.272 | ¥175,820.88 | -55.88% | 56.16% | 1.220 |
| IDLE_JUP__Q102_FET | ¥426,811.41 | -46.44% | 58.65% | 1.339 | ¥140,390.88 | -55.86% | 55.95% | 1.258 |
| PENGU_V8__Q102_FET | ¥327,847.38 | -42.42% | 58.33% | 1.281 | ¥155,488.92 | -49.70% | 56.62% | 1.222 |
| THREE | ¥472,102.93 | -42.42% | 59.09% | 1.420 | ¥226,988.18 | -45.46% | 57.14% | 1.338 |

## Delta vs canonical baseline

| Case | 10bps Final Δ | 10bps DD improvement | 30bps Final Δ | 30bps DD improvement |
|---|---:|---:|---:|---:|
| IDLE_JUP | +11.4% | -0.97pp | +12.2% | -0.37pp |
| PENGU_V8 | +24.6% | +5.55pp | +82.9% | +5.56pp |
| Q102_FET | +25.8% | +1.82pp | +23.7% | +8.54pp |
| IDLE_JUP__PENGU_V8 | +52.5% | +9.07pp | +125.8% | +9.17pp |
| IDLE_JUP__Q102_FET | +81.2% | +11.64pp | +80.3% | +9.19pp |
| PENGU_V8__Q102_FET | +39.2% | +15.65pp | +99.7% | +15.35pp |
| THREE | +100.4% | +15.65pp | +191.5% | +19.59pp |

## Current result

THREE is the strongest tested bundle: 10bps ¥472,102.93, DD -42.42%; 30bps ¥226,988.18, DD -45.46%.

PENGU_V8 + Q102_FET gives the lowest 10bps DD among the pairwise tests; THREE ties that 10bps DD while improving profit and gives a lower 30bps DD.

IDLE_JUP alone raises final equity but slightly worsens DD. Its benefit appears interaction-dependent rather than a standalone DD improvement.

These thresholds are research A/B filters on the target period. They are not unbiased OOS certification and must not be treated as Production adoption evidence without causal/pre-period validation.

Evidence: `evidence/CANONICAL_RESEARCH_GATE_AB_COMPARISON_20261111.csv` and `.json`.
