# V12 Multi-Logic Recovery Research Status — 2026-10-08

## Status
**RESEARCH_ONLY / NO LIVE OR PRODUCTION CHANGE**

## Corrected objective
The target is not to force V12 into a single high-precision 55/77-trade gate. The target is to recover the missed profitable opportunities through multiple independent logic sets, each with its own causal entry/exit behavior and its own recovery sleeve, while preserving shared portfolio risk caps.

## Starting point
- Baseline V12 accepted: 1,123
- Baseline V12 10bps PF: 0.7197
- Baseline V12 10bps net: -4,717
- High-precision failed-break core: 55 trades, PF 2.4356, net +4,090.68
- Robust 24–48h SHORT_MID complement produced a 77-trade core/complement structure.

Among baseline accepted trades not represented by the 77-trade structure, 445 were winners. This established that the main task was not further filtering; it was separating different market structures into independent profitable route families.

## Feature reconstruction
Entry-time-only H1 features were reconstructed from completed bars:
- 3/6/12/24/48h symbol return
- BTC return and BTC-relative return
- ATR
- EMA distance
- efficiency ratio
- volume ratio
- 24h breakout/range location
- pullback depth
- compression
- candle body / close location
- momentum-condition age

No future information was used for entry classification.

## Multi-logic route construction
A broad route scan showed that simply naming several filters was insufficient. The process was changed so that every new route's **incremental uncovered subset** had to be profitable.

### Stage 1 recovery
Five legacy-exit route families retained for the V2 candidate architecture:
1. MID relative-strength / low-volume SHORT
2. Early BTC-opposed high-volume SHORT
3. Late BTC-relative SHORT
4. Mature relative-strength / range SHORT
5. Slow-trend SHORT

### Stage 2 recovery
The remaining trades were re-searched with independent exit templates:
- time exits: 6h / 12h / 24h / 36h / 48h
- ATR-based TP/SL templates

Fourteen additional incremental route+exit sleeves were retained before the final integrated replay. The V2 candidate pool was approximately 724 unique opportunities including the core/complement structure.

## Why true multi-trade was required
When all recovery routes were forced through the original shared V12 2+1 position pool, candidate-level profitable routes were selectively rejected:
- BASE_SLOTS_FULL
- SAME_SYMBOL_ACTIVE
- shared symbol/side cooldowns

The solution tested was an independent recovery-sleeve architecture:
- high-confidence failed-break stays Core
- recovery routes get route-local slots/cooldowns
- same-symbol ownership stays exclusive
- Core can preempt Recovery
- Recovery does not preempt Core/FET for Gross
- Recovery does not make IDLE/Residual core-busy
- shared caps remain unchanged:
  - Crypto gross 3.0x
  - V12 gross 2.0x
  - Total gross 4.25x
- Recovery-family gross cap: 0.50x
- Recovery trade gross: 0.10x in final slot sensitivity

## Final slot comparison

### 2 recovery slots per route
10bps:
- V12: **503 trades**
- V12 WR: 56.06%
- V12 PF: **1.9520**
- V12 net: **+9,485.2**
- Portfolio final: **JPY 21,698,573**
- Portfolio PF: 2.5778
- DD: -20.243%

20bps:
- V12: 499
- V12 PF: 1.6463
- V12 net: +4,066.4
- Portfolio final: JPY 12,192,895

30bps:
- V12: 497
- V12 PF: 1.4048
- V12 net: +1,680.2
- Portfolio final: JPY 6,726,205

### 3 recovery slots per route
10bps:
- V12: **507**
- V12 WR: 56.02%
- V12 PF: **2.0457**
- V12 net: **+10,528.6**
- Portfolio final: JPY 21,183,486
- DD: -20.234%

20bps:
- V12: **501**
- V12 PF: 1.7122
- V12 net: +4,491.2
- Portfolio final: **JPY 12,355,477**

30bps:
- V12: 499
- V12 PF: 1.4658
- V12 net: +1,980.1
- Portfolio final: **JPY 6,967,925**

### 4 recovery slots per route
10bps:
- V12: **511**
- V12 WR: 55.97%
- V12 PF: 2.0449
- V12 net: +10,473.1
- Portfolio final: JPY 21,088,730

20bps:
- V12: **505**
- V12 PF: 1.7114
- V12 net: +4,482.7
- Portfolio final: JPY 12,343,609

30bps:
- V12: **504**
- V12 PF: 1.4647
- V12 net: +1,973.6
- Portfolio final: JPY 6,957,780
- Portfolio PF: 2.2431
- DD: -20.819%

## Interpretation
The user's multi-logic/multi-trade premise is supported by the integrated replay.

Compared with the 55-trade core:
- trade count can be restored to more than 500;
- V12 remains profitable;
- V12 absolute profit materially increases;
- portfolio final equity also increases materially;
- DD remains around the existing ~20% area.

However, the current 19-sleeve research architecture is **not yet Production-ready**. Several sleeves remain negative after actual portfolio admission/preemption even though their development candidate sets were positive. These sleeves must be replaced or redesigned rather than retained merely to satisfy a trade-count target.

Current interpretation:
- **2-slot**: best 10bps portfolio final.
- **3-slot**: highest V12 net and strongest 20/30bps portfolio result among 2/3/4 slots.
- **4-slot**: guarantees >500 V12 accepted trades under all 10/20/30bps scenarios, but adds little economic value over 3 slots and slightly lowers portfolio value.

The next refinement should therefore focus on replacing the portfolio-negative sleeves while keeping the independent-sleeve architecture and >=500-trade coverage, not on relaxing one monolithic V12 gate.

No LIVE/Production logic was changed.
