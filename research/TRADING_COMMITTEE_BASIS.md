# Trading Committee Decision: Executable Cross-Venue Basis

## Mandate

Maximize realizable profit, not backtest headline return. A strategy is rejected when its profit depends on stale last-trade prices, unavailable depth, unrealistic fills, one asset, or one short regime.

## Committee roles

### Alpha research
Proposed five families: last-price latency arbitrage, mark-premium convergence, funding carry, liquidation continuation, and liquidation exhaustion reversal.

### Data audit
Rejected historical last-price latency arbitrage after the PENGU finding. Historical Aster depth, liquidation and complete OI archives are not available for a trustworthy long-horizon replay. Mark-price and settled funding histories are suitable for a slower market-neutral screen.

### Execution
Required two-venue gross exposure of 1.0, next-bar execution, non-zero Aster and Binance trades, point-in-time liquidity thresholds, two-venue fees/slippage, and separate 10/15 bps stress cases. PENGU receives a stricter liquidity gate.

### Risk
Required market-neutral legs, non-overlapping positions, hard maximum holding time, spread stop, no leverage rescue of negative alpha, and reporting of profit concentration by symbol and month.

### Statistics
Required three chronological blocks: development, validation, and untouched final holdout. Parameters may be selected only from development and validation. Nearby variants and cost sensitivity must remain positive.

### CIO decision
Historical research will test three executable families:

1. **Mark-premium convergence** — Aster mark price relative to Binance mark/contract price reverts.
2. **Carry-confirmed convergence** — enter only when the funding differential pays the intended convergence position.
3. **Premium-turn confirmation** — require the premium to begin moving back toward fair value before entry.
4. **Funding carry with premium control** — collect relative funding only when the mark premium is not strongly adverse.

Liquidation/OI continuation and reversal remain forward-only hypotheses until timestamped live depth, OI and liquidation data are recorded.

## Approval gates

A production candidate must satisfy all of the following:

- positive development, validation and final holdout returns;
- final unlevered annualized return at least 25%;
- operationally scaled annualized return at least 40%;
- maximum drawdown no worse than -25%;
- Sharpe at least 1.2;
- positive after 10 bps per side per venue stress;
- at least 60% of nearby variants positive in validation and holdout;
- no single symbol or month contributes more than 35% of total profit;
- enough trades to distinguish skill from a handful of events.

Failure means research rejection, not parameter relaxation.