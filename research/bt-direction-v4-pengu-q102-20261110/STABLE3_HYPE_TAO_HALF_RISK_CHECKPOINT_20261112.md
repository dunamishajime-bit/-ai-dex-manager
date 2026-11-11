# STABLE3 + HYPE half + TAO half-risk checkpoint — 2026-11-12

Status: RESEARCH CANDIDATE / NO PRODUCTION CHANGE

## Construction

This candidate starts from STABLE3. It keeps all previously frozen CAUSAL_THREE and STABLE3 gates/quarantines, then applies two conservative non-predictive risk reductions:
- HYPE requested gross x0.50
- IDLE TAO route `IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2` requested gross x0.50

Neither scale was grid-searched on the target period. The single 0.50 scale was frozen before the integrated target A/B.

## Rationale

HYPE: independent pretarget evidence is unstable and no simple entry gate, early adverse exit, or online health policy survived validation. Half-risk reduces damage without pretending a reliable classifier exists.

TAO: pretarget/validation/forward evidence shows genuine instability. A pretarget-frozen ATR gate survives local OOS/forward but had already failed integrated portfolio improvement, so no further target-period static threshold search is allowed. Half-risk is tested as a single conservative alternative to repeated threshold mining.

## Integrated result

| Cost | STABLE3 | HYPE half | HYPE half + TAO half |
|---|---:|---:|---:|
| 10bps final JPY | 4,512,970.17 | 4,380,032.76 | **4,442,161.58** |
| 10bps DD | -26.06% | -23.81% | **-23.81%** |
| 10bps WR | 61.68% | 61.73% | **61.73%** |
| 10bps PF | 1.668 | 1.727 | **1.783** |
| 30bps final JPY | 1,454,529.57 | 1,484,977.13 | **1,536,510.07** |
| 30bps DD | -28.08% | -24.77% | **-24.57%** |
| 30bps WR | 59.53% | 59.60% | **59.60%** |
| 30bps PF | 1.513 | 1.567 | **1.617** |

Relative to HYPE-half, TAO half-risk improves 10bps equity and PF with unchanged DD, and improves 30bps equity, DD and PF. WR is unchanged.

## Determinism

Canonical simulator SHA256: eba62b627ae78929de28a3274e9afadaf5204af05527996c47ce7ef6b14018c6

Generated S3_HH_TH wrapper SHA256 on both full runs: cf024715e3590b15b4c7ad4655213b9f3bbb728c4b30611787ab24b65b308e67

21 output artifacts matched exactly between two complete runs.
Artifact manifest SHA256: 16585c30c9d79438b378ce20c0dd8e356e71ea47792e6eb3095ca151c96a56ba

## Interpretation

This is currently a stronger integrated risk candidate than STABLE3 and HYPE-half, but it is still not a signal-quality solution. It reduces exposure to two independently unstable routes while preserving the rest of the portfolio.

The <=20% DD goal is still not reached. Continue logic+symbol misclassification work rather than tuning these scales further on the target year.

## Next priority

1. IDLE TIA: distinguish true direction error from temporary early adverse movement.
2. Q102 FET: identify causal sub-regime failure without target-derived route blacklisting.
3. PENGU V8 losing subset: preserve already-profitable accepted gate and avoid target-driven tightening.
4. Q102 DOGE and IDLE RENDER: structural regime work only.

## Safety

No LIVE order, cancel, position, STOP, Kill Switch, Production runner or Production configuration changed.
