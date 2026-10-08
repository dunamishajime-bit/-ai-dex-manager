# V12 Profit-Accretion Research Status — 2026-10-08

## Status
RESEARCH_ONLY. No LIVE/Production change.

## User concern
The 300/500 rescue designs added many V12 trades but did not increase absolute V12 profit relative to the 55-trade core. That is unacceptable: added trades must be profit-accretive, not merely keep aggregate PF above 1.

## Rejected designs

### RESCUE_300_CAP10
Compared with CORE55, the extra V12 trades were collectively negative:
- roughly +247 V12 trades
- incremental PF about 0.786
- incremental PnL about -520 JPY in the integrated replay

Main drag:
- CONT_SHORT_BURST: 156 accepted trades, PF about 0.665, net about -662

### RESCUE_500_CAP10
Compared with CORE55:
- roughly +351 V12 trades
- incremental PF about 0.831
- incremental PnL about -465

Therefore the earlier multi-route 300/500 recommendation is superseded and rejected.

## Broad SHORT_MID study
Adding all SHORT_MID entries at 0.50x initially looked attractive:
- V12 134 trades vs CORE55 55
- 10bps V12 net about +6,737 vs +4,091 CORE55

But the complementary route itself was temporally unstable:
- 10bps first-half PF about 0.923
- second-half PF about 3.132
- 30bps first-half PF about 0.502
- second-half PF about 2.102

Therefore broad SHORT_MID is not robust enough to promote.

## Robust complementary slice
The actual accepted SHORT_MID trades were decomposed by momentum-condition age.
The 24–48h age band was the only useful age bucket that stayed positive in both halves even at 30bps:
- 30bps first-half PF about 1.403
- 30bps second-half PF about 1.086

Frozen complement definition:
- side: SHORT
- momentum condition age: >=24h and <48h
- signed 6h return: >=0.5% and <1.5%
- EMA12 distance: >=1 ATR
- legacy exit preserved
- core FAILED_BREAK_REV_SHORT_6H unchanged

## Final integrated comparison

### CORE55
10bps:
- V12 55 trades
- V12 PF 2.4356
- V12 net +4,090.68
- portfolio final JPY 18,375,534
- portfolio PF 2.7562
- DD -19.697%

20bps:
- V12 net +1,761.09
- portfolio final JPY 10,028,050

30bps:
- V12 net +697.93
- portfolio final JPY 5,735,623

### Robust complement, cap 0.25x
10bps:
- V12 77 trades
- V12 PF 2.3246
- V12 net +4,366.26
- portfolio final JPY 18,717,979
- DD -19.691%

20bps:
- V12 net +1,850.75
- portfolio final JPY 10,163,659

30bps:
- V12 net +720.35
- portfolio final JPY 5,799,101
- first-half V12 PF 2.1894
- second-half V12 PF 1.4301

### Robust complement, cap 0.50x
10bps:
- V12 77 trades
- V12 PF 2.2351
- V12 net +4,566.44
- portfolio final JPY 18,771,920
- DD -19.690%

20bps:
- V12 net +1,909.97
- portfolio final JPY 10,157,733

30bps:
- V12 net +734.63
- portfolio final JPY 5,782,092
- first-half V12 PF 2.2906
- second-half V12 PF 1.3933

### Robust complement, cap 0.75x
10bps V12 net is higher (+4,705.75) and portfolio final JPY 18,830,465, but 30bps portfolio final falls to JPY 5,320,381, below CORE55. Reject as not sufficiently cost-robust.

### Robust complement, cap 1.00x
Worse than 0.25/0.50x under stress and rejected.

## Decision
1. Reject RESCUE_300 and RESCUE_500 as profit-dilutive.
2. Reject broad SHORT_MID despite attractive full-period profit because the edge is period-dependent.
3. Current robust research candidate:
   - CORE55 + SHORT_MID age 24–48h complement
   - 0.25x preferred for portfolio-level robustness
   - 0.50x preferred if maximizing V12 absolute PnL while still beating CORE55 at 10/20/30bps
4. Do not promote to LIVE from this studied period alone. The complement needs independent/forward validation.

The governing rule for further V12 expansion is now:
**Every added route must independently add absolute PnL and must not reduce total portfolio value under the required cost-stress scenarios.**
