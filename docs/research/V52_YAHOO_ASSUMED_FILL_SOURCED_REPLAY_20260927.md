# 2026-09-27 Yahoo Finance V52 assumed-fill replay — precise evidence

## User-selected change
The V52 research backtest no longer requires historical Level-2, trade queue reconstruction, or verified actual venue fills **for V52**. When a V11/V50 *approximated* basis gate passes, this research run assumes an immediate fill at the available price proxy. This change is limited to the research branch; no VPS LIVE runner, stop, approval, or production Gate was changed.

**Do not claim exact LIVE V52 parity.** The true V11/V50 measures near-simultaneous Aster stock-perpetual versus cash reference basis and enforces 5-second source freshness, 1.5-second source skew, cost, spread and depth. Yahoo Finance's hourly quote opens and Aster's hourly stock-perp opens cannot reconstruct its 10-second V50 snapshot or any such five-second quote timing. The user waived L2 and authorized modeled fills; the model reports its assumptions and remaining non-L2 disparities rather than treating modeled fills as actual fills.

## Acquired source data

- Original first-party Yahoo Finance data via `yfinance==0.2.65`, `interval=60m`, `auto_adjust=False`. Actual date coverage 2025-08-01 to 2026-08-10. AMZN / META / MSFT / NVDA / TSLA each have 1,791 validated New-York-session hourly observations, not daily OHLC interpolations.
- Earlier direct Yahoo chart requests on the Linux workflow and VPS both returned HTTP 429. A separate bounded first-party Yahoo session succeeded and persisted the validated private source; no other vendor prices were silently substituted.
- Yahoo root-only archive: `/var/lib/disdex/research-bt-formal/a09-yahoo-v52-source-36290050697.tgz`, SHA256 `4e6043237b020ae862453748ea260a251d27dcb70361413dc2264ac1074e8b7f`.
- Independently acquired native Aster `AMZNUSDT/METAUSDT/MSFTUSDT/NVDAUSDT/TSLAUSDT` perpetual hourly opens. Each has exactly 8,784 continuous H1 observations from 2025-08-10 through 2026-08-10. Order books not downloaded or required.
- Aster stock-perp root-only archive: `/var/lib/disdex/research-bt-formal/a09-stock-h1-v52-36289853022.tgz`, SHA256 `03705fe70a51236d3d5e12266bb3378fa2c3fbbe96f12ac90a0f887e84b1ed34`.
- Trading SHA frozen to `a09ea45ca3cbd72100f9eb0eaae499039c40b6a0`. The two source archives and modeled ledger archive have verified SHA256 provenance and were reproduced in an isolated GitHub Actions runner.
- Only research-model results are publicly logged; all historical price source bodies and detailed decision/fill ledgers remain on private VPS.

## Separate modeled outcomes — NOT formal live performance

Signal gates are computed using Yahoo stock reference H1 and Aster native stock perpetual H1, with V11 top-one 10:00 signal and 10:30 entry and V50 at 11:30, 12:30 and 13:30. The point-in-time proxy uses each price's last-known hourly OPEN, not a future candle close/high/low. The 10-second V50 signal capture and same-time venue price cannot actually be observed with hourly prices. Missing prices fail closed. The same eligible V52 signal path is cost-tested under two explicit **assumed** round-trip costs: NORMAL 20bps and SEVERE 55bps.

| Model fill and price type | Assumed cost | Modeled fills | V11/V50 | Win rate | Unit PF |
|---|---:|---:|---:|---:|---:|
| Yahoo *cash-reference* price open, NORMAL | 20bps | 163 | 58 / 105 | 35.58282% | 0.68307 |
| Yahoo *cash-reference* price open, SEVERE | 55bps | 113 | 41 / 72 | 15.04425% | 0.18667 |
| Aster stock-perp H1 open, NORMAL | 20bps | 163 | 58 / 105 | 72.39264% | 11.18725 |
| Aster stock-perp H1 open, SEVERE | 55bps | 113 | 41 / 72 | 60.17699% | 4.42252 |

**Important:** The cash-reference price model is not Aster-perpetual PnL, and the Aster H1 mark model is not a contemporaneous executable quote. Such large differences between otherwise identical signals demonstrate proxy-model dependence, not that the LIVE strategy has one of these PFs. `unit_profit_factor` is calculated from unweighted assumed return per eligible trade; it is NOT an account-level portfolio PF, and sums of unit returns are NOT DCA returns. No cross-strategy gross competition, monthly JPY asset curve, exact protection order placement, historical funding or actual stop execution is claimed here.

- At NORMAL, 4,006 gate observations led to 163 assumed completed stock trades; V11 58 and V50 105.
- At SEVERE, 4,006 gate observations led to 113 assumed completed stock trades; V11 41 and V50 72. Higher assumed cost also changes which basis gates pass, not merely realized P&L.
- Raw price acquisition and replay tests passed. Regression tests include DST/NYSE early close, Yahoo 60m timestamp validation, no future candle lookahead, independent same-symbol/route competition, explicit missing-source rejection and Yahoo-vs-Aster fill-mode divergence.

## Immutable modeled-result artifacts

- Replay workflow: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36290325329 — completed successfully.
- Original Yahoo acquisition: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36290050697 — completed successfully.
- Aster stock price acquisition: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36289853022 — completed successfully.
- Root-only result ledger: `/var/lib/disdex/research-bt-formal/a09-v52-yahoo-model-results-36290325329.tgz`, SHA256 `1deeb95aff9f6bc2b6adcd56fc925c6b95c290bd3725dc5b72b68c13538532d5`.
- Separate ledger JSONL under `model-results/NORMAL_REFERENCE`, `SEVERE_REFERENCE`, `NORMAL_PERP`, `SEVERE_PERP`, each with SHA256 of the exact accepted trades. All three archives retained for independent replay.

## What remains before a five-logic **integrated** statement
The last verified four-crypto historical acquisition and scans remain preserved in separate private a09 archives on VPS, but the crypto formal replay still cannot verify historical actual fills or all exact route exits; its four official NORMAL/SEVERE execution paths remain `NOT_VERIFIABLE`. The V52 Yahoo assumed-fill branch now removes *V52's* historical L2 dependency for a clearly hypothetical V52 mode. A five-logic research ledger still requires chronological merging of four crypto candidate streams and V52's :30 NY executions, shared risk and gross-cap competition, asset-level monthly JPY calculation and independent all-sleeve ledger reconciliation. Do not add these standalone V52 unit returns to the earlier four-crypto-only NAV or represent such addition as compounding.

No LIVE orders or service restarts were performed.
