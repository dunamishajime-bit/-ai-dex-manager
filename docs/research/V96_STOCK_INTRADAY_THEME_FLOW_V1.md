# V96 Stock Intraday Theme Flow V1

## Classification

- Strategy ID: `V96_STOCK_INTRADAY_THEME_FLOW_V1`
- Status: `FROZEN_RESEARCH_CANDIDATE_NOT_BACKTESTED`
- Mode: `SHADOW_RESEARCH_ONLY`
- Order submission: disabled
- Crypto V96: unchanged
- Stock sleeve Gross cap: 1.0
- Sleeve lending: disabled

## Why the previous stock rules are not reused

The completed historical work rejected both earlier price-only families:

- daily 5-day / 20-day theme-breadth directional rotation;
- weekly strongest-versus-weakest same-theme market-neutral pair.

Those rules lost after chronological delay and conservative costs. The new candidate therefore does not merely lower the old breadth threshold or increase its trading frequency.

## What the Forward data changed

The stock-perpetual collector showed that execution quality is highly dependent on session and symbol:

- off-session and closed-session Spread can be very wide;
- some symbols have no quoted depth inside 10 bps at sampled moments;
- the currently selected SNDK leg was executable while AVGO was not in the same observation;
- simulated 100 / 500 / 1,000 USDT depth fills were generally available, but p95 Slippage was materially higher than the median;
- depth-derived and bookTicker mids occasionally disagree, including rare extreme invalid values;
- all fixed contracts were observed as trading;
- event data are available with first-seen chronology, but are not reliable direction selectors.

The architecture is therefore:

1. price and volume choose direction;
2. market microstructure, Open Interest and event data decide whether an otherwise valid signal may be executed;
3. the position is closed before the regular session ends.

## Fixed universe

The existing fixed 22 Aster stock-perpetual contracts:

`ADBE, AMAT, AMD, AMZN, ARM, ASML, AVGO, CRM, DRAM, GOOGL, INTC, META, MRVL, MSFT, MU, NVDA, ORCL, PLTR, QCOM, SNDK, TSLA, TSM`.

A symbol is eligible only while its contract status is `TRADING` and all execution data are complete.

## Time model

- Signal bars: completed 15-minute regular-session bars.
- Opening range: 09:30–10:00 New York time.
- New entries: 10:00–14:30 New York time.
- Mandatory flat: 15:45 New York time.
- No overnight stock position.
- Maximum one stock position at a time.
- Maximum two new entries per U.S. session.
- Sixty-minute cooldown after a hard-stop exit.

The first 30 minutes and final 15 minutes are excluded to avoid the most unstable price-discovery and closing-liquidity periods.

## Directional signal

The signal is calculated separately for the AI and Semiconductor themes.

### Theme direction

Long theme:

- at least 60% of eligible members are positive over the active intraday window;
- median theme move is at least +0.35 of the theme's volatility unit.

Short theme:

- at least 60% of eligible members are negative;
- median theme move is at most -0.35 of the volatility unit.

### Symbol selection

Long:

- symbol is in the strongest quartile of its theme;
- price is above session VWAP;
- price exceeds the opening-range high by at least 0.10 ATR;
- relative volume is at least 1.20.

Short:

- symbol is in the weakest quartile;
- price is below session VWAP;
- price is below the opening-range low by at least 0.10 ATR;
- relative volume is at least 1.20.

News, Funding, OI, liquidation flow and order-book imbalance do not choose Long or Short.

## Execution gate

Every entry and add must pass all conditions:

- confirmed U.S. regular session;
- contract status `TRADING`;
- no trading halt;
- no company-event or macro-event block;
- book/depth mid mismatch no more than 5 bps;
- Spread no more than 15 bps;
- expected one-way Slippage no more than 15 bps;
- expected round-trip cost no more than 40 bps;
- requested side fillable at the proposed notional;
- quote depth inside 10 bps at least 10 times proposed order notional;
- Funding present and absolute rate no more than 5 bps;
- 15-minute Open Interest change present and at least +0.10%.

The OI requirement is confirmation that the breakout is accompanied by new participation. It does not select direction.

Any book/depth mismatch over 5 bps is stored as invalid execution evidence rather than clipped into the aggregate.

## Position sizing

- Maximum Stock Gross: 1.0.
- Initial entry cap: 0.50 Gross.
- Add cap: additional 0.50 Gross after two completed confirming bars.
- Account risk budget: 0.75% per trade.
- Stop distance: maximum of 0.60% and 1.25 ATR.
- Actual Gross: minimum of the relevant entry/add cap, Stock Gross 1.0, and risk-budget Gross.

This prevents a high-volatility symbol from automatically receiving Gross 1.0.

## Exit

Exit the full stock position on the first applicable condition:

- hard stop;
- completed 15-minute close fails session VWAP against the position;
- valid opposite theme signal;
- trading halt;
- 15:45 New York mandatory close.

No profit target is used in V1. The intended edge is intraday continuation; fixed take-profit optimization is deferred until the baseline has independent evidence.

## Event policy

- Earnings, trading halts, FOMC, BLS and BEA events are risk gates.
- News headlines never select direction.
- Article bodies are not required.
- A company-event block prevents new entries in the affected symbol.
- A macro-event block prevents all new Stock entries around the event window.

## Historical backtest split

The authoritative BT must keep signal and execution evidence separate:

1. Backtestable core: 15-minute OHLCV, opening range, VWAP, ATR, relative volume, theme breadth and relative rank.
2. Forward-calibrated execution model: observed Spread, Slippage and invalid-book distributions by symbol and session.
3. Forward-only gates: OI, liquidation and exact event chronology must be reported separately when historical coverage is unavailable.

Required outputs:

- Development / Validation / untouched Holdout;
- year-by-year Normal and Severe;
- trade count, PF, win rate, average gain/loss, CAGR and maximum DD;
- result without best trade and best month;
- symbol and theme concentration;
- cost sensitivity at observed median, observed p95 and Severe;
- comparison with the rejected daily directional and weekly neutral baselines;
- comparison with Crypto Gross 1.0 and combined Gross 2.0.

## Promotion restriction

This document freezes a candidate for research. It does not approve Production, LIVE, VPS deployment or real orders. Any change to these thresholds creates a new strategy ID and restarts the evidence clock.
