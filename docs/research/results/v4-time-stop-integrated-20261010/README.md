# V12 V4 TIME resident STOP comparison (2026-10-10)

STATUS: RESEARCH ONLY. No Production activation authorization.

Historical H1 source and exact 41-route engine; TIME exit preserved unless resident emergency STOP triggers.

| Cost | STOP policy | Final JPY | PF | Max DD | Total trades | Filled STOPs |
|---:|---|---:|---:|---:|---:|---:|
| 10bps | none | 291,326,103 | 4.0490 | -20.420% | 1222 | 0 |
| 10bps | fixed_4pct | 212,447,857 | 3.4772 | -18.295% | 1252 | 124 |
| 10bps | fixed_6pct | 258,030,782 | 3.7569 | -19.396% | 1240 | 51 |
| 10bps | fixed_8pct | 282,646,704 | 4.1126 | -19.526% | 1228 | 17 |
| 10bps | fixed_10pct | 280,104,702 | 3.9839 | -19.982% | 1227 | 12 |
| 10bps | fixed_12pct | 276,627,364 | 3.9621 | -20.527% | 1224 | 7 |
| 10bps | atr_4x | 225,945,620 | 3.4829 | -19.332% | 1248 | 113 |
| 10bps | max_8pct_4atr | 282,588,238 | 4.1125 | -19.526% | 1228 | 17 |
| 20bps | none | 231,193,740 | 3.6557 | -20.966% | 1224 | 0 |
| 20bps | fixed_8pct | 228,069,633 | 3.7834 | -19.974% | 1228 | 17 |
| 20bps | fixed_10pct | 222,556,520 | 3.6645 | -20.440% | 1228 | 12 |
| 20bps | max_8pct_4atr | 228,016,094 | 3.7833 | -19.973% | 1228 | 17 |
| 30bps | none | 174,749,524 | 3.2776 | -18.389% | 1218 | 0 |
| 30bps | fixed_8pct | 162,548,087 | 3.3417 | -18.189% | 1223 | 17 |
| 30bps | fixed_10pct | 166,308,018 | 3.2851 | -17.948% | 1225 | 12 |
| 30bps | max_8pct_4atr | 162,485,484 | 3.3416 | -18.189% | 1223 | 17 |

## Recommendation (pending explicit policy authorization)
The fixed 8% emergency STOP is the most balanced discrete policy for 10/20bps.
10bps: baseline 291.326M JPY DD -20.420%; fixed8 282.647M JPY DD -19.526%.
20bps: baseline 231.194M JPY DD -20.966%; fixed8 228.070M JPY DD -19.974%.
30bps is only a stress test: baseline 174.750M JPY; fixed8 162.548M JPY.
Among 17 filled STOPs in fixed8 10bps, 12 were REC_Y06_REV_D0_T72.
A tighter fixed4 STOP causes large reallocation and damages profit.

## Reproducibility and limitations
- Exact unchanged 10bps baseline 1,222 trades, JPY 291,326,102.6203428, DD -20.420013795%.
- Candidate STOP price: LONG entryPrice*(1-fraction), SHORT entryPrice*(1+fraction).
- Stop touched on hourly high/low; adverse gap fill LONG min(open,stop), SHORT max(open,stop).
- Integrated engine replays all strategy exits and resource reallocations, not merely fixed-trade cohort.
- Source H1 market ends 2026-08-10. Forward results Aug-Oct not yet available; historical BT remains in-sample.
- No real STOP execution, intrahour sequence, orderbook, exchange tick rounding, broker fee/funding parity.
- The fixed8 formula is a research recommendation, NOT an already authorized TIME37 stop contract.
- Keep the V4 order gate fail closed until separate user/operator STOP policy approval, 41-route parity and full execution certification.
- Detailed full output is retained only on authorized research Windows PC; per-trade hashes are in consolidated-comparison.json.

Scripts: scripts/research/v12_v4_time_resident_stop_integrated.py and scripts/research/v12_v4_time_resident_stop_sensitivity.py.
