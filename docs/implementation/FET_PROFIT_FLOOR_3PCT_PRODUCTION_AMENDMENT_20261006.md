# FET +3% Profit Floor Production Amendment — 2026-10-06

Base Production: `ba38937cb2a22316b8fa2c6b11d3a07eebf7daca`

## Change

Only FET BRK48 LONG profit protection changes:

- Trigger remains **+5.0%**
- Fixed protected profit floor changes **+0.5% -> +3.0%**
- STOP never moves down
- No peak trailing is added

Unchanged: 72h return >= +2%, 24h post-exit cooldown, 24h max hold, -5% initial hard stop, volume >= 1.2x 72h median, Gross 1.0.

## Integrated 10bps backtest

- Final equity: **JPY 4,268,873,845.1163716**
- PF: **2.9637157881041185**
- Maximum MTM DD: **-12.96457052048714%**
- Closed trades: **1,358**
- FET: **8 trades / JPY 119,064,702.59208399 PnL**
- V12: **995 trades / 643 wins / 352 losses**
- Ownership conflicts: **0**
- Accounting: **PASS**

Previous +0.5% floor anchor: JPY 4,067,358,397.424793 / PF 2.960180377096512 / DD -12.96457052048714%.

The candidate lifecycle was regenerated with the existing causal H1 convention. The +3% floor does not protect an earlier low in the same H1 bar in which +5% is first observed; protection starts from the following hour.
