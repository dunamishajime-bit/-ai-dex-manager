# V96 Stock Cross-Venue Maker Hedge V13 Public Probe — 2026-07-24

## Decision

**V13_FORWARD_DATA_REQUIRED**

The short public-data probe validates endpoint availability, normalization, safety isolation and the conservative virtual execution path. It does not validate profitability.

V12/V12B remains rejected. No threshold from the reused 73-session sample was retuned.

## CI evidence

- Pull request: #78
- Workflow: `V96 Stock Cross-Venue Maker Hedge V13`
- Run: `30066546397`
- Head commit: `1dcc83a0ca01091fcefc9655688dda79b67c6c55`
- Conclusion: `success`
- Probe duration: 75 seconds
- Generated at: 2026-07-24 04:22:02 UTC
- Collector errors: 0 observed in the event Artifact

## Venue and symbol coverage

| Symbol | Aster book | XYZ book |
| --- | --- | --- |
| AMZN | YES | YES |
| META | YES | YES |
| MSFT | YES | YES |
| NVDA | YES | YES |
| TSLA | YES | YES |

Observed public events:

- Aster book updates: 123
- XYZ book updates: 80
- Aster aggregate trades: 0
- XYZ public trades: 206
- normalized opportunity rows: 252

The probe occurred outside the U.S. regular stock session. Aster books updated, but no Aster aggregate trade was observed during the short window.

## Conservative virtual execution

- virtual quotes opened: 4
- conservative fills: 0
- fill rate: 0%
- unhedged rejections: 0
- maker-top-moved cancellations: 2
- TTL cancellations: 1
- stale/invalid-book cancellations: 1

The four eligible observations were Aster Maker Sell / XYZ Taker Buy hedge candidates on TSLA. Their predeclared Normal net edge at quote creation was approximately +3.72 to +6.53 bps. No candidate was counted as a fill because no qualifying Aster aggressive Buy trade consumed the displayed queue ahead and the full 100 USDT virtual order.

This is the intended difference from a price-touch backtest: an apparent executable spread is not PnL unless conservative queue consumption and the hedge both complete.

## Diagnostics

- event-latency p50: 84 ms
- event-latency p95: 404 ms
- observed Normal net-edge distribution p50: approximately -10.00 bps
- observed Normal net-edge distribution p95: approximately +18.29 bps

These opportunity-distribution figures include non-eligible directions and are not expected returns.

## Cost scenarios

No fill occurred, so average net PnL is intentionally null under every scenario:

| Scenario | Frozen cost | Fills | Average net |
| --- | ---: | ---: | --- |
| Forward median | 6 bps | 0 | N/A |
| Normal | 10 bps | 0 | N/A |
| P95 | 17 bps | 0 | N/A |
| Severe | 30 bps | 0 | N/A |

## Correct interpretation

- public two-venue book collection works for all five symbols;
- XYZ public trade collection works;
- the deterministic queue-consumption test works;
- a short off-session probe cannot validate Aster-side fill probability;
- no positive or negative profitability conclusion is allowed;
- the next valid evidence is a frozen U.S.-session Forward collection, not another historical threshold search.

## Frozen review gate

- at least 20 completed U.S. regular sessions;
- at least 100 conservative virtual fills;
- positive average net result in Normal, P95 and Severe;
- positive-net fill rate at least 55%;
- no symbol contributes more than 40% of net profit;
- endpoint freshness, hedge-depth and unhedged-rejection diagnostics remain acceptable;
- no retuning on the collected Forward window.

Passing would authorize only a longer Paper/Shadow review, not Production or LIVE.

## Safety

- mode: `SHADOW_RESEARCH_ONLY`
- order submission: disabled
- Production changed: NO
- LIVE changed: NO
- VPS changed: NO
- Crypto V96 changed: NO
- V11 changed: NO
- real positions changed: NO
