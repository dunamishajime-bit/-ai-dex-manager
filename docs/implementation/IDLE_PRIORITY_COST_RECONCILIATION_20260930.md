# Idle Priority SHORT — Cost / Replay Reconciliation (2026-09-30)

Status: **CONTROLLING RESEARCH CORRECTION**

This document supersedes any earlier requirement that treats **JPY268.05M / 1,342 trades / PF~2.055 / DD~-23.24%** as one coherent 10bps integrated backtest.

## 1. Source identity

Canonical Release:
`bt-v12-score100-volume080-normalonly-20260928`

Archive SHA256:
`891c36d8a5957cafe3aae65656a98b7c02a3c437c4f520fe63756d550f08b4fb`

Canonical Idle evidence:
- 495 stream SHA256 `09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb`
- 63 filtered SHA256 `5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48`
- exact causal 63→61: PASS
- admitted 61 = 48W / 13L
- DOT14 / JUP14 / RENDER15 / TAO9 / TIA9

Comparison code:
`research/idle_priority_fixed_intent_dynamic_gross.py`

CI:
- workflow: `Idle Priority fixed intent dynamic gross diagnostic`
- run: `36664690807`
- commit: `56400e878452acc251e73eb9b7747ac61d1f8aea`
- conclusion: SUCCESS

Replay model for this comparison:
- start from the canonical accepted baseline intent schedule only
- do not promote baseline-only rejected candidates
- baseline intent requested Gross = original candidate requested Gross
- current MTM Gross = abs(quantity × mark) / current equity
- Crypto cap 3.0 / Total cap 4.25 and existing strategy caps
- Idle requested/accepted Gross = exactly 1.00x
- Idle is not preempted
- same-symbol Idle occupancy already reduces 63→61
- later baseline accepted intents remain subject to real shared capacity
- split entry/exit cost path
- no outcome-based selection

## 2. Canonical baseline anchors from Release

10bps formal baseline:
- final equity: JPY141,845,207.7243423
- closed trades: 1,284
- PF: 2.0771737482823114
- max MTM DD: -22.873351303266531%

8bps formal sibling:
- final equity: JPY175,059,528.3889343
- closed trades: 1,284
- PF: 2.124076416274601
- max MTM DD: -22.742907668802037%

The research diagnostic reconstructs each baseline within about JPY4.5k of the immutable Release final-equity anchor and preserves all 1,284 baseline trades. The immutable Release metrics remain the baseline authority.

## 3. Coherent 10bps integrated overlay

CI output:
- baseline retained: 1,278
- baseline rejected after Idle exposure: 6
- Idle trades: 61
- Idle rejected: 0
- total completed trades: **1,339**
- final equity: **JPY214,775,230.26444945**
- PF: **2.046425970772986**
- hourly diagnostic max MTM DD: **-22.840597480157931%**
- Idle PnL using final FX attribution: **JPY52,475,222.48842543**
- Idle PF: **6.582814623608791**

Strategy counts:
- V12 986
- PENGU 62
- Q102 130
- V52 85
- FET 15
- Idle 61

Six baseline rejects:
- V12 LINKUSDT C000111 @ 1756159200000 — NO_GROSS_ROOM
- V12 DOGEUSDT C000115 @ 1756202400000 — NO_GROSS_ROOM
- V12 ADAUSDT C000119 @ 1756216800000 — NO_GROSS_ROOM
- PENGU PENGUUSDT C000245 @ 1758816000000 — PENGU_NO_LOT_SHRINK
- V12 ETHUSDT C000280 @ 1759046400000 — NO_GROSS_ROOM
- V12 DOGEUSDT C002150 @ 1780488000000 — NO_GROSS_ROOM

This is the coherent 10bps fixed-intent/shadow-baseline overlay research result. It does **not** reproduce JPY268.05M.

## 4. Coherent 8bps sensitivity

CI output:
- baseline retained: 1,278
- baseline rejected: 6
- Idle trades: 61
- total completed trades: **1,339**
- final equity: **JPY268,148,071.9251832**
- PF: **2.0925476176754634**
- hourly diagnostic max MTM DD: **-22.688538434015348%**
- Idle PnL using final FX attribution: **JPY64,537,163.64162981**
- Idle PF: **6.739641037227033**

This is within about 0.04% of the previously reported JPY268.05M and is also close to the previously reported Idle contribution of roughly JPY66M.

## 5. Historical report reconciliation

The previously repeated bundle:
- 10bps baseline around JPY141.85M
- integrated final around JPY268.05M
- total trades around 1,342
- PF around 2.055
- DD around -23.24%
- Idle PF around 6.60
- Idle contribution around JPY66M

is not reproduced by any single coherent source-backed replay found to date.

The evidence now shows:
- JPY268.05M / roughly JPY66M aligns with the **8bps** coherent overlay.
- baseline JPY141.85M is the **10bps** formal baseline.
- PF around 2.055 / Idle PF around 6.60 are much closer to the **10bps** overlay.
- DD around -23.24% is closest to the separate full path-dependent 10bps diagnostic reported earlier (-23.2382%), which admitted only 51 Idle trades.
- 1,342 trades is reproduced by neither coherent overlay: both 8bps and 10bps fixed-intent overlays produce 1,339; the full path-dependent replay produced 1,331.

Therefore **JPY268.05M / 1,342 / PF2.055 / DD-23.24% must not be used as a production parity certificate**. It is a historical mixed-run/mixed-cost reporting anchor, not a verified single run.

## 6. Production research contract

For production safety and reproducibility:
1. Use **10bps** as the primary cost case because the adopted formal baseline is the 10bps JPY141.845M case.
2. Keep 8bps as sensitivity only.
3. Preserve 495→63 and exact causal 63→61 evidence.
4. Production must remain causal. A shadow baseline-only state may be used to represent the historical meaning of “Idle” without future information.
5. Actual portfolio admission still must enforce Shared Risk, Margin Guard, Kill Switch, pending exposure, account lock, actual available Gross, and venue margin.
6. Do not loosen caps or select rejects to recover JPY268M.
7. Do not certify LIVE using the historical mixed anchor.
8. Any final Production parity certificate must identify its cost case and replay model explicitly.

## 7. Current primary research acceptance reference

Until a stricter formal engine extension supersedes it, the reproducible **10bps fixed-intent dynamic-Gross overlay** is:
- input baseline intents: 1,284
- Idle: 61 / 48W13L
- baseline retained: 1,278
- baseline rejects: 6
- integrated trades: 1,339
- final equity: about JPY214.78M
- PF: about 2.04643
- diagnostic hourly DD: about -22.84%
- Idle PnL attribution: about JPY52.48M
- Idle PF: about 6.583

These figures are research acceptance references, not permission to bypass any LIVE safety gate.
