# All-logic / all-symbol DD and misclassification audit — checkpoint 2026-11-11

Status: RESEARCH ONLY / NO PRODUCTION CHANGE

## User objective

Re-audit every implemented logic and symbol, reduce direction/regime misclassification, and reduce integrated maximum drawdown without target-year overfitting.

## Locked comparison

CAUSAL_THREE:
- 10bps: JPY 1,585,699.80 / DD -41.3525% / 540 fills / WR 59.6296% / PF 1.4313
- 30bps: JPY 579,086.35 / DD -50.6043% / 539 fills / WR 58.2560% / PF 1.3223

## New target-year diagnostic only

A per-strategy/symbol early-direction audit at H3/H6/H12 identified weak target-year groups including:
- IDLE TAO
- IDLE RENDER
- HYPE HYPEUSDT
- Q102 RENDER / UNI / AVAX / ONDO / DOGE
- V4 BNB / ATOM / BTC

This diagnostic is NOT used to select rules. It is only used to prioritize causal pre-target research.

## Pretarget route-health policy

A 64-policy pre-target-only jitter grid was run over lookback 60/90/120/180d, minN 4/5/6/8, PF cut 0.60/0.70/0.80/0.90.

Stable pre-target block evidence:
- PENGU SHORT_V20: 64/64 eligible policies block
- Q102 AVAX|MR24_Z1.5_H24: 44/44 block
- Q102 UNI|MR72_Z1.5_H24: 48/48 block
- Q102 AVAX|REV12_T0.03_H12: 25/32 block, but not promoted because later target behavior is positive and the evidence is less clean
- HYPE: only 28/64; not stable
- IDLE TAO: only 20/64; not stable

A separate pre-target monthly walk-forward policy test found the strongest conservative policy:
- 90d lookback
- minimum 5 completed outcomes
- block only when mean < 0 and PF < 0.60

The train and validation windows both end before 2025-10-01. This policy maps to exactly three 2025-10-01 blocks:
1. PENGU SHORT_V20
2. Q102 AVAX|MR24_Z1.5_H24
3. Q102 UNI|MR72_Z1.5_H24

## Integrated STABLE3

CAUSAL_THREE + the three frozen pre-target weak-route quarantines:

| Cost | Final JPY | Max DD | Fills | Win rate | PF |
|---|---:|---:|---:|---:|---:|
| 10bps | 4,512,970.17 | -26.06% | 856 | 61.68% | 1.668 |
| 30bps | 1,454,529.57 | -28.08% | 855 | 59.53% | 1.513 |

Determinism:
- 21/21 artifacts exact SHA256 match between pass1 and pass2.
- manifest SHA: bc2f95a7d6ff8d2458aaffab7cbedd021bd40b72208baddb196ab8cd9bab9b1b

The large fill-count increase is due to portfolio capacity being freed when weak routes are absent, allowing more later admissions. It is not an arithmetic add/remove comparison.

## HYPE sensitivity

Adding a full HYPE quarantine to STABLE3 yields:
- 10bps: JPY 4,647,983.01 / DD -21.52% / 808 fills / WR 63.74% / PF 1.932
- 30bps: JPY 1,474,715.28 / DD -23.33% / 807 fills / WR 61.21% / PF 1.629

This is a sensitivity result, NOT accepted. HYPE pre-target block evidence is not stable across the policy-jitter grid, and prior HYPE train-only feature gates failed independent validation.

## Q102 HIGH_VOL pre-target reconstruction

Binance UM pre-target proxy 2025-01-01..2025-10-01:
- 202 modeled signals
- 0 unresolved
- exact current-pin replay parity: 202/202

Important pre-target 30bps observations:
- SUI: strong overall; especially SHORT
- APT: strong
- ENA / ONDO: positive overall
- SEI: weak, especially SHORT
- ARB: weak overall but recent samples differ by side
- OP: mildly weak
- FIL: weak, small sample

Target-year SUI / ONDO HIGH_VOL losses are therefore not sufficient reason to disable those symbols: the pre-target evidence shows substantial regime dependence. More causal regime-drift work is required.

## Full IDLE pre-target proxy

Exact pinned IDLE signal functions were replayed on Binance UM proxy 2025-03-22..2025-10-01 for all configured IDLE symbols, with pinned M5 hard-stop/take-profit/max-hold/profit-trail semantics.

Completed candidates: 1,597
Unresolved near period end: 18

30bps full / recent90:
- TAO: full PF 0.633, recent90 PF 1.017
- TIA: full PF 1.055, recent90 PF 0.568
- DOT: full PF 2.059, recent90 PF 2.377
- JUP: full PF 1.342, recent90 PF 1.382
- RENDER: full PF 0.986, recent90 PF 0.975

## IDLE causal train/validation/prehold/forward screen

Thresholds were generated from pre-target train only. Validation, September prehold and true 2026-10..11 Aster forward were falsification-only.

- DOT: 0 robust new gates
- JUP: 0 new gates under this stricter unified search; existing CAUSAL_THREE JUP gate remains the current accepted gate
- TIA: 0 robust new gates
- RENDER: 2 robust two-feature candidates
- TAO: several candidates, including ATR <= ~0.017, but TAO ATR17 had already failed integrated portfolio improvement and remains rejected

Best RENDER candidate:
- atrRatio <= 0.02244512414537602
- ret24 <= -0.05907928388746808

It is positive in train/validation/prehold/forward at 30bps, but integrated STABLE3+RENDER does NOT improve DD:
- 10bps: JPY 4,537,038.37 / DD -26.06% / WR 61.88% / PF 1.656
- 30bps: JPY 1,472,526.59 / DD -30.22% / WR 59.69% / PF 1.506

