# P76 | Exact-hour match of ASTER Native53 and Binance Native62

Only source Native V20 short signals which fire at EXACT same UTC hour; both use original pinned SHA. Market-regime signed score must be identical prior to same UTC time. Each venue's original native exit price/time evaluated INDEPENDENTLY, 30bps.

| Exact hour original Native result | Matched source intents |
|---|---:|
| both markets win | 15 |
| both markets lose | 12 |
| ASTER win Binance lose | 0 |
| ASTER lose Binance win | 0 |

Exact simultaneous Native signal 27 of ASTER53 and Binance62 (unpaired ASTER26, Binance35). These are NOT 27 one-slot executed trades.

| 0 or >=0.5 gross policy | retained paired signals | ASTER source wins retained | Binance source wins retained | win disagreement | original source winner pair rejected ASTER/Binance |
|---|---:|---:|---:|---:|---:|
| ORIGINAL_075 | 27 | 15 | 15 | 0 | 0/0 |
| MACRO_BULL_VETO_075 | 22 | 13 | 13 | 0 | 2/2 |
| MACRO_BULL_HALF_ELSE_075 | 27 | 15 | 15 | 0 | 0/0 |
| MACRO_BULL_PENGU_WEAK_HALF_ELSE_REJECT | 25 | 15 | 15 | 0 | 0/0 |
| SIGNED_LESS_MINUS6_VETO_ELSE_075 | 25 | 15 | 15 | 0 | 0/0 |
| SIGNED_NEGATIVE_VETO_ELSE_075 | 22 | 12 | 12 | 0 | 3/3 |

Signed asof score parity verified in every matched hour; differing Native exits/outcomes are real cross-venue source differences, not score timing misalignment. This is NOT a live executed simultaneous trade report.
