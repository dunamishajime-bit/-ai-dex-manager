# RENDER independent SHORT: no Shadow-quality Gate / variable exits (2026-10-26)

STATUS: RESEARCH_STAGED_NOT_LIVE; no signed Aster or current Production parity. Does not authorize any LIVE orders.

## What was varied

Remove solely the six-hour Shadow **quality** entry Gate (24 historical samples, 75% win rate, PF1.35, mean +0.1%, 365-day minimum). Keep the six-hour Shadow as read-only telemetry only, preserve existing OI-free causal market entry, 12-hour cooldown, no concurrent same-symbol owners, independent .25x, existing RENDER -1%/120min/MFE<+.25% protective exit.

Historical M5 comparisons: max real hold 55m, 120m, 6h, 12h, 24h, and no maximum duration; TP +1.5%, +2%, +3%; resident stop remains -2%. No maximum time exit means positions close *only* at TP or STOP, never an arbitrary synthetic terminal price.

## Exact public-M5 research model

25 monthly archives per symbol (Aug 2024 - Aug 2026) for BTCUSDT and RENDERUSDT with source ZIP-CRC and SHA-256 checks, no M5 gaps, stop-first treatment of ambiguous M5 bars, last completed H1 and H4. Entry is unchanged: BTC H1 >= +0.15%, RENDER H1 <= -0.50%, last completed H4 <= -0.15%, RENDER taker seller >= 53%, H1 wick/open >= 0.35%. No OI in new route.

There were 25 raw H1 signals in the evaluated archive window; 11 raw H1 signals in the 2025-08-10 to 2026-08-10 economic period. Former high-WR sample Gate yielded only 1 eligible economic-year candidate.

Independent 11-entry standalone cases, 10bps round trip:
- TP+1.5%, 55m: WR72.73%, PF2.43, mean net +0.3624%.
- TP+1.5%, 6h: WR90.91%, PF6.28, mean net +1.0071%.
- TP+2%, 6h: WR90.91%, PF8.42, mean net +1.4162%.
- TP+3%, 6h: WR90.91%, PF10.20, mean net +1.7564%.
- TP+3%, 12h: WR81.82%, PF10.35, mean net +1.9412%.
- TP+3%, 24h: WR81.82%, PF5.95, mean net +1.8895%.
- TP+3%, no max duration: WR81.82%, PF6.21, mean net +1.9909%.

These are NOT shared-wallet returns and cannot be added to an eight-strategy baseline.

## Combined Native8 shared-wallet model — 10bps / 30bps

All options include the existing legacy RENDER early stop. Eight sleeves are V12, Q102, PENGU, IDLE, RESIDUAL, V52, HYPE_LONG and FET. This is an archived research Native8 model, not current Aster signed venue parity.

| Independent configuration | Final 10bps JPY | Delta to legacy-stop-only | Final 30bps JPY | Delta |
|---|---:|---:|---:|---:|
| Legacy RENDER stop only (no independent) | 279,087,048 | baseline | 169,095,336 | baseline |
| Shadow Gate OFF, TP+1.5%, 55m | 279,073,204 | -13,844 | 169,563,876 | +468,540 |
| Shadow Gate OFF, TP+1.5%, 6h | 278,093,397 | -993,651 | 167,203,194 | -1,892,142 |
| Shadow Gate OFF, TP+1.5%, no max duration | 278,093,397 | -993,651 | 167,203,194 | -1,892,142 |
| Shadow Gate OFF, TP+3%, 6h | 278,831,223 | -255,825 | 167,598,671 | -1,496,665 |
| Shadow Gate OFF, TP+3%, 24h | 279,299,136 | +212,088 | 168,089,435 | -1,005,901 |
| Shadow Gate OFF, TP+3%, no max duration | 279,495,544 | +408,496 | 168,332,699 | -762,637 |

DD across all cases approx -14.515% at 10bps and -15.015% at 30bps, no improvement.
Each model was injected into actual native owner/wallet selection for three repeat runs at each cost; accounting PASS and exactly three *accepted independent* trades per cost per case. 11 raw yearly candidate signals do not imply 11 accepted wallet trades.

## Earlier source period robustness check

On the other 2024-08 to 2025-08 sample, with 13 eligible trades after cooldown, the 10bps isolated win rate/PF was 53.85%/1.41 for TP+1.5/55m, 76.92%/2.22 for TP+1.5/6h, 61.54%/1.78 for TP+3/6h, and 61.54%/2.21 for TP+3 with no max time. All samples were used in exploratory work and are not untouched forward data.

## Decision and safety

Removing the Shadow quality Gate opens more opportunities. At 10bps, an uncapped TP+3% configuration gains JPY 408,496 in modeled eight-wallet final value, but at 30bps it LOSES JPY 762,637 and DD does not improve. 55m TP+1.5% improves the 30bps model only. Thus results do not support indiscriminately replacing production with TP+3% no-time orders. Time-unlimited live trades especially require resident venue STOPs, strong reconciliation, restart recovery, funding stress and account capacity tracking.

On the isolated research branch, IndependentPriority can be invoked with requireShadowQuality=false: history thresholds no longer block the raw market signal, but raw M5 completeness, cooldown, incumbent scoring, shared risk/margin, resident STOP and production-SHA-bound venue certification still apply. New independent orders remain disabled by default; the legacy new stop is separately default OFF. The VPS and Production are not changed by this research.

## Evidence and reproducibility

- scripts/research/render-no-shadow-exit-grid-bt-20261026.py
- scripts/research/render-no-shadow-native8-integrated-bt-20261026.py
- docs/research/results/render-dual-20261026/RENDER_NO_SHADOW_EXIT_HOLD_COMPARISON_20261026.json (18 independent model exit combinations, official archive digest manifest)
- docs/research/results/render-dual-20261026/RENDER_NOSHADOW_NATIVE8_COMPARISON_SUMMARY_20261026.json (six combined cases, 10bps and 30bps, three runs, full ledger SHA-256, accepted route count, final equity, DD, PF).
- Primary local full ledger/M5 source remains on the authorized Windows PC under C:/tmp/render-dual-preflight-native8-20261025 and C:/tmp/render-multiregime-study-20261024.
- TypeScript compilation PASS; 23 pure and 74 related runner tests PASS.

DO NOT describe this research as CERTIFIED_LIVE. A final new unified SHA + actual Aster order lifecycle / partial fills / STOP-TP readback / restart replay / shadow forward observation and operator approval remains necessary.
