# Five-logic BT reusable ledger contract

This document defines the durable output contract for the one-year integrated
V12 / PENGU / Q102 / FET / V52 research backtest. It is a modeled H1 price
replay, not a claim of historical L2 fill verification.

## Cost scenarios

- `PRICE_MODEL_ASTER_TAKER_8BPS`: practical low-cost sensitivity.
- `PRICE_MODEL_BASE_10BPS`: primary conservative research baseline.
- `PRICE_MODEL_EXTREME_COST_70BPS_NOT_BASELINE`: intentionally extreme
  cost sensitivity only. It must never be presented as the Aster baseline.

## Durable per-scenario files

Each retained scenario directory contains:

- `metrics.json`: portfolio metrics, strategy PnL, win/loss aggregates,
  candidate decision counts, accounting reconciliation and monthly equity.
- `portfolio-trades.jsonl`: one row per accepted and closed modeled trade.
  It preserves candidate/position ID, strategy, symbol, side, route/family,
  entry and exit timestamps, modeled entry/exit prices, quantity, accepted
  Gross, entry/exit fees, price PnL, funding PnL, total PnL, exit reason,
  settlement currency and reference FX. `historical_fill_verified=false`
  remains explicit.
- `candidate-decisions.jsonl`: one row for every upstream candidate,
  including both accepted and rejected candidates. Rejections retain the exact
  allocation/gating reason such as shared daily loss, cooldown, route
  quarantine, occupied slot, same-symbol active, no Gross room, no-lot-shrink,
  residual below minimum, source-data exclusion or out-of-sample lifecycle.
  Requested Gross and candidate entry/exit prices/times are retained when
  available.
- `portfolio-events.jsonl`: chronological modeled cash ledger containing
  contributions, entries, partial exits, funding cashflows and exits with
  price/quantity/fee/PnL/wallet-after-event fields.

The output is intentionally sufficient for later attribution and filtering
without rerunning market-data acquisition.

## Stable identifiers

Every upstream candidate receives a deterministic `candidate_id` after the
annual candidate set is sorted by entry time, strategy priority and symbol.
Accepted candidates retain both `candidate_id` and `position_id` through
trade and event ledgers, so allocation decisions can be joined directly to
modeled trades and all cash events.

## Source and replay provenance

The research engine restores the allowlisted historical runtime snapshot from
repository commit `a09ea45ca3cbd72100f9eb0eaae499039c40b6a0` and validates the
runtime source digest before signal replay. The annual run also preserves
acquisition/reconciliation manifests and official ECB reference-FX provenance.

Raw vendor candle dumps are not committed to the repository. The reusable
ledger retains the prices actually used for modeled entries/exits and the
provenance manifests/hashes needed to identify the market-data run.

## Interpretation

`ACCEPTED_MODELED_ENTRY` means the portfolio allocator admitted the candidate
under the modeled shared-Gross/risk rules. It does not mean an historical L2
order fill was verified.

`REJECTED_PORTFOLIO` means the strategy produced an upstream candidate but the
integrated portfolio did not allocate it. `EXCLUDED_PREALLOCATION` means the
candidate could not enter the portfolio model because its lifecycle/source
coverage was not eligible.

For strategy win/loss analysis, use the allocated `portfolio-trades.jsonl`
rather than raw strategy candidate win rates.
