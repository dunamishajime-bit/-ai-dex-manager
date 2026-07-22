# V96 Stock Event Ledger

- Universe: fixed 22 Aster AI / Semiconductor stock perpetuals
- Window: 2026-07-22 23:00 UTC through 2026-07-29 01:00 UTC
- Full cadence: hourly
- U.S. session fast cadence: every 15 minutes for recent headlines, trading halts, and Aster status
- Sources: Google News RSS, Nasdaq earnings, Nasdaq Trader halts, Aster exchangeInfo, SEC EDGAR with Nasdaq public fallback, BLS and BEA live sources with explicit frozen official-schedule fallbacks, and Federal Reserve FOMC
- Google headlines are limited to the preceding 36 hours; article bodies are not stored
- Every live-source failure and every non-live fallback is explicitly recorded
- Purpose: later Baseline-versus-Event-Overlay Shadow analysis
- Trading: observation only; no Entry gate, order, LIVE, Production, VPS, or V96 change
