# Five-Logic Integrated Backtest — Design Specification

**Status:** Design approved for specification review; implementation has not started.
**Created:** 2026-09-26
**Scope:** V12, PENGU, Q102, FET, V52.
**Production boundary:** Read-only source audit only. No VPS, production data, live order, configuration, or strategy code changes are permitted.

## 1. Objective

Build a new reproducible backtest from the running VPS Production implementation. The running release is the primary source of truth; previous backtest engines, saved fills, and prior execution ledgers are not used as results or implementation inputs.

The backtest must reproduce strategy decisions, shared portfolio controls, sizing, order lifecycle, and exits as closely as the available timestamped data permits. Every modeled or unverified element must be identified in the outputs. It must not call a case successful when required source data is missing.

## 2. Frozen test conditions

- Test dates: 2025-08-10 through 2026-08-10, UTC dates inclusive.
- Initial capital: ¥10,000 at 2025-08-10 00:00 UTC.
- Contributions: ¥10,000 on each monthly anniversary from 2025-09-10 through 2026-08-10, for 12 contributions. Total paid in is ¥130,000.
- Equity and positions compound. Deposits are external flows and are excluded from profit and return calculations.
- Convert JPY deposits and USDT-valued portfolio balances using the daily USD/JPY reference series DEXJPUS from FRED; use the latest observation available at or before each UTC deposit or valuation timestamp. Preserve the source rate and timestamp in the run manifest.
- Include NORMAL and SEVERE scenarios as defined in Section 6. These are backtest-only execution-data scenarios; they do not define or change a Production mode.
- Begin each instrument only from its first valid Aster market-data bar and after the exact strategy warm-up requirement is satisfied.

## 3. Production source of truth

Read-only VPS audit found the active Runtime SHA to be:

- Runtime SHA: e1b58060d6263a3af7ced51bec854d3e211d2f35
- Active units audited: V12, PENGU, Q102 CAUSAL_V4, FET, shared Margin Guard, V52 and its reference-feed proxy.

At implementation time, capture a secret-free manifest containing the Runtime SHA, source file paths and SHA256 values, allowlisted non-secret configuration values, active unit names, data-source timestamps, and extraction date. Never store or display environment secrets, API keys, private keys, account identifiers, or user data.

The strategy decision layer will be ported from or directly shared with the audited runtime implementation and parity-tested on deterministic input vectors. If a source file or setting cannot be recovered and validated, the affected behavior is marked unverified and excluded from a success claim.

## 4. Strategy scope

### V12

- Universe: BTC, ETH, BNB, SOL, LINK, AVAX, DOGE, INJ, XRP, ADA, LTC, ATOM, AAVE, NEAR.
- Reproduce contiguous H1-to-H2 construction, BTC regime and score logic, candidate ranking, selectors, pre-execution overlays, sizing, protective orders, trailing behavior, hold limits, and cooldown from the audited V12 source.
- Reproduce the shared maximum of three positions and aggregate gross limits.
- First complete the unchanged Production baseline. Only after that baseline passes validation, compare the following BT-only variants with HC1.75 fixed: current gates; volume ratio 0.80 and Score 1.00; volume ratio 0.55 and Score 0.85; strong-BTC score-gap acceptance extended up to the current neutral threshold. Report trades added, trades removed, profitable trades displaced, and net P&L change for each variant.

### PENGU

- Decision instruments: PENGUUSDT and BTCUSDT feature input; trade only positions permitted by the audited PENGU runtime.
- Reproduce dual long/short routes, Recovery mode, precedence, single-position behavior, route quarantine, stop/trailing/time exits, partial reductions, sleeve drawdown lockout, and runtime risk limits.

### Q102

- Reproduce the active CAUSAL_V4 runtime mode, current HIGH_VOL and S34 universes, training/walk-forward windows, eligibility rules, candidate-selection precedence, single-position policy, quote/slippage gates, software exits, and family gross limits.
- Only information available by each decision timestamp may contribute to training or selection. Monthly model criteria and data history must be rebuilt as-of time, with no current/future labels leaking into earlier decisions.

### FET

- Reproduce the FET_BRK48 long-only route, 48-hour breakout reference, prior-volume gate, evaluation schedule, residual sizing bounds, hard stop, profit-lock behavior, time exit, and preemption/trim behavior from the audited runtime.

### V52

- Reproduce V11_EQ and V50_POST_OPEN_BASIS as separate routes, their stock reference feed, basis/cost/depth/spread checks, session schedule, post-only entry attempts, exits, force-flat rules, and interaction with the shared portfolio allocator.
- Use historical stock reference quotes from the same provider family used by the active runtime where available; document every feed identifier and bar/quote time alignment. Use the official NYSE 2025/2026 trading calendar for full closures and early closes. The Production helper audited to date does not explicitly model early closes; the backtest will additionally prohibit execution after an official early close to satisfy the market-calendar requirement and log that BT-only availability constraint.

