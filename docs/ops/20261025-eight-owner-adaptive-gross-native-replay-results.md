# 2026-10-25: eight-owner native event-loop adaptive GROSS rescue results

## Method and source integrity

Executed **real archived 2026-10-23 eight-owner native chronological integrated model**, not a frozen accepted-trades resizer. Every run replays signals, position ownership, actual modeled entry/exit, historical H1 and 5m STOP paths, funding, wallet, shared gross caps, daily risk and route cooldowns. The only experimental source modifications are at the native capacity and normalized-quantity admission gates, never at strategy entry/exit generation.

Period: 2025-08-10–2026-08-10; initial 10,000 JPY; **zero monthly contributions**; 10bps and 30bps as separate stress cases. Historical selected research gross caps are crypto 3.5x and total 4.75x, not the misapplied 3.0x / 4.25x caps from earlier alternative research.

IMPORTANT: 2026-10-23 **research** source, NOT an exact certified current live eight-SHA match, not signed Aster L2 fills, and not a valid auto-LIVE deployment. Original V52 stock tape has eleven previously suppressed native stock candidates that cannot be regenerated from the archived 99 rows.

Research patch only allows fractional sizing when another strategy was already open with position entry time strictly before the candidate timestamp. Native venue minQuantity/minNotional step normalization is still executed. Zero or insufficient residual GROSS is still rejected; remaining strategy/position/portfolio shared limits, risk Gate, stop, signal cooldown and time-ordered reselection remain active.

One score proxy experiment uses a smoothed, **causally closed strategy-wide win rate**, (past wins + 5)/(past closed trades + 10), requiring at least 12 historical closes strictly before each new candidate; this is a *research fallback*, NOT the true cross-strategy candidate Score. 60/65/70 thresholds were run. Additional JUP and JUP/TIA rescue exclusions are exploratory selected after seeing aggregate results, so cannot qualify as independent validation.

## Correct same-source comparative backtest results

| Condition | Cost | Final JPY | Closed trades | PF | WR | Max MTM DD | Later-period PnL JPY |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Native baseline | 10bps | 247,438,945 | 1298 | 4.1254 | 72.34% | -14.60% | 198,438,888 |
| Native baseline | 30bps | 144,336,413 | 1297 | 3.4650 | 69.55% | -15.81% | 122,286,963 |
| Gross-only fractional rescue: IDLE/RESIDUAL | 10bps | 233,136,935 | 1338 | 3.6536 | 71.52% | -14.60% | 188,226,467 |
| Gross-only fractional rescue: IDLE/RESIDUAL | 30bps | 120,966,331 | 1327 | 2.9859 | 68.65% | -15.81% | 103,657,842 |
| Causal strategy WR >= 60% | 10bps | 244,173,150 | 1324 | 3.8142 | 71.98% | -14.60% | 195,089,396 |
| Causal strategy WR >= 60% | 30bps | 143,372,806 | 1304 | 3.3640 | 69.40% | -15.81% | 121,290,614 |
| Causal strategy WR >= 65% | 10bps | 247,438,945 | 1298 | 4.1254 | 72.34% | -14.60% | 198,438,888 |
| Causal strategy WR >= 65% | 30bps | 144,336,413 | 1297 | 3.4650 | 69.55% | -15.81% | 122,286,963 |
| Causal strategy WR >= 70% | 10bps | 247,438,945 | 1298 | 4.1254 | 72.34% | -14.60% | 198,438,888 |
| Causal strategy WR >= 70% | 30bps | 144,336,413 | 1297 | 3.4650 | 69.55% | -15.81% | 122,286,963 |
| Score >= 60% and no new JUP rescue | 10bps | 243,167,314 | 1309 | 3.9346 | 72.12% | -14.60% | 194,145,621 |
| Score >= 60% and no new JUP rescue | 30bps | 145,937,695 | 1300 | 3.4726 | 69.54% | -15.81% | 123,928,149 |
| Score >= 60% and no new JUP/TIA rescue | 10bps | 241,405,409 | 1303 | 3.9332 | 72.22% | -14.60% | 192,342,670 |
| Score >= 60% and no new JUP/TIA rescue | 30bps | 144,336,413 | 1297 | 3.4650 | 69.55% | -15.81% | 122,286,963 |

All 14 native economic scenarios have three fully converged native cooldown passes with exactly matching final equity, PF, DD and trade counts, and accounting PASS. Exact machine-readable report outside Git:
C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-25_adaptive_fractional_full8_test\adaptive-gross-native-eight-comparison-summary.json

## What was and was not proved

- Unconditional fractional gross rescue of Idle and RESIDUAL increased accepted trades (+40 at 10bps; +30 at 30bps) but decreased both final equity and PF. DD did not improve.
- The 60% causal score variant reduced the loss but did not exceed unchanged baseline at either cost.
- At 65% or 70% score thresholds, *no* additional accepted modeled trades occurred: results exactly equaled baseline.
- Excluding newly rescued JUP improved **30bps only** (approximately +1.60 million JPY), but **worsened 10bps** (approximately -4.27 million JPY). The same condition therefore does not satisfy two-cost robustness, regardless of observed later-period profit.
- Excluding both rescued JUP and TIA also failed to beat 10bps baseline; 30bps returned to unchanged baseline.
- Later-period partition starts 2026-04-22. These experiments are retrospective and threshold / symbol selection was performed with historical knowledge; the later period is **diagnostic**, not untouched out-of-sample forward validation.
- Choosing only retrospectively profitable rescued fills is prohibited: this would introduce future-information leakage and fake a win rate.
- Current deployed TypeScript strict approval caps Score allocation to already-approved quantity; it cannot rescue a native capacity-rejected signal without the native planner recomputing a NEW strict approval at valid fractional quantity. This is NOT a production-ready algorithm.

## Decision

**Do not adopt automatic new fractional rescue as-is.** At 10bps and 30bps tested conditions, no candidate raised equity at both costs with acceptable independent evidence. The goal of avoiding missed good entries is valid, but generic spare gross and strategy-level smoothed WR cannot reliably identify high-expectancy new entries.

Next research must use true causal candidate-specific Score (signal, route, symbol, regime, volatility, score calibration) before entry, rather than generic strategy WR. Recompute actual per-candidate risk-adjusted expected gross, protect existing higher-quality signals and verify native strict approval, margin, lot and STOP setup after sizing. Re-run native 8 strategy portfolios at current production SHAs, test 10bps/30bps and a truly independent later forward/holdout set. Never override safety gates merely to increase trade count.

## Replay sources / provenance

- Archived wrapper: C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-22_hype_entry_plus_exit_full8\repo\scripts\dd-reduction\run-v52-amzn-entry-full8-after-fet-20261022.py
- Source SHA256: 0f77b3600b872c64b7ebda9c50f724baea922a08cabb8fdaaebfc0c4b823c930
- Research in-memory source-gross hook scripts: scripts/research_native8_adaptive_gross_gate_20261025.py and scripts/research_native8_selective_gross_rescue_20261025.py
- No VPS, LIVE, orders, venue position changes or risk-limit changes were performed.
