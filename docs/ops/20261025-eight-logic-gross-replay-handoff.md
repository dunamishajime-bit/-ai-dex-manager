# Eight-logic gross integration — archive recovery and parity handoff

Date: 2026-10-25. Status: RESEARCH_ONLY_BLOCKED_NATIVE_GATE_AND_LATEST_SHA_PARITY.
No order, VPS production or systemd changes are part of this research.

## Families and evidence

The eight archived owners are V12, PENGU, Q102, FET, HYPE_LONG, IDLE,
RESIDUAL and V52. ZEC is not the eighth strategy of this historical portfolio.
The 2026-10-23 full8 residual-ablation engine contains 10bps and 30bps
versioned H1/M5 modeled candidate/exit tapes. All 41 distinct V4 route
identities can be observed in those source tapes, but this does NOT mean
the latest V4 SHA/exit rules were used.

Current production observed previously: 7688ed7c93a1918d8b44837339b7da5584a868f5.
V4 service SHA observed previously: 23ddd4b01fcff38cd10d4d4614221f93dc6b44e5.
Most archived crypto sources use dbf84542311c15f69508f91a0e7311ff7e686d96
or ce1edeead8d0f9e5d88e829d415057117502a335, which are NOT that
current V4 runtime source. The stock V52 archive lacks a source runtime SHA.

Source data: owner PC research archive dated 2026-10-22 and 2026-10-23,
older 2026-09-28 H1/funding/FX/V52 model archive, and separately recovered
hype_aster_h1.json. HYPE historical funding and L2 execution are NOT
authenticated. The 10 and 30 bps candidate universes differ, because the
underlying native research engine preserved cost-dependent model gates.

## 8-owner dynamic research execution

Same dynamic allocator as scripts/research_formal_dynamic_score_bt.py.
New adapter scripts/research_archived_full8_dynamic_gross_bt.py loads
all eight modeled owner tapes, adds HYPE H1, applies causal V12 percentile
calibration and strict PENGU 0.75x/strategy/class/total gross caps.
Uses model trade exit paths and account cash/MTM, not live fills.

Conservative owner conflicts added research-only:
core candidates/positions exclude Idle/Residual, active HYPE excludes
Idle/Residual, Idle has priority over Residual; no order is manufactured
merely because capital remains. These do not recreate every native
cooldown, min-quantity, stock and owner gate.

Results with those conservative checks:
10bps 3,105 candidates; 799 modeled closed; final JPY 78,759,828.50489876;
DD -19.889262%; PF 2.727874; win rate 71.8398%.
30bps 2,631 candidates; 785 modeled closed; final JPY 20,647,743.61133615;
DD -20.585791%; PF 2.320791; win rate 69.0446%.
Initial JPY10,000 and 13 monthly JPY10,000 contributions.
These figures are exploratory and NOT comparable with the native full8
portfolio until ownership/rate/margin and strategy-native exit parity passes.

## Why native latest parity is BLOCKED

scripts/audit_archived_full8_dynamic_parity.py compares actual accepted
rows and native risk rejections. 10bps accepted entries differ:
V12 -463, PENGU -2, Q102 +2, FET +4, HYPE_LONG +9,
IDLE -34, RESIDUAL -17, V52 +2.
30bps accepted differences:
V12 -466, PENGU -3, Q102 +1, FET +4, HYPE_LONG +10,
IDLE -37, RESIDUAL -11, V52 +1.

Native original rejects include idle filled-symbol cooldown, full-1x
quantity/availability, multi-signal ambiguous ownership, core owner,
Task9 side-loss cooldown, V52 AMZN causal veto, shared margin and
venue tick/min notional. Those are NOT all recreated in this experiment.
The original native engine source implementing all these gates was not
located in the inspected exported Python sources. Cross-strategy
same-time allocation is implemented, native full8 gate parity is not.

V12 modeled trades do not match current V4 source SHA even though the
archived candidate tape has 41 unique route IDs. Independent holdout,
venue L2 fills, specific HYPE funding and full current LIVE order
lifecycle remain unverified. Exact full annual latest-source BT is
not completed and cannot be labeled PASS.

Outputs on owner Windows PC:
C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-25_archived-eight-family-dynamic-gross-parity-experiment
Each scenario contains candidate-decisions.jsonl, portfolio-trades.jsonl,
portfolio-events.jsonl, metrics.json, native-gate-parity.json.

## Next necessary source reconstruction

1. Collect exact active V12 V4, PENGU, Q102, FET, HYPE, IDLE,
   RESIDUAL and V52 code/route config SHA from production and
   reconcile the 2026-10-23 model snapshot against all adopted changes.
2. Execute those exact source entry and exit rules against a fully
   timestamped historical H1+M5 price/funding tape with proven coverage.
3. Recreate native ownership, cooldown, rate budget, venue sizing, pending,
   margin, order/reservation and STOP lifecycle, not simply old accepted IDs.
4. Freeze comparable causal score and train/test holdout; compare original
   native baseline and dynamic 10bps/30bps from the SAME source/universe.
5. Pass per-route and wallet accounting, deterministic replay, source parity,
   actual venue lifecycle certification and HP runtime SHA verification.
Production dynamic LIVE must remain disabled until approved.
