# Aster-only V21 Broad Universe Strict Protocol

## Purpose

Test whether the raised +50% Normal / +30% P95 hurdle can be reached by increasing the number of economically distinct Aster stock-perpetual opportunities rather than by leverage, cheaper cost assumptions or retuning the failed five-symbol thresholds.

## Fixed universe before results

The requested large-cap underlying universe is:

ADBE, AMD, AMAT, AMZN, ARM, ASML, AVGO, CRM, GOOGL, INTC, META, MRVL, MSFT, MU, NVDA, ORCL, PLTR, QCOM, TSM and TSLA.

A symbol is eligible only when:

- its Yahoo cash ticker and Aster perpetual both provide aligned intraday history;
- it has at least 120 aligned sessions inside the exact one-year period;
- no performance statistic is used to include or exclude it.

At least eight eligible symbols must be available on a day for the day to be evaluated.

## Fixed signal

The signal parameters are copied without retuning from the V18/V19 lead:

- prior 20-session same-time Basis distribution;
- absolute Z-score at least 2.0;
- absolute residual at least 35 bps;
- Aster rich to cash: short Aster;
- Aster cheap to cash: long Aster;
- select the largest absolute Z-score among available symbols;
- +0.75% take-profit;
- -1.00% stop-loss;
- otherwise two-hour exit;
- Gross 1.0 maximum;
- one position at a time;
- no Hyperliquid;
- no overnight position.

Only three predeclared scheduling architectures are compared:

1. 12:30 New York only;
2. chronological 11:30 and 12:30;
3. chronological 11:30, 12:30 and 13:30.

A later opportunity is considered only after any earlier position has exited. Future slots cannot be inspected retrospectively.

## Period and selection

- exact period: 2025-07-25 through 2026-07-24;
- July 2026 is excluded from candidate selection;
- pre-July data are divided chronologically into Development, Validation and final reused diagnostic;
- Validation selects at most one of the three architectures;
- no threshold, universe, holding time, stop or cost is changed after results.

## Costs and raised hurdles

The same V20 cost scenarios and strict hurdles apply:

- Normal round trip 40 bps and annual return at least +50%;
- P95 round trip 44 bps and annual return at least +30%;
- PF at least 1.50;
- maximum DD no worse than -15%;
- at least 50 Normal trades;
- chronological segments and July Holdout positive under Normal/P95;
- concentration, best-trade, best-month and Severe fail-closed checks.

## Limitations

The broad universe is fixed from currently known large-cap Aster underlyings, not from a survivorship-free historical listing archive. Yahoo 60-minute cash data and Aster 30-minute candles cannot reproduce Pyth ticks, exact spread, depth, queue or fills.

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11-EQ, credentials, orders and positions remain unchanged.
