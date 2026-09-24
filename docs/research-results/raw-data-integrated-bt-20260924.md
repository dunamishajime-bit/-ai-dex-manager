# Raw-data integrated BT audit

Status: `BLOCKED_RAW_SOURCE_OR_PARITY`

No recovered trade ledger was used as event input. The primary crypto source
was fetched read-only from Aster public Futures REST. Because the Aster
response contains one reproducible invalid OHLC row, an independent Binance
USD-M Futures public REST bundle was also acquired for the same period and
universe. V52 reference data is a separately identified Yahoo Finance stock
source and is not claimed to be Aster crypto data.

For the alternate raw run, Binance is the selected crypto source. It is a
clean independent market-data source, but it is not evidence of Aster venue
price/fill parity.

Capital contract: initial ¥10,000, twelve monthly ¥10,000 deposits, total
contributed ¥130,000, compounding enabled.

## Blocking evidence

The Aster bundle contains one invalid OHLC row that cannot be silently
repaired or dropped:

| Symbol | UTC | Open | High | Low | Close | Finding |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| BTCUSDT | 2025-09-13 04:00 | 115,941.8 | 115,916.1 | 115,580.7 | 115,707.3 | high < open |

The same public Aster response reproduced this row on a read-only re-fetch.
FETUSDT starts at its declared inception (`2026-01-09T18:00:00Z`) and is
recorded as an availability boundary rather than missing history.

The Binance alternate bundle passes the raw-data contract: 16/16 symbols,
140,160 hourly bars, zero duplicates, zero gaps, and zero invalid OHLC rows.
This resolves the Aster-row issue for an independent raw-data run without
silently repairing Aster data. However, the alternate-source run currently
only reaches the adapter-level reservation smoke stage: it has no production
fills, exits, mark-to-market equity, or formal PnL. Therefore NORMAL/SEVERE
integrated results are still not reported, and no formal baseline parity or
new-PENGU comparison is claimed.

The observed smoke output was 3 accepted reservations and 36,386 rejected
candidates in both NORMAL and SEVERE. Realized PnL, fees, and funding remain
zero because no fill/exit simulator is present; these numbers must not be
interpreted as BT performance.

In addition, the new raw adapters are contract-level rebuild scaffolding, not
evidence of complete Production signal parity: the full V12 feature stack,
Q102 causal model, PENGU route exits, FET BRK48 rules, V52 Aster/reference
join, and end-to-end exit/mark-to-market replay still require their source
rules and validated inputs. Their unit contracts pass, but that is not a
formal portfolio BT result.

## Source and quality evidence

The Binance compressed bundle is recorded at
`.raw-data/binance-2025-08-10-2026-08-10.json.gz` with SHA256
`4447178C2CC121B4756F3FC37A92250088F8DD5A13871839CFD5DA7BC3AF621A` and
canonical bundle SHA256
`5d2f0d6ec495bfd7455f24e2465a98b62ecc561e71044adc8eb6f739f121c400`.
Yahoo Finance chart JSON remains the accepted V52 reference source. The five
symbols load 1,735 non-null 60-minute bars each for this period; all-null
market-closed rows are skipped and partial-null rows are rejected. Yahoo alone
does not provide the paired Aster stock/futures basis and execution leg needed
to claim V50 candidate parity.

## Implemented and tested

The branch contains raw-data models/validation, Aster and Binance pagination
and funding handling, Yahoo chart normalization, raw V12 Top3, raw PENGU
COMBINED_FILTERED Q60/DD17/H72, raw Q102 Causal V4 one-slot, raw FET
residual, raw V52 cost gates, one portfolio accounting engine, and audit
helpers. The explicit raw test set plus alternate-source tests pass.

## Required next step

Implement and validate the missing Production-equivalent fill/exit/MTM
replay and the paired V52 basis/cost input. Then run both scenarios and
deterministic replay against a source manifest. Until that work is complete,
the correct status is `BLOCKED_RAW_SOURCE_OR_PARITY`; the Binance data itself
is valid and available for that next stage.
