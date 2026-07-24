# V13D + V11-EQ Stock Router + Crypto V96 — Codex Implementation and LIVE Handoff

## User-approved target

Implement one coordinated Production system containing:

1. Crypto V96 as the 24-hour Crypto sleeve;
2. V13D as the first-priority Stock strategy at 10:00 New York;
3. V11-EQ as the second-priority Stock fallback at 10:30 New York;
4. a shared Portfolio risk layer enforcing Crypto Gross 1.0, Stock Gross 1.0 and total Gross 2.0.

The Stock strategies remain separate engines. Do not merge V13D and V11-EQ signal logic into one model.

## Frozen implementation contract

The canonical constants are in:

- `config/disdexStockRouterV13DV11EqRuntime.ts`
- `lib/disdex-v13d-v11eq-stock-router-contract.ts`

Do not alter thresholds while implementing. Any change requires a separate research PR and explicit user approval.

## Strategy order and time router

All Stock times use `America/New_York` with DST support.

| Time | Required behavior |
| --- | --- |
| 00:00–09:29 | Crypto V96 continues. Stock sleeve holds cash. |
| 09:30–09:59 | Collect authenticated cash, Aster and XYZ evidence. No Stock entry. |
| 10:00 | Evaluate V13D once using one simultaneous decision batch. |
| 10:00–10:30 | Manage any V13D Maker/Hedge completion. Do not let later prices influence symbol selection. |
| 10:30 | Evaluate V11-EQ only when no completed V13D Stock position exists. |
| 10:30–15:30 | Manage the selected Stock engine's own frozen exits. Crypto continues independently. |
| 15:30–15:10 rule exception | V13D must already be flat by 15:10. V11-EQ must be flat at 15:30. |
| After Stock flat | Stock sleeve returns to cash. Crypto V96 continues. |

## V13D implementation

Use the exact `V13D_EDGE20_NO_PREVIOUS_SYMBOL` rules from the runtime contract.

Required execution sequence:

1. Obtain fresh Aster and XYZ books for all five symbols in the same bounded decision batch.
2. Reject stale, shallow or invalid books before ranking.
3. Rank by largest absolute Aster/XYZ Basis dislocation, minimum 20 bps, alphabetical tie-break.
4. Apply the immediately previous completed V13D symbol cooldown once.
5. Place only the Aster Maker order for the selected symbol.
6. Prove Maker fill from authenticated order/trade updates. Do not infer a real fill from a candle.
7. After the frozen 250 ms delay, place the exact opposite XYZ Taker hedge.
8. Incomplete Maker fill, stale hedge data, insufficient hedge depth or unresolved hedge state must fail closed.
9. Store both venue Funding and realized execution costs.
10. Exit both legs at 14:30 when the frozen price-gross condition is met, otherwise at 15:00; hard flat deadline 15:10.

Never allow an unhedged Stock position to remain open because the expected edge appears attractive.

## V11-EQ implementation

V11-EQ preserves V11's signal and exit. Only the pre-entry Execution Quality Gate is new.

### Signal

- Cash/Aster absolute Basis at least 50 bps;
- five-symbol absolute-Basis Top1;
- both Long and Short directions;
- Stock target Gross 1.0;
- no Top2, normalized selection or tiered sizing;
- no candidate replacement after the 10:00 signal is frozen.

### Mandatory Entry gate

All conditions must pass:

- data age no more than 1.5 seconds;
- source clock difference no more than 1.5 seconds;
- no fallback or reference-only cash source;
- estimated round-trip cost no more than 60 bps;
- estimated round-trip cost / Entry Basis no more than 0.75;
- conservative estimated Net Edge at least 10 bps;
- cumulative executable depth at least two times order notional;
- current Aster Spread no more than 20 bps;
- current Spread no more than two times the trailing 30-second median;
- adverse two-second move no more than 5 bps;
- adverse Basis movement no more than 10 bps;
- candidate remains Top1 at Entry;
- Stock sleeve unoccupied;
- no daily-loss lock;
- no Kill Switch.

If any condition fails, hold cash. Do not substitute the second-ranked symbol.

### Entry execution

- post-only Limit only;
- maximum TTL 10 seconds;
- never chase the price;
- no automatic market fallback;
- cancel remainder after TTL;
- accepted fill ratio must be at least 90%;
- if below 90%, cancel and flatten the fill safely;
- persist every rejection reason and every order-state transition.

### Exit

- Basis absolute value at or below 15 bps;
- or Basis zero-cross;
- or Basis expansion to 1.5 times Entry Basis;
- otherwise forced exit at 15:30 New York;
- no overnight Stock position.

A normal convergence exit may attempt a short Limit close. The expansion stop and final time exit may use Taker execution. Any unresolved remainder is a Kill Switch event.

## Stock conflict resolution

