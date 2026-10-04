# V12 + PENGU V2 + V52 Stocks — latest one-year unified backtest

- Period: `2025-08-10T00:00:00+00:00` to `2026-08-10T00:00:00+00:00`
- Status: `PASS_RESEARCH_ONLY`
- Provisional candidate: `V12_X1.00_ALL`
- V12 time controls gate new entries only; exits and venue-resident stops remain active 24/7.

| Rank | Variant | V12 × | Entry policy | Normal return | Severe return | Severe PF | Severe PF w/o best | Severe DD | Gate |
|---:|---|---:|---|---:|---:|---:|---:|---:|:---:|
| 1 | V12_X1.00_ALL | 1.00 | ALL | 889.79% | 189.47% | 2.151 | 2.001 | -16.27% | PASS |
| 2 | V12_X0.75_ALL | 0.75 | ALL | 763.47% | 168.06% | 2.173 | 2.007 | -16.62% | PASS |
| 3 | V12_X0.50_ALL | 0.50 | ALL | 631.50% | 142.57% | 2.197 | 2.008 | -17.07% | PASS |
| 4 | V12_X1.00_JST_16_24 | 1.00 | JST_16_24 | 503.94% | 141.59% | 2.358 | 2.147 | -17.66% | PASS |
| 5 | V12_X1.00_JST_00_08 | 1.00 | JST_00_08 | 603.29% | 138.08% | 2.202 | 2.012 | -16.60% | PASS |
| 6 | V12_X1.00_JST_08_16 | 1.00 | JST_08_16 | 610.43% | 135.98% | 2.257 | 2.049 | -16.99% | PASS |
| 7 | V12_X1.00_US_RTH_OFF | 1.00 | US_RTH_OFF | 716.33% | 135.19% | 1.941 | 1.791 | -16.27% | PASS |
| 8 | V12_X0.75_JST_16_24 | 0.75 | JST_16_24 | 482.34% | 131.60% | 2.342 | 2.121 | -17.66% | PASS |
| 9 | V12_X0.75_JST_00_08 | 0.75 | JST_00_08 | 563.20% | 130.71% | 2.227 | 2.025 | -16.94% | PASS |
| 10 | V12_X0.75_JST_08_16 | 0.75 | JST_08_16 | 561.10% | 128.59% | 2.271 | 2.053 | -17.23% | PASS |

## Interpretation

The ranking is a one-year portfolio-routing comparison, not an independent untouched holdout. The selected row is therefore a shadow/paper candidate only; it is not marked LIVE eligible.

## Key limitations

- The latest year overlaps strategy research and is not an untouched independent holdout; the recommendation is for shadow/paper validation only.
- Combined drawdown is measured on completed events because synchronized mark-to-market paths for all three sleeves are unavailable; intratrade drawdown can be worse.
- V52 stock execution is an observable historical proxy and cannot reconstruct queue position, partial fills, spread, or sub-second slippage.
- US_RTH_OFF uses New York weekday/time boundaries; US exchange holidays are not separately removed from the V12 time gate.
- The crypto 5% daily latch is modeled conservatively. The deployed PENGU runner only consumes a portfolio daily-loss file when that VPS environment path is configured.
- The shared kill switch and exogenous operational failures cannot be reconstructed from market history.
