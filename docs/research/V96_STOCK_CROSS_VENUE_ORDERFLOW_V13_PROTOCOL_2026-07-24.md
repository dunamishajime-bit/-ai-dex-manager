# V96 Stock Cross-Venue Order-Flow / Maker Hedge V13 Protocol — 2026-07-24

## Decision before data

**V13_FORWARD_DATA_REQUIRED**

V12/V12B rejected a static two-taker Aster/XYZ basis-convergence structure. V13 does not retune the 10–100 bps thresholds or reuse the same 73-session Holdout to select another nearby spread rule.

V13 changes the information and execution model:

- actual best bid/ask updates from Aster and XYZ;
- actual public trade prints and aggressor direction;
- a conservative displayed-queue model for a virtual Maker order;
- correct Maker and Taker bid/ask accounting;
- a frozen 250 ms SHADOW hedge delay after a full Maker fill;
- a complete hedged inventory cycle before any PnL is recognized;
- adverse order-flow, stale-book, reference-move, quote-TTL and inventory-age controls.

No profitability claim is made until a fixed Forward window is complete.

## Frozen universe, venues and clock

- Aster versus XYZ HIP-3 on Hyperliquid
- AMZN, META, MSFT, NVDA and TSLA
- opening quotes only during the New York weekday 09:30–16:00 regular-session window
- one virtual quote and at most one hedged inventory per symbol
- virtual initial notional: 100 USDT
- SHADOW research only
- real order submission absent and prohibited

The weekday clock is a research gate. A completed Forward review must also identify exchange holidays and abnormal session closures from the captured evidence before any promotion decision.

## Frozen Maker-hedge opening rules

For every synchronized fresh two-venue book, V13 evaluates four opening directions:

1. Maker BUY on Aster, Taker SELL hedge on XYZ;
2. Maker SELL on Aster, Taker BUY hedge on XYZ;
3. Maker BUY on XYZ, Taker SELL hedge on Aster;
4. Maker SELL on XYZ, Taker BUY hedge on Aster.

An opening quote is eligible only when all conditions hold:

- projected Normal entry dislocation is at least 2 bps after the frozen 10 bps complete-cycle cost envelope;
- displayed queue ahead is at most 250 USDT;
- opposite-venue top-level hedge depth covers the exact base quantity and is at least 100 USDT;
- both books are no older than 1.5 seconds;
- two-second adverse trade imbalance is no greater than 0.65.

The best eligible direction is selected without a symbol-specific threshold.

## Correct bid/ask accounting

- Maker BUY quotes at the maker venue bid;
- Maker SELL quotes at the maker venue ask;
- Taker BUY executes at the hedge venue ask;
- Taker SELL executes at the hedge venue bid.

Maker-side and Taker-side price selection are implemented separately. A crossed or midpoint price is never substituted for an executable top-of-book price.

## Conservative queue and fill rule

A quote is not filled merely because price touched it.

- queue ahead starts as the displayed best-level quote notional;
- only opposite-side aggressive public trades at or through the quote consume the queue;
- the virtual order reaches a full Maker fill only when one observed trade, after consuming the remaining queue ahead, covers the entire remaining virtual quote notional;
- a smaller post-queue partial fill is classified as `PARTIAL_FILL_SAFETY_FAILED` because V13 does not add a second, post-selected partial-fill hedger;
- a full Maker fill enters `PENDING_HEDGE` for the frozen 250 ms delay;
- after the delay, the other venue must still have a fresh book and sufficient top-level depth for the exact base quantity;
- a stale or shallow delayed hedge is an unhedged safety failure and can never contribute positive PnL.

This remains an approximation because hidden orders, cancellations ahead, latency priority and private matching details are not observable. The approximation is intentionally conservative but cannot prove real queue position.

## Complete-cycle accounting

An opening Maker fill plus its delayed Taker hedge does **not** count as profit. It opens a delta-hedged cross-venue inventory.

PnL is recognized only after one of these exits:

1. **Maker cycle close** — the opposite Maker quote fills on the original Maker venue, followed by the same frozen 250 ms delayed Taker hedge close on the other venue;
2. **Forced Taker close** — inventory reaches the frozen 60-second maximum age or the probe ends, and both legs can be flattened from fresh books with sufficient depth.

The realized gross cycle result uses the same base quantity on all four executions:

- Maker open;
- Taker hedge open;
- Maker or Taker inventory close;
- Taker hedge close.

If a forced close lacks fresh books or sufficient depth, the inventory remains unresolved and is never counted as profitable.

## Quote cancellation rules

Cancel a virtual quote before any fill when any condition occurs:

- quote age reaches 3 seconds;
- maker best price changes;
- either venue book becomes stale or invalid;
- opposite-venue reference mid moves more than 4 bps;
- adverse two-second order-flow imbalance exceeds 0.65;
- maximum inventory age or probe end requires flattening.

Any post-queue partial fill is not treated as a normal cancellation; it is an execution-safety failure.

## Frozen cost envelopes

These are research stress envelopes, not claims about a specific account fee tier.

| Scenario | Two-Maker completed cycle | Forced-Taker close cycle |
| --- | ---: | ---: |
| Forward median | 6 bps | 10 bps |
| Normal | 10 bps | 16 bps |
| P95 | 17 bps | 26 bps |
| Severe | 30 bps | 45 bps |

Opening eligibility uses the Normal two-Maker envelope. Every completed cycle is scored with the envelope matching its actual close profile.

## Promotion gate

V13 remains rejected or Forward-only unless a single frozen collection obtains:

- at least 20 completed U.S. regular sessions;
- at least 100 completed hedged inventory cycles;
- positive average net result in Normal, P95 and Severe, including forced closes;
- positive-net completed-cycle rate of at least 55%;
- no single symbol contributing more than 40% of positive net profit;
- zero partial-fill safety failures;
- zero unhedged hedge failures;
- zero unresolved inventory at the end of the review;
- acceptable endpoint gaps, book freshness, forced-close frequency and hedge latency;
- no threshold, delay, cost or symbol-specific retuning using the collected Forward window.

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
