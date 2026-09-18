# Idle Capital DD20 Boundary Research

Method: FULL EVENT REPLAY. Research only; no LIVE/VPS/production/order changes.

Strict gate: both NORMAL and SEVERE drawdown must remain within 20%.

| Target gross | NORMAL asset | NORMAL DD | SEVERE asset | SEVERE DD | Gate |
|---:|---:|---:|---:|---:|---|
| 1.60x | ¥79,935,629.90 | -18.7101% | ¥9,959,012.10 | -19.2447% | PASS |
| 1.62x | ¥82,192,201.32 | -18.9319% | ¥10,220,550.14 | -19.4452% | PASS |
| 1.64x | ¥84,536,084.55 | -19.1229% | ¥10,488,385.42 | -19.6705% | PASS |
| 1.66x | ¥86,943,029.96 | -19.3117% | ¥10,762,652.46 | -19.8957% | PASS |
| 1.67x | ¥88,169,878.54 | -19.4062% | ¥10,902,240.58 | -20.0083% | FAIL |
| 1.68x | ¥89,412,552.14 | -19.5006% | ¥11,043,488.20 | -20.1208% | FAIL |

At 0.01x granularity, 1.66x is the highest passing target; 1.67x first breaches the SEVERE DD 20% gate.
