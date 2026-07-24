# V13 Maker Hedge Fixed 20-Session Forward Protocol — 2026-07-24

## Frozen decision

**V13_FORWARD_COLLECTION_SCHEDULED**

This package starts a fixed SHADOW-only Forward collection for
`V96_STOCK_CROSS_VENUE_MAKER_HEDGE_V13`.

It does not reopen V12/V12B, retune the reused 73-session sample, enable real
orders, or change Production, LIVE, VPS, Crypto V96, V11 or account positions.

## Immutable source

- Frozen V13 source commit:
  `f1b2820705d5cef815a4b160feb124af1230d746`
- The scheduled workflow checks out this exact commit by SHA.
- Later changes to the research branch cannot alter the collected logic.
- The Forward configuration is stored as JSON and SHA-256 bound in every chunk.

## Fixed collection window

- Sessions: 2026-07-27 through 2026-08-21
- Required dates: 20 predeclared weekdays
- Entry clock: New York weekday 09:30–16:00
- Universe: AMZN, META, MSFT, NVDA and TSLA
- Venues: Aster and XYZ HIP-3
- No missing date may be replaced by a later date.

Each session is divided only for GitHub-hosted-runner duration control:

1. `OPEN_CORE`: collection attempts begin at 13:25 UTC and run to 18:45 UTC.
2. `LATE_CLOSE`: collection attempts begin at 18:45 UTC and run to 20:00 UTC.

New opening quotes are blocked 90 seconds before each segment ends. The frozen
60-second maximum inventory age remains active, leaving a 30-second boundary
buffer. Closing quotes, delayed hedges and forced flattening remain active.

## Frozen execution rules

The collector imports the already-tested V13 engine from the exact source
commit. It preserves:

- 100 USDT initial virtual notional;
- Maker BUY at bid and Maker SELL at ask;
- Taker BUY at ask and Taker SELL at bid;
- displayed queue consumption before any virtual Maker fill;
- partial-fill safety failure rather than ignored partial execution;
- 250 ms delayed opposite-venue hedge;
- complete hedged inventory cycle before PnL recognition;
- 60-second maximum inventory age;
- zero real order route.

## Immutable evidence

Every segment stores:

- normalized book and public trade records;
- opportunities, virtual quotes and queue consumption;
- pending hedge and inventory events;
- completed cycle records;
- `result.json`;
- wrapper and collector logs;
- `chunk.json` containing session, segment, source SHA, workflow SHA,
  configuration digest, result status and collector exit code.

Evidence is committed to:

`research-data/v13-maker-forward-20260727`

For duplicate acquisition attempts, aggregation selects the earliest attempt
that passes only predeclared data-quality requirements. Later attempts are
excluded before any PnL inspection.

## Final gate

After the last session, the fixed aggregate must have:

- all 20 predeclared sessions complete;
- both segments present for every session;
- at least 100 completed hedged cycles;
- positive average net result in Normal, P95 and Severe;
- Normal positive-cycle rate at least 55%;
- maximum single-symbol positive-profit contribution at most 40%;
- zero partial-fill safety failures;
- zero unhedged hedge failures;
- zero unresolved ending inventory;
- no threshold, cost, delay, symbol or date retuning.

Possible final classifications include:

- `V13_FORWARD_COVERAGE_INCOMPLETE`
- `V13_FORWARD_EXECUTION_SAFETY_FAILED`
- `V13_FORWARD_INSUFFICIENT_COMPLETED_CYCLES`
- `V13_FORWARD_PERFORMANCE_FAILED`
- `V13_FORWARD_SHADOW_REVIEW_PASS_NOT_LIVE`

Even the passing classification authorizes only a longer Paper/Shadow review.
It never authorizes Production, LIVE or real orders.

## Safety

- Order submission: disabled
- Production change: none
- LIVE change: none
- VPS change: none
- Crypto V96 change: none
- V11 change: none
- Existing real positions: unchanged
