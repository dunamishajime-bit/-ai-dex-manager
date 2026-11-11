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
