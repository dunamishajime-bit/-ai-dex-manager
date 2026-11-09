# DisDex Backtest Validation Protocol

Status: permanent research procedure
Effective date: 2026-11-10
Scope: all future DisDex backtests, re-runs, logic revisions, and direction-correction research unless explicitly superseded by a newer documented protocol.

## Mandatory start-of-BT check

Before starting or restarting a DisDex backtest, read this file and confirm that the current run follows the mandatory validation path below. Do not rely on conversational memory alone.

## Mandatory validation path

1. Reproduce the current/pinned implementation faithfully.
   - Identify the exact source/commit/pin used.
   - Record the tested period, end-exclusive boundary, initial capital, gross/leverage assumptions, fees, funding, and any omitted unavailable data.
   - Do not silently substitute a simplified strategy for the current implementation.

2. Run the real-data backtest.
   - Preserve entry signal, virtual fill, exit, STOP, fees, funding, PnL, and route attribution where available.
   - Evaluate both the 10 bps and 30 bps cost models separately.
   - Report max drawdown, final equity, PF, win rate, trigger count, false-positive direction changes, and route-level PnL.

3. Perform synthetic-market validation.
   - Test exact threshold boundaries: just below, equal, and just above.
   - Test multi-condition gates with one condition deliberately failing.
   - Test bullish, bearish, range, high-volatility, low-volatility, crash/rebound, asset-only move, BTC-only move, and relative-strength divergence paths where relevant.
   - Include explicit misclassification scenarios: native LONG loses in an actually falling path; native SHORT loses in an actually rising path; and the reverse cases.
   - Where possible, generate synthetic raw price series and pass them through the same feature calculations used by the strategy, not only hand-entered feature values.
   - Synthetic tests validate logic behavior, not profitability.

4. Perform robustness validation.
   - No future information or leakage.
   - Threshold sensitivity / jitter around every candidate cutoff.
   - Time-ordered walk-forward / unseen validation.
   - Regime splits.
   - Explicit count of originally correct trades damaged by the correction rule.
   - Small samples cannot be called solved solely because observed precision is 100%.

5. Use the Data validation workflow as an independent second pass.
   - Recheck methodology, sample size, leakage risk, independent calculations, boundary handling, and conclusion support.
   - Do not treat the same helper/output as independent proof.
   - Any material contradiction returns the candidate to unresolved or rejected status.

6. Cross-check external market data when it can materially resolve uncertainty.
   - Use Binance public market data where appropriate for crypto price/candle/trade comparison.
   - Record source and timestamps.
   - Do not overwrite the canonical dataset merely because an external source differs; investigate the reason for the difference.

7. Run the integrated portfolio backtest before accepting a rule.
   - A route-level improvement is insufficient.
   - Re-run the whole portfolio with both 10 bps and 30 bps.
   - Reject or downgrade a candidate that improves a route but worsens integrated portfolio risk materially.

8. Classify every researched route.
   Every route must end in exactly one of:
   - ACCEPTED_CAUSAL_CANDIDATE
   - REJECTED
   - UNRESOLVED_DATA_OR_SEPARATION

   Unresolved must state exactly what evidence is missing.

9. Preserve reproducibility evidence.
   - Save scripts, compact result files, assumptions, source/pin references, and SHA256 hashes.
   - Commit and push meaningful checkpoints to a dedicated research branch.
   - Keep research-only changes separate from production/runtime code.
   - Do not claim a result is production-adopted unless a later production change explicitly implements it.

## V4 / PENGU priority rule

Current priority is V4 first, then PENGU, before moving to later strategy families.

For the current direction-correction work:
- V4 unresolved routes must be exhausted or explicitly classified first.
- PENGU LONG V64, Recovery V8, and SHORT V20 must be evaluated separately for entry direction and delayed rescue/re-evaluation behavior.
- Do not move to Q102 or another family merely because one V4/PENGU candidate looks promising.

## Completion rule

A backtest is not considered complete until:
- implementation parity is documented,
- real-data BT is complete,
- synthetic-market behavior is tested,
- robustness checks are complete,
- Data independent validation has been performed,
- external market data has been checked where materially useful,
- integrated 10bps/30bps results are recomputed,
- every route is classified,
- reproducibility artifacts are committed and pushed.

If any required step cannot be performed, the run must state the blocker and remain incomplete rather than silently skipping the step.
