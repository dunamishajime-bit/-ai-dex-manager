# Raw-data integrated backtest redesign

## Goal

Rebuild the one-year integrated backtest without using any recovered trade
ledger as an event source. Recreate V12, PENGU, Q102, FET, and V52 from raw
market inputs and explicit production contracts, then calculate the portfolio
with one deterministic execution/accounting engine.

The capital contract is fixed: initial `¥10,000`, `¥10,000` deposited on each
of the following 12 monthly dates, total contributed `¥130,000`, compounding
enabled, and a one-year UTC interval. The result must be labelled independent
unless every production event source and execution rule is available and
verified.

## Non-goals and safety

- Do not use recovered V12/PENGU/Q102/FET/V52 trade ledgers as event input.
- Do not change VPS, Production, systemd, UI, Aster account state, or LIVE
  orders.
- Do not tune parameters to match historical result numbers.
- Do not send test, synthetic, or market orders.
- If a required raw source, contract, or execution rule is missing, fail closed
  and report the missing provenance instead of substituting a ledger.

## Contract snapshot

At run time, the engine snapshots and hashes the current production target. The
run is blocked if the source contract is ambiguous or differs from the
requested target.

- V12: current Production Top3 contract; Rank3 Gross `0.10x`, Rank3 score
  threshold `0.70`, and current aggregate/per-position limits from the
  production target artifact.
- PENGU: `COMBINED_FILTERED`, every accepted entry Gross `1.0x`, same-route
  hard-stop quarantine `60h`, realized DD `-17%`, new-entry hold `72h`.
- Q102: Causal V4 generator/selector/planner/live adapter, one slot, current
  production Gross contract.
- FET: BRK48 Residual and current preemption/priority contract.
- V52: current V11/V50 production contract, including the current cost,
  spread, basis, convergence, stop, and holding rules.
- Shared portfolio Gross, daily loss, and 5x Cross requirements come from the
  same production target snapshot and are checked at every accepted entry.

## Raw data and provenance

Crypto data is fetched from Aster's public futures API (`fapi.asterdex.com`)
for every crypto symbol required by the current universe. The manifest records
endpoint, symbol, interval, first/last timestamp, row count, SHA-256, missing
bars, duplicate bars, and download/cache time. Funding data is independently
recorded and joined only by timestamps available before the decision.

V52 is not an Aster crypto market. Its raw stock OHLCV/reference source is
recorded separately with the same manifest fields; an Aster-only claim is not
made for V52.

The engine rejects duplicate bars, invalid OHLC relationships, non-monotonic
timestamps, missing required decision bars, and post-period rows used in the
period calculation.

## Signal and execution reconstruction

Each strategy emits a timestamped candidate from raw data only. The event
pipeline is:

`raw bars → indicators/features → signal → ranking/gate → next-bar execution →
shared reservation → fill/position → mark-to-market/exit`

The following are mandatory invariants:

- Signal features use data through the signal bar only.
- An entry cannot fill at a price from the signal bar close unless the
  production contract explicitly says so and the rule is documented.
- Same-bar exit/entry ordering is deterministic and tested.
- Fee, funding, spread, slippage, quantity rounding, and partial fills are
  applied exactly once.
- Rejected candidates do not create trades, PnL, or PENGU DD state.
- Existing Gross, pending reservation, candidate Gross, portfolio caps, and
  available margin are evaluated before acceptance.
- Exits release Gross only after their modeled fill event.

PENGU Q60 and DD17/H72 state are updated only by accepted, filled, closed
PENGU positions. Existing protection remains active during a governor pause.

## Accounting and scenarios

The engine maintains cash, mark-to-market equity, realized PnL, fees, funding,
open Gross, pending reservations, and contribution basis separately. Deposits
are applied once at their scheduled UTC timestamps. Compounding changes
position sizing through the contract, not by multiplying a trade return twice.

At minimum the run produces NORMAL and SEVERE scenarios. Their fee,
slippage, funding, and stock-cost assumptions are explicit in the manifest;
they are not inferred from the expected result.

## Validation gates

The run is valid only if all gates pass:

1. All five strategy generators use raw-data inputs, not recovered ledgers.
2. Required raw data passes schema, timestamp, duplicate, gap, and range
   checks.
3. No feature or execution price uses future data.
4. Gross caps are never exceeded at acceptance.
5. Deposits total exactly `¥130,000` and are not double-counted.
6. Fees and funding are applied once per modeled fill.
7. Rejected entries are absent from trade count, PnL, and PENGU governor
   state.
8. NORMAL and SEVERE state are independent.
9. A deterministic second run produces the same result and manifest hash.
10. Per-trade returns, total return, and drawdown pass plausibility checks; any
    unusually large return is retained for audit rather than silently clipped.

## Deliverables

- Raw-data manifest with SHA-256 and quality findings.
- Strategy event ledgers generated by the new engine.
- Integrated event ledger and Gross timeline.
- NORMAL/SEVERE summary, monthly equity, drawdown intervals, and per-logic PnL.
- Plausibility/audit report explaining any large-profit contribution.
- Unit and integration tests for look-ahead, duplicate events, deposits,
  costs, Gross reservations, Q60, DD17/H72, and deterministic replay.

The final status must distinguish:

- `RAW_DATA_INDEPENDENT_BT_VERIFIED` when all raw-data and validation gates
  pass; or
- `BLOCKED_RAW_SOURCE_OR_PARITY` when a required raw input or production rule
  cannot be reproduced.