Decision: DO NOT PROMOTE RENDER GATE. Per-route accuracy improvement is not enough; integrated DD worsens at 30bps.

## Current best defensible research state

STABLE3 is currently the strongest causally-supported integrated candidate.

It improves the previous CAUSAL_THREE DD from -41.35%/-50.60% to -26.06%/-28.08%, while using route blocks selected entirely from pre-target evidence.

The <=20% DD objective is not yet achieved. HYPE quarantine nearly reaches it, but its causal evidence is not robust enough to adopt.

## Next research priorities

1. HYPE: find a structural/regime explanation rather than a train-fit threshold; keep current HYPE included until robust evidence exists.
2. Q102 HIGH_VOL: analyze pre-target side/regime deterioration and devise an online causal health/regime gate rather than target-symbol blacklisting.
3. IDLE TIA / RENDER: no static rule is promoted; investigate regime-state gating and cross-asset confirmation.
4. V4 BNB / ATOM / BTC: require true pre-target/no-hindsight evidence before any route/symbol suppression.
5. Re-run integrated portfolio after each frozen candidate and reject local improvements that worsen total DD.

## Safety

No LIVE order, cancel, position, STOP, Kill Switch, Production runner or Production configuration was changed.


## Overfit-guard continuation

The following work was added specifically to prevent target-year loss-mining from becoming a rule.

### HYPE: no promotable gate

A generic 90d/min5/PF<0.60 online shadow-health gate, frozen from cross-route pretarget research, was tested without tuning on HYPE target outcomes. It worsened both pretarget and target HYPE quality, so it is rejected.

A separate simple structural search used only 39 pretarget Binance-proxy HYPE candidates:
- train: 2025-06..07
- validation: 2025-08
- prehold: 2025-09
- single-feature rules only
- train quartile thresholds only
- >=35% retention
- validation + prehold both required to improve
- sibling-threshold support required

Result: 0 robust rules. Therefore the attractive full-HYPE-quarantine sensitivity result remains diagnostic only and is not adopted.

### Q102 HIGH_VOL: parity corrected; no new gate

The prior target HIGH_VOL parity diagnostic was comparing against the legacy V1 signal builder and therefore reported 19/19 requested-gross mismatches. The replay now uses buildQuality102CausalV4Signal, which applies the production family/side gross contract and HIGH_VOL exit policy.

Correct result:
- 19 signals checked
- 19 exact V4 parity
- 0 mismatches

A generic online shadow-health gate was then tested with the same pretarget-frozen 90d/min5/PF<0.60 policy. It blocked good pretarget trades and, in the target one-shot, blocked three profitable ONDO LONG trades. Rejected.

A structural HIGH_VOL search used only pretarget data with train/validation/prehold splits, five predeclared features and simple predeclared pair families. 150 rules were tested; 0 survived the robustness constraints. No symbol blacklist or target-fitted HIGH_VOL rule is accepted.

### V4 BTC/BNB/ATOM direction audit

All symbols were screened with pretarget temporal splits before reading the true forward set.

Only BTCUSDT met the strict pretarget quarantine condition:
- pretarget native n=51, WR 11.76%, mean -1.988%, PF 0.050
- opposite shadow n=51, WR 70.59%, mean +1.324%, PF 6.797
- native remained negative in train, validation and prehold
- true forward native n=9, WR 11.11%, mean -0.583%, PF 0.012

BNB did not have enough robust support and true forward native became positive; ATOM native was positive in pretarget and forward. They are not blocked.

The BTC block was then frozen and evaluated once in the integrated STABLE3 portfolio:
- 10bps: JPY 3,947,836.61 / DD -26.06% / WR 61.92% / PF 1.667
- 30bps: JPY 1,295,062.11 / DD -28.08% / WR 59.33% / PF 1.511

DD did not improve and profit fell materially. Decision: reject the BTC block despite its strong isolated statistics. Do not flip BTC direction either.

### IDLE TAO ATR gate retest

The pretarget+forward-robust TAO rule atrRatio <= 0.01706380378807714 was frozen before target evaluation and retested on top of STABLE3:
- 10bps: JPY 4,435,239.86 / DD -26.06% / WR 61.59% / PF 1.659
- 30bps: JPY 1,435,064.28 / DD -28.08% / WR 59.44% / PF 1.506

DD did not improve and both profit/PF weakened. Decision: reject.

### Q102 S34 strict route stability

A new route-level screen required every route quarantine to have:
- train >=5
- validation >=3
- prehold >=2
- full pretarget >=12
- negative mean and PF<1 in every pretarget split
- full-period PF<0.70
- true forward could only veto, never add

Result: no additional route passed. The existing STABLE3 Q102 quarantines remain; no DD-window loser was blacklisted from target outcomes.

### STABLE3 DD attribution is diagnostic only

10bps maximum DD:
- peak 2026-02-28 10:55 UTC
- trough 2026-03-09 02:05 UTC
- DD -26.06%
- HYPE was the only materially negative realized strategy in the peak-to-trough interval; V4 and Q102 exits were net positive.

30bps maximum DD:
- peak 2026-07-27 11:00 UTC
- trough 2026-09-22 11:00 UTC
- DD -28.08%
- Q102 realized net in the interval: approximately -JPY 538,869
- HYPE: approximately -JPY 162,391
- IDLE: approximately -JPY 100,819
- PENGU, V52 and FET were net positive over the same realized-exit window.

These losses are used only to prioritize the next pretarget research. They are not allowed to define thresholds, symbols or routes.
