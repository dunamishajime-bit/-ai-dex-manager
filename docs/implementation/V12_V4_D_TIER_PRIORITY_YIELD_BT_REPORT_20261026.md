# D-tier larger Gross plus priority yield: integrated research outcome 2026-10-26

STATUS: RESEARCH_ONLY. Zero VPS deployments, order/cancel/position changes.

## User hypothesis
Keep unchanged D Gross 0.05 for Y15, X07, X14, Y18; expand only G3=0.25x, X13=0.15x and CONT_SHORT=0.15x, but close a held D position when a more important new owner actually needs the capacity. Do not interpret a raw upstream signal as permission to force close. Priority to existing protective STOPs, risk/capital gates and verified execution paths.

## Method
Archival native8 2026-10-09 frozen causal H1 research model, 2025-08-10 through 2026-08-10 with 10/30bps. Frozen C-tier 0.25x and D gross scenario as above. In-model injection AFTER normal risk, research-gate, cooldown and slot validation, before final size admission. Existing H1 mark closing and venue-model exit fee accounted. Preempt only if shared crypto/total cap truncates the higher candidate and only as many approved G3/X13/CONT open positions as required; never preempt unrelated sleeves. Per-owner V12 tier rank required to be higher than victim route. Model cannot rescue upstream blocked same-symbol or slot contenders, and cannot reproduce actual venue resident STOP partial fills.

## Comparative result

| Policy | 10bps final asset JPY | 10bps max DD | 10bps yield events | 30bps final asset JPY | 30bps max DD | 30bps yield events |
|---|---:|---:|---:|---:|---:|---:|
| BASE_NO_PREEMPT | 304,799,546 | -20.3402% | 0 | 193,683,203 | -18.3495% | 0 |
| D_CAPACITY_PREEMPT | 302,859,135 | -20.4074% | 1 | 193,683,203 | -18.3495% | 0 |
| D_MATERIAL_PREEMPT | 304,799,546 | -20.3402% | 0 | 193,683,203 | -18.3495% | 0 |

- Capacity-yield policy reduces 10bps final equity by JPY 1,940,410 and max DD worsens from -20.3402% to -20.4074%.
- The only actual preempt event closes REC_G3 (AVAX SHORT) at historical timestamp 1760113800000 to increase V52 AMZN V50_POST_OPEN_BASIS gross from about 1.95499 to 1.99697x. That V52 position was eligible and accepted without preemption, but would otherwise have slightly smaller size. The lost G3 position would have remained profitable under its existing exit model. This is not an example of unlocking an otherwise impossible new trade.
- At 30bps there are zero qualifying higher-candidate capacity events; the policy makes no difference.
- A conservative material shortage of 0.10x has zero preempt events at both cost assumptions and matches baseline exactly, so provides no incremental benefit during the chosen period.

## Economic decision

**Do not adopt automatic closing on ANY other strategy's signal.** Existing D routes' direct profits and their portfolio opportunity effects are distinct. Keep priority yield a research hypothesis; a production variant must first demonstrate that an actually executable, more valuable order was blocked by D capacity and that freeing it after modeled exit fees, slippage and STOP lifecycle yields incremental risk-adjusted benefit.

For further research, trigger only on a trusted post-risk approved candidate that genuinely cannot be filled at venue minimum quantity/notional; calculate expected deficiency at exact same symbol or shared capital and only close the smallest eligible D lot required. Two-phase handoff: reserve pending Gross atomically, cancel/replace STOP safely, execute reduce-only D close, receive signed fill readback, then recheck candidate freshness/risk and submit new entry. If the replacement fails or becomes stale, do not force a D close. Any unprotected period or venue uncertainty must fail closed. Existing orders are NEVER cancelled or modified by this report.

Limitations: H1 research fills, not Aster live signed L2, later October modifications/RENDER dual routes not included, selection done in-sample. No evidence to change LIVE priority and no automatic activation.
