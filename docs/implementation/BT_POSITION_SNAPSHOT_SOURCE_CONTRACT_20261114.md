# DisDex BT — Position Snapshot Source Contract (2026-11-14)

Status: implemented as strict optional source reader with regression tests.
The actual current strategy BT engine position-export hook is NOT YET CONNECTED.
This is research/BACKTEST only. Never use it for LIVE orders or runner controls.

## Owner requirement

During time-accelerated BT replay show current strategy, symbol, side,
remaining quantity, entry price, current mark, account equity, Total/Crypto/Stock
Gross x and the specific current Gross x of each model holding. Gross proportions
must visibly follow the changing account and position portfolio.

## Source audit (11/14)

- The original STABLE4 research cases have time-varying account equity and
  Total/Crypto/Stock Gross, but completed FILLS.csv has only entry notional
  and entry Gross. Current individual quantity/mark/Gross is not included.
- RUN_MANIFEST.json records one unclosed Q102 SUIUSDT LONG (entry
  2026-09-29 04:00 UTC, entry price 1.1156, entry Gross 1.0x).
  A future MODELED exit is 2026-10-02 03:00 UTC. This is NOT a real fill.
- Finished fills alone omit this still-open model position; the final source
  equity snapshot still shows one open position.
- The original research sources were preserved. Four corrected research
  replays were built privately on the owner PC:
  C:\tmp\bt481-hp-replay-library-terminal-v3-20261114
- BTCUSDT source hourly GZIP SHA256:
  e4eb9ad9f82ebe335b12ce50d84b4ee0e35f8f940f4c0119746453ed4e13492c
- Do not place private replay files in public/, GitHub Pages or Git.

## Mandatory new source position CSV columns

The real model engine must emit one source file per cost case:
PREFIX_10BPS_POSITION_SNAPSHOTS.csv and
PREFIX_30BPS_POSITION_SNAPSHOTS.csv.

| Column | Definition |
|---|---|
| utc | Source equity time in UTC with explicit offset |
| trade_id | Unique model position ID at this source timestamp |
| logic | Model strategy name |
| symbol | Model trading symbol |
| side | LONG or SHORT |
| quantity | Remaining quantity, after relevant partial closes |
| entry_price | Actual model entry quote from source |
| mark_price | Available as-of source quote; no look-ahead |
| fx_jpy_per_price_unit | Explicit source quote-to-JPY conversion |
| contract_multiplier | Instrument contract multiplier |
| notional_jpy | Source current mark notional in yen |
| current_gross_x | Current source-engine position exposure in x |
| entry_gross_x | Original recorded entry time exposure in x |
| category | crypto or stock |

Every equity source timestamp MUST have exact inventory coverage. For flat
snapshots emit one row with UTC and empty fields; absence of a row means
unknown data and must fail validation, not imply zero exposure.

The source engine must include an ENTRY lifecycle record for **every**
open position ID, even if the model's exit lies beyond the BT period.
Never invent exit trades to make the FILLS.csv ledger balance.

## Fail-closed verification

The new bt_hp_source_position_snapshots.py reader rejects missing times,
duplicate IDs, mixed flat/populated markers, inconsistent position lifecycles,
incorrect source open counts, invalid values, mismatched entry price or gross,
inconsistent mark * quantity * FX * multiplier versus source JPY notional,
and inconsistent crypto/stock/total category Gross versus equity source.
It validates ALL equity observations, not just visible downsampled frames.

Only if every check passes do replay positions receive quantity, mark,
current Gross and the source position file SHA256. Otherwise current position
exposure remains null. Gross is NEVER allocated pro rata from Total Gross.

As-of phases matter: an order entered at 01:00 may only appear in 01:05
equity and position snapshots. Matured exits can be included before a
same-timestamp new entry. The adapter records sourceOpenCount and
sourcePositionAlignment MATCHED/AMBIGUOUS/UNMATCHED; only explicitly
matched position IDs are authoritative when full source snapshots exist.

## Results and limitations

- 20 synthetic model adapter tests cover valid records, absent information,
  terminal open-only positions, future access, all-moment phase accounting,
  invalid/missing/duplicate rows, source volume and category reconciliation.
- Four real case replays preserve all source equity/realized PnL/Gross,
  trade events, original BTC bars, metrics and source SHA256.
- Unclosed Q102 SUIUSDT LONG is displayed in the RESULTS tab only as
  period-end source model evidence; no fabricated current Gross/qty/mark.
- New model position source CSV is not present in those four historic cases.
  Canonical LIVE-pinned engine parity, actual venue fills and full per-position
  holdings remain UNVERIFIED.
- Next integration is to hook an emission writer into the actual selected BT
  simulator at its existing equity snapshot append site, not retroactively
  infer missing source position marks from completed FILLS or BTC charts.
