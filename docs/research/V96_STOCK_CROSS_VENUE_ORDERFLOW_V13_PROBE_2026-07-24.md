# V96 Stock Cross-Venue Maker Hedge V13 Public Probe — 2026-07-24

## Decision

**V13_FORWARD_DATA_REQUIRED**

The final short public-data probe validates endpoint availability, five-symbol normalization, regular-session entry gating, safety isolation, deterministic complete-cycle accounting and Artifact creation. It does not validate profitability.

V12/V12B remains rejected. No threshold from the reused 73-session sample was retuned.

## Final CI evidence

- Pull request: #78
- Workflow: `V96 Stock Cross-Venue Maker Hedge V13`
- Run: `30068278300`
- Head commit: `f1b2820705d5cef815a4b160feb124af1230d746`
- Conclusion: `success`
- Probe duration: 75 seconds
- Result generated: 2026-07-24 05:02:17 UTC
- Artifact ID: `8587034678`
- Artifact digest: `sha256:6ec8f6636ec3ab4c0a9560ffe29e0393789503e8d9ac771782c27a978025ccfc`

All CI stages passed:

- syntax checks for the collector, base engine and cycle engine;
- deterministic execution self-test;
- public two-venue SHADOW probe;
- endpoint and safety assertions;
- Artifact upload.

## Venue and symbol coverage

| Symbol | Aster book | XYZ book |
| --- | --- | --- |
| AMZN | YES | YES |
| META | YES | YES |
| MSFT | YES | YES |
| NVDA | YES | YES |
| TSLA | YES | YES |

Observed public records:

- Aster book updates: 126
- XYZ book updates: 80
- Aster aggregate trades: 0
- XYZ public trades: 213
- collector errors: 0
- total normalized book rows: 206
- total normalized trade rows: 213

Per-symbol book rows:

| Venue | AMZN | META | MSFT | NVDA | TSLA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Aster | 1 | 40 | 44 | 9 | 32 |
| XYZ | 16 | 16 | 16 | 16 | 16 |

The probe occurred outside the New York weekday 09:30–16:00 entry window. Data collection remained active, but the frozen session gate correctly prevented strategy entries.

## Final virtual execution result

- virtual quotes opened: 0
- opening Maker fills: 0
- pending delayed hedges: 0
- completed hedged inventory cycles: 0
- forced-Taker cycles: 0
- open inventory at result: 0
- partial-fill safety failures: 0
- unhedged hedge failures: 0
- unresolved inventory: 0
- unresolved close attempts: 0
- cancellations: 0

This is the expected endpoint-probe result. No off-session spread observation can become a trade or PnL record.

## Corrections made before the final probe

The final V13 engine is materially stricter than the initial endpoint prototype:

1. **Complete-cycle PnL only** — an opening Maker fill plus hedge creates inventory; it is not profit.
2. **Correct executable bid/ask** — Maker BUY uses bid, Maker SELL uses ask, Taker BUY uses ask and Taker SELL uses bid.
3. **Regular-session gate** — opening quotes are blocked outside the New York weekday 09:30–16:00 window.
4. **Displayed queue consumption** — price touch alone never creates a fill.
5. **Partial-fill safety failure** — a post-queue fill smaller than the remaining virtual quote cannot be ignored.
6. **Frozen 250 ms hedge delay** — a full Maker fill must survive a delayed fresh-book and exact-depth hedge check.
7. **No probe-end delay bypass** — a fill occurring less than 250 ms before the probe ends becomes an execution-safety failure.
8. **Forced inventory close** — inventory is flattened at 60 seconds or probe end only when both books are fresh and deep enough.
9. **Concentration reporting** — net contribution is reported by symbol under every cost scenario.
10. **Hard safety gate** — any partial fill, unhedged hedge failure or unresolved ending inventory prevents a positive status.

The earlier off-session TSLA observations are not valid V13 candidates after the regular-session gate and corrected Taker pricing. They are retained only as endpoint-history evidence and are not used as strategy evidence.

## Deterministic self-test evidence

The self-test verifies that:

- queue-ahead volume is consumed before virtual fill volume;
- Taker SELL uses the hedge bid;
- Taker BUY uses the hedge ask;
- the full Maker fill first enters `PENDING_HEDGE`;
- no inventory exists before the frozen 250 ms delay passes;
- the delayed opening hedge creates inventory but no realized cycle PnL;
- the opposite Maker close also enters delayed hedge state;
- only the delayed closing hedge completes the cycle and creates PnL;
- no partial-fill, unhedged or unresolved condition exists in the successful deterministic path.

## Cost scenarios

No completed cycle occurred, so realized net PnL is intentionally null under every scenario:

| Scenario | Two-Maker cost | Forced-close cost | Completed cycles | Average net |
| --- | ---: | ---: | ---: | --- |
| Forward median | 6 bps | 10 bps | 0 | N/A |
| Normal | 10 bps | 16 bps | 0 | N/A |
| P95 | 17 bps | 26 bps | 0 | N/A |
| Severe | 30 bps | 45 bps | 0 | N/A |

Observed event latency:

- p50: 59 ms
- p95: 379 ms
- frozen SHADOW hedge delay: 250 ms

Latency diagnostics are transport observations, not expected returns.

## Correct interpretation

- five-symbol public two-venue book collection works;
- XYZ public trade collection works;
- Aster books were available but no Aster aggregate trade occurred in this off-session window;
- regular-session zero-entry gating works;
- the conservative execution and complete-cycle accounting path passes deterministic tests;
- no positive or negative profitability conclusion is allowed;
- the next valid evidence is an untouched U.S.-session Forward collection, not another historical threshold search.

## Frozen review gate

- at least 20 completed U.S. regular sessions;
- at least 100 completed hedged inventory cycles;
- positive average net result in Normal, P95 and Severe including forced closes;
- Normal positive-net completed-cycle rate at least 55%;
- no symbol contributes more than 40% of positive net profit;
- zero partial-fill safety failures;
- zero unhedged hedge failures;
- zero unresolved inventory at review end;
- no threshold, delay, cost or symbol-specific retuning on the collected Forward window.

Passing would authorize only a longer Paper/Shadow review, not Production or LIVE.

## Safety

- mode: `SHADOW_RESEARCH_ONLY`
- order submission: disabled
- Production changed: NO
- LIVE changed: NO
- VPS changed: NO
- Crypto V96 changed: NO
- V11 changed: NO
- V12/V12B status changed: NO
- real positions changed: NO
