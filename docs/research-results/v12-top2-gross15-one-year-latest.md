# V12 Top2 residual GROSS 1.50 — latest complete one-year backtest

- Period: `2025-08-01T00:00:00Z` to `2026-08-01T00:00:00Z` (365 days)
- Data: Binance USD-M futures
- Timeframe: 2H
- V12 risk sizing: current `riskPct=3.19%`; per-position entry GROSS cap `1.00x`
- Requested Top2 architecture: candidate #1 + candidate #2 using residual V12 aggregate GROSS
- Tested V12 aggregate entry caps: `1.00x`, `1.25x`, `1.50x`
- Normal costs: 5 bps fee, 0 bps added slippage
- Stress costs: 10 bps fee, 5 bps added slippage
- Research only: no production change, no VPS change, no orders sent
- GitHub Actions run: `32472874489`

| Variant | Normal return | Normal PF | Normal DD | Stress return | Stress PF | Stress PF w/o best | Stress DD | Stress trades | Avg GROSS stress | Observed max MTM GROSS stress |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Current 1-slot / cap 1.00 | 120.00% | 3.051 | -7.27% | 46.69% | 1.652 | 1.576 | -9.52% | 253 | 0.052x | 1.037x |
| Top2 residual / cap 1.00 | 159.26% | 2.767 | -8.28% | 58.56% | 1.590 | 1.531 | -11.07% | 378 | 0.063x | 1.049x |
| Top2 residual / cap 1.25 | 176.65% | 2.577 | -7.47% | 59.53% | 1.502 | 1.451 | -10.70% | 453 | 0.071x | 1.303x |
| Top2 residual / cap 1.50 | **203.03%** | **2.545** | **-8.51%** | **63.71%** | **1.474** | **1.428** | **-10.83%** | **453** | **0.079x** | **1.559x** |

For Top2 residual cap 1.50 in stress mode: win rate `44.59%`; rank-2 entries `173`; entries while another V12 position was held `230`; two-position bars `2.95%`; capacity blocks `0`.

The backtest calculation step completed successfully and produced `PASS_RESEARCH_ONLY`. The workflow's post-calculation validation step failed only because it compared mark-to-market observed GROSS (`1.559x`) to the entry-sizing cap (`1.500x`). This is not an entry-sizing breach: after entry, price and equity movement can make current mark-to-market GROSS drift above the entry cap. The result should therefore be interpreted as an entry cap of 1.50x with observed post-entry MTM drift of about +3.95% in this sample.

## Interpretation

Top2 residual materially improves return over the current one-slot baseline. Raising the Top2 aggregate entry cap from 1.25x to 1.50x increases normal return by 26.38 percentage points and stress return by 4.18 percentage points, while stress DD changes only from -10.70% to -10.83%. The trade count is effectively unchanged, so the gain is sizing rather than extra signal frequency. PF declines as GROSS rises, but stress PF remains above 1.47 and stress PF without best remains above 1.42.
