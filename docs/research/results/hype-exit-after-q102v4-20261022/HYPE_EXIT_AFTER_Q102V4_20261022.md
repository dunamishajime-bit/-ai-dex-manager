# HYPE LONG: protective initial loss and profit floors with V4/Q102 adopted rules fixed

> Research only. No LIVE or Production alterations. V4 adopted 4, Q102 adopted 3 and HYPE75 existing entry parameters unchanged.

Window: 2025-08-10 to 2026-08-10; initial capital JPY 10,000 compounded; zero contributions. Native 8-logic dynamic admission, pending/gross, 10bps vs 30bps.

| Current HYPE trades from accepted baseline | 10bps | 30bps |
|---|---:|---:|
| Trades | 40 | 38 |
| Wins / Losses | 12 / 28 | 13 / 25 |
| Net HYPE PnL JPY | 9,453,396 | 3,550,521 |
| Loser median MFE | +0.73% | +0.69% |
| Loser median MAE | -1.74% | -1.70% |

## Five full8 economic tests

| HYPE-only candidate | 10bps final JPY | DD 10bps | 30bps final JPY | DD 30bps | NEW HYPE exits 10/30bps |
|---|---:|---:|---:|---:|---:|
| HYPE_BASELINE_3ACCEPTED | 198,324,735 | -14.60331% | 88,431,931 | -15.75383% | 0/0 |
| HYPE_EARLY_0H_MINUS1P5_MFE0P3 | 194,099,317 | -14.60331% | 81,793,768 | -15.75383% | 2/2 |
| HYPE_PROFIT_ARM0P8_FLOOR0P3 | 164,263,052 | -14.60331% | 55,626,272 | -16.91736% | 18/17 |
| HYPE_BOTH_EARLY1H_PROFIT1P5 | 169,054,888 | -14.60331% | 63,523,545 | -17.55497% | 17/17 |
| HYPE_PROFIT_ARM3_FLOOR1 | 187,113,867 | -14.60331% | 78,678,609 | -16.96334% | 4/4 |

## Source findings and decision

Existing ATR-derived HYPE H1 TREND protective STOP and TAKE_PROFIT are retained. Historical reference records 28 STOP + 12 TP for 10bps and 25 STOP + 13 TP for 30bps. No HYPE LONG entry gates changed.
A 0h 1.5% early adverse STOP was hit by a previous modeled TP winner and a previous STOP loser; changes of the dynamic 8-strategy allocator can reduce final wealth even when one loser is rescued.
Extra profit STOP arms only on fully completed previous 5-minute candle CLOSE and executes with gap-aware conservative next-bar model fill. It is not a guaranteed realized floor.
Historical tests are in-sample. Acceptance needs risk-first integrated economics, holdout, signed venue protective stop and latest Task9 independent source parity. No LIVE deployment or real orders made.
All selected cooldown last-two iteration decision/trade/event/MTM/metric ledgers reproduced identically (50 SHA256 matches). Full raw portfolio artifacts remain on owner Windows research drive.
