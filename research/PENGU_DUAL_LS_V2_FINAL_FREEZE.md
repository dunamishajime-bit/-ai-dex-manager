# PENGU_DUAL_LS_V2_FINAL_FREEZE

Status: RESEARCH FREEZE ONLY. Do not change parameters during production integration. Deployment/activation remains subject to the repository's official fail-closed gates.

Evaluation window: 2025-08-10 00:00 UTC <= entry < 2026-08-10 00:00 UTC.
Base fee assumption: 6 bps per side. Stress: +35 bps per side. Entry: next 1h open. Max one PENGU position; Short priority; 6h cooldown.

## Frozen strategy

### Short
- 72h PENGU return <= 0%
- 24h PENGU return <= -7% starts an impulse window
- setup expires after 24h
- track local low; arm after +1.25% bounce; invalidate if bounce > +6%
- after armed, require all:
  - close < previous 1h low
  - close < EMA72
  - EMA72 < EMA168
  - PENGU 24h return - BTC 24h return <= -2%
  - volume ratio (last 6h average / prior 36h average) in [0.25, 3.0]
  - BTC 24h return <= +4%
  - PENGU 24h return >= -12%
  - BTC / BTC EMA168 - 1 >= -4%
  - RSI14 >= 30
- enter next 1h open
- max hold 72h
- hard stop: +8% adverse
- trailing: activate at +15% favorable, retrace 4%

### Long
- 72h PENGU return >= +15%
- close > prior 18h high
- PENGU 24h return >= +10%
- PENGU 24h return - BTC 24h return >= +1%
- BTC 24h return >= 0%
- RSI14 in [48, 78]
- volume ratio (last 6h average / prior 36h average) in [0.25, 3.0]
- ATR24 / close <= 5%
- close > EMA168
- rising-edge entry only
- enter next 1h open
- max hold 120h
- hard stop: -8%
- trailing: activate at +10% favorable, retrace 3%

### Position sizing
Gross = clip(0.75 * 0.02 / ATR24_ratio, 0.60, 0.75).

## Evidence summary

### OKX USDT perpetual, exact recent year
- trades: 32 (Long 5 / Short 27)
- return: +134.77%
- PF: 2.904
- max DD: -11.31%
- win rate: 59.38%
- +35 bps/side stress: +100.08%, PF 2.381, max DD about -14.05%
- 1h entry delay: +76.10%, PF 2.258
- stress + 1h delay: +50.14%, PF 1.855
- large waves (72h move >=20%): 20, captured 11 (55.0%), wave-linked PnL +68.35 percentage points
- quarter normal returns: +36.88%, +39.91%, +20.27%, +1.80%
- latest-quarter stress: -1.85% (7 trades)

### Aster perpetual, exact recent year
- trades: 30 (Long 5 / Short 25)
- return: +135.37%
- PF: 2.962
- max DD: -16.17%
- win rate: 60.0%
- actual Aster funding applied: +137.56%, PF 2.993, max DD about -16.15%
- actual funding + 35 bps/side stress: +103.71%, PF 2.457, max DD about -17.97%
- large waves: 19, captured 10 (52.63%), wave-linked PnL +75.99 percentage points
- quarter normal returns: +42.84%, +44.59%, +9.17%, +4.30%
- latest-quarter stress: +1.65%

### Bitget USDT perpetual, untouched external validation
This venue was not used to select or tune the frozen 72h regime thresholds.
- aligned data: 9,263 hourly rows from 2025-07-20 through 2026-08-09 (near-complete warmup + evaluation coverage)
- trades: 33 (Long 5 / Short 28)
- return: +147.49%
- PF: 2.990
- max DD: -11.31%
- win rate: 60.61%
- +35 bps/side stress: +109.73%, PF 2.450, max DD -14.05%
- 1h entry delay: +115.07%, PF 2.600, max DD -11.24%
- stress + 1h delay: +83.04%, PF 2.131, max DD -12.21%
- large waves: 19, captured 9 (47.37%), wave-linked PnL +56.06 percentage points
- quarter normal returns: +41.79%, +34.75%, +27.57%, +1.54%

### Robustness checks
OKX: removing the largest winning trade leaves about +102.04%; removing the best month leaves about +74.07%.
Aster: removing the largest winning trade leaves about +102.70%; removing the best month leaves about +72.77%.

### Excluded external tests
- Bybit: GitHub Actions runner received HTTP 403; no strategy result.
- KuCoin: returned only 3,944 aligned hourly rows over a period that should contain about 9,264; excluded because 24h/72h rolling features would not represent calendar hours reliably.

## Freeze rule
Do not change parameters based on any subsequent evaluation result. New data after this freeze must be treated as forward/OOS evidence. Any parameter or family change creates a new version and restarts the selection protocol.

Research source freeze SHA: `f6821440b847a5556bfc4d58c2e32bc6c0ed7d4e` on `research/pengu-dual-ls-v2-20260810`.
