# RESIDUAL Entry and Exit Deep Audit — 2026-10-23

STATUS: RESEARCH ONLY — NO NEW ENTRY OR EXIT ADOPTED; PRODUCTION/LIVE UNCHANGED.

## Source and validity
- Repository: dunamishajime-bit/-ai-dex-manager. Base SHA: ebf15dee8bde0df18b2ead5bc8883dd9118ebd79.
- Original full-8 source: f8v52amzn_more/V52_AMZN_YAHOO_ENTRY_FULL8_20261022.json and SHA-matched portfolio trade ledger.
- Three verified M5 instruments: BTCUSDT, DOGEUSDT, AVAXUSDT; 114,048 rows per symbol, contiguous timestamps.
- Evaluation: 2025-08-10 to 2026-08-10 UTC. Post-study stability check: 2026-08-10 through the available price-data tail near 2026-09-01.
- Entries: fully closed HH:55 5-minute candle followed by next HH:00 M5 open. 10/30bps round-trip costs; price STOP first when same candle touches STOP and TAKE.
- Research-only independent entry experiments: no historical full8 funding, margin, order-book or dynamic account capital matching. The originally accepted full8 trades are NOT the same cohort as independently regenerated hourly candidates.

## Original full-8 baseline ledger, unchanged

|Roundtrip cost|Total integrated trades|DOGE n / wins|DOGE modeled yen PnL|AVAX n / wins|AVAX modeled yen PnL|Total RESIDUAL contribution|Full8 max MTM DD|
|---|---:|---:|---:|---:|---:|---:|---:|
|10bps|1298|17 / 8|-5,635,979|13 / 8|-433,141|-6,069,120|-14.6033%|
|30bps|1297|16 / 5|-3,668,657|13 / 8|-210,164|-3,878,821|-15.8077%|

One 10bps-only DOGE candidate, C002237 at 2026-04-30 05:00 UTC, is absent from the 30bps portfolio, which has a nearby IDLE JUPUSDT entry. The precise allocator ownership cause requires trace verification; do not mistake different admitted portfolios for a simple fee-only PnL comparison.

Previously integrated DOGE 1h loss-2%/low-MFE early exit: delta versus baseline +3,935,015 yen at 10bps but -2,158,750 yen at 30bps; DD barely changed. Prior full8 exit-only candidates are not cross-cost robust.

## New entry screen

Prior study: 25 existing entry gates, 20 regenerated LONGs, 22 new SHORTs and an 18-feature probability model, none qualified.

This follow-up: 13 fixed new/reference entry architectures per symbol, 8,747 causal hourly M5 decision opportunities for DOGE and 8,747 for AVAX. Candidates use stateful pullback recovery, EMA reclaim, past volume climax, retest/breakdown, BTC regime and relative-strength dynamics.

|Symbol|New entry|Raw signals|Non-overlap trades|10bps WR / PF|30bps WR|First-half WR|Later-half WR|
|---|---|---:|---:|---|---:|---:|---:|
|DOGE|BTC-positive pullback recovery LONG|242|148|43.24% / 0.86|39.86%|44.09%|41.82%|
|DOGE|Failed-bounce retest SHORT|133|101|46.53% / 1.31|40.59%|48.44%|43.24%|
|AVAX|BTC/AVAX trend pullback LONG|433|226|36.73% / 0.57|32.74%|36.43%|37.11%|
|AVAX|Failed-bounce retest SHORT|143|115|49.57% / 1.37|47.83%|50.75%|47.92%|
|AVAX|Original-style LONG|12|7|71.43% / 8.42|71.43%|71.43%|0 later trades|

The AVAX original-style 5 wins / 7 trades has a Wilson 95% win-rate lower bound of only approximately 35.9% and no validation-half trades. This is NOT a verified 70% entry.