## 5. Shared portfolio and order model

- Replay all strategy events on one deterministic UTC event timeline.
- Reproduce strategy priority and funding competition: V52, PENGU, V12, Q102 CAUSAL_V4, legacy Q102 if active in the audited dispatcher, and FET, including any preemption/trim performed by the live shared planner.
- Reproduce gross and margin limits from the active policy, including per-route/per-family caps, position count, balance reserve, leverage and cross-margin requirements, profit-expansion gates, drawdown governor, stale-data gates, daily loss stops, and Margin Guard warning/reduce/critical behavior.
- Use the audited live risk policy values: base crypto gross 3.0x, stock gross 4.0x, combined gross 4.25x; hard crypto gross 5.0x and total gross 8.0x. Reproduce route-specific caps and policy tiers from source rather than substituting a simplified single cap.
- Margin Guard thresholds: warning at maintenance ratio 50% or liquidation buffer 12%; reduce at 65% or 8%; critical at 75% or 5%; recovery only below 45% and above 15% buffer. New orders are blocked at warning; reduce/critical actions use the shared kill-switch semantics.
- Reproduce the live DD Governor’s realized-closed-event TWR semantics and deployment reset, not an assumed mark-to-market drawdown implementation. Any equity-curve MTM drawdown is reported separately.
- Carry fees, funding, slippage, partial fills, minimum order sizes, and leverage on every applicable entry/exit. Use actual Aster fee configuration for Aster executions. Use historical funding data from Aster when present and the selected proxy source only in the proxy scenario when Aster funding is missing.
- Preserve actual source behavior for market, stop, take-profit, trailing, maker, and reduce-only order types. Where H1 OHLC cannot determine whether stop or target was first, use the adverse ordering and flag the ambiguous bar.

## 6. Data coverage and comparison scenarios

### Primary data

- Aster H1 candles, Aster instrument history, and Aster funding/mark history are primary for strategy signals and position reference values.
- Aster historical L2 coverage in the identified public archive begins 2025-09-29. Instrument-level and hour-level files must be validated individually; a dataset-wide date range is not evidence that every symbol-hour is complete.
- V52 reference data: use the active live reference-feed equivalent (Alpaca IEX historical quotes previously verified for the sample query) and record quote age, session, and source timestamp. FRED DEXJPUS supplies JPY conversion.

### Alternative-venue proxy

- For periods or symbol-hours without valid Aster L2, inspect official historical order-book archives from Binance, OKX, or Bybit. Prefer direct official exchange files/API where accessible; do not create an account or purchase data as part of this task.
- Validate venue symbol identity, contract type, listing time, UTC timestamps, sequence continuity, snapshot availability, units, missing hours, and contemporaneous price basis before using a file.
- Use only same-underlying crypto perpetuals for crypto routes. Map OKX instrument IDs such as BTC-USDT-SWAP explicitly; never infer a symbol match from its base-asset name alone.
- Apply the other venue’s contemporaneous relative spread, depth-impact and position-adverse funding as a proxy around the Aster signal/reference price. Do not replace Aster OHLC or signal features with other-venue candles. A proxy result is modeled research, not an Aster fill observation.
- For V52, the first-50-day period has no verified same-stock perpetual order books on an alternative venue. Under the user-approved rule, omit V52 orders in that interval in both comparisons. Stock-share quotes may inform the reference value but cannot stand in for an Aster stock-perpetual order book.
- L2 does not contain individual order queue position. Post-only fills require a conservative, explicitly logged trade-through/fill rule; a merely resting limit order is not assumed filled. If the order’s fill cannot be established within live TTL and available trade/book data, record no fill.

### NORMAL and SEVERE

- NORMAL: where Aster L2 exists and passes validation, use Aster L2 and Aster funding. Where Aster data is missing, use the median execution-cost and position-adverse funding estimate across valid same-time alternative venues.
- SEVERE: use the least favorable valid execution-cost observation and most adverse position-side funding among Aster and available same-time alternatives. If only one venue is valid, use that observation and record that no cross-venue stress comparison was available.
- Fees and strategy/risk thresholds remain the audited Production values in both scenarios. SEVERE changes only market-data-derived execution cost/funding inputs; it does not create an unreviewed live setting.

### Requested 50-day comparison

Report two full-run paths for NORMAL and SEVERE:

1. PROXY_APPLIED: trade eligible crypto events during the initial Aster-L2 gap using validated alternate-venue L2/funding; use Aster execution data from 2025-09-29 onward. Skip only specific proxy events whose files are missing, stale, or discontinuous. V52 is skipped during the initial gap.
2. ASTER_DATA_ONLY: skip all entries requiring missing Aster L2/funding during the initial gap; continue with validated Aster data from 2025-09-29 onward. V52 is skipped during the initial gap.

