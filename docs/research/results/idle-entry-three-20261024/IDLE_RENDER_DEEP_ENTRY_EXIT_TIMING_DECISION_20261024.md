# RENDER SHORT ENTRY / EXIT：新ルート・タイミング再選択・初期損失2時間監視（2026-10-24）

RESEARCH ONLY. VPS, LIVE, Production, HP, actual orders unchanged. All evidence reflects modeled replay only.

## Compared like-for-like cumulative full8 backtests
- Period: 2025-08-10 to 2026-08-10, normal 10bps and stress 30bps, 3-pass dynamic reselection, 8-logic common wallet.
- Previous PENGU and AVAX research retained, plus DOT 1h change >= -1%, JUP 12h >= -5% and 3h >= -1.5%, RENDER BTC3h >= -1.5%. All risk/gross/ownership protections stay unchanged.
- Historical samples are highly explored. In-sample changes and previously-seen time splits are not independent OOS proof.

| Model | 10bps final JPY | 10bps delta | all trades | RENDER win rate | 30bps final JPY | 30bps delta | all trades | RENDER win rate | DD 10/30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| JUP−1.5%/DOT−1%/RENDER BTC3h−1.5% cumulative baseline | 284,315,191 | +0 | 1285 | 16/24 (66.7%) | 173,535,687 | +0 | 1284 | 12/24 (50.0%) | -14.51499%/-15.01472% |
| RENDER MFE1.5% after floor+0.35% | 284,418,781 | +103,589 | 1285 | 16/24 (66.7%) | 173,611,665 | +75,978 | 1284 | 12/24 (50.0%) | -14.51499%/-15.01472% |
| RENDER MFE1.5% after floor+0.40% | 283,727,830 | −587,361 | 1285 | 16/24 (66.7%) | 173,174,416 | −361,272 | 1284 | 11/24 (45.8%) | -14.51499%/-15.01472% |
| RENDER MFE1.5% after floor+0.45% | 283,794,364 | −520,827 | 1285 | 16/24 (66.7%) | 173,222,587 | −313,100 | 1284 | 11/24 (45.8%) | -14.51499%/-15.01472% |
| RENDER -1% touch, watch2h and MFE<0.25 | 283,657,967 | −657,225 | 1285 | 16/24 (66.7%) | 172,936,930 | −598,757 | 1284 | 12/24 (50.0%) | -14.51499%/-15.01472% |
| RENDER initial watch2h + floor0.35% | 283,766,561 | −548,630 | 1285 | 16/24 (66.7%) | 173,014,744 | −520,943 | 1284 | 12/24 (50.0%) | -14.51499%/-15.01472% |

## Why simply waiting one to six hours is not a substitute for entrance logic
- Native selected RENDER H1: 24 of 164 candidates accepted. Other 140: 81 competing core, 44 RENDER cooldown, 8 simultaneous capacity, 7 insufficient gross.
- At 30bps, 12 winning/12 losing selected. Eight of 12 losing trades have a cooldown-rejected RENDER candidate within six hours. The first such candidate is hypothetically profitable for only 1 of 8; projected first-followup sum is negative (not an executable portfolio result).
- Moving an order entry forward by one hour is not justified; a new completed-M5 price-action confirmation and ownership-aware native testing are required.

## Independent NEW SHORT entrance signals (NOT included in full8 economic results)
- 11 causal hourly-retrace/mean-reversion/fade entrances, 3 fixed short exit contracts, M5 stop-first, 12h cooldown, entry at next M5 open; no full8 capital, funding, borrow or live venue fill.
| Standalone model, 30bps | trades | wins | PF | early PF/wins | later PF/wins |
|---|---:|---:|---:|---:|---:|
| BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD12 | 44 | 70.45% | 1.2349 | 2.5893/83.33% | 0.6329/55.0% |
| BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD6 | 44 | 68.18% | 1.2504 | 2.3168/79.17% | 0.6763/55.0% |
| BROAD_RETRACE_RESISTANCE__TP1P75_SL2P5_HOLD12 | 163 | 64.42% | 1.0316 | 1.4781/71.43% | 0.7287/56.96% |

