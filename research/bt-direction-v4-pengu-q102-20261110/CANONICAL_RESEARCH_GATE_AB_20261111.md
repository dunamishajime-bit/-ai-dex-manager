# Canonical research-gate A/B — 2026-11-11 post V52 strategy-capital fix

Research only. Baseline is the deterministic current-implementation canonical replay.
Canonical script SHA256: eba62b627ae78929de28a3274e9afadaf5204af05527996c47ce7ef6b14018c6

## Canonical baseline

- 10bps: Final JPY 887,336.06; DD -56.31%; fills 537; Win 57.36%; PF 1.222
- 30bps: Final JPY 321,161.96; DD -63.20%; fills 537; Win 56.24%; PF 1.168
- Determinism: 8/8 primary artifacts exact SHA256 match across consecutive runs.

## A/B results

| Case | 10bps Final | 10bps DD | 10bps fills | 10bps Win | 10bps PF | 30bps Final | 30bps DD | 30bps fills | 30bps Win | 30bps PF |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| IDLE_JUP | 854,737.33 | -57.32% | 533 | 57.79% | 1.240 | 313,185.50 | -63.59% | 533 | 56.47% | 1.177 |
| PENGU_V8 | 981,179.95 | -59.43% | 558 | 57.53% | 1.221 | 343,026.50 | -66.70% | 557 | 56.37% | 1.164 |
| Q102_FET | 1,272,282.28 | -46.62% | 535 | 58.88% | 1.308 | 465,527.59 | -54.20% | 535 | 57.76% | 1.236 |
| IDLE_JUP+PENGU_V8 | 1,053,733.80 | -56.42% | 550 | 58.00% | 1.264 | 375,867.44 | -63.74% | 549 | 56.65% | 1.195 |
| IDLE_JUP+Q102_FET | 1,585,355.65 | -40.68% | 528 | 59.47% | 1.438 | 589,644.28 | -43.71% | 528 | 58.14% | 1.331 |
| PENGU_V8+Q102_FET | 1,405,260.81 | -50.43% | 556 | 58.99% | 1.306 | 495,509.49 | -58.66% | 555 | 57.84% | 1.230 |
| THREE | 1,775,745.94 | -39.30% | 545 | 59.63% | 1.446 | 642,178.79 | -49.08% | 544 | 58.27% | 1.333 |

## Interpretation

- Rel24-only IDLE_JUP is research comparison only; it failed the saved causal robustness screen.
- Q102_FET is the strongest single gate on the corrected canonical replay.
- THREE gives the largest final equity among the seven original target-period A/B cases.
- Causal decisions must use the separate causal-supported harness, not target-period A/B alone.