Show total portfolio impact, initial-gap trade count/P&L, instrument and route impact, changes to later compounded sizing, skipped opportunities, proxy-data coverage, and results by month. Do not treat omitted periods as zero-return evidence. Label PROXY_APPLIED as PROXY_RESEARCH and ASTER_DATA_ONLY as VERIFIED_COVERAGE_ONLY; neither result is a statement that LIVE should be enabled.

## 7. Market-data controls

Every input record carries source, exchange, symbol/instrument ID, event timestamp, receive timestamp when available, UTC-normalized timestamp, interval, and content hash. Acquisition manifests record URL/API route, request time, requested and actual date range, first/last record, row count, sequence gaps, duplicate count, missing hours, and SHA256.

Automated checks must detect:

- missing, duplicate, out-of-order, stale, malformed, or time-zone-misaligned bars, quotes, trades, funding, or book updates;
- incomplete L2 snapshots or non-contiguous updates;
- instrument listing/delisting mismatches and inconsistent contract units;
- look-ahead in features, order fills, walk-forward training, funding timestamps, stock calendars, or monthly deposits;
- invalid bar ordering where stop and target can both trigger;
- a strategy trade without a complete entry-to-exit ledger or without its required source records.

Any failed check marks the affected symbol/time/run as not verified. It cannot contribute an unqualified successful trade or favorable P&L. Proxy and Aster observations remain distinguishable at every log/ledger row.

## 8. Required artifacts

- Re-runnable backtest engine and data-acquisition/validation commands.
- Secret-free source/runtime/config manifest and data-source coverage report.
- Full decision/gate log for every strategy decision time and instrument, including gate result, reason, data provenance and scenario.
- Full order and trade ledger with entry, partial exit, stop, TP, trailing, funding, fees, slippage, margin, sizing, execution source and final exit.
- Monthly, instrument, strategy and consolidated P&L, profit factor, win rate, max drawdown, contribution-adjusted return, equity and margin history for NORMAL/SEVERE and both 50-day coverage paths.
- V12 variant comparisons after the unchanged baseline is complete.
- Automated tests for decision parity, portfolio competition, order lifecycle, missing-data handling, time alignment, no-lookahead, stock calendars, determinism and output completeness.
- Markdown methodology and comparison report with source links, limitations, run IDs, data hashes and explicit status labels.

## 9. Repository and data-licensing gate

The target GitHub repository was confirmed public. The public CryptoHFTData archive’s standard license and OKX’s published historical-data/API terms prohibit publishing or redistributing market data without prior written permission. Therefore:

- Do not commit raw L2, trades, quotes, funding rows, or full data-bearing gate logs/ledgers to the public repository unless a source grants redistribution rights.
- Complete and retain the full data-dependent research outputs in the local workspace under the applicable personal/internal-research terms.
- Before pushing any data-bearing report, gate log, ledger, or exact market-derived results, verify written publication rights or obtain user direction to an authorized private/internal destination. Do not change the existing GitHub repository visibility without a separate explicit request.
- Engine, tests, source code, schemas, source links, and non-data-bearing manifests may be prepared independently, subject to ordinary repository review.

This is a delivery constraint, not a Production change. The requested public push of full source-derived logs and ledgers remains conditional on data publication rights.

## 10. Acceptance criteria

- Runtime SHA and strategy/risk configuration provenance are captured without secrets.
- Baseline decision outputs match audited live logic on deterministic fixtures.
- Shared capital, deposit, margin, gross, DD, priority, partial-exit and protection behavior is replayed by one engine.
- Every unavailable or invalid source point is visible and cannot become an unqualified successful result.
- NORMAL/SEVERE and PROXY_APPLIED/ASTER_DATA_ONLY comparisons include all requested metrics and the initial 50-day impact.
- V12 variants run only after baseline acceptance and include profitable-trade displacement analysis with HC1.75 fixed.
- Tests prove data-integrity checks and deterministic replay; final outputs include exact commands and hashes.
- No VPS, Production, live order, or live strategy condition is modified.

## 2026-09-27 user-directed V52 modeled-price amendment

The user requested that V52 use Yahoo Finance stock price data instead of
historical order books, assuming an immediate fill whenever its actual
strategy entry gates pass. This **adds** a labeled price-only modeled research
path; it does not retrospectively prove that an Aster stock-perpetual order
would have filled. The model uses the last *completed* Yahoo 60m candle as
of each audited LIVE V52 decision timestamp, requires the matching runtime
source manifest, and refuses stale or future bars, closed NYSE sessions,
missing historical data, and unverified decisions. Retain the pre-existing
initial-50-day V52 omission. Publish modeled counts separately from verified
fills and leave unresolved exit/fee/funding/P&L metrics null. Do not rewrite
old baseline result anchors to reflect modeled results.
