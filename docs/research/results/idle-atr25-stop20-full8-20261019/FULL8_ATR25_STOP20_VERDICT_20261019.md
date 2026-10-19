# Latest 8-strategy integrated backtest — ATR2.5% + SHORT STOP-risk20% + Idle residual sizing

**2026-10-19 | STATUS: REJECT production adoption after current full8 re-test.**

Backtest anchor: 2025-08-10–2026-08-10, starting ¥10,000, no deposits, compounded H1 mark-to-market, 10/30bps. Original 2026-10-17 eight-strategy 5-minute overlay source was independently replayed to the exact frozen result at both costs. V12 V4, Q102, HYPE, FET, V52, PENGU and RESIDUAL signals and exits retained; only Idle SHORT admission/size modified.

## Exact comparison

| Scenario | 10bps final JPY | 10bps DD | 10bps PF | 10bps trades | 30bps final JPY | 30bps DD | 30bps PF | 30bps trades |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Frozen original | ¥222,818,967 | -15.6206% | 3.459 | 1310 | ¥124,289,207 | -16.7878% | 3.079 | 1307 |
| ATR 2.5% only | ¥225,159,278 | -15.6206% | 3.472 | 1306 | ¥123,091,563 | -16.7878% | 2.959 | 1302 |
| ATR + 20% budget (full/reject) | ¥198,337,058 | -15.6105% | 3.302 | 1295 | ¥94,577,503 | -16.7994% | 2.795 | 1291 |
| ATR + 20% budget (residual 0.25x+) | ¥183,894,335 | -15.6228% | 2.938 | 1307 | ¥85,908,975 | -16.7994% | 2.456 | 1311 |
| Stress gap 0% / other SHORT stop 10% | ¥186,127,368 | -15.6151% | 2.969 | 1309 | ¥86,663,305 | -16.8183% | 2.473 | 1314 |
| Stress gap 1% / other SHORT stop 10% | ¥184,250,872 | -15.6151% | 2.941 | 1308 | ¥86,702,380 | -16.8183% | 2.472 | 1312 |
| Stress gap 2% / other SHORT stop 5% | ¥186,172,942 | -15.6242% | 2.968 | 1315 | ¥86,882,284 | -16.8036% | 2.477 | 1320 |
| Stress gap 2% / other SHORT stop 15% | ¥183,931,296 | -15.6201% | 2.984 | 1302 | ¥82,333,710 | -16.7848% | 2.437 | 1308 |

## Formal nominal proposal verdict (2% adverse STOP gap, other shorts 10% native stop proxy)

- 10bps: ¥183,894,335 vs ¥222,818,967, **¥-38,924,632** final-wealth loss; DD -15.6228% vs -15.6206% (**-0.0022 percentage-points deterioration**).
- 30bps: ¥85,908,975 vs ¥124,289,207, **¥-38,380,232** final-wealth loss; DD -16.7994% vs -16.7878% (**-0.0116 percentage-points deterioration**).
- Idle accepted modeled trades: 10bps original 71 vs nominal 65; 30bps original 74 vs nominal 75. Whole-portfolio trades above. After lot normalization, nominal partial accepted Idle gross never below 0.2475x.
- 10bps full-width budget candidate reason counters include 62 budget-below-floor and 43 venue-rounding-below-floor rejections (candidate-level, not independent winning trades).

## Integrity and interpretation

- The 20% is the **account-equity budget for modeled maximum SHORT loss to STOP** before a new Idle SHORT order, not a 20% portfolio maximum-drawdown threshold. Existing SHORTs are marked at the causal H1 admission timestamp; unrealized winner profit is not counted as negative risk credit. New Idle 10% STOP + 2% stressed gap + 10bps conservative round trip is the nominal risk assumption.
- The old five-runner ~JPY 208 million residual-sizing result came from a different, 1,284-event portfolio and **cannot** validate the October-17 eight-strategy candidate.
- The scenario sweeps show profit loss across all tested gap and cross-runner STOP assumptions. DD sensitivity is at most a few hundredths of one percentage-point; this is not a material improvement.
- Crucially, the frozen H1 engine does **not** have actual historical cross-runner signed STOP prices, unsigned pending orders, margin treatment, or exchange execution. The modeled 5%/10%/15% other-short STOPs are scenario assumptions, not verified past orders.
- The research-only partial venue policy includes a 1% one-step rounding tolerance around 0.25x; current staged TS code must match whichever final physical minQty/stepSize rule is adopted.
- Independent forward/out-of-sample validation remains outstanding. V52 stock M5 historical coverage was previously incomplete.
- No new LIVE deployment, safety latch change, order, position, or protective STOP change.

## Recommendation

**Reject ATR2.5% + global SHORT STOP-risk20% + residual sizing as a combined LIVE change in the latest eight-strategy version.** Even ATR2.5% alone has zero meaningful drawdown improvement and mixed 10/30bps asset effect. Investigate specific Idle losing routes, or account-wide SHORT overlap behavior with real signed STOP and pending data before considering a replacement candidate.

## Source inputs and reproducibility

- Current full8 model: `research/idle_atr25_stop20_current_full8_bt_20261019.py` SHA256 `12582879d2638610acc8d9379eb5b0474a088ed774aa6dc62010a51b0829fe76`
- Frozen baseline bootstrap: `C:/Users/dis/Desktop/disdex-idle-basket-bt-20261019/research/long_two_axis_latest_full8_20261019.py` SHA256 `f861140de0a123aef0e4ce93f21e6b0b83ec9f9594921c4bca0439fc65f56108`
- Outputs: this folder's `*_10BPS.json` and `*_30BPS.json`, plus `FULL8_ATR25_STOP20_VERDICT_20261019.json`.