- BTC_TRAP (12h) achieves 30bps 44 trades, 70.45% WR, PF1.2349 in this isolated model, but early PF2.5893 and later PF0.6329. This does not prove an edge that survives regime changes; no implementation or LIVE approval.
- Risk of overfitting is substantial because thresholds were compared on a repeatedly researched period.

## Decision and next valid evidence
- Compare both costs, maximum mark-to-market DD, and individual RENDER count/wins as well as all eight trade count. Reject an idea that increases WR by cutting all important winning opportunity.
- If a model makes profits but not RENDER 70% WR, it is research/Forward Shadow candidate only, not an adopted live strategy.
- Require source-permission/venue-entry lifecycle, recovery of protective stop after partial fills/restart, pending-margin parity, exact Production SHA, plus unseen OOS/replay before production.

## Evidence files
- scripts/dd-reduction/run-idle-three-entry-native-full8-20261024.py
- scripts/dd-reduction/audit-idle-entry-three-native-full8-20261024.py
- scripts/dd-reduction/screen-idle-render-timing-priority-chain-20261024.py
- scripts/dd-reduction/screen-render-fresh-rally-fade-m5-20261024.py
- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_H1_TIMING_CHAIN_AND_CANDIDATE_OWNERSHIP_20261024.json
- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_NEW_RETRACEMENT_SHORT_INDEPENDENT_5M_20261024.json
- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json

## Critical disjoint older-year validation, fixed rules and exits
Public Binance USD-M Futures BTC and RENDER M5 archives, August 2024 through July 2025: 24/24 downloaded, CRC+SHA256 source checks pass. Earlier rules are frozen; no new threshold selected based on older outcomes.
This disjoint historical window is still retrospective, not prospective forward OOS and not eight-strategy allocator parity.
| Fixed model and round-trip cost | Older n | Older WR | Older PF | Later research n | Later WR | Later PF |
|---|---:|---:|---:|---:|---:|---:|
| BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD12 10bps | 50 | 52.0% | 0.7075 | 44 | 70.45% | 1.5133 |
| BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD6 10bps | 51 | 49.02% | 0.7181 | 44 | 68.18% | 1.5552 |
| BROAD_RETRACE_RESISTANCE__TP1P75_SL2P5_HOLD12 10bps | 198 | 55.56% | 0.8165 | 163 | 64.42% | 1.2849 |
- Both-year PF>1 with minimum 20 trades at 10bps among 33 independently generated rule+exit models: 1 models.
| BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD12 30bps | 50 | 52.0% | 0.5762 | 44 | 70.45% | 1.2349 |
| BTC_TRAP_REJECTION__TP1P75_SL2P5_HOLD6 30bps | 51 | 49.02% | 0.5786 | 44 | 68.18% | 1.2504 |
| BROAD_RETRACE_RESISTANCE__TP1P75_SL2P5_HOLD12 30bps | 198 | 55.56% | 0.6624 | 163 | 64.42% | 1.0316 |
- Both-year PF>1 with minimum 20 trades at 30bps among 33 independently generated rule+exit models: 0 models.

The BTC_TRAP 12h short is rejected: 30bps later-year 44 trades, 70.45% WR, PF1.2349; older disjoint-year 50 trades, 52% WR, PF0.5762. There is no 30bps new-entrance model with both-year PF>1 in this 33-model group.
This is direct evidence against declaring victory from an in-sample high WR.

Evidence:
- scripts/dd-reduction/acquire-render-btc-independent-older-m5-20261024.py
- scripts/dd-reduction/evaluate-render-new-short-older-2024-2025-m5-20261024.py
- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json
- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_NEW_SHORT_OLDER_OUT_OF_YEAR_M5_VALIDATION_20261024.json