Of greatest importance, the two seemingly profitable new SHORT entries degraded: DOGE PF 1.62 in training half to 0.77 in later half (37 later trades); AVAX PF 1.75 to 0.86 (48 later trades). These later samples are not untouched OOS, but already undermine stability.

Exploratory predeclared gate (both cost levels): at least 40 total trades and 20 later trades per symbol, at least 70% WR and 1.2 PF both total and later, and closed trade DD no worse than -15%. Passed: ZERO.

## Exit study, after entrance fixed

Thirteen exit variants include 5/7/10% hard stops, 6/12/18h time exits, 1h/2h early-loss exits, armed profit floors and +3% arm / 1.5% giveback trail. Both frozen original-entry cohorts and independent per-symbol dynamic re-admission were evaluated.

|Symbol plus entry|Exit|10bps n|10bps WR / PF|30bps WR / PF|10bps closed DD|
|---|---|---:|---|---|---:|
|DOGE original-style LONG|12h baseline|10|50.0% / 0.33|40.0% / 0.29|-24.7%|
|DOGE original-style LONG|6h time|10|60.0% / 0.97|50.0% / 0.85|-14.6%|
|DOGE pullback/retest LONG|12h baseline|27|40.7% / 0.72|40.7% / 0.58|-14.0%|
|DOGE pullback/retest LONG|6h time|27|48.1% / 1.06|44.4% / 0.82|-9.1%|
|DOGE failed-retest SHORT|12h baseline|101|46.5% / 1.31|40.6% / 1.09|-23.8%|
|DOGE failed-retest SHORT|18h time|90|53.3% / 1.61|45.6% / 1.37|-27.6%|
|AVAX failed-retest SHORT|12h baseline|115|49.6% / 1.37|47.8% / 1.15|-11.9%|
|AVAX failed-retest SHORT|2h, negative 3%, low-MFE|116|49.1% / 1.40|47.4% / 1.17|-15.1%|

All DD figures in this independent exit table are closed-trade unit-equity DD, NOT full-portfolio mark-to-market DD and NOT leverage-adjusted economic returns. Shorter exits may improve DD but damage PF at 30bps or later windows; longer holds may raise PF but enlarge DD and lower trade count. No candidate passed the combined entry-plus-exit adoption criteria.

## Post-study price-data tail audit (not independent forward test)

|Symbol + unchanged entry rule|Tail trades|10bps WR|10bps PF|30bps PF|
|---|---:|---:|---:|---:|
|DOGE failed-retest SHORT|5|20.0%|0.96|0.80|
|AVAX failed-retest SHORT|6|33.3%|0.61|0.47|
|DOGE pullback recovery LONG|11|36.4%|0.57|0.50|
|AVAX pullback recovery LONG|11|54.5%|1.79|1.46|

The tail is about 22 days and likely not fully independent of all other research. It confirms no robust adoption and does not justify promotion based on AVAX's 11-trade PF.

## Audit and next gate
- Existing research: 12 tests PASS.
- New entry/exit causality and accounting: 8 tests PASS.
- New annual sweep rerun 2 times with identical byte-level SHA256:
  JSON: e2dba682b290100d9c2bee4992062628aaf4232b041912a7bc1741b1c9bb8660
  Markdown: 5f59bcc2756eb61cf9e27fa078d71dd0a1b33c1a05b460843d39bcec44ef6d9e
- Historical M5 tail audit: completed.
- No LIVE, production, operator gate or order was modified.
- Next required source evidence: complete pre-gate and rejected signal tape, broker exchange time-verified funding/open-interest/basis/spread inputs, and an actually untouched holdout or newly accrued forward shadow. Pre-register a different stateful entry architecture or alpha before touching exit, then rerun current-code full8 portfolio owner/admission, all costs, mark-to-market DD, trade frequency and current LIVE parity. Do not claim standalone candidates reproduce production.

DECISION: NO CHANGE TO RESIDUAL ENTRY OR EXIT UNTIL EVIDENCE PASSES.