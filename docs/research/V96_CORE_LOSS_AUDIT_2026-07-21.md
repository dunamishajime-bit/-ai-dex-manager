# V96 Non-PENGU Core Loss Audit — 2026-07-21

## Scope and policy

- Frozen historical period: 2023-01-01 through 2026-06-30 UTC
- Completed 12-hour buckets: 2,554
- Core symbols: BTC, ETH, BNB and SOL
- Fixed algorithm: V90 Weight Band plus V86 Strong Boost as used by historical V95/V96 research
- Normal assumptions: 10 bps turnover cost
- Severe assumptions: 50 bps turnover cost, one-bar delay and 3 bps adverse execution
- Parameter search performed: **NO**
- Production code changed: **NO**
- Structural-loss rule declared before review: at least 5 episodes, at least 2 entry years, negative total contribution and win rate below 45%

## Portfolio result

| Scenario | Compounded return | Max drawdown | Profit factor |
| --- | ---: | ---: | ---: |
| Normal | +343.7621% | -30.7176% | 1.2722 |
| Severe | +41.0068% | -46.2852% | 1.0913 |

Severe annual results were negative in 2024 (-11.8646%), 2025 (-11.4665%) and 2026H1 (-5.3217%). Normal 2025H1 was also negative (-4.8578%). This is a cost and execution-fragility warning, not a justification for selecting new thresholds from known losses.

## Symbol attribution

| Symbol | Total contribution | Episodes | Winning episodes | Worst episode |
| --- | ---: | ---: | ---: | ---: |
| BTC | +8.6093% | 28 | 46.4286% | -3.8732% |
| ETH | +29.6782% | 38 | 44.7368% | -3.9695% |
| BNB | +26.2872% | 34 | 50.0000% | -4.0919% |
| SOL | +113.7225% | 39 | 35.8974% | -18.4955% |

All symbols contributed positively over the full period. SOL has the lowest episode win rate and the largest single loss, but also supplies most of the Core return.

## Strong Boost result

Strong Boost was active in 56 of 2,554 normal buckets, or 2.1926%.

| Group | Episodes | Winning episodes | Total contribution |
| --- | ---: | ---: | ---: |
| SOL episodes that experienced Boost | 9 | 77.7778% | +156.7958% |
| SOL episodes without Boost | 30 | 23.3333% | -41.9745% |
| ETH episodes that experienced Boost | 9 | 88.8889% | +43.7944% |
| ETH episodes without Boost | 29 | 31.0345% | -13.1613% |
| BNB episodes that experienced Boost | 6 | 50.0000% | +9.2589% |
| BNB episodes without Boost | 28 | 50.0000% | +18.0264% |

The evidence does not support reducing or removing Strong Boost. The repeated losses are concentrated in non-Boost short and medium-duration exposures.

## Repeated multi-year loss clusters

| Cluster | Episodes | Years | Win rate | Total contribution |
| --- | ---: | --- | ---: | ---: |
| SOL 1–2 bars | 9 | 2023, 2024, 2025 | 22.2222% | -10.9225% |
| SOL 3–6 bars | 6 | 2023–2026 | 16.6667% | -2.3977% |
| SOL 7–14 bars | 6 | 2024–2026 | 0.0000% | -11.9973% |
| BNB 3–6 bars | 8 | 2023–2026 | 25.0000% | -6.1998% |
| BTC 3–6 bars | 7 | 2023–2026 | 28.5714% | -5.4120% |
| BTC 7–14 bars | 9 | 2023–2026 | 33.3333% | -5.4936% |
| ETH 1–2 bars | 5 | 2023–2025 | 20.0000% | -1.3449% |
| ETH 3–6 bars | 7 | 2023–2026 | 14.2857% | -4.1013% |
| ETH 7–14 bars | 12 | 2023–2026 | 41.6667% | -3.7300% |

By contrast, 15+ bar episodes were positive for every symbol. SOL 15+ bar episodes contributed +140.1388%, ETH +39.8092%, BNB +25.8672% and BTC +22.1626%.

## Worst historical episodes

1. SOL long, 2025-01-19 to 2025-01-27, 16 bars: -18.4955%
2. SOL long, 2023-04-13 to 2023-04-20, 15 bars: -6.8813%
3. SOL long, 2023-04-30 to 2023-05-01, 2 bars: -5.3720%
4. SOL long, 2024-10-27 to 2024-11-02, 11 bars: -4.4451%
5. BNB long, 2024-06-06 to 2024-06-11, 10 bars: -4.0919%

The largest SOL loss occurred while the episode later experienced drawdown stage 2. That is evidence that the current drawdown brake limits exposure but does not guarantee a quick exit from a selected trend.

## Concentration check

| Test | Compounded return | Max drawdown | Profit factor |
| --- | ---: | ---: | ---: |
| Remove best 1 episode | +148.3152% | -30.7176% | 1.1794 |
| Remove best 3 episodes | +35.4195% | -30.7176% | 1.0792 |
| Remove best 5 episodes | +0.5240% | -38.2767% | 1.0253 |

The historical Core result is materially concentrated in a small number of large trend episodes, mainly SOL. This is the strongest overfitting and robustness warning found by the audit.

## 400-bar state reconstruction

At the latest frozen checkpoint, the full-history and 400-bar reconstructions agreed:

- target difference: 0.0
- full and window target: BTC short 0.4
- scale: 1.0 / 1.0
- Strong Boost: off / off
- drawdown stage: 0 / 0
- Whipsaw: off / off

This single checkpoint does not prove parity at every historical transition. Production should log and compare the persisted controller state over forward checkpoints before Core size is increased.

## Review decision

Do not remove SOL, reduce Strong Boost or introduce symbol-specific thresholds from this reused dataset. Those changes would target known history and are likely to overfit.

The next research candidate should address entry and retention quality for short and medium-duration exposures using a small, predeclared family of generic rules. Any candidate must pass:

1. development/holdout separation by time;
2. all-symbol or leave-one-symbol-out stability;
3. neighboring-parameter stability;
4. Normal and Severe cost assumptions;
5. best 1/3/5 episode removal;
6. no degradation of 15+ bar trend capture;
7. forward shadow evidence before Production promotion.

## Limitation

This audit does not contain the VPS fills produced after V96 deployment. Actual live review requires the V96 runner state and Aster fill history, with credentials and private keys removed.