# AIFX Early Wave Detector — Proxy Precommit

Status: **LOCKED BEFORE RESULTS**
Date: 2026-08-11

Purpose: test whether the main failure is late wave recognition rather than wrong direction. This is a free public-data proxy only; it is not production evidence.

## Data and universe

- Public `ejtraderLabs/historical-data` M15 OHLC.
- Pairs: EURUSD, GBPUSD, USDJPY, EURJPY, GBPJPY.
- Non-JPY integer prices /100000; JPY /1000.
- Source timezone is unverified, so no session-of-day rule is allowed.
- Years require >=20,000 M15 bars and no timestamp gap >96h.
- Public mid OHLC is converted to stressed executable BID/ASK using **2x** `(broker spread floor + execution buffer)`.
- Stress pips: EURUSD 1.0, GBPUSD 0.5, USDJPY 0.6, EURJPY 1.3, GBPJPY 0.8 round-trip spread model.
- Gap-stop losses are never clipped.
- Entry is on the next bar after a signal.

## Time split

From complete years common to all five pairs:

- final 2 complete years: untouched OOS;
- preceding 2 complete years: validation;
- all earlier complete years: development (minimum 3 years).

OOS is never used to choose a family, timeframe, or threshold. 2025 is not used.

## Timeframes

- M15 native.
- M30 is built strictly from exactly two M15 bars; incomplete M30 bars are discarded.
- M30 indicator windows are halved to preserve approximately the same wall-clock horizon.

## Early-wave families

LONG and SHORT are independent. Exactly three structural families compete, with identical thresholds across pairs.

### 1. IMPULSE_START

Looks for a new directional displacement near/beyond a recent extreme, rising volatility, directional candle bodies, and momentum acceleration. H1 contributes only one optional score point and is **not** a hard gate.

- initial stop: 1.0 ATR;
- Chandelier trail: 2.2 ATR.

### 2. CONTINUATION

Looks for an already-started directional move, a shallow retracement, then a renewed local high/low with momentum still alive. H1 is optional score only.

- initial stop: 1.1 ATR;
- Chandelier trail: 2.0 ATR.

### 3. REVERSAL

Looks for a prior adverse extension followed by an accelerated counter-move and micro-structure break. H1 is optional score only and cannot veto reversal.

- initial stop: 1.2 ATR;
- Chandelier trail: 2.0 ATR.

## Exit structure

No fixed 16/20/24-bar profit exit and no fixed take-profit.

A position exits on the earliest causal event among:

1. prior trailing stop hit (gap uses actual open, not clipped stop);
2. opposite strong IMPULSE_START observed on the previous completed bar -> next-bar-open exit;
3. prior-bar local structure break -> next-bar-open exit;
4. 10 trading-day fail-safe maximum hold only to prevent stale positions.

## H1 prior

H1 uses only causal completed bars. EMA24 vs EMA96 + ADX is a weak direction prior. It adds at most one score point. EMA192 is not an entry hard gate. Stale H1 state (>2h from last completed H1 bar) is treated as neutral.

## Development family selection

For each pair x direction x timeframe, rank the three fixed families by:

1. positive development years;
2. worst development-year R;
3. total development R;
4. PF.

Gate:

- positive development years >= max(2, ceil(67%));
- total R > 0;
- >=80 development trades;
- PF >=1.02.

## Validation gate

Frozen family must have:

- positive R in each of the two validation years;
- >=40 validation trades combined;
- combined PF >=1.05.

## M15/M30 selection before OOS

- both fail validation -> reject direction;
- only one passes -> choose that timeframe;
- both pass -> compare validation 2x-stress R/year;
- if within 5R/year -> smaller absolute DD;
- if still tied -> PF;
- exact tie -> M30.

Only after this selection is frozen may OOS be evaluated.

OOS pass requires both OOS years positive and combined PF >=1.05.

## Diagnostics

For each OOS year and pair, construct a retrospective 6x-H1-ATR ZigZag opportunity for diagnostics only.

Report:

- yearly R, PF, realized DD, trades, net pips;
- 2x cost stress;
- 6x-ATR Swing Capture Ratio = selected net pips / oracle absolute swing pips;
- Wave Detection Lag = fraction of same-direction oracle swing price distance elapsed at first selected signal;
- detection coverage = share of oracle legs receiving a same-direction signal;
- baseline-vs-early lag comparison using the old H1 hard-gated Breakout/Momentum/Pullback signal architecture (diagnostic only; no OOS repair).

Proxy PASS never authorizes LIVE trading.