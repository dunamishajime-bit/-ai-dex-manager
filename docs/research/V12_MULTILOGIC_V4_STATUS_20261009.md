# V12 Multi-Logic V4 Research Status — 2026-10-09

## Status

**RESEARCH ONLY — NO LIVE / PRODUCTION CHANGE**

The V12 redesign objective has been restored to the original scale: recover roughly 1,000+ V12 opportunities with multiple independent logic/exit sleeves while keeping V12 profitable and portfolio drawdown controlled.

The old monolithic V12 baseline had 1,123 accepted trades but was structurally unprofitable. The V4 architecture now restores more than 1,000 modeled V12 trades while remaining profitable under 10/20/30bps cost stress.

## Legacy baseline

Studied period: 2025-08-10 through 2026-08-10.

Legacy V12:
- accepted trades: 1,123
- win rate: 40.25%
- PF: 0.7197
- V12 net: -4,717
- integrated portfolio final: about JPY 4.319m
- portfolio DD: about -23.82%

The failure was entry architecture, not insufficient trade frequency.

## V4 architecture

V4 is not one relaxed gate. It is a multi-logic / multi-trade architecture.

Main design:
- failed-break high-confidence core
- robust SHORT_MID complement
- multiple continuation / relative-strength / early / mature / reversal sleeves
- dedicated time exits and ATR TP/SL exits where appropriate
- route-local slots and cooldowns
- same-symbol/same-direction V12 signals may coexist as internal Virtual Legs of one venue net position
- opposite-direction overlap remains exclusive
- REC_Y reversal sleeves may preempt opposite lower-priority REC_X / REC_G recovery sleeves
- high-confidence core is protected
- exact venue quantity constraints remain modeled
- selective Min-Lift may raise a recovery order only to the minimum valid venue quantity when post-lift gross stays within room and the configured lift cap

Shared caps remain:
- V12 total gross: 2.0x
- crypto gross: 3.0x
- total gross: 4.25x

Best capacity configuration:
- recovery route slots: 16
- recovery family gross cap: 1.00x
- normal recovery requested gross: 0.10x
- Min-Lift maximum gross: 0.30x

## Candidate recovery progression

- Core only: 55 V12 trades
- Core + robust complement: 77
- V2 independent sleeves: ~500
- V3: 642
- V4 same-direction Virtual Legs: 866
- V4 + Min-Lift: 892
- V4 + reversal preemption: 910
- V4 capacity tuning: 940
- V4 extended: 997
- V4 Final1000: **1,018 at 10bps**
- same Final1000 architecture: **1,017 at 20bps / 1,012 at 30bps**

## V4 Final1000 — fixed architecture before G5 refinement

### 10bps
- V12 trades: **1,018**
- V12 win rate: **67.780%**
- V12 PF: **3.2323**
- V12 net: **+67,761.37**
- V12 first-half PF: 6.6699
- V12 second-half PF: 3.1830
- portfolio final: **JPY 52,400,306.51**
- portfolio PF: 2.9219
- portfolio win rate: 68.0836%
- DD: **-17.1378%**
- total portfolio trades: 1,435

### 20bps
- V12 trades: **1,017**
- V12 win rate: **64.602%**
- V12 PF: **2.5800**
- V12 net: **+34,743.07**
- V12 first-half PF: 5.8825
- V12 second-half PF: 2.5255
- portfolio final: **JPY 30,023,530.02**
- portfolio PF: 2.3735
- DD: **-17.6501%**

### 30bps
- V12 trades: **1,012**
- V12 win rate: **61.957%**
- V12 PF: **2.2240**
- V12 net: **+17,483.87**
- V12 first-half PF: 5.1174
- V12 second-half PF: 2.1599
- portfolio final: **JPY 18,026,978.57**
- portfolio PF: 2.2673
- DD: **-18.1580%**

Accounting/deposit audit: PASS for all three cost scenarios.

## Final extension routes

Two extra routes were added only after they had already shown positive first/second-half evidence and strong 20bps candidate PF.

### REC_Y19_REV_D1_TP2_SL1_H36
Final integrated:
- 10bps: 10 trades, 80% WR, PF 102.68
- 20bps: 10 trades, 80% WR, PF 72.83
- 30bps: 10 trades, 80% WR, PF 55.88

### REC_Z21_ORIG_D2_TP1_SL1_H24
Final integrated:
- 10bps: 11 trades, 81.82% WR, PF 2529.84
- 20bps: 11 trades, 81.82% WR, PF 1280.79
- 30bps: 11 trades, 81.82% WR, PF 644.65

Extended routes whose second-half evidence failed were not promoted.

## Quality audit and G5 correction

The Final1000 route audit found three 10bps-negative subroutes:
- REC_X10_TIME_48H
- REC_X14_TIME_48H
- REC_G5_SLOW_TREND

G5's loss source was its legacy/trailing exit behavior. A fixed 48h exit was tested without changing the entry rule.

With G5 fixed 48h:
- G5 10bps PF: **1.999**
- G5 20bps PF: **1.854**
- G5 30bps PF: **1.800**

The refined aggregate remains above 1,000 V12 trades at every tested cost:

### Research candidate: Final1000 + G5 fixed 48h

10bps:
- V12 trades: **1,015**
- WR: **67.783%**
- V12 PF: **3.2257**
- V12 net: **+68,179.39**
- portfolio final: JPY 52,241,786.03
- portfolio PF: 2.9123
- DD: -17.140%

20bps:
- V12 trades: **1,014**
- WR: **64.892%**
- V12 PF: **2.5779**
- V12 net: **+35,145.22**
- portfolio final: JPY 30,168,161.91
- portfolio PF: 2.3731
- DD: -17.646%

30bps:
- V12 trades: **1,012**
- WR: **62.253%**
- V12 PF: **2.2287**
- V12 net: **+18,037.27**
- portfolio final: JPY 18,371,646.26
- portfolio PF: 2.2648
- DD: -18.150%

This G5 refinement slightly reduces the 10bps portfolio final relative to unrefined Final1000 (~0.3%), but increases V12 absolute PnL at all three cost levels and improves the stressed 20/30bps portfolio result while turning G5 itself profitable. It is therefore the preferred research version.

## X10 / X14 sizing test

Halving REC_X10 / REC_X14 gross to 0.05x reduces their drag and improves 10bps PF/DD, but it lowers 20bps portfolio final and does not dominate the unhalved configuration across costs.

Therefore:
- do not adopt the half-sizing change as the fixed V4 research architecture
- keep X10/X14 as open research items
- do not remove them merely to cosmetically improve per-route PF, because the full architecture must remain above the 1,000-trade target and their candidate-level evidence was positive

## Remaining limitations

This is not Production-certified.

The available Aster H1 market dataset ends at **2026-08-10 23:00 UTC**. There is no post-development untouched market window in the current dataset for an external holdout of this final architecture.

Therefore:
1. do not deploy V4 to LIVE yet
2. freeze the current rules before obtaining new data
3. validate without threshold changes on post-2026-08-10 data or forward-shadow evidence
4. separately review X10/X14 behavior under actual portfolio preemption
5. preserve the Virtual-Leg ownership/accounting semantics exactly in any future implementation

## Research conclusion

The user's original premise is supported:

> V12 should not be rescued by shrinking from 1,123 trades to a tiny high-precision gate. The correct architecture is multiple independent market-structure logic sets with independent exits and multi-trade handling.

V4 now restores **more than 1,000 accepted V12 trades under 10/20/30bps**, while V12 remains strongly profitable and portfolio DD stays below the legacy baseline.
