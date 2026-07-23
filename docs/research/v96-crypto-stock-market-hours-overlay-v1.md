# V96 Crypto + Stock Market-Hours Overlay V1

Status: **FROZEN SHADOW RESEARCH SPECIFICATION**

Policy ID: `V96_MARKET_HOURS_STOCK_OVERLAY_V1`

Allocation ID: `V96_CRYPTO_1_STOCK_1_EQUAL_GROSS_V1`

Historical backtest policy: `V96_STOCK_HISTORICAL_BT_POLICY_V1`

## 1. Architecture decision

This system is not a hard time-sliced router.

- The V96 Crypto Engine remains eligible to create new entries 24 hours a day.
- The Stock Engine is an additive overlay that is eligible only during a confirmed U.S. regular market session.
- A U.S. stock session must never suppress an otherwise valid Crypto signal.
- When both engines have eligible signals and both independent sleeves have capacity, both entries are allowed.
- A static JST clock is not authoritative by itself. Session status must come from an exchange/session calendar source that handles DST, holidays and shortened sessions.

The rejected design was:

- Crypto active outside U.S. stock hours.
- Stock active during U.S. stock hours.
- Crypto entries blocked only because the stock market is open.

That rejected design has no causal basis when the Crypto strategy uses the same conditions at all hours. A post-hoc missed-signal PnL ledger is not used to justify blocking Crypto entries.

## 2. Frozen equal-gross allocation

Initial research comparison:

- Crypto Gross cap: `1.00`
- Stock Gross cap: `1.00`
- Portfolio Gross cap: `2.00`
- Stock directional strategy: Gross `1.00`
- Stock market-neutral strategy: Long `0.50` / Short `0.50`
- Sleeve lending: disabled

Unused Stock Gross is not lent to Crypto, and unused Crypto Gross is not lent to Stock during the initial comparison. This preserves attribution and prevents one engine from changing the other's risk profile.

The former Crypto `1.90` / Stock `0.10` allocation is Legacy reference only and is not the authoritative comparison baseline.

## 3. Entry routing

### Crypto

Crypto entry eligibility is determined by the existing V96 rules and its independent Gross cap.

A Crypto entry is rejected only for a Crypto-specific or portfolio safety reason, such as:

- no eligible V96 signal;
- Crypto sleeve Gross would exceed `1.00`;
- an existing V96 risk, exposure, liquidity or safety gate fails.

`STOCK_MARKET_OPEN` is not a valid Crypto rejection reason.

### Stock

A Stock entry requires all of the following:

- an eligible frozen Stock signal;
- confirmed U.S. regular market session;
- valid session source;
- Aster contract status is `TRADING`;
- Spread, depth, premium, Funding and simulated Slippage gates pass;
- Stock sleeve Gross remains at or below `1.00`;
- Event Risk Gate passes once that gate is promoted from observation-only Shadow status.

Premarket, after-hours, closed, unknown session, missing session source or failed execution gates block a new Stock entry. Existing-position emergency controls remain independent of new-entry hours.

## 4. News and event data

News does not select Long or Short direction.

The Stock Event Ledger stores observation-time evidence for risk analysis:

- earnings schedules and releases;
- material SEC filings;
- trading halts and resumptions;
- corporate actions;
- Aster contract status and specification changes;
- major company headlines with published and fetched timestamps;
- FOMC, CPI, employment and other major macro schedules.

Article bodies are not stored. Sentiment is not used to choose trade direction.

During the current seven-day collection, event information remains a parallel Shadow overlay and does not alter the frozen Baseline signals. Later analysis may measure whether a predeclared Event Gate improves PnL or DD, but the same seven-day sample must not be used to optimize event windows and then claim independent validation.

## 5. Current Forward data role

The seven-day Collector is used to establish:

- which symbols are executable;
- regular-session versus premarket/after-hours Spread;
- depth within 5/10/25 bps;
- simulated fills and Slippage at several order sizes;
- Funding, premium and Open Interest behavior;
- contract precision, minimum order constraints and status;
- endpoint latency, gaps and semantic inconsistencies;
- open, regular-core and close execution quality.

These observations determine a frozen execution model and symbol eligibility rules. They are not sufficient to establish robust profitability.

## 6. Historical backtest after the rules are frozen

Yes, once the Stock entry, exit, holding, universe, session and execution rules are frozen, historical data can estimate the strategy's historical profitability and a plausible forward range.

Preferred data order:

1. Aster Stock Perpetual historical 1-hour data, when the listing history is sufficiently long and complete.
2. Underlying U.S. equity 1-hour data for earlier periods, with an explicit limitation that it does not reproduce Perpetual basis, Funding, overnight Aster pricing or contract-specific liquidity.

Forward-observed Spread, depth and Slippage are used to create realistic cost scenarios. They must not be used to choose historical winners after their returns are known.

Required scenarios:

- Normal fixed cost, initially 20 bps turnover.
- Forward-observed executable cost by symbol/session/order size.
- Severe fixed cost, initially 50 bps plus additional stress where specified.

Required outputs:

- net return and CAGR;
- win rate and Profit Factor;
- maximum drawdown and return/DD;
- average win and average loss;
- trade count and turnover;
- Funding and transaction costs;
- year-by-year and regime results;
- Development, Validation and untouched Holdout;
- symbol and trade contribution concentration;
- largest trade removed and largest month removed;
- Normal and Severe results;
- directional and market-neutral results separately.

The backtest output is an estimate, not a guarantee. Production approval requires independent Forward evidence after the rules are frozen.

## 7. Allocation changes after evidence

The first comparison remains `1.00 / 1.00`.

Future weighting may compare `60/40` and `70/30`, but reallocation is not based only on recent profit or win rate. It must consider:

- net return;
- Profit Factor;
- maximum drawdown;
- return/DD;
- average win/loss;
- Severe performance;
- costs;
- Crypto/Stock return correlation;
- sample size and independent Forward duration.

Dynamic reallocation is not implemented in V1.

## 8. Safety

This specification is Shadow research only.

- No order submission.
- No Production strategy change.
- No LIVE change.
- No VPS deployment change.
- No modification to current Production V96 weights.
- No use of the current seven-day sample as Production approval.
