# 2026-10-28 Q102 exact-source native Aster H1 acquisition audit

**NOT A FULL 8-STRATEGY ECONOMIC BACKTEST; NOT A LIVE DEPLOY CERTIFICATE.**

Target: Q102 Causal V4 `ef1ab178e26a7bf5bddb6473467765edba242e1d`.

- The Aster public **native futures** `/fapi/v1/klines` GET endpoint returned all **23 required symbols**, 5,112 contiguous hourly candles each, 2026-01-10 00:00 UTC through 2026-08-10 23:00 UTC; 117,576 1H candles; no gaps. Raw evidence and lossless gzip files are retained on the owner PC, while only cryptographic source receipts are committed to this public repo.
- The earliest returned Aster history for ENA, FET, FIL, LDO, JUP, RENDER, TAO and TIA postdates the 2025-02-10 start needed as a 181-day warmup for a 2025-08-10 signal. Seven of these also lack native August 2025 prices. Thus the exact current 23-symbol/181-day source contract **cannot run at every timestamp** in the historical full-year period.
- Native Q102 source **actually executed on VPS staging** as the unprivileged `deploy` user against 23 real Aster symbols at 2026-08-10 00:00 UTC; its result was NO_SIGNAL. Toggling only `basePositionActive` for another runner produced the identical signal. Signed venue requests and orders: **zero** during this signal-only test.
- Ten points sampled at UTC midnight at 72-hour intervals from 2026-07-13 to 2026-08-09 all yielded NO_SIGNAL. **These ten selected instants cannot establish any hourly frequency, PnL, DD or real portfolio return**. All-hour Q102 source replay, accepted-entry and exit simulation, 8-sleeve shared wallet replay at 10/30bps and operator certification are still required.
- Already merged **2026-10-27** Native8 8-strategy research ledgers are in `docs/research/2026-10-27-v12-v4-cd-render-native8/`. Their Q102 source is older `dbf84542`, not the new target, so they are not a substitute.
- Actual old Q102 LIVE is left unchanged; new version is not activated. Do not edit shared Operator activation, fabricate a `sourceParity=true` economic certification or bypass the Fail-Closed promoter.

Evidence files: `aster-availability-screen.json`, `aster-earliest-available-bar.json`, `aster-native-h1-acquisition-manifest.json`, `q102-exact-source-native-h1-sampled-signals.json`, `source-coverage-and-bt-readiness-audit.json`.
