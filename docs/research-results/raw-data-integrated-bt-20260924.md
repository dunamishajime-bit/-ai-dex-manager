# Raw-data integrated BT audit

Status: `BLOCKED_RAW_SOURCE_OR_PARITY`

No recovered trade ledger was used as event input. Crypto data was fetched
read-only from Aster public Futures REST. V52 reference data is a separately
identified Yahoo Finance stock source and is not claimed to be Aster crypto
data.

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

Because the raw-data contract rejects invalid OHLC and forbids post-hoc
repair, NORMAL/SEVERE integrated results were not reported. No formal
baseline parity or new-PENGU comparison is claimed.

In addition, the new raw adapters are contract-level rebuild scaffolding, not
evidence of complete Production signal parity: the full V12 feature stack,
Q102 causal model, PENGU route exits, FET BRK48 rules, V52 Aster/reference
join, and end-to-end exit/mark-to-market replay still require their source
rules and validated inputs. Their unit contracts pass, but that is not a
formal portfolio BT result.

## Implemented and tested

The branch contains raw-data models/validation, Aster pagination and funding
handling, raw V12 Top3, raw PENGU COMBINED_FILTERED Q60/DD17/H72, raw Q102
Causal V4 one-slot, raw FET residual, raw V52 cost gates, one portfolio
accounting engine, and audit helpers. The raw test set passed 36/36 before
this report update.

## Required next step

Obtain a corrected or independently reproducible Aster raw bar for the one
invalid timestamp, document the replacement, rerun validation, then execute
both scenarios and deterministic replay. Until then the correct status is
`BLOCKED_RAW_SOURCE_OR_PARITY`.
