# V12 Top2 Residual GROSS contract

This change keeps the V12 signal, indicator, and exit logic frozen and changes
only the portfolio sleeve's entry allocation.

| Limit | Value |
| --- | ---: |
| V12 aggregate entry GROSS | 1.50 |
| V12 per-position entry GROSS | 1.00 |
| V12 maximum positions | 2 |
| PENGU V2 maximum GROSS | 0.75 |
| V12 + PENGU shared crypto GROSS | 1.50 |
| V52 stock GROSS | 1.50 |
| Total portfolio GROSS | 2.50 |

Rank 1 is submitted first using the existing risk-linked sizing. Rank 2 is
eligible only when a second signal exists and the fresh account snapshot has
capacity. The accepted rank-2 GROSS is clipped by:

```text
min(requestedRiskLinkedGross, 1.00, 1.50-currentV12Gross,
    1.50-currentCryptoGross, 2.50-currentTotalGross)
```

The planner never preempts PENGU or V52, and it never force-closes an existing
position because mark-to-market GROSS drift moved above the entry cap. All
entry work remains behind the existing account lock, reservation, durable
pending-order, reconciliation, resident-protection, shared-risk, and
fail-closed gates.

This is an implementation/CI/backtest change only. It does not activate LIVE
orders or modify the VPS.
