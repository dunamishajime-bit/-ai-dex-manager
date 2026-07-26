# Aster-only V36 V11 Outcome Overlay Protocol

## Goal

Preserve the proven V11-EQ plus V19 baseline exactly, then add at most one later Aster-only trade only after a successful or early V11-EQ exit.

## Frozen candidates

56 policies are declared before execution:

- overlay source: V19, Opening Range, Breadth, or best available;
- V11 outcome gate: net positive, gross +25 bps, non-stop exit, positive non-stop, exit within two hours, positive within two hours, or positive convergence;
- same-symbol reuse allowed or blocked.

## Routing

- V11-EQ always has priority.
- If V11-EQ is not accepted, the original V19 fallback is used unchanged.
- If V11-EQ is accepted, an overlay can enter only after its actual exit time and only when the frozen outcome gate passes.
- At most one overlay is added.
- Maximum concurrent Gross remains 1.0 and maximum concurrent positions remains one.
- Hyperliquid is not used.

## Acceptance

The V22/V29 hurdles remain unchanged: router Normal above +72.276908%, P95 above +68.080022%, fallback Normal above +7.813259%, fallback P95 above +7.400908%, sufficient Validation observations, positive Final reused and July Holdout, PF/DD/concentration controls, and best-trade/month-removal robustness.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
