# Three-Layer Online Portfolio Research - Q102

Status: **RESEARCH ONLY / NO PRODUCTION CHANGE**

## Architecture

1. **Layer 1 - Existing logic**
   Existing runners continue to emit their native candidates. Suppressed candidates are retained in a shadow ledger instead of being discarded from research visibility.

2. **Layer 2 - Online judgement**
   Uses only outcomes whose modeled exits are already complete at the candidate timestamp. The generic estimator combines historical strategy/route/symbol context and feature similarity, then Q102 recovery additionally requires same-route evidence and two independent recent-health windows.

3. **Layer 3 - Portfolio Opportunity**
   A recovered candidate must have a higher opportunity score than the scored active alternative. Existing Shared Risk, Gross, Q102 one-slot, symbol ownership, cooldown and Fail-Closed rules remain authoritative. No cap is bypassed.

## Selected Q102 recovery

Only one suppressed candidate survives the clean policy:

- ID: Q102P_00089
- Symbol/side: UNIUSDT SHORT
- Route: UNI|MR72_Z1.5_H24
- Native gross: 0.75x
- Online estimated win probability: 63.92%
- Online estimated 30bps net EV: 3.88%
- Confidence: 0.728
- Same-route completed sample: 6
- Recent-5 same-route mean: 7.00%
- Recent-6 same-route mean: 11.78%
- Opportunity score: 0.03762
- Active alternative max score: 0.01132

## Exact integrated result

| Case | 10bps Final | 10bps DD | 10bps PF | 30bps Final | 30bps DD | 30bps PF |
|---|---:|---:|---:|---:|---:|---:|
| V3 baseline | ﾂ･12,931,263 | -25.56% | 2.254 | ﾂ･4,701,167 | -26.24% | 2.043 |
| **Three-layer Q102** | **ﾂ･13,541,227** | **-21.57%** | **2.260** | **ﾂ･4,923,412** | **-22.28%** | **2.050** |

Versus V3:
- 10bps final: **+ﾂ･609,965 (+4.72%)**
- 10bps DD: -25.56% -> **-21.57%**
- 30bps final: **+ﾂ･222,244 (+4.73%)**
- 30bps DD: -26.24% -> **-22.28%**
- 30bps PF: 2.043 -> **2.050**

The modeled fill count does not increase versus V3. The recovered UNI trade occupies the existing Q102 slot and naturally blocks a later AVAX candidate that hit STOP5. The improvement is opportunity replacement, not extra leverage.

## What was rejected

- Global Online score rollout to all filtered IDLE/PENGU candidates: rejected; realized shadow performance was weak or negative.
- Same route-local KNN copied to IDLE/PENGU: rejected (IDLE PF about 0.42; PENGU PF about 0.32).
- Global negative-veto: rejected because model reliability differs sharply by runner.
- Raw cross-runner Opportunity sorting: rejected; same-timestamp diagnostics showed higher generic scores could displace much better PENGU/V4 trades.
- Any bypass of Daily Loss, Gross, symbol ownership, cooldown, one-slot or Fail-Closed gates: not tested or adopted.

## Robustness / limitations

- pWin 0.58-0.60, EV +0.1%-+0.3%, confidence 0.40-0.50 all select the same candidate.
- The clean one-candidate wrapper exactly reproduces the prior route-health integrated result.
- The route-health structure itself was developed after inspecting target-period diagnostics. Therefore this is **not an untouched holdout validation**.
- Before Production adoption, keep this as shadow logic and require fresh forward/live-shadow evidence.

## Safety

No Production runner, order, position, STOP, Kill Switch, Production config, merge, deployment or risk cap was changed.
