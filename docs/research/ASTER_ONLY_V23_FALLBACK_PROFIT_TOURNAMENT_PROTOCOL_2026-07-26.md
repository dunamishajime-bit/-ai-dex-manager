# Aster-only V23 Dedicated Fallback Profit Tournament Protocol

## Objective

Increase the profit contribution of the V19 fallback without weakening the frozen V11-EQ primary, adding Hyperliquid collateral, increasing Gross above 1.0, or using final/July results to select the winner.

## Frozen architecture

- Venue: AsterDEX only.
- Primary: frozen V11-EQ evaluated first at 10:30 New York.
- Fallback: evaluated only when V11-EQ is not accepted.
- Maximum one Stock position per day.
- Maximum Gross: 1.0.
- Maximum fallback holding time: two hours.
- Normal/P95/Severe cost assumptions remain frozen.
- Cost above 60 bps or projected Net Edge below 10 bps fails closed.

## Candidate universe

The tournament reuses the 336 predeclared V15 candidates:

- seven economic families;
- three fixed thresholds per family;
- four causal entry policies: first eligible, 11:30, 12:30 or 13:30 New York;
- one- or two-hour maximum holding;
- previous-symbol cooldown on/off.

No threshold is added after observing Validation, final or July results.

## Selection

1. Development screens all 336 candidates.
2. At most 40 Development survivors proceed.
3. Validation selects at most one candidate.
4. The winner must produce at least eight total routed Validation trades and at least four accepted fallback Validation trades.
5. Final reused and July diagnostics are evaluated only after selection.

## Strict improvement requirement

A candidate is classified as a strict improvement only if it:

- passes every existing V22 strict hurdle;
- improves exact-year Normal return over the frozen V19 router;
- improves exact-year P95 return;
- improves the fallback component under Normal and P95;
- keeps drawdown within one percentage point of the V19-router baseline;
- keeps PF at least 1.50;
- keeps positive-profit symbol concentration at most 40%.

## Interpretation

This history overlaps previous V15/V19 research. Even a passing result is only a Forward-Shadow lead. Production promotion requires untouched no-order Pyth/IEX/Aster evidence.

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11-EQ runtime, V13D, credentials, orders and positions must remain unchanged.
