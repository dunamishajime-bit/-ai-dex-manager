# V12 V4 LONG initial loss and profit giveback: H1-confirmed exit research

> RESEARCH_ONLY_NO_ACCEPTED_CASE. Source-backed modeled full8 BT; Production/VPS/LIVE untouched.

## Verified stop contract: current pinned V4 source

- Production 41 routes = 37 TIME + 3 ATR + 1 NATIVE.
- TIME routes require exact release-SHA/root-owned operator approval for emergency STOP; LONG quoted STOP = signed average entry fill x 0.92 (price -8%).
- TIME route time exits are in route catalog (3-72h), subject to other strategies preempting the position; emergency -8% is not a trailing profit protector.
- ATR routes X13 (TP 1.5 ATR, SL 1 ATR), Y19 (TP 2 ATR, SL 1 ATR), Z21 (TP 1 ATR, SL 1 ATR).
- NATIVE G3 initial stop = entry - max(2.477 ATR, 0.5% price); TP = +3.1995 ATR, trailing step = 0.20 ATR, up to 46h, H2 trailing update.
- Existing modeled baseline V12 LONG 142/140 positions all belong to TIME routes. These price-model exits must not be equated to signed resident STOP fills; venue reconciliation outstanding.

## Causal two-axis research

- First-negative: require maximum favorable excursion below a threshold and confirmed bearish H1 closes, with optional BTC three-hour weakening; market EXIT modeled at next M5 open.
- Post-profit: peak MFE +2%, +3% or +5% achieved in the past, followed by closed-H1 bearish movement and profit giveback; trigger only after completed H1 candles.
- Baseline data: 2025-08-10 to 2026-08-10. Full eight-logic dynamic allocation, costs 10/30 bps, modeled fills and full H1 MTM DD.
- The first 2h variant was independently recomputed after fixing the exact two-H1 causal observation window. All other candidates require 3 complete H1 closes and are unaffected by the correction.

| Candidate | ΔDD 10bps | ΔDD 30bps | Final10 JPY | Final30 JPY | Saved original losses10 | Cut original winners10 | Verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| INITIAL_X_2H_MFE0P5_NEG0P75 | +0.0014pt | -0.0289pt | ¥219,563,473 | ¥118,481,683 | 3 | 4 | REJECT |
| INITIAL_X_4H_MFE1_NEG1P0_BEAR2 | +0.0007pt | -0.0288pt | ¥223,638,328 | ¥120,916,338 | 2 | 1 | REJECT |
| INITIAL_X_4H_MFE1_NEG1_BEAR2_BTC3NEG | -0.0206pt | +0.0000pt | ¥222,999,142 | ¥124,224,950 | 1 | 0 | REJECT |
| INITIAL_XY_6H_MFE1_NEG1P5_BEAR2 | -0.0071pt | -0.0236pt | ¥221,827,250 | ¥121,642,875 | 2 | 1 | REJECT |
| INITIAL_Y_3H_MFE0P5_NEG0P75_BEAR2 | +0.0000pt | +0.0000pt | ¥220,772,923 | ¥121,301,258 | 1 | 1 | REJECT |
| PROFIT_X_2P0_FLOOR0P5_BEAR2 | +0.0058pt | -0.0133pt | ¥221,592,948 | ¥118,150,579 | 2 | 4 | REJECT |
| PROFIT_X_3P0_FLOOR1P0_BEAR2 | +0.0000pt | +0.0000pt | ¥222,373,711 | ¥123,696,117 | 0 | 1 | REJECT |
| PROFIT_XY_3P0_FLOOR0P5_BEAR2_BTCNEG | +0.0000pt | +0.0000pt | ¥222,355,103 | ¥123,624,655 | 0 | 2 | REJECT |
| PROFIT_XY_5P0_FLOOR2P0_BEAR2 | +0.0000pt | +0.0000pt | ¥222,521,201 | ¥123,899,248 | 0 | 2 | REJECT |
| PROFIT_XY_2P0_FLOOR0_BEAR2 | -0.0067pt | -0.0159pt | ¥218,678,349 | ¥111,793,206 | 2 | 7 | REJECT |

**Gate result:** 0/10 variants improved both 10 and 30 bps MTM maximum DD by at least 0.10 percentage point.
Several rescue 1-3 losing trades, but either also cut profitable trades or worsen cost-stress DD; no Production promotion.

## Why maximum DD does not respond

- Independent frozen H1 mark ledger places common maximum DD in 2025-12-05 19:00 UTC to 2025-12-10 23:00 UTC at both costs.
- No accepted V4 LONG overlaps this peak-trough, hence V4 LONG exit rules cannot directly remove the source risk in that window.
- Actual short and PENGU risks in the window need separate contribution and shared-risk DD governor study; do not change PENGU parameters under this task.

## Limitations and follow-on verification

1. Historical model follows 5m market trajectories; this does NOT prove live Aster resident STOP activation, signed partial-fill reconciliation, gap execution or price ticks.
2. TIME37 resident fixed 8% emergency STOP is part of the current implementation contract but source-backed research did not model signed exchange trigger fills. Reconcile this lifecycle before promoting a price-model result.
3. BTC gate uses timestamps strictly before each completed H1 boundary; no future market closes or final P/L used to trigger exits.
4. No final validation against the independently authored TypeScript new Task9 reducer; source-based full8 allocator accounting passed for all costs and cases.
5. This is post-hoc exploratory over previously inspected history, no untouched holdout.
6. Profit giveback and early initial weakness are distinct proposed exits; no arbitrary account-level DD kill-switch can be inferred from the 20-21% research design guide.

Research code: scripts/dd-reduction/run-task9-v4-long-two-axis-20261021.py
Evidence source JSON: V12_V4_LONG_H1_TWO_AXIS_RESEARCH_20261021.json
Unit test: scripts/dd-reduction/test-v4-long-two-axis-20261021.py
Decision: preserve V4 LONG settings; no validated DD-improving overlay in this experiment.
