# P107 FET official Binance USD-M archive backfill with ASTER execution gating

2026-11-23. Official Binance [binance-public-data](https://github.com/binance/binance-public-data) USD-M FETUSDT H1 monthly ZIPs were downloaded for March 2025 through January 2026. 11/11 official .CHECKSUM SHA256 checks matched and 8,088 continuous H1 bars passed time and OHLC validation, with no missing hours. Source code and complete source URL+SHA256 manifests are committed; original ZIPs and .CHECKSUM files retained on the owner PC in C:\\tmp\\disdex-prism7-p107-parity-audit-20261122\\binance_fet_1h_fill_20261123\\raw_archive, never overwriting ASTER.

Venue switch: before ASTER public FET first bar 2026-01-09 18:00 UTC use Binance *indicators only* (7,554 bars), from the first ASTER bar forward use original ASTER public H1 (6,342 bars). Total merged 13,896 hourly bars, gap count 0; original Binance/ASTER overlap 534 H1 bars and non-trivial price discrepancies: median absolute close 0.354%, p95 1.982%, max 4.148%. Venue source is explicitly recorded; **not interchangeable execution prices**. Reproduced from frozen SHA 7688ed7c... FET BRK48 native source:

- ASTER-only native: 11 raw entry candidates.
- Mixed Binance warmup / ASTER entry source: 17 FET raw entry signals.
- New six candidate signals ALL occurred before ASTER's first FET historical candle. They are **BINANCE-ONLY NON-EXECUTABLE ON ASTER**; zero new eligible ASTER entries. Post-venue switch the same 11 signals match original ASTER-only source, same timing and feature prices. Therefore no automatic increase in FET ASTER model fills.
- Current SHA c7310d34... Q102 full 20-asset preflight replay with FET hybrid source vs ASTER-only FET: 499 eligible grids, 1691 fail-closed, 49 raw candidates remain identical on decisionTs, symbol, side, family, variant and gross. LDO/RENDER and other ASTER historical source gaps remain; changing FET alone cannot resolve them.

This is a **separate cross-venue research comparison** and cannot be labeled exact P107 ASTER venue historical backtest. Do not use Binance price for ASTER fills, do not backfill a fictitious ASTER quote, and do not bypass Q102 native fail-closed on missing unrelated inputs.

No real orders, STOP actions, account state resets or Production changes.
