# V12 Gate holdout addendum — technical retention constraint only

Gate rejected the first two data requests before returning any PENGU market rows with `INVALID_PARAM_VALUE: Candlestick too long ago. Maximum 10000 points recently are allowed`.

No Gate PENGU performance data has been observed.

Therefore, before the first successful Gate data fetch, the untouched Gate holdout period is fixed to:

- warm-up: 2025-07-10T00:00:00Z
- evaluation: 2025-08-01T00:00:00Z through 2026-08-01T00:00:00Z

This is a full one-year evaluation and fits Gate's 10,000 recent 1h candle retention window at the time of testing.

Everything else remains exactly as pre-registered at `2cfe0d7bb829e6cd928cef4871e1f0168c098506`:

- candidate: `RAPID_RISKON_RELATIVE_WEAKNESS_REENTRY`
- existing V11 progression-failure logic unchanged
- re-entry must remain within current short maxHoldHours/4 (72/4 = 18h)
- re-entry signal btcReturn24h >= 0
- PENGU must re-break the failure episode low and remain below EMA72
- candidate count = 1
- no threshold sweep
- no current PENGU base-entry filtering or removal
- same Normal/Severe cost assumptions
- same +5pp win-rate / Return / PF / DD / best-trade-removal / chronological-fold promotion gates

This addendum changes only Gate's evaluable date range because of a documented API retention limitation encountered before any Gate market data was returned. RESEARCH_ONLY; no LIVE/VPS/orders/production changes.
