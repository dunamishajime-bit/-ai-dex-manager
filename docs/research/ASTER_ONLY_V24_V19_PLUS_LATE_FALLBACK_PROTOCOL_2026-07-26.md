# Aster-only V24 V19 Plus Late Fallback Protocol

## Objective

Increase the V19 fallback contribution without replacing or weakening the existing V19 signal.

## Causal route priority

1. Frozen V11-EQ at 10:30 New York.
2. Frozen V19 at 12:30 New York when V11-EQ is not accepted.
3. One 13:30 secondary fallback only when both V11-EQ and V19 are absent or fail the cost/edge gate.

This preserves all accepted V19 trades. The secondary engine can only add trades on otherwise unused days.

## Frozen constraints

- AsterDEX only.
- Hyperliquid not used.
- Gross maximum 1.0.
- Maximum one Stock position per day.
- Secondary holding maximum two hours.
- Cost above 60 bps or projected Net Edge below 10 bps fails closed.
- Existing V11-EQ and V19 parameters are unchanged.

## Candidate universe

The secondary universe contains the 84 predeclared V15 candidates whose entry policy is exactly 13:30 New York:

- seven economic families;
- three thresholds per family;
- one- or two-hour maximum holding;
- previous-symbol cooldown on/off.

## Selection discipline

- Development screens all 84 candidates.
- At most 30 candidates proceed to Validation.
- Validation selects at most one candidate.
- Validation requires at least eight routed Normal trades and at least three selected secondary trades.
- Final reused and July diagnostics are not used for selection.

## Strict improvement

A selected architecture must pass all V22 strict hurdles, improve full-year Normal and P95 over the V19 baseline router, produce positive secondary Normal/P95 returns, avoid worsening final reused results, keep drawdown within one percentage point, keep PF at least 1.50 and keep positive-profit concentration at most 40%.

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11-EQ runtime, V13D, credentials, orders and positions remain unchanged.
