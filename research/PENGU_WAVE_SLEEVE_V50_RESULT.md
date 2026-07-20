# PENGU Wave Sleeve V50 Result

## Design

- Long and Short candidate spaces are fully separate.
- One-hour decision interval; no 24-hour decision wait.
- Extreme Momentum + volume acceleration + volatility expansion: immediate 0.05 Gross probe.
- Ordinary candidates: armed state only, no order.
- Confirmation within 3 hours: enter/add to total 0.15 Gross.
- Short selected and evaluated first; Short wins conflicts.
- Long disabled unless untouched Holdout and Holdout Severe are positive and major-wave early-capture gate passes.
- Final chronological 20% is untouched during selection.

## Result

Status: **NO_PRODUCTION_CANDIDATE**

### Long

Selected candidate:

`L_BREAK_LB6_M10p35_M32_REL0p5_VA1p1_VX1_XF2p2_CF0p4_WIDE`

- Train: +1.3001%, PF 1.3999, DD -2.2321%, 22 trades
- Train Severe: +0.9041%
- Validation: +0.1582%, PF 1.1382, DD -1.0974%, 9 trades
- Validation Severe: +0.0111%
- Untouched Holdout: +0.1281%, PF 1.3547, DD -0.1882%, 5 trades
- Untouched Holdout Severe: +0.0511%, PF 1.1305
- Long major 24h waves: 3/3 captured, 1/3 early, 2/3 profitable
- Long major 72h waves: 1/1 captured, 0/1 early, 1/1 profitable
- Aggregate Long major early rate: 25%
- Adoption gate: FAIL because required early rate is >=50%

Entry delay on major Long waves:

- +20.7539% / 24h wave: 5 hours, profitable
- +23.6789% / 24h wave: 24 hours, loss
- +31.8642% / 24h wave: 23 hours, profitable
- +46.8236% / 72h wave: first entry after 14 hours, profitable overall

Conclusion: separate Long logic and one-hour evaluation materially improve Holdout stability and capture all identified Long major waves, but two 24h waves are still entered near the end of the move.

### Short

- Eligible Short candidates after Train + Validation + cluster stability: 0
- No Short candidate was allowed to inspect or pass the untouched Holdout as a production candidate.
- Adoption gate: FAIL

## Comparison with V49

V49 Long Holdout was negative. V50 Long changed to:

- Holdout +0.1281%
- Holdout Severe +0.0511%
- 3/3 Long 24h major waves eventually captured

The principal remaining issue is no longer Holdout profitability; it is early timing.

## Safety

- Production changed: NO
- LIVE changed: NO
- VPS changed: NO
- Orders sent: NO
- Research-only Draft PR; do not merge into production.
