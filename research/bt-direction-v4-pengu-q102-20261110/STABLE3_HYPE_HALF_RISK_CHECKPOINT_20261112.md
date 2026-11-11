# STABLE3 + HYPE half-gross causal risk checkpoint — 2026-11-12

Status: RESEARCH CANDIDATE / NO PRODUCTION CHANGE

## Why this was tested

STABLE3 remaining-loss audit showed HYPE/HYPEUSDT as one of the largest remaining loss contributors:
- 48 fills
- 34 losses
- loss rate 70.8%
- 13.8% of the 10bps gross-loss pool
- among losing HYPE trades: H3 wrong-direction 76.5%, H6 88.2%, H12 76.5%, persistent H3/H6/H12 wrong 64.7%

The target-year loss pattern was used only to prioritize HYPE for investigation. It was NOT used to construct an entry threshold.

## Pretarget anti-overfit work

Independent pretarget Binance-UM proxy HYPE evidence contains 39 candidates:
- train (Jun-Jul): n=19, WR 47.4%, mean +1.096%, PF 2.232 at 30bps
- validation (Aug): n=11, WR 0%, mean -1.864%, PF 0
- prehold (Sep): n=9, WR 22.2%, mean -0.358%, PF 0.699

Three additional attempts to fix HYPE signal quality were rejected before any target-year tuning:

1. Simple structural entry gates: robust candidates after sibling-threshold support = 0.
2. Early adverse exits: 80 fixed rules; train-qualified = 0; robust = 0.
3. Online HYPE health policies: 36 predeclared policies; robust = 0; target one-shot therefore not performed.

A previously frozen generic 90d/min5/PF<0.60 online-health policy also failed: it blocked profitable HYPE shadow trades and worsened admitted expectancy.

Conclusion: current evidence does NOT justify a new HYPE entry threshold, early exit rule, or online activation rule.

## Conservative risk response frozen before target replay

Because HYPE is unstable across independent pretarget periods and no reliable classifier survived, one simple non-predictive risk response was frozen:

**HYPE requested gross = 50% of current modeled HYPE gross.**

This is not a target-fitted threshold. It is a conservative half-size response to unstable pretarget evidence. Only one scale was submitted to the target-period integrated A/B; no 25/60/75% target search was performed.

## Integrated one-shot STABLE3 A/B

| Cost | STABLE3 final JPY | HYPE-half final JPY | STABLE3 DD | HYPE-half DD | STABLE3 WR | HYPE-half WR | STABLE3 PF | HYPE-half PF |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 10bps | 4,512,970.17 | 4,380,032.76 | -26.06% | **-23.81%** | 61.68% | **61.73%** | 1.668 | **1.727** |
| 30bps | 1,454,529.57 | **1,484,977.13** | -28.08% | **-24.77%** | 59.53% | **59.60%** | 1.513 | **1.567** |

DD improvement:
- 10bps: **+2.25 percentage points**
- 30bps: **+3.31 percentage points**

At 10bps, final equity falls about 2.9% while DD, WR and PF improve. At 30bps, final equity, DD, WR and PF all improve.

## Determinism

Canonical simulator SHA256: eba62b627ae78929de28a3274e9afadaf5204af05527996c47ce7ef6b14018c6

After deterministic block-literal correction, the generated HYPE-half wrapper SHA256 matched on two independent full runs: be10fb41265c81c009660bf9d9438b5e03ed8d741cec0dcb90971b60ba6efd5d

The 21 output artifacts matched exactly across repeated full runs. Artifact manifest SHA256: c00aeb9044824ff8e1a07711e0ccfd8c15b2cb52d57d77502656877ad5bb03aa

## Decision

**PROMISING / KEEP AS CURRENT BEST RISK CANDIDATE, NOT PRODUCTION.**

This does not solve HYPE misclassification; it reduces the damage caused by a signal whose stable classifier has not yet been found.

The next research baseline should compare against STABLE3_HYPE_HALF while continuing to look for genuine signal improvements in IDLE TAO, Q102 FET, PENGU V8 losing subset, IDLE TIA, Q102 DOGE and IDLE RENDER.

The <=20% DD objective is still not achieved.

## Safety

No LIVE order, cancel, position, STOP, Kill Switch, Production runner or Production configuration changed.
