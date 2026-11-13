# Q102 / HYPE / IDLE Reconstruction — 2026-11-14

Research only. Production was not changed.

## Selected reconstruction

- PENGU SHORT_V20 Rank3 remains frozen.
- Q102: AVAX causal online-KNN + M5 STOP5/TP3, confidence hardening threshold 0.013 / agree 0.65. Weak legacy AVAX/UNI routes remain quarantined.
- IDLE: keep the current causal reconstruction (RENDER WAIT + TAO 12h risk-off sensor). The JUP/TIA online replacement was rejected after exact integration.
- HYPE: 1.0x. Base H48R4 entry + pretarget winner signature rel24 <= 0.026202553353817715.
- New structural admission rule: HYPE may enter only when no FORMAL_PRIORITY runner is already open (V4/Q102/PENGU/FET/V52).
- Existing V4-preemption behavior remains unchanged.
- HYPE feature selection uses pre-target TRAIN/VALID/PREHOLD only. The formal-free admission rule is a structural priority rule, not a target-year threshold search.

## Exact integrated result

| Case | 10bps final | 10bps DD | 10bps PF | 30bps final | 30bps DD | 30bps PF |
|---|---:|---:|---:|---:|---:|---:|
| HYPE WAIT | ¥9,819,827 | -25.56% | 2.064 | ¥3,163,593 | -26.24% | 1.742 |
| HYPE WSIG unrestricted | ¥11,209,897 | -29.75% | 2.007 | ¥4,031,468 | -32.39% | 1.827 |
| **HYPE WSIG + formal-free entry** | **¥12,931,263** | **-25.56%** | **2.254** | **¥4,701,167** | **-26.24%** | **2.043** |

Compared with HYPE WAIT, the selected case adds **¥1,537,574** at 30bps (+48.6%) while max DD is unchanged at -26.24%.

## HYPE exact contribution (30bps)

- HYPE fills: 8
- Wins / losses: 6 / 2
- Win rate: 75.0%
- Direct modeled HYPE net PnL: ¥664,035
- HYPE candidates blocked because a formal runner was already open: 19
- Shared Risk trips: WAIT 11 -> selected 9
- Shared Risk flattens: WAIT 8 -> selected 5
- Positive months at 30bps: WAIT 11 -> selected 12
- Max-DD interval remains the same: 2026-02-28T10:00:00Z -> 2026-03-09T02:05:00Z

## Rejected HYPE variants

- generic online KNN / safe exit: no robust pretarget candidate.
- online health overlay: worsened target/forward.
- ATR dynamic STOP: standalone loss cap improved, but exact portfolio interaction worsened 30bps DD to about -39.19%.
- loss cooldown: no pretarget-identifiable policy survived.
- preempt HYPE for all formal runners: crystallized losses; 30bps DD worsened to about -43.25%.
- 3.75% half-Shared-Risk entry gate: only one HYPE blocked; DD unchanged.

## Status

This is a research candidate, not a Production deployment. No runner, order, position, STOP, Kill Switch, production config, or deployment was changed.

## Supersedes FINAL_V2

The previously pushed FINAL_V2 remains preserved for audit history. V3 improves the exact integrated result without changing max DD.

- 10bps: JPY 10,600,407 -> JPY 12,931,263 (+21.99%), DD -25.56% -> -25.56%.
- 30bps: JPY 3,807,597 -> JPY 4,701,167 (+23.47%), DD -26.24% -> -26.24%.
- 30bps PF: 1.855 -> 2.043.
- 30bps HYPE admissions: 7 -> 8.

V3 uses the simpler structural HYPE admission rule: enter only when no formal-priority runner is already open. It does not replace the pre-target entry gate with a target-selected threshold.
