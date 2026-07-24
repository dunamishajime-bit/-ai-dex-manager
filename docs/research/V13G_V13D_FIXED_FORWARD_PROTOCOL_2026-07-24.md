# V13G / V13D Fixed 20-Session Forward Protocol — 2026-07-24

## Frozen decision

Exactly two candidates are frozen for an untouched Forward/Shadow comparison:

1. **V13G Growth** — `EDGE20__NONE`
2. **V13D Diversified** — `EDGE20__NO_PREVIOUS_SYMBOL`

No third candidate, nearby edge threshold, different holding time, additional exit rule, symbol blacklist or post-window retuning is permitted.

The historical evidence used to choose these two arms is reused research evidence. This new test starts a separate immutable Forward window and does not claim that the historical result is an independent Holdout.

## Fixed Forward window

- Sessions: 2026-07-27 through 2026-08-21
- Required sessions: 20 predeclared U.S. weekdays
- Missing sessions may not be replaced by later dates
- Time zone: America/New_York
- Universe: AMZN, META, MSFT, NVDA and TSLA
- Venues: Aster Maker and opposite XYZ Taker hedge
- Mode: SHADOW_RESEARCH_ONLY
- Initial virtual Maker notional: 100 USDT
- Real order submission: disabled

## Shared entry batch

Both arms use the same immutable market-data batch.

- The collector begins before 10:00 New York.
- The decision snapshot is targeted at 09:59:55 New York.
- It waits only until 10:00:20 for fresh books from all five symbols.
- Entry Maker quotes expire at 10:00:30.
- Symbols are ranked only against symbols available in this same decision batch.
- The highest absolute Aster/XYZ basis dislocation wins, with alphabetical symbol order as the deterministic tie-breaker.
- No later opportunity from the same day may affect the 10:00 selection.

## Shared entry eligibility

A symbol is eligible only when all frozen requirements pass:

- absolute Aster/XYZ basis dislocation is at least 20 bps;
- Maker venue is Aster and hedge venue is XYZ;
- projected Normal immediate execution edge is at least 2 bps;
- displayed Aster Maker queue is at most 250 USD;
- XYZ executable Taker top is at least 100 USD and covers the exact hedge quantity;
- both books are no more than 1,500 ms old;
- two-second adverse Aster trade imbalance is no greater than 0.65;
- reference movement after quoting remains within 4 bps.

The minimum edge is fixed at 20 bps. Testing 18, 22, 25 or any other nearby value on this Forward window is prohibited.

## Actual execution evidence

Historical candle touch is not accepted as a fill.

- Aster public aggressive trades must first consume the displayed queue ahead.
- Only aggressive volume beyond the queue can fill the virtual Maker order.
- Any incomplete post-queue fill is recorded as a partial-fill safety failure.
- A complete Maker fill enters a frozen 250 ms delayed XYZ hedge check.
- A stale or shallow delayed hedge is an unhedged safety failure.
- PnL is recognized only for a completed hedged cycle.
- Unresolved inventory cannot contribute positive PnL.

All eligible symbols may be shadow-quoted so that both arms can be reconstructed from the same causal market-data batch. Only the symbol selected by each frozen arm contributes that arm's PnL, cycle count, safety failures and concentration statistics.

## Shared exit rule

- At 14:30 New York, the selected hedged inventory is marked against executable Taker prices.
- If price gross PnL is at least 30 bps, both legs are force-closed by Taker at 14:30.
- Otherwise both legs are force-closed by Taker at 15:00.
- Any remaining inventory must be flattened by 15:10.
- Overnight inventory is prohibited.
- Actual public Funding rows from Aster and XYZ are included between opening and closing timestamps.

No partial take-profit, trailing exit, nearby time or second-Maker assumption may be added after the window begins.

## The only difference between the two arms

### V13G Growth

- Candidate ID: `EDGE20__NONE`
- No symbol cooldown
- Select the largest eligible same-batch dislocation

### V13D Diversified

- Candidate ID: `EDGE20__NO_PREVIOUS_SYMBOL`
- The symbol of the immediately preceding completed V13D cycle is skipped once
- If the blocked symbol would otherwise rank first, select the next-largest eligible same-batch dislocation
- A failed or uncompleted cycle does not advance the cooldown state

No other rule differs between V13G and V13D.

## Immutable evidence discipline

Every session stores:

- normalized Aster and XYZ books and public trades;
- the complete five-symbol decision batch;
- entry eligibility and rejection reasons;
- virtual quotes and queue consumption;
- pending hedge, inventory, exit-decision and completed-cycle events;
- actual public Funding histories;
- result, logs and immutable chunk metadata;
- frozen source commit and configuration SHA-256.

Evidence is persisted to:

`research-data/v13g-v13d-forward-20260727`

If duplicate acquisition attempts exist, aggregation selects the earliest attempt that passes only predeclared data-quality checks. Later attempts are excluded before inspecting PnL.

## Cost scenarios

Every selected completed cycle is scored using the same forced-Taker complete-cycle envelopes:

| Scenario | Cost |
| --- | ---: |
| Forward median | 10 bps |
| Normal | 16 bps |
| P95 | 26 bps |
| Severe | 45 bps |

## Final gates

Both arms require:

- all 20 predeclared sessions complete;
- at least four completed selected cycles per arm;
- positive average net result in Normal, P95 and Severe;
- Normal positive-cycle rate of at least 55%;
- zero selected-symbol partial-fill safety failures;
- zero selected-symbol unhedged hedge failures;
- zero selected-symbol unresolved ending inventory;
- no retuning on the collected window.

Concentration limits:

- V13G Growth: maximum single-symbol positive-profit contribution at most 50%;
- V13D Diversified: maximum single-symbol positive-profit contribution at most 40%.

The looser V13G limit is reported explicitly because its historical purpose is maximum profit. V13D retains the stricter diversification requirement.

## Interpretation boundary

A passing result authorizes only a longer Paper/Shadow review. It does not authorize Production, LIVE, leverage, VPS deployment or real orders.

A failed arm remains failed. The collected Forward window may not be recycled to create V13G2, V13D2, a new edge floor or a new exit clock.

## Safety

- Research/Shadow only
- Order submission disabled
- Production unchanged
- LIVE unchanged
- VPS unchanged
- Crypto V96 unchanged
- V11 unchanged
- Original 60-second V13 Forward collector unchanged
- Existing real positions unchanged
