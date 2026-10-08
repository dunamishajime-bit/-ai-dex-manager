# V12 1,000+ Trade Multi-Logic Research Status — 2026-10-09

## Status
**RESEARCH ONLY. NO LIVE / PRODUCTION CHANGE.**

The research objective was corrected from "filter V12 down to a tiny high-precision set" to:

> Recover roughly the original 1,000+ V12 opportunities through multiple independent causal logic sleeves, while keeping V12 profitable and preserving portfolio risk controls.

## Original reference
Development period: 2025-08-10 through 2026-08-10.

Original V12 baseline:
- V12 accepted: 1,123
- 10bps V12 WR: 40.25%
- 10bps V12 PF: 0.7197
- 10bps V12 net: -4,717.11
- portfolio final: JPY 4,319,497.91

High-precision failed-break core:
- 55 V12 trades
- WR 60.0%
- PF 2.4356
- V12 net +4,090.68
- portfolio final about JPY 18.38m

The 55-trade result proved a strong entry family but was intentionally rejected as the final architecture because it discarded too many valid opportunities.

## Architecture developed
The final research architecture is not one relaxed V12 gate. It is a family of independent logic sleeves.

### Core / complement
- FAILED_BREAK_REV_SHORT_6H high-confidence core
- robust SHORT_MID 24–48h complement

### Multi-logic recovery
Missed baseline opportunities were decomposed using causal entry-time H1 features:
- symbol 3/6/12/24/48h returns
- BTC returns
- BTC-relative returns
- ATR
- EMA distance
- efficiency ratio
- volume ratio
- breakout / 24h range location
- pullback depth
- compression / expansion
- candle body / close location
- momentum-condition age

Additional routes were admitted only from their incremental uncovered subset.

### Dedicated exits
Routes use different exit structures rather than one legacy V12 exit:
- 3/6/9/12/18/24/36/48/72h time exits
- ATR TP/SL exits where appropriate
- failed original-direction entries can become opposite-direction recovery signals when the causal evidence supports it

### Multi-trade execution model
To avoid forcing unrelated strategies through one V12 slot/cooldown pool:
- route-local recovery sleeves
- same-side V12 virtual lots may coexist and would be aggregated into one venue-side position while being tracked internally by route
- a new opposite recovery signal may close only older recovery lots on that symbol and flip direction
- Core is never flipped by Recovery
- other strategies are never flipped by Recovery
- Core retains priority and may preempt Recovery
- shared caps remain:
  - V12 gross 2.0x
  - Crypto gross 3.0x
  - Total gross 4.25x
- selected Recovery-family cap: 1.75x

## Candidate coverage
The first Stage3 search was intentionally stopped at 1,051 raw candidate opportunities.

Extending the same incremental-profitability search without that artificial stop found:
- 1,176 raw opportunities across the full extended search
- two late routes with weak second-half evidence were excluded
- the retained V4 candidate pool is approximately 1,143 opportunities

This provides enough admission buffer to retain more than 1,000 actual V12 trades after ownership, cooldown, venue-minimum, and gross constraints.

## V4 extended result
With the F1.75 sizing/risk structure frozen:

| Cost | V12 trades | Portfolio final | Portfolio PF | Portfolio WR | DD |
|---|---:|---:|---:|---:|---:|
| 10bps | 1,082 | JPY 60,613,237 | 2.8178 | 67.02% | -19.78% |
| 20bps | 1,078 | JPY 43,128,808 | 2.7572 | 65.08% | -20.05% |
| 30bps | 1,077 | JPY 21,445,546 | 2.1357 | 62.45% | -20.29% |

V12 itself:
- 10bps: 1,082 trades / WR 66.36% / PF 3.1984 / net +98,224.3
- 20bps: 1,078 / WR 63.64% / PF 2.7489 / net +61,124.3
- 30bps: 1,077 / WR 60.91% / PF 2.3949 / net +29,705.2
- first-half / second-half PF remains positive at every tested cost.

## Quality pruning
Three persistently weak integrated routes were removed:
- REC_X10_TIME_48H
- REC_Y13_REV_D2_T36
- REC_G5_SLOW_TREND

### V4 PRUNED F1.75 — portfolio-oriented candidate
| Cost | V12 trades | V12 WR | V12 PF | V12 net | Portfolio final | DD |
|---|---:|---:|---:|---:|---:|---:|
| 10bps | 1,012 | 66.11% | 3.3254 | +92,151.3 | JPY 59,621,630 | -19.72% |
| 20bps | 1,009 | 63.33% | 2.8509 | +55,704.1 | JPY 40,538,870 | -20.02% |
| 30bps | 1,007 | 60.48% | 2.4338 | +27,120.1 | JPY 21,511,558 | -20.34% |

At 10bps and 20bps there are no subroutes with integrated PF below 1.
At 30bps only REC_G2_EARLY_BTC_OPPOSE_VOL is below 1 (52 trades, PF about 0.818, small net loss).

## G2 exit redesign
The G2 route was decomposed without changing its entry.

At 30bps, a 6h time exit on the same G2 entries produced:
- 52 trades
- PF 2.105
- first-half PF 1.968
- second-half PF 3.029

Integrated replay:

### V4 G2-6H F1.75 — route-quality candidate
| Cost | V12 trades | V12 WR | V12 PF | V12 net | Portfolio final | DD |
|---|---:|---:|---:|---:|---:|---:|
| 10bps | 1,012 | 66.40% | 3.350 | +93,623.0 | JPY 59,581,354 | -19.89% |
| 20bps | 1,009 | 64.02% | 2.864 | +55,933.0 | JPY 40,403,836 | -20.20% |
| 30bps | 1,008 | 61.11% | 2.482 | +28,405.2 | JPY 20,733,217 | -20.46% |

In this version, no V12 subroute has integrated PF below 1 in any of the 10/20/30bps scenarios.

The tradeoff is that portfolio final equity is slightly lower than V4 PRUNED because the shorter G2 holding period changes portfolio ownership / compounding paths.

## Rejected sensitivity
A global venue-minimum quantity floor was explicitly rejected because it changed sizing for unrelated strategies and materially distorted the portfolio.

Increasing only strong-route size and Recovery capacity beyond the selected structure can increase nominal profit but reduces trade count through higher capital occupancy. Therefore it is not used as the 1,000+ trade solution.

## Current frozen candidates
Two candidates should now be taken into independent validation without further development-period tuning:

1. **V4 PRUNED F1.75**
   - portfolio-value oriented
   - 1,012 / 1,009 / 1,007 V12 trades at 10/20/30bps

2. **V4 G2-6H F1.75**
   - cleaner per-route robustness
   - 1,012 / 1,009 / 1,008 V12 trades
   - every V12 subroute PF > 1 at all tested cost scenarios

## Critical limitation
All route discovery and the comparisons above are from the studied development period.

This result proves that a 1,000+ trade profitable multi-logic architecture can be constructed on the studied data. It does **not** yet prove forward/OOS generalization.

No candidate should be promoted to LIVE solely from this result. The next step is frozen-rule independent / forward-period validation. No thresholds, route definitions, or exits should be tuned from that validation set.
