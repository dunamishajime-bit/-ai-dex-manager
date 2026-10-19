# HP VPS Runtime Parity and Complete History Design

## Purpose

Align the production HP with the current VPS runtime observability without changing trading behavior, while making the realtime page show the owning logic for every currency and making trade history/PnL coverage explicit and complete for all configured production symbols and all available Aster fills.

## User-visible outcome

- The realtime page keeps its existing 30-second refresh, ranking order, countdown, movement animation, sound, and notification behavior.
- Every realtime row has an explicit `logicName` derived from the VPS observability source. The full name is available on desktop and in the row detail/title on narrow screens.
- History and performance use one normalized history contract. Authenticated Aster official fills are the authoritative source; VPS fill-lineage evidence and the local ledger enrich and fill gaps without duplicating fills.
- Partial fills sharing an order ID remain separate fills when their trade IDs differ.
- The UI reports source coverage, oldest/newest fill, requested/completed/failed symbols, and whether the result is complete or partial. It never presents an incomplete source as a complete history.

## Scope and non-goals

In scope:

- `apps/production-ui` history source, attribution, API response, history page, performance page, realtime row contract, and realtime row layout.
- Tests and an immutable UI release deployed through the existing XServer VPS path.
- Read-only post-deploy checks for realtime, history, performance, UI release marker, and service health.

Out of scope:

- Trading runner code, strategy conditions, sizing, Gross, Shared Risk, Margin Guard, Kill Switch, operator artifacts, state files, positions, open orders, or Aster order placement/cancellation.
- Clearing the Shared Risk daily-loss latch.
- Exposing API keys, private configuration, or raw secrets.
- Treating historical research/backtest artifacts as live trade history.

## Source and lineage contract

The history endpoint must use these source priorities:

1. Authenticated Aster `/fapi/v3/userTrades` fills for the configured production symbol manifest.
2. Persisted VPS fill-lineage evidence matched by exact order ID, client order ID, or trade ID where present.
3. Local runtime ledger entries only for fills not already represented by the official source.

The symbol manifest is the deduplicated union of the current production configuration: V12 symbols, PENGU, Q102 symbols, FET, HYPE/ZEC, Idle symbols, and V52 stock symbols. A new UI build must not invent a symbol from a historical row or infer an owner from symbol alone when explicit lineage is absent.

For each symbol, pagination continues from the last strictly increasing venue trade ID until the venue returns fewer than the page size or no new row. A defensive maximum page count is allowed only as an integrity guard; reaching it produces `PARTIAL`, an error/coverage record, and a visible notice rather than silently dropping older fills.

Fills are deduplicated using a trade-level identity. A venue `tradeId` is preferred. When unavailable, use a stable composite of provider, symbol, order ID, execution time, side, price, and quantity. An order ID alone is never a duplicate key when multiple trade IDs exist under that order.

## Data contract

The normalized history response keeps the existing `entries` shape and adds:

```ts
type HistoryCoverage = {
  status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  source: "ASTER_OFFICIAL" | "LOCAL_FALLBACK" | "EMPTY";
  requestedSymbols: string[];
  completedSymbols: string[];
  failedSymbols: Array<{ symbol: string; reason: string }>;
  pagesBySymbol: Record<string, number>;
  totalFills: number;
  oldestExecutedAt?: string;
  newestExecutedAt?: string;
  mergedLocalEntries: number;
  refreshedAt: string;
}
```

The API continues to expose `historySource`, `historyNotice`, and `readOnlyError` for compatibility. `coverage.status` is authoritative for completeness. Unauthenticated requests remain read-only and do not call the account-history endpoint; they return the local fallback and `PARTIAL`/`UNAVAILABLE` coverage as appropriate.

## Logic attribution contract

The logic vocabulary includes `V12`, `PENGU`, `Q102`, `FET`, `HYPE`, `IDLE`, `V52`, and `UNATTRIBUTED`. Exact client-order/fill-lineage markers are preferred:

- `v12-*` → V12
- `dualls2-*` / `rec-v8-*` → PENGU
- `q102v1-*` → Q102
- `fet-*` → FET
- `hz-*` on HYPEUSDT → HYPE
- `idle-*` or explicit Idle strategy/route evidence → IDLE
- explicit V52/V11/V50 evidence or stock strategy ownership → V52

When no exact evidence exists, the display is `UNATTRIBUTED`/`未分類`; symbol-only inference must not be presented as definitive ownership. Route labels remain available for PENGU and Q102 variants.

## Realtime display contract

The server response adds `logicName` to each `RankRow`, while keeping `logic` backward-compatible. The client renders `logicName` in the row and top-three cards, adds a full-name title/accessible label, and uses responsive column sizing. `refreshSeconds=30`, preview timing, `rankRows`, `rankChanges`, `useRankingShow`, sound, and notification behavior remain unchanged.

## PnL contract

History and performance consume the same normalized entries. Net PnL preference remains:

1. explicit net PnL,
2. realized PnL minus stable-asset commission,
3. no invented value when neither is available.

Partial exits remain independent closed fills with their own quantities and PnL. Funding and unrealized PnL remain separate from realized trade PnL. Monthly and logic summaries are generated from the complete normalized set and use the same attribution as the history table.

## Error handling and safety

- Official symbol failures are recorded individually and do not make successful symbols disappear.
- A partial or unavailable source is visible in the UI and never labeled `全履歴取得済み`.
- Aster read failures do not mutate orders, positions, state, locks, or risk files.
- The deployment changes only the UI release and UI service. Trading services are not restarted.

## Verification requirements

Tests must cover:

- more than 20 pages of fills without truncation;
- two partial fills with the same order ID and different trade IDs;
- official/local merge without duplicate fills;
- all production symbol families including HYPE and Idle;
- exact Idle/HYPE/Q102 attribution and explicit `UNATTRIBUTED` fallback;
- complete, partial, and unavailable coverage states;
- logic/PnL/monthly summaries consuming the same entries;
- realtime `logicName` rendering while preserving 30-second refresh and movement behavior.

Post-deploy verification must check the current UI release marker, service working directory/PID, HTTP 200 for `/realtime`, `/history`, `/performance`, the realtime API refresh contract, and the history coverage fields. No trading mutation is permitted.
