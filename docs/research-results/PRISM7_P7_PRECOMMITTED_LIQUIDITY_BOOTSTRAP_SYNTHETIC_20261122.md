# PRISM VII P7 — 四期間の流動性クラスタ × 人工価格レジーム（実験前固定）

Status: **RESEARCH ONLY** — the synthetic test is a price/print availability and causal direction-classifier stress; **NOT** a native PENGU entry+STOP/full P&L simulation.

## Why a different generator is required

P7-4 frozen 40-path ILLIQUID synthetic generator had mean 56.123% zero-print M5, but only 0.025 full zero-print H1 per 72-hour path (0.035%), max M5 no-print run 18 across all40 paths. Observed PENGU across 2025 Aug 01–2026 Nov 18: 136,512 M5, 74,608 no-print (54.653%), 883 full empty H1 of 11,376 (7.76%), max no-print 112 M5 (9h20m). Thus marginal zero fraction alone is not enough; *temporal clustering* strongly differs.

Read-only quality segmentation by already downloaded public PENGU archives:

| Liquidity-only calibration period (name) | M5 count | Zero-print fraction | Empty full H1 fraction | Longest no-print run |
| --- | ---: | ---: | ---: | ---: |
| PRE_20250801_20250924 | 15,552 | 75.913% | 18.287% | 112 M5 |
| MAIN_PREFIX_20250924_20260803 | 90,144 | 53.807% | 6.723% | 87 M5 |
| MAIN_SUFFIX_20260803_20261001 | 16,992 | 52.843% | 9.605% | 109 M5 |
| POST_20261001_20261118 | 13,824 | 38.477% | 0.434% | 19 M5 |

These cohorts are historically seen. Liquidity calibration is not evidence of a blind OOS trade edge.

## Freeze BEFORE P7 experiment

1. **Sample only print availability**: each synthetic path selects a deterministic, fixed-seed, contiguous 864 × 5m (72h) window of **whether PENGU source candle has positive traded volume** from one of the four periods. Select a random hour-aligned start index without using source returns, winners, signal labels, target prices or native STOP. Preserve the zero-print **run lengths, clustering and empty-hour structure** exactly within each selected mask. Do **not** copy real prices/returns or trade classification from source.
2. Independently generate PENGU and BTC prices with P7-4's existing eight economic market-regime drift/volatility schedules and a separate deterministic price RNG. BTC is fully printed; PENGU printed OHLCV/taker data only when source mask has positive volume. During no-print periods, PENGU latent price may move internally while observable OHLC remains previous printed close with **volume=0**; next positive print includes a potential opening gap. Signatures are a model, not actual exchange quotes.
3. **Eight price regimes** = `PERSISTENT_DOWN`, `PERSISTENT_UP`, `SIDEWAYS`, `DOWN_THEN_SQUEEZE`, `UP_THEN_DUMP`, `HIGH_VOL_CHOP`, `ILLIQUID_ZERO_PRINT`, `BTC_PENGU_DIVERGENCE`. Four historical print-mask cohorts × **12 independent predetermined seeds 2026112280…2026112291** ⇒ **384 price paths** and **16,128 hourly decision checkpoints** (42 per path, 25h warm-up, six-hour outcome). The liquidity profile is an orthogonal axis; even the "ILLIQUID_ZERO_PRINT" price regime uses the selected historical mask, no additional IID dropout.
4. Both exact frozen P6 and P6B as-of direction-classifier functions are applied **unchanged** to all synthetic checkpoints. Do not adjust thresholds or choose favorable paths after seeing outcomes. Future 6h gross returns are *diagnostic targets*, not signals or executable profits.
5. Verify deterministic rerun SHA256; input M5 source SHA256 and selected mask start indices; OHLCV time continuity, nonpositive-volume bars not treated as fills, the future-prefix invariance of both classifiers, 320/384 pathway independence caveat, profile-specific zero-print fractions and full no-print hours. Report error if source quality/print bins disagree.
6. **Success is not promised**. Even if average forward direction improves, user acceptance still requires a complete pinned PENGU signal+STOP artificial market replay, new untouched market evidence, real execution / fee / Funding / Gross / DD<=20%, and enough events without suppressing legitimate trades. P7 is a falsification step, not a replacement for all those.

Economic outcome fitting is prohibited in liquidity bootstrap sampling: source price/volume magnitude and native win/loss are never inputs to the mask selection.