The router must be deterministic:

1. completed V13D position;
2. otherwise V11-EQ Gate pass;
3. otherwise cash.

Rules:

- only one Stock position total;
- V11-EQ cannot replace or offset V13D;
- V13D cannot enter after the 10:00 decision attempt has finished;
- a rejected V13D candidate does not cause re-ranking from later market data;
- V11-EQ cannot select another symbol when its frozen Top1 fails the Entry gate;
- client order IDs must identify strategy, date, symbol, leg and attempt idempotently.

## Crypto V96 integration

Do not rewrite the existing V96 signal engine.

- retain current Core Volume50 / Turnover7.5, Weight Band, Strong Boost, Drawdown and Whipsaw behavior;
- retain existing PENGU V46 handoff behavior;
- compute the complete V96 target first;
- proportionally cap the complete Crypto target to Crypto sleeve Gross 1.0;
- do not transfer unused Stock capacity to Crypto;
- do not transfer unused Crypto capacity to Stock;
- Stock orders never cancel or resize Crypto orders;
- Crypto orders never cancel or resize Stock orders;
- total Portfolio Gross must remain at or below 2.0.

## Shared risk and recovery

Implement one authoritative Portfolio risk state:

- maximum daily Portfolio loss 2%;
- daily accounting boundary UTC;
- cancel all pending managed orders when locked;
- flatten managed positions reduce-only when the lock or Kill Switch requires it;
- never close unmanaged/manual positions;
- unknown order state, stale data, reconciliation failure or duplicate runner ownership fails closed;
- process restart must reconcile remote orders and positions before creating orders;
- all order commands must be idempotent;
- one active service owner only;
- persist configuration fingerprint and exact Git commit.

## Required modules for Codex

Codex should create or adapt the following separation of responsibilities:

- Stock market-data adapters for authenticated cash, Aster and XYZ;
- V13D signal and dual-venue execution engine;
- V11-EQ signal and Execution Quality Gate engine;
- Stock state and reconciliation store;
- Stock router/scheduler;
- shared V96/Stock Portfolio Gross allocator;
- shared daily-loss and Kill Switch coordinator;
- combined live runner and preflight;
- Paper and Shadow executors using the same decision path as LIVE;
- systemd installer/service unit separate from currently running legacy services.

Do not reuse a research candle fill as a Production order fill.

## Required tests before LIVE

### Pure contract tests

- V13D always wins when completed;
- V11-EQ runs only when V13D did not complete;
- no substitute Stock symbol after frozen Top1 rejection;
- every EQ rejection reason tested at its exact boundary;
- Crypto Gross, Stock Gross and total Gross caps tested;
- sleeve lending remains disabled;
- mode disabled blocks every real order.

### Execution tests

- Maker no-fill;
- Maker partial fill;
- hedge success;
- hedge timeout;
- duplicate WebSocket event;
- REST/WebSocket order-state disagreement;
- stale order book;
- insufficient depth;
- post-only rejection;
- V11 89.9% fill flatten path;
- forced Stock close and unresolved remainder;
- daily-loss lock during pending order;
- restart with open V13D hedge;
- restart with open V11-EQ position;
- duplicate process ownership;
- Kill Switch while both Crypto and Stock sleeves are active.

### End-to-end gates

- TypeScript typecheck passes;
- existing V96 parity and self-tests remain green;
- new Stock contract self-test passes;
- combined Paper rehearsal covers at least one V13D attempt and one V11-EQ attempt;
- zero unknown order events;
- zero Gross violations;
- zero unresolved ending Stock inventory;
- exact-commit preflight artifact saved;
- credentials, venue account mode and symbol precision verified;
- operator override created only after all evidence is reviewed.

## Activation sequence

Codex must not jump directly from implementation to LIVE.

1. Implement with `mode=DISABLED`, `liveTradingEnabled=false`, `orderSubmissionAllowed=false`.
2. Run contract, type, V96 parity, execution and recovery tests.
3. Run Shadow with real books and no orders.
4. Run Paper through the same router and state machine.
5. Reconcile current real positions and confirm `closeUnmanagedPositions=false`.
6. Produce an exact-commit preflight report.
7. Obtain explicit operator approval for that commit and runtime configuration.
8. Enable the dedicated service without stopping unrelated existing services.
9. Confirm first-cycle state and order ownership.

No code path may silently enable LIVE from environment defaults. LIVE requires both configuration approval and an explicit runtime operator override.

## Current handoff safety state

The committed runtime contract intentionally has:

- `mode=DISABLED`;
- `liveTradingEnabled=false`;
- `orderSubmissionAllowed=false`;
- `paperTradingEnabled=false`;
- `shadowCollectionEnabled=true`.

This branch is an implementation handoff, not evidence that the combined strategy is already running.
