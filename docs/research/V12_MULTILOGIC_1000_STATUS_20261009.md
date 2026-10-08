# V12 Multi-Logic 1000-Trade Recovery Status — 2026-10-09

## Status
**RESEARCH_ONLY / NO LIVE OR PRODUCTION CHANGE**

## Objective correction
The original realistic V12 baseline accepted 1,123 trades. Therefore 500 trades was only an intermediate recovery milestone, not the final target.

The research objective is:

- recover roughly 1,000+ V12 trades,
- do it through multiple independent causal logic/exit sleeves rather than one relaxed monolithic gate,
- keep V12 profitable,
- keep total portfolio profit improving,
- preserve the high-confidence Core,
- retain portfolio-level risk caps.

## Starting anchors

### Original V12 baseline
10bps:
- V12 accepted: 1,123
- V12 PF: 0.7197
- V12 net: -4,717.11
- conclusion: large opportunity count, but the monolithic V12 entry architecture was loss-making.

### High-confidence failed-break Core
10bps:
- V12 accepted: 55
- WR: 60.0%
- PF: 2.4356
- V12 net: +4,090.68

This proved that strong V12 edge existed, but 55 trades was far too restrictive.

## Multi-logic reconstruction

The >1,000 V12 opportunity stream was decomposed using completed H1 bars only. Entry-time features included:

- 3/6/12/24/48h symbol returns
- BTC returns
- BTC-relative strength
- ATR
- EMA distance
- efficiency ratio
- volume ratio
- breakout/range location
- pullback depth
- compression
- candle body / CLV
- momentum-condition age

The resulting architecture contains:

1. FAILED_BREAK_REV_SHORT_6H high-confidence Core
2. robust SHORT_MID complement
3. Stage-1 independent legacy-exit recovery sleeves
4. Stage-2 independent dedicated-exit sleeves
   - 6/12/24/36/48h time exits
   - ATR TP/SL variants
5. Stage-3 reversal sleeves
   - selected old-direction candidates are traded in the opposite direction when the causal state indicates failed continuation
6. independent route-local slot/cooldown handling
7. V12 Virtual Leg accounting for same-symbol recovery signals

## Why Virtual Legs were necessary

At the V3 stage, the candidate architecture had about 1,051 V12 opportunities, but only 642 were accepted. The largest rejection source was:

- V12:SAME_SYMBOL_ACTIVE: 320
  - same direction: 252
  - opposite direction: 68

The physical venue position can be netted by symbol, but the research logic requires each causal route/exit to remain separately auditable.

Therefore V12 Recovery was modeled with logical Virtual Legs:

- same-symbol, same-side Recovery legs may coexist,
- opposite Recovery legs may coexist as virtual net legs,
- FAILED_BREAK Core is protected and cannot be overlapped by Recovery,
- cross-strategy ownership remains protected,
- logical gross is still counted conservatively toward portfolio risk.

## Progression

| Stage | V12 accepted | Portfolio final @10bps | Key change |
|---|---:|---:|---|
| Original V12 | 1,123 | n/a | monolithic losing baseline |
| Core | 55 | JPY 18.38m | failed-break only |
| V3 | 642 | JPY 24.10m | multi-route independent sleeves |
| V4 | 866 | JPY 30.89m | same-direction Virtual Legs |
| V5 | 946 | JPY 45.28m | venue minimum handling + recovery priority |
| V6 RCAP 1.25 | 1,000 | JPY 47.22m | Recovery-only opposite virtual net |
| V6 RCAP 1.35 | **1,006** | **JPY 47.30m** | small Recovery-family cap sensitivity |

## Current best: V6 Recovery Family Cap 1.35x

Shared caps remain:
- V12 total gross cap: 2.0x
- Crypto gross cap: 3.0x
- Total gross cap: 4.25x
- Recovery family gross cap: 1.35x

### 10bps
- V12 accepted: **1,006**
- V12 WR: **64.31%**
- V12 PF: **2.8302**
- V12 net (engine accounting): **+57,912.01**
- V12 first-half PF: **5.1608**
- V12 second-half PF: **2.8009**
- Portfolio final: **JPY 47,304,997**
- Portfolio PF: **2.9839**
- Portfolio WR: **65.68%**
- Max DD: **-19.682%**
- Total portfolio trades: 1,422

### 20bps
- V12 accepted: **1,008**
- V12 WR: **61.61%**
- V12 PF: **2.4627**
- V12 net: **+31,170.52**
- V12 first-half PF: **4.5606**
- V12 second-half PF: **2.4280**
- Portfolio final: **JPY 26,724,319**
- Portfolio PF: **2.3337**
- Portfolio WR: **63.40%**
- Max DD: **-19.872%**
- Total portfolio trades: 1,437

### 30bps
- V12 accepted: **1,002**
- V12 WR: **58.68%**
- V12 PF: **2.1300**
- V12 net: **+15,271.72**
- V12 first-half PF: **4.0001**
- V12 second-half PF: **2.0878**
- Portfolio final: **JPY 15,611,839**
- Portfolio PF: **2.2167**
- Portfolio WR: **60.91%**
- Max DD: **-20.254%**
- Total portfolio trades: 1,430

## Interpretation

The user's core hypothesis is supported in the studied replay:

**V12 does not need to choose between “high precision but only 55 trades” and “1,123 trades but losing.”**

A multi-logic / multi-trade architecture can recover roughly the original opportunity count while remaining profitable.

The important architectural changes were:

- separate different market structures into independent logic sleeves,
- give those sleeves route-specific exits,
- allow multiple logical legs instead of rejecting every same-symbol signal,
- protect the high-confidence Core,
- keep logical exposure under shared gross caps,
- use opposite-side reversal routes for failed continuation states.

## Important limitations

This is **not Production-ready yet**.

1. The architecture was selected and refined on the same studied development period. Independent walk-forward / untouched out-of-sample validation is required.
2. Current venue quantity constraints are observed-current filters from 2026-10-07, not a historical venue-filter archive.
3. The model is H1 price-model based and is not a historical L2 execution replay.
4. Virtual Net Legs require a Production execution/reconciliation design so multiple logical exits can be mapped safely onto one venue net position.
5. At 30bps, V12 WR is 58.68%, below the earlier 60% V12 win-rate aspiration, although V12 remains strongly profitable with PF 2.13.
6. No LIVE/Production logic was changed during this research.

## Current research decision

Use **V6 RCAP 1.35** as the current research benchmark for the next validation stage.

Next validation priority:
1. freeze all route definitions and thresholds,
2. do not tune further on this development period,
3. run independent post-selection / walk-forward validation,
4. validate Virtual Leg accounting and venue net-position reconciliation,
5. only then decide whether to prepare a Production handoff.
