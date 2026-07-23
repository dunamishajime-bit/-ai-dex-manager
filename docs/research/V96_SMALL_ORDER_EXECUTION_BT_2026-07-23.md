# V96 Small-order Execution Backtest — 2026-07-23

## Decision

**KEEP_CURRENT_5_USD_OR_1PCT_TOLERANCE**

The proposed same-direction accumulation does not create a new valid execution rule. A correctly netted residual is already represented by:

```text
target notional - current notional
```

Therefore `NET_RESIDUAL_MAX_5_OR_1PCT` produced exactly the same return, drawdown, order count and tracking error as the current rule in every tested account size and both cost scenarios.

Repeatedly adding the same unchanged 0.8 USD difference each runner tick is invalid because it double counts the same desired position difference and would eventually overshoot the target.

## Fixed test

- Frozen V95/V96 non-PENGU Core: BTC / ETH / BNB / SOL
- Historical window: 2023-01-01 through 2026-07-01 UTC
- Starting equity: 50 / 100 / 250 / 500 / 1,000 USD
- Current execution tolerance: `max(5 USD, 1% equity)`
- Candidates: correct net residual at 5 USD, 3 USD, 2 USD, and fixed 5 USD without the percentage tolerance
- Normal: 10 bps turnover cost
- Severe: one completed 12-hour bar delay, 50 bps turnover cost and 3 bps adverse cost per active bucket
- Historical Aster candles and Funding
- Production / LIVE / VPS / orders changed: NO

## Main results

| Start equity | Candidate | Normal delta vs current | Severe delta vs current | Normal orders | Severe orders | Decision |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| 50 USD | 3 USD threshold | +1.5425 pp | -2.8869 pp | 778 → 858 | 633 → 768 | Reject: Severe deterioration |
| 50 USD | 2 USD threshold | -0.5018 pp | -2.9937 pp | 778 → 974 | 633 → 832 | Reject |
| 100 USD | 3 USD threshold | +1.1497 pp | -1.6788 pp | 912 → 1,015 | 793 → 881 | Reject: Severe deterioration |
| 100 USD | 2 USD threshold | +1.2393 pp | +0.3502 pp | 912 → 1,037 | 793 → 961 | Isolated historical lead only |
| 250 USD | 3 USD threshold | +0.2805 pp | -0.7119 pp | 1,037 → 1,045 | 961 → 1,061 | Reject: no robust gain |
| 250 USD | 2 USD threshold | +0.2805 pp | -0.7245 pp | 1,037 → 1,045 | 961 → 1,081 | Reject |
| 500–1,000 USD | 3 / 2 USD threshold | 0.0000 pp | approximately 0.0000 pp | unchanged | unchanged | 1% tolerance dominates |

The 100 USD / 2 USD result is not accepted because the improvement does not persist in the neighboring 50 USD and 250 USD account sizes. It also requires the exchange contract filters to permit orders below 5 USD.

Removing the 1% equity tolerance while retaining fixed 5 USD increased order count substantially and generally reduced Normal return. It is not supported.

## Interpretation of the observed ETH 0.8 USD no-change

The live observation was not a missing V96 signal:

- ETH Long target existed.
- The current position was already close to the target.
- The remaining adjustment was approximately 0.8 USD.
- The adjustment was correctly suppressed below the 5 USD tolerance.

The backtest does not support manufacturing an order from repeated copies of that same 0.8 USD gap. The existing runner will naturally submit an order if the **net current target gap** later reaches the valid tolerance.

## Execution-model warning

This account-level execution replay produced materially weaker Severe results than the existing aggregate V96 historical report. The reason is that the account-level replay charges repeated target-tracking rebalances and models actual threshold suppression, while the aggregate research series represents target weights more abstractly.

Accordingly:

- this result is valid for comparing the small-order policies against one another;
- its absolute Severe return must not be presented as a replacement for the full V96 portfolio result without a separate parity audit;
- the result strengthens the warning that more frequent small orders are fragile under high costs.

## Final conclusion

Keep:

```text
minimum adjustment = max(5 USD, 1% account equity)
```

Do not add a cumulative 0.8 USD counter. Do not lower the threshold globally based on this history. The correct improvement is clearer display of `SIGNAL_PRESENT / ORDER_DELTA_BELOW_TOLERANCE`, not forcing additional orders.

Status: **NO_ROBUST_EXECUTION_IMPROVEMENT**
