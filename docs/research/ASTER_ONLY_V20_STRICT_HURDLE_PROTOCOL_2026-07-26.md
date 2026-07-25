# Aster-only V20 Strict Hurdle Tournament Protocol

## Purpose

Raise the acceptance standard for an AsterDEX-only V13D replacement. The prior V19 candidate earned +14.687018% Normal and therefore fails the new minimum-return hurdle before this tournament begins.

This run tests whether multiple causal intraday opportunities can increase return without leverage, Hyperliquid collateral or overlapping positions.

## Exact period

- Start inclusive: 2025-07-25 00:00 UTC
- End exclusive: 2026-07-25 00:00 UTC
- Calendar span: 365 days
- July 2026 sessions are excluded from candidate selection and used only as a short chronological Holdout
- Warm-up history is used only for the frozen 20-session same-time Basis distribution

## Fixed architecture

- AsterDEX only
- Universe: AMZNUSDT, METAUSDT, MSFTUSDT, NVDAUSDT and TSLAUSDT
- No Hyperliquid position
- Maximum concurrent Gross: 1.0
- Maximum one open Stock position at a time
- Entry observations: 11:30, 12:30 and 13:30 New York
- A later entry is allowed only after the earlier position has exited
- Maximum holding: one or two hours
- No overnight position
- Daily completed-trade loss lock: -2%
- V96 capital priority remains mandatory before any future Production consideration

This is not a leverage tournament. Candidate Gross remains 1.0.

## Candidate grid

Exactly 144 candidates are declared before results:

- four economic families:
  - same-time Basis Z-score fade;
  - same-time absolute Basis-residual fade;
  - one-hour intraday Basis-shock fade;
  - Basis-rejection fade;
- three thresholds per family;
- three chronological slot policies:
  - all 11:30 / 12:30 / 13:30 opportunities;
  - early 11:30 / 12:30 opportunities;
  - late 12:30 / 13:30 opportunities;
- one- or two-hour maximum holding;
- with or without previous-symbol cooldown.

Every slot is processed chronologically. The engine cannot inspect a later slot and retrospectively choose an earlier trade.

## Execution model

- +0.75% take-profit;
- -1.00% stop-loss;
- otherwise fixed one- or two-hour exit;
- actual historical Aster Funding included;
- observable cost gate rejects round trips above 60 bps;
- estimated edge after cost must remain at least 10 bps.

Cost scenarios:

- Forward median: 24 bps round trip
- Normal: 40 bps
- P95: 44 bps
- Severe: 100 bps and fail-closed no entry

## Chronological selection

- first 50% of pre-July sessions: Development;
- next 25%: Validation;
- final 25%: final reused-history diagnostic;
- Development retains at most 20 candidates;
- Validation selects at most one candidate;
- July Holdout is evaluated after selection;
- no threshold, slot, holding time, family, stop or concentration limit may be changed after results.

## Raised acceptance hurdles

A candidate passes only when every condition holds:

- exact-year Normal return at least +50%;
- exact-year P95 return at least +30%;
- Normal Profit Factor at least 1.50;
- Normal maximum drawdown no worse than -15%;
- at least 50 accepted Normal trades;
- Development, Validation and final chronological Normal/P95 positive;
- July Holdout has at least three accepted trades and positive Normal/P95;
- maximum single-symbol share of positive Normal profit at most 40%;
- best-trade-removed Normal/P95 positive;
- best-month-removed Normal/P95 positive;
- Severe remains non-negative through fail-closed behavior.

A pass remains Shadow-only. It does not authorize Production or LIVE orders.

## Limitations

- historical cash data are Yahoo 60-minute bars rather than Pyth ticks;
- Aster data are 30-minute candles and cannot reconstruct exact spread, depth, queue or fills;
- the economic families were previously inspected, although the sequential multi-opportunity architecture is new;
- the July Holdout is short;
- historical performance does not guarantee future profit.

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11-EQ, credentials, orders and positions remain unchanged.
