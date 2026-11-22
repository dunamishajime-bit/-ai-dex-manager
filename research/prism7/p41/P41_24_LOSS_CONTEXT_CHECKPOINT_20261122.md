# P41: Native V20 original 24 losses, timing and missed downleg

**53/53 frozen source-native H1 signals reproduced; 29 original wins and 24 original losses. No orders or Production modifications.**

## Key findings

- All 24 source losers had a >=3% price drop from 24h-prior H1 opening price to their eventual native entry.
- 26 of the 29 original source winners had the same >=3% drop. Thus it is NOT by itself a reliable discriminator.
- 19 of 24 losers vs 12 of 29 winners had >=7% maximum H1 close peak-to-subsequent-close trough drop in the prior 24h; exploratory, previously inspected cohort.
- Eight losing Native entries had earlier full Short V20 signals in the previous 48h; 14 earlier signal events in total. All 14 signals were already represented as other original 53 source trades and overlapped original 53 source holding intervals.
- Across the 12 cases where post-entry favorable M5 closed return never reached 1%, 10 hit hard stop, 2 max-hold.
- All 12 of those had >=3% prior 24h price drops, and 8 had no earlier full Native short signal in the preceding 48h.
- Earlier first impulse-only H1 candidate could show a >1% net fall to original late entry in 6/12, and 3 of them had no earlier complete Native signal.
- For all 24 losers, 11 had a >=1% net price drop from first impulse-only next-H1-open candidate to native entry; an armed-only candidate showed >=1% in 6/24. These are NOT trades: the alternative entry fails the original Native V20 gate and early STOP / native exit has not been replayed.

## Each original losing Native trade

| Entry UTC | Id | Native net | Original loss type | Prior24 fall | Earlier native signals | Impulse-only pre-entry proxy net |
|---|---|---:|---|---:|---:|---:|
| 2025-08-15T19:00 | PENGU_00003 | -8.3% | No favorable 1% | 3.03% | 0 | 4.3249% |
| 2025-08-18T08:00 | PENGU_00004 | -0.45% | Gave back >=3% | 5.04% | 0 | -0.3984% |
| 2025-08-20T14:00 | PENGU_00006 | -8.3% | No favorable 1% | 6.42% | 0 | 0.9475% |
| 2025-09-01T11:00 | PENGU_00008 | -8.3% | Gave back >=3% | 3.04% | 0 | -3.5374% |
| 2025-10-22T18:00 | PENGU_00005 | -3.94% | Gave back >=3% | 10.0% | 0 | 3.6963% |
| 2025-10-23T12:00 | PENGU_00006 | -8.3% | No favorable 1% | 3.45% | 1 | 3.8091% |
| 2025-11-09T01:00 | PENGU_00013 | -8.3% | Gave back 1-3% | 6.73% | 0 | 0.7473% |
| 2025-11-09T10:00 | PENGU_00014 | -8.3% | No favorable 1% | 6.53% | 1 | 3.3249% |
| 2025-12-06T14:00 | PENGU_00021 | -8.3% | No favorable 1% | 3.38% | 0 | 1.6919% |
| 2025-12-18T18:00 | PENGU_00034 | -8.3% | Gave back >=3% | 7.01% | 3 | 5.2071% |
| 2025-12-19T00:00 | PENGU_00035 | -8.3% | Gave back 1-3% | 7.79% | 4 | 7.7055% |
| 2026-02-28T16:00 | PENGU_00051 | -8.3% | No favorable 1% | 4.86% | 0 | 4.3822% |
| 2026-05-28T11:00 | PENGU_00075 | -2.65% | Gave back >=3% | 7.18% | 0 | -1.1377% |
| 2026-05-28T20:00 | PENGU_00076 | -1.53% | Gave back 1-3% | 7.69% | 1 | -0.068% |
| 2026-06-19T04:00 | PENGU_00080 | -2.78% | Gave back 1-3% | 3.36% | 0 | 2.9733% |
| 2026-07-17T20:00 | PENGU_00086 | -8.3% | No favorable 1% | 4.42% | 0 | -1.6258% |
| 2026-07-28T10:00 | PENGU_00088 | -2.09% | Gave back >=3% | 7.94% | 0 | -0.6219% |
| 2026-09-02T17:00 | PENGU_00101 | -8.3% | No favorable 1% | 4.67% | 0 | -0.0324% |
| 2026-09-04T18:00 | PENGU_00103 | -8.3% | No favorable 1% | 8.35% | 0 | -0.5197% |
| 2026-09-04T23:00 | PENGU_00104 | -8.3% | No favorable 1% | 5.14% | 1 | -0.9836% |
| 2026-10-09T00:00 | PENGU_00003 | -3.89% | No favorable 1% | 8.48% | 1 | 9.1804% |
| 2026-10-09T05:00 | PENGU_00004 | -3.64% | Gave back 1-3% | 5.76% | 2 | 7.6307% |
| 2026-10-24T21:00 | PENGU_00006 | -2.13% | Gave back >=3% | 4.73% | 0 | -1.7493% |
| 2026-10-30T08:00 | PENGU_00008 | -1.27% | No favorable 1% | 5.68% | 0 | -0.6376% |

## Limits

Prior high-to-low movement is a retrospective observation. The first -7% impulse H1 is observable at candle close, but entering then changes the actual Native Short V20 logic: it still requires a bounce, rebreak, volume, EMA, RSI and BTC gates.
Earlier prototype candidate return is only measured up to the later original source entry, which is a hindsight exit time. Actual earlier native exit and STOP, costs, funding, overlapping slots and shared risk have not been replayed. Do not adopt for Production without forward / blind validation.

Sources, case data, pinned H1 SHA and reproducible script are recorded in the companion JSON and original source ledger.
