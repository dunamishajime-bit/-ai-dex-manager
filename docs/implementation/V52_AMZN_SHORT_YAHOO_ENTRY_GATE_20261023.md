# V52 AMZN SHORT Yahoo entry gate

This change is limited to new `V52 / AMZN / SHORT` admission.

## Contract

- Use the latest confirmed Yahoo 60-minute bar whose interval completed at or
  before the decision timestamp.
- Use the last confirmed bar from the immediately preceding NYSE full-session
  date as the reference close. The date is determined in
  `America/New_York`, including weekends, holidays, and DST transitions.
- Compute `(latest_confirmed / previous_session_close - 1) * 100`.
- Reject only when the result is strictly greater than `+1.0%`.
- An exact `+1.0%` result passes. The implementation uses a small floating-point
  epsilon only to preserve this exact boundary in binary arithmetic.
- Missing, stale, malformed, or unavailable Yahoo data returns
  `DATA_UNAVAILABLE` and rejects only a new AMZN SHORT candidate.

The gate never runs for AMZN LONG, the other V52 symbols, position management,
existing protective orders, or any other runner.

## Provenance

- Research branch: `research/v52-amzn-entry-reference-regime-20261022`
- Research SHA: `f777008e0d149f1f42ffb01cf0936d2d1b40d99c`
- Research result: one AMZN SHORT candidate was removed in the one-year
  price-model comparison; the research source is not a claim of venue-fill
  parity or a future return guarantee.

## Runtime observability

The V52 state stores `amznShortYahooGate` with the status, reason, prior NYSE
close, latest confirmed price, return percentage, decision timestamp, and bar
completion timestamp. The production UI renders this evidence read-only on the
V52 decision page.
