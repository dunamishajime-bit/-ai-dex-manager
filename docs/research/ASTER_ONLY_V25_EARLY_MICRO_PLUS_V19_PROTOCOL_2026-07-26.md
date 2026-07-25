# Aster-only V25 Early Micro Plus V19 Protocol

## Objective

Increase V19 fallback profit by adding a short 11:30 New York opportunity while preserving the frozen 12:30 V19 trade.

## Causal architecture

- Frozen V11-EQ remains first priority.
- When V11-EQ is not accepted, one 11:30 micro fallback may trade for at most one hour.
- At 12:30, after the micro position has exited, frozen V19 is evaluated normally.
- Maximum concurrent Stock positions: one.
- Maximum sequential fallback trades per day: two.
- Daily loss lock: -2% before the V19 decision.

## Candidate universe

The 42 candidates are predeclared V15 variants with:

- exact 11:30 entry policy;
- exactly one-hour maximum holding;
- seven economic families;
- three thresholds per family;
- previous-symbol cooldown on/off.

## Selection discipline

- Development screens all 42 candidates.
- At most 20 Development survivors proceed.
- Validation selects at most one candidate.
- Validation requires at least eight routed Normal trades and at least four accepted micro trades.
- Final reused and July diagnostics are evaluated only after selection.

## Strict improvement

A selected architecture must pass the strict annual, P95, PF, drawdown, trade-count, concentration, removal, Validation, final and July hurdles; improve annual Normal and P95 over the V19 baseline; produce positive micro Normal/P95; avoid worsening final results; and keep drawdown within one percentage point.

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11-EQ runtime, V13D, credentials, orders and positions remain unchanged.
