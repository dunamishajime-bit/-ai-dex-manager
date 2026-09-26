# V12 LIVE screen vs repeated 2-hour research opportunities — verified correction (2026-09-26 JST)

**This report is a correction of the misleading interpretation "roughly five actual entries per day".** It is not a live gate update, a resident-stop backtest or a recommendation to loosen gates.

## Direct LIVE proof, 2026-09-26 19:00 JST decision snapshot

Authoritative production SHA: `e1b58060d6263a3af7ced51bec854d3e211d2f35`. Observation: `regime=NEUTRAL`, `reason=NO_COMPLETED_BAR_SIGNAL`. All 14 symbols were classified `VOLUME_RATIO_BELOW_MINIMUM` because the actual LIVE volume minimum is still **0.9845**, not the offline research values 0.80 or 0.55. For NEUTRAL regime the actual LIVE score minimum is **1.4649**.

Top actual LIVE metrics:
- LTC LONG score 0.74722555 / volume 0.17568364 / momentum 0.21221498 as *fraction*.
- BTC SHORT score 0.73788541 / volume 0.85573930 / momentum -0.02759934 as *fraction*.
- BNB SHORT score 0.52148559 / volume 0.71550682.
- ETH SHORT score 0.33056125 / volume 0.95451447.
- DOGE SHORT score 0.18257401 / volume 0.73685312.
- Entire observed universe maximum score 0.74722555. Exactly 2/14 satisfy volume 0.80 (BTC and ETH), but neither reaches score 1.00. Exactly 4/14 satisfy volume 0.55 (BTC, BNB, ETH, DOGE), but none reaches score 0.85. Thus even if those offline thresholds were applied to this frozen neutral snapshot, **zero candidates would pass both**. Further momentum/HC/rank/portfolio/venue gates could still block any candidate after relaxing score.
- Existing HP displays only the *first* failure reason, currently volume, concealing later score and quality failures. Proposed separate display of all gate results and explicit distinction between `LIVE thresholds` and `BT-only thresholds`.
- Screenshot's percent-format display of momentum warrants UI verification: runner values are fractions (e.g., BTC -0.02759934 = -2.759934%), and must be multiplied by 100 if shown with a % suffix.

VPS read-only source: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36238273538
Code: `config/v12X1AllRuntime.ts`, `lib/v12-x1-all.ts` under immutable e1b58060 source.

## September 20.7-day H1 public Aster short-sample audit

248 common H2 candles, only **170 evaluable H2 decision windows** after warmup and forward 24h requirement. Production baseline exact parity passed. A reported opportunity is a selected symbol/direction *at a 2h decision timestamp*, even when the same symbol was selected on consecutive bars, NOT a fresh independent executable order. Independent 24h/46h per-symbol spacing below is a diagnostic heuristic, not simulation of realized trades, actual stop exits, PENGU competition, gross or compounding.

| Gate volume / neutral score | Repeated H2 selected observations | Days with at least one observed candidate (JST) | 24h per-symbol separated episodes | 46h separated episodes | 24h fee-net proxy for 46h-separated episodes |
|---|---:|---:|---:|---:|---:|
| LIVE 0.9845 / 1.4649 | 114 | 9 | 37 | 30 | +1.5508% |
| Offline 0.80 / 1.00 | 133 | 10 | 46 | 35 | +0.5863% |
| Offline 0.80 / 0.85 | 141 | 11 | 49 | 37 | +0.1829% |
| Offline 0.55 / 0.85 | 156 | 11 | 48 | 36 | -0.1796% |
| Offline 0.80 / 0.70 diagnostic | 151 | 11 | 50 | 37 | -0.1472% |

For frozen baseline, 114 repeated observations occur on just nine JST dates: 2026-09-13 (5), 15 (2), 16 (3), 18 (2), 19 (20), 20 (18), 21 (23), 22 (24), 23 (17). The candidate tally includes *no* new independent signal observation on 2026-09-24 or 25 in this fully evaluable short sample. It never implied five independent trades each calendar day.

If dividing raw repeated observations by the 20.7-day overall fetch horizon, approximately 5.5 per day **is not a measured live entry frequency**. Conversely 170 H2 windows cover ~14.2 days after warmup/forward horizon; denominator choice further undermines the naive number.

Source: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36238214317
Research source on branch: `scripts/research-v12-gate-sensitivity-20260926.ts`.

## Independent full-year public Aster forward-return diagnostic (first annual audit)

Period 2025-08-10 through 2026-08-10, 4,368 evaluable H2 decisions, 14 real V12 symbols, production frozen baseline parity passed. Raw selected symbol-H2 observations: LIVE frozen 1,458 (~4.0/day average over calendar year), volume0.80-only 1,669, volume0.55/score0.85 2,762 (~7.6/day). The 24h **forced-horizon directional proxy**, not a resident-stop strategy return, was -0.810% per repeated baseline observation and -0.629% per repeated 0.55/0.85 observation. Neither figure gives integrated PnL, PF or DD and neither justifies activation. Annual independent episode calculations are separately checked before using yearly entry frequency.

Source: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36238142727

## Required acceptance gate before any LIVE modification

1. Match current exact production frozen one-year integrated five-logic NORMAL and SEVERE outputs using its original sources/data; no new ad-hoc or simplified BT engine.
2. Recalculate candidate variant 0.80/1.00 and 0.55/0.85 on the same original engine, same period and Aster historical bars; isolate no-signal dates, per-regime score distributions, entry exposure, intra-day overlap, route/HC1.75, realized stops, fees, slippage, capital competition and worst-case severe DD. A surrogate per-symbol 24h spacing is insufficient.
3. Check screenshots against the actual LIVE snapshot timestamp, show full multi-gate diagnostics rather than the first failed gate, display scores/momentum with correct units, and label every research-only threshold clearly.
4. Fail closed on genuine rate/access faults; do not force new positions merely to meet an arbitrary daily frequency.
