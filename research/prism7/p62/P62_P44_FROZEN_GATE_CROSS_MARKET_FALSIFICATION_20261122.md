# P62 — frozen P44 market-transfer falsification, source Native V20, same gate

P44 D3 prior48h ALL3 was fixed before fetching Binance USD-M 2025 Jan-Jul. Aster & Binance OHLCV are different venues. Original Native53 source events remain immutable.

| Market | All source | All wins | Kept | Kept wins | Kept win rate | Excluded wins/total | Kept 95% Wilson | Fisher two-sided (descriptive) |
|---|---:|---:|---:|---:|---:|---|---|---:|
| ASTER_REFERENCE_2025AUG_2026NOV | 53 | 29 | 21 | 19 | 90.47619% | 10/32 | [71.09, 97.35] | 2e-05 |
| BINANCE_EXTERNAL_2025JAN_JUL | 55 | 28 | 14 | 7 | 50.0% | 21/41 | [26.8, 73.2] | 1.0 |

**Outcome:** Frozen P44 condition is not cross-market robust. In Binance source signals, selected 7/14=50%, excluded 21/41=51.22%, meaning no better discrimination in this test. Do not replace 3% with retrospective 5% threshold (P61 sensitivity showed D5 13/21 natural source).

Fisher p for Aster discovery-selected gate cannot be used as independent validation. All candidate source entries can overlap, 55 source cases are NOT 55 independent venue fills. Cross-market H1 cannot certify Aster M5 DD or real STOP.

Preserve original Native V20 and original P44 history for falsification; no production changes.
