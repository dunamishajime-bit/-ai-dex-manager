# V96 Stock Cross-Venue Order-Flow / Maker Hedge V13 Protocol — 2026-07-24

## Decision before data

**V13_FORWARD_DATA_REQUIRED**

V12/V12B rejected a static two-taker Aster/XYZ basis-convergence structure. V13 does not retune the 10–100 bps thresholds or reuse the same 73-session Holdout to select another nearby spread rule.

V13 changes the information and execution model:

- actual best bid/ask updates from Aster and XYZ;
- actual public trade prints and aggressor direction;
- a conservative displayed-queue model for a virtual Maker order;
- an immediate Taker hedge on the other venue only after a conservative virtual fill;
- adverse order-flow, stale-book, reference-move and quote-TTL cancellations.

No profitability claim is made until a fixed Forward window is complete.

## Frozen universe and venues

- Aster versus XYZ HIP-3 on Hyperliquid
- AMZN, META, MSFT, NVDA and TSLA
- one virtual quote per symbol at a time
- virtual notional: 100 USDT
- SHADOW research only
- real order submission absent and prohibited

## Frozen Maker-hedge rules

For every synchronized fresh two-venue book, V13 evaluates four executable directions:

1. Maker BUY on Aster, Taker SELL hedge on XYZ;
2. Maker SELL on Aster, Taker BUY hedge on XYZ;
3. Maker BUY on XYZ, Taker SELL hedge on Aster;
4. Maker SELL on XYZ, Taker BUY hedge on Aster.

A virtual quote is eligible only when all conditions hold:

- Normal expected net edge is at least 2 bps after the frozen 10 bps cost envelope;
- displayed queue ahead is at most 250 USDT;
- opposite-venue top-level hedge depth is at least 100 USDT;
- both books are no older than 1.5 seconds;
- two-second adverse trade imbalance is no greater than 0.65.

The best eligible direction is selected without a symbol-specific threshold.

## Conservative fill rule

A quote is not filled merely because price touched it.

- queue ahead starts as the displayed best-level quote notional;
- only opposite-side aggressive public trades at or through the quote consume the queue;
- the virtual order fills only after observed aggressive volume exceeds the full displayed queue ahead and then covers the 100 USDT virtual order;
- after fill, the other venue must still have a fresh book and at least 100 USDT at the hedge top level;
- otherwise the event is classified as an unhedged rejection, not a profitable trade.

This remains an approximation because hidden orders, cancellations ahead, latency priority and private matching details are not observable. The approximation is intentionally conservative but cannot prove real queue position.

## Cancellation rules

Cancel the virtual quote before fill when any condition occurs:

- quote age reaches 3 seconds;
- maker best price changes;
- either venue book becomes stale or invalid;
- opposite-venue reference mid moves more than 4 bps;
- adverse two-second order-flow imbalance exceeds 0.65;
- probe or fixed collection window ends.

## Frozen cost envelopes

These are research stress envelopes, not claims about a specific account fee tier.

| Scenario | Total round-trip maker-plus-hedge cost |
| --- | ---: |
| Forward median | 6 bps |
| Normal | 10 bps |
| P95 | 17 bps |
| Severe | 30 bps |

Eligibility uses Normal. Every conservative fill is reported under all four scenarios.

## Promotion gate

V13 remains rejected or Forward-only unless a single frozen collection obtains:

- at least 20 completed U.S. regular sessions;
- at least 100 conservative virtual fills;
- positive average net result in Normal, P95 and Severe;
- positive-net fill rate of at least 55%;
- no single symbol contributing more than 40% of total net profit;
- acceptable endpoint gaps, book freshness and hedge-depth failures;
- no threshold or cost retuning using the collected Forward window.

Passing these gates would authorize only a longer Paper/Shadow review. It would not authorize Production or LIVE.

## Event-conditioned Order Flow alternative

V13 records trade imbalance so a later predeclared event study can test whether one venue leads and the other lags after a signed trade shock. It is not enabled as a second strategy in the same Forward window. Enabling it now would create post-selection leakage and mix two families.

## Safety

- Production unchanged
- LIVE unchanged
- VPS unchanged
- Crypto V96 unchanged
- V11 unchanged
- V12/V12B remains rejected
- real orders disabled
