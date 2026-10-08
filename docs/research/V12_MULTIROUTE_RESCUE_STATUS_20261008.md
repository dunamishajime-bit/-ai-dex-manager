# V12 Multi-Route Rescue Research Status — 2026-10-08

## Status

**RESEARCH_ONLY / NO LIVE OR PRODUCTION CHANGE**

User requirement addressed: do not collapse V12 from >1,000 accepted trades to only ~55 trades if profitable opportunities can be retained.

## Baselines

### Current persistent-momentum V12
10bps integrated replay:
- V12 accepted: 1,123
- V12 WR: 40.25%
- V12 PF: 0.7197
- V12 net: -4,717.11
- Portfolio final: JPY 4,319,497.91
- Portfolio PF: 1.8314
- DD: -23.82%

### High-precision failed-break-only route
FAILED_BREAK_REV_SHORT_6H:
- V12 accepted: 55
- V12 WR: 60.00%
- V12 PF: 2.4356
- V12 net: +4,090.68
- Portfolio final: JPY 18,375,534.06
- Portfolio PF: 2.7562
- DD: -19.70%

This route is profitable but over-filters trade opportunity.

## Multi-route redesign

Keep the 55-trade high-precision failed-break route at existing sizing and add continuation-rescue routes selected from baseline V12 only when their candidate-level PF was >1 in both temporal halves.

Rescue families:
- SHORT_BURST: SHORT, momentum age <=96h, signed 6h return >=3.0%
- SHORT_FAST: SHORT, age <=12h, signed 6h return 0..1.5%
- LONG_CREEP: LONG, signed 6h return 0..0.25%
- SHORT_CREEP: SHORT, signed 6h return 0.25..0.50%
- ALL_ACCEL_EARLY: age <=24h, signed 6h 1.5..3.0%, EMA12 distance >=1 ATR
- NEG_PULLBACK: age <=72h, signed 6h <0, EMA12 distance 0.5..1 ATR
- ALL_BURST_EARLY: age <=24h, signed 6h >=3.0%

The first integrated replay showed that restoring all rescue candidates at normal ATR sizing made V12 approximately break-even/negative because weak-edge rescue losses received too much gross.

Therefore the next design uses **confidence-weighted sizing rather than deleting entries**:
- FAILED_BREAK_REV_SHORT_6H: unchanged sizing
- continuation rescue entries: uniform maximum gross cap
- no route-specific outcome-tuned cap

## Key sizing result

### Recommended research balance: RESCUE_500_CAP10

High-precision failed-break route unchanged.
Continuation rescue route gross capped at **0.10x**.

#### 10bps
- V12 accepted: **406**
- V12 WR: **48.52%**
- V12 PF: **1.6251**
- V12 net: **+3,425.96**
- V12 first-half PF: **1.6297**
- V12 second-half PF: **1.6250**
- V12 LONG PF: 1.3546
- V12 SHORT PF: 1.6394
- Portfolio final: **JPY 17,734,375.99**
- Portfolio PF: **2.7427**
- Portfolio WR: 58.59%
- Portfolio DD: **-20.00%**
- Portfolio trades: 838

#### 20bps
- V12 accepted: **404**
- V12 WR: 45.05%
- V12 PF: **1.3075**
- V12 net: **+1,056.55**
- first-half PF: 1.3182
- second-half PF: 1.3072
- Portfolio final: JPY 9,043,767.22
- Portfolio PF: 2.4981
- DD: -20.53%

#### 30bps
- V12 accepted: **399**
- V12 WR: 41.10%
- V12 PF: **1.0586**
- V12 net: **+139.75**
- first-half PF: **1.0703**
- second-half PF: **1.0581**
- Portfolio final: JPY 5,021,166.49
- Portfolio PF: 2.2873
- DD: -21.06%

This is the first tested architecture in this research sequence that restores several hundred V12 entries while keeping V12 profitable across 10/20/30bps and both temporal halves.

## Opportunity / robustness alternatives

### RESCUE_300_CAP10
10bps:
- V12 302 trades
- PF 1.6576
- net +3,419.44
- portfolio final JPY 17,953,004.95
- DD -19.86%

30bps:
- V12 296 trades
- PF 1.0932
- first-half PF 1.1923
- second-half PF 1.0896

This is the most robust of the multi-route variants, but retains fewer opportunities than the 500 plan.

### RESCUE_700_CAP10
10bps:
- V12 489 trades
- PF 1.5836
- net +3,404.39
- portfolio final JPY 17,120,069.71
- DD -19.78%

30bps:
- V12 480 trades
- PF 1.0367
- first-half PF 0.9979
- second-half PF 1.0387

The 700 plan retains the most opportunity, but strict half-by-half 30bps robustness is marginal because first-half PF is just below 1.

## Decision

Current research ranking:
1. **RESCUE_500_CAP10 — preferred balance**
2. RESCUE_300_CAP10 — stronger robustness, fewer entries
3. RESCUE_700_CAP10 — more entries, marginal 30bps first-half weakness
4. CORE55 — strongest precision, unacceptable opportunity loss as sole V12 architecture
5. Current baseline V12 — reject; high trade count but negative V12 expectancy

The key design change is not “filter harder.” It is:
- separate high-confidence reversal entries from lower-confidence continuation entries;
- keep more valid trade opportunities;
- scale exposure by confidence.

No LIVE/Production implementation is approved from this study alone. External/forward validation remains required before deployment.
