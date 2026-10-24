# RENDER #4427 independent SHORT: sensitivity and Native8 execution audit (2026-10-24)

**RESEARCH ONLY, NOT APPROVED FOR LIVE.**

Historical sensitivity uses independent no-OI entry gates, completed-as-of 90/180d shadow outcomes, and conservative incumbent priority. The five historical windows were already inspected: this is not pristine OOS.

| Seller gate | New shadow trades | 2024 30bps Δcompound | 2025H2 30bps Δcompound | 2026JanAug 30bps Δcompound | 10/30bps all five nondegrading |
|---|---:|---:|---:|---:|---|
| 53% | 53 | +18.551pp | +1.646pp | -3.140pp | FAIL |
| 54% | 41 | +12.049pp | +1.646pp | +0.000pp | FAIL |
| 54.5% | 51 | +21.531pp | +1.646pp | +7.667pp | FAIL |
| 55% | 38 | +14.519pp | +1.646pp | +4.973pp | PASS |
| 55.5% | 36 | +15.949pp | +1.646pp | +4.973pp | PASS |
| 56% | 35 | +14.445pp | +1.646pp | +4.973pp | PASS |
| 56.5% | 26 | +9.810pp | +1.646pp | +3.296pp | PASS |
| 57% | 20 | +5.499pp | +1.646pp | +3.296pp | PASS |
| 58% | 18 | +5.499pp | +1.646pp | +0.000pp | PASS |
| 60% | 18 | +5.499pp | +1.646pp | +0.000pp | PASS |

The 55%-56% plateau retains 3 candidate timestamps in the Native8 window and 2 actual modeled accepted entries. Shadow independent entries are highly clustered: 28 in 2024, 7 in 2025 (Jan1 and Sep6, latter 4 wins/2 losses), and 3 in 2026 (May1 June2), none Aug–Oct. The 2025 Sep entries cannot be Native8 accepted without authentic missing Aster RENDER H1 marks (source begins Jan6 2026).

## Native8 incremental adverse-execution sensitivity

Only new RENDER independent SHORT exit prices receive extra 60/120bps modeled adverse change; baseline strategy, gross, owner, margin and risk checks remain. Shared portfolio 2025-08-10 to 2026-08-10, normal 10/30bps on top.

| Extra disadvantage | Δ final equity 10bps (JPY) | Δ final equity 30bps (JPY) |
|---|---:|---:|
| none | +1,482,753.20 | +865,155.03 |
| +60bps | +843,830.35 | +429,746.68 |
| +120bps | +204,868.93 | -5,336.47 |

24 modeled Native8 runs: 4 route/cost conditions × 2 costs × 3 repeats. Accounting PASS; within-condition economic ledger exact after stripping synthetic candidate_id, 2 extra accepted trades (or baseline 0), zero displaced original trades, and no same-symbol overlaps. Max MTM DD unchanged at -14.514985% (10bps) and -15.014724% (30bps).

**Stress conclusion:** 120bps additional unfavorable fill on new entries wipes the 30bps model incremental benefit, slightly negative. Improvements arise from only two accepted June 2026 modeled fills. Historic thresholds were optimized after observing market results; forward validity is unknown.

**Decision: RESEARCH_CANDIDATE_ONLY. No LIVE/VPS/HP/Production change.**

Next: seek authentic Aster RENDER historical 2025 marks if available (otherwise fail closed), prospectively collect genuine time-locked shadow with more trades across months/regimes, test nonseasonal independently firing new entrance families with 10/30bps and MTM DD, then audit HP/Runner score, funding, partial fills, pending, portfolio gross/Shared Risk/Margin Guard for any eventual proposal.

Sources in this branch: RENDER_4427_SELLER_THRESHOLD_TEMPORAL_SENSITIVITY_20261024.json and RENDER_4427_INDEPENDENT_NATIVE8_COST_STRESS_AUDIT_20261024.json; reproducible scripts under scripts/dd-reduction/. Windows owner-PC C:/tmp historical inputs remain required for recreation.
