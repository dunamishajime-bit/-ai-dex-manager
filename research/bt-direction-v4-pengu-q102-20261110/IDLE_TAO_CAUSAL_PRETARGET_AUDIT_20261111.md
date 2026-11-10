# IDLE TAO causal pre-target audit — 2026-11-11

## Conclusion

Do not add a new TAO gate to CAUSAL_THREE.

The previous TAO rule using ret24 and rel24 was selected from the target evaluation year itself (29 target-year trades split 14 train / 15 validation). It is retained as historical research only and is rejected as causal evidence for this target-year BT.

## New target-independent research

- Pre-target period: 2025-03-22 through 2025-09-30.
- Data: Binance UM public candles as a pre-target proxy because historical Aster TAO candles are unavailable there.
- Exact current pinned IDLE signal functions were imported.
- Current TAO exit semantics: 12h max hold, -10% hard stop, +25% take profit.
- Pure route candidates: 116.
- Train: 70.
- Validation: 31.
- September pre-holdout: 15.
- True Aster forward holdout 2026-10-01 through 2026-11-08: 8.

## Frozen simple candidate before target-year evaluation

TAO atrRatio <= 0.017

30bps candidate-level evidence:

| Split | n | Win | Mean/trade | PF |
|---|---:|---:|---:|---:|
| Train | 33 | 45.5% | +0.782% | 1.790 |
| Validation | 21 | 76.2% | +0.854% | 3.598 |
| September pre-holdout | 13 | 53.8% | +0.956% | 2.130 |
| 2026 forward Aster | 5 | 60.0% | +0.346% | 1.609 |

Threshold sensitivity was broadly stable from about 0.015 to 0.018. At 0.019 and above, training degraded below PF 1.

## Binance proxy vs Aster on true forward holdout

569 overlapping October-2026 H1 decisions:

- atrRatio correlation: 0.9941.
- atrRatio mean absolute difference: 0.000933.
- atrRatio <= 0.017 classification agreement: 96.5%.
- Complete TAO route-decision agreement: 99.1%.
- ret12 / ret24 / rel24 correlations: above 0.998.
- volumeRatio correlation: only 0.372, therefore no volume-based proxy gate is trusted.

## Target-year evaluation after freeze

Canonical baseline:
- 10bps: JPY 887,336; DD -56.31%; 537 fills; Win 57.36%; PF 1.222.
- 30bps: JPY 321,162; DD -63.20%; 537 fills; Win 56.24%; PF 1.168.

TAO ATR17 alone:
- 10bps: JPY 892,595; DD -55.95%; 536 fills; Win 57.28%; PF 1.224.
- 30bps: JPY 323,738; DD -62.89%; 536 fills; Win 56.16%; PF 1.169.

Existing CAUSAL_THREE:
- 10bps: JPY 1,585,700; DD -41.35%; 540 fills; Win 59.63%; PF 1.431.
- 30bps: JPY 579,086; DD -50.60%; 539 fills; Win 58.26%; PF 1.322.

CAUSAL_FOUR = CAUSAL_THREE + TAO ATR17:
- 10bps: JPY 1,571,335; DD -41.35%; 538 fills; Win 59.48%; PF 1.429.
- 30bps: JPY 576,122; DD -50.60%; 537 fills; Win 58.10%; PF 1.321.

The extra TAO filter removes 21 raw candidates but only a small number of portfolio fills. It does not reduce integrated maximum DD and slightly lowers final equity, win rate and PF versus CAUSAL_THREE.

## Decision

- Old target-year-derived TAO rule: reject as causal evidence.
- New pre-target ATR17 rule: causal research support exists, but integrated value is neutral/negative.
- No TAO gate is added.
- Keep CAUSAL_THREE as the current causal reference and investigate PENGU SHORT_V20 next.

## Evidence SHA256

- preperiod proxy candidates: 44354693f7f5851c1993341be8ebbc51962b8637b6549f678243f1af73993fb7
- preperiod causal gate search: f9a527d931ebcfd9e06d188da4b5868d03a489a895ce7b70dbb409e46d9248df
- old target-year-derived TAO search: 80b038b3d89e05f03e6a7cef7de911ad3c0dd11aec9d65c90fc1ef839b8050e1
- normalized preperiod manifest: 2289f7ee90626290ccdf09c8dd6935e6efc472da1667fdd6aa395657cde33d26
- forward Binance/Aster feature comparison: 78c6ba3be3e3c3f4b2e924a129f8246adc29734cae7cd6eec266c6bea1b3ca64
