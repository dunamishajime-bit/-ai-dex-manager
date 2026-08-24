# PENGU V20 — Recent 1Y DCA/Compound Backtest

Status: PRE-REGISTERED BEFORE THIS REPORTING RUN

RESEARCH ONLY. This reporting run does not modify the frozen V20 strategy. It evaluates the already-passed candidate `COUNTERWIND_VOL_TARGET_FAILURE_EXIT` over a recent one-year window with a money-weighted contribution overlay.

## Frozen strategy

- Candidate: `COUNTERWIND_VOL_TARGET_FAILURE_EXIT`
- V20 pre-registration SHA: `ad7cedb3cafaf9f9680e390112f72375d84b50ac`
- Known-venue formal run: `32683827489`
- KuCoin final holdout run: `32685838116`
- No threshold, feature, sizing, fee, funding, state-machine, entry, or exit changes are allowed.

## Reporting window

- Warmup start: `2025-07-01T00:00:00Z` (excluded from reported performance; supplies sufficient H1 history and pre-evaluation state)
- Evaluation start: `2025-08-24T00:00:00Z`
- Evaluation end: `2026-08-24T00:00:00Z` (exclusive)

## Capital plan

- Initial capital at evaluation start: JPY 10,000
- Contribution: JPY 10,000 at 00:00 UTC on the first day of each subsequent calendar month while inside the evaluation window
- Scheduled contributions: 2025-09-01 through 2026-08-01 inclusive (12 contributions)
- Total contributed capital: JPY 130,000
- Profits/losses are compounded.
- A contribution made while a position is already open is not retroactively exposed to that open trade. It becomes available for subsequent position sizing after the current trade exits.

## Venues

Run the identical frozen V20 state machine on OKX, Binance, Bitget, and KuCoin public historical futures data where complete data are available. Each venue is an independent JPY 10,000-account comparison; venue balances must not be summed and represented as one portfolio.

## Output

For NORMAL and STRESS preserve frozen strategy metrics and additionally report the DCA/compound account path:

- trades / wins / win rate
- strategy return / profit factor / max drawdown
- initial capital
- monthly contribution
- number and total of contributions
- final balance
- net profit versus contributed capital
- profit percentage versus contributed capital
- account-balance drawdown
- monthly ending balances

No synthetic candles, forward fill, interpolation, or substitute venue data. Missing required official data => BLOCKED for that venue.

Safety: `RESEARCH_ONLY`; `ordersSent=false`; `liveChanged=false`; `vpsChanged=false`; `productionChanged=false`.
