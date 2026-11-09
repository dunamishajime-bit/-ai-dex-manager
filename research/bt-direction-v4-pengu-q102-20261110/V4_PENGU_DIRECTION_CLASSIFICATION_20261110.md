# V4 / PENGU direction classification - deep revalidation 2026-11-10

Research only. No Production/LIVE changes.

## Important corrections to earlier research statements

- The earlier PENGU Recovery V8 3/3 + 2/2 + 2/2 two-hour result was based on a selected seven-event subset. One of those seven is temporally infeasible because the native hard stop exits at the two-hour decision timestamp. Rebuilding all 51 Recovery V8 cases leaves 50 strictly feasible cases, and 21/50 benefit from a two-hour reversal. The old rule is therefore not accepted as a solved rescue rule.
- The earlier V4 X05/X07/X11 simple rules passed historical split precision tests, but raw-price synthetic stress produced valid bearish counterexamples for the standalone rules. X05/X07 are downgraded to unresolved component candidates. X11 improves when absolute symbol trend is added, but remains small-sample / threshold-sensitive.
- Initial PENGU delay search allowed time/index and absolute-price features in its candidate pool. A second independent search using only normalized return/relative/volatility/RSI-style features is the controlling result below.

## PENGU final research classification

| Route | Status | Current conclusion |
|---|---|---|
| LONG V64 | ACCEPTED_CAUSAL_CANDIDATE | Planned 2h LONG-to-SHORT switch when BTC 72h log-return volatility > 0.0033088852 AND PENGU-BTC 12h relative return > 0.0735537632. 7/7 beneficial across train/validation/test; 15/25 threshold-jitter cells remain zero-FP with test triggers; same gate is beneficial for all eligible cases at 2h (7/7), 4h (5/5), 6h (5/5), 12h (4/4), but 8h has one adverse case. Research candidate only, not Production-adopted. |
| Recovery V8 | UNRESOLVED_DATA_OR_SEPARATION | Keep native entry. Full 50-case two-hour label rebuild has 21 beneficial / 29 harmful reversals. No train+validation zero-FP rule survives under the original broad search. Normalized-only 2h/6h searches find sparse pre-entry conditions with only four total flagged events each and no actual post-delay confirmation feature; not sufficient to call solved. |
| SHORT V20 | UNRESOLVED_DATA_OR_SEPARATION | Keep native. 2/6/8/12h candidates have no final-test triggers; 4h develops a final-test false positive. No delayed rule accepted. |

### V64 controlled integrated A/B

- Same integrated engine and same V4/Q102 assumptions; only PENGU lifecycle changed.
- Native PENGU baseline: 10bps final 2,592,724.76 JPY, DD -38.21%; 30bps final 764,259.66 JPY, DD -50.57%.
- V64 2h gate: 10bps final 3,972,843.81 JPY, DD -38.21%; 30bps final 1,176,141.20 JPY, DD -50.57%.
- Therefore V64 materially improves final equity in this research engine without worsening max DD, but it does not reduce the portfolio max-DD bottleneck.
- Artificial raw-price test includes an explicit continued-bull counterexample where the gate fires and the two-hour SHORT switch loses. The candidate is empirical/causal, not logically guaranteed.

## V4 route classification

| Route | Status | Reason |
|---|---|---|
| CONT_SHORT_MID_AGE24_48 | REJECTED | No robust correction; keep native. |
| REC_G1_MID_REL_LOWVOL | REJECTED | No robust correction; keep native. |
| REC_G2_EARLY_BTC_OPPOSE_VOL | REJECTED | Final unseen false positives. |
| REC_G3_LATE_BTC_REL | REJECTED | No confirmed correction; keep native. |
| REC_G4_MATURE_REL_RANGE | UNRESOLVED_DATA_OR_SEPARATION | Candidate did not trigger final unseen data. |
| REC_G5_SLOW_TREND | REJECTED | No robust correction; keep native. |
| REC_X01_TIME_24H | REJECTED | No zero-FP rule. |
| REC_X02_TIME_36H | REJECTED | Final unseen false positives. |
| REC_X03_TIME_12H | UNRESOLVED_DATA_OR_SEPARATION | Conflicting audits; full strict audit unconfirmed. |
| REC_X04_TIME_24H | REJECTED | Final unseen false positives. |
| REC_X05_TIME_36H | UNRESOLVED_DATA_OR_SEPARATION | Old vol72 rule was zero-FP historically, but raw-price synthetic bear counterexamples exist; stronger absolute-trend confirmations lose OOS support. |
| REC_X06_TIME_12H | REJECTED | Final unseen false positives. |
| REC_X07_TIME_6H | UNRESOLVED_DATA_OR_SEPARATION | Old 3h rule was zero-FP historically, but synthetic continued-bear counterexamples exist; positive-trend confirmation loses OOS triggers. |
| REC_X08_TIME_48H | REJECTED | Final unseen false positives. |
| REC_X09_TIME_48H | UNRESOLVED_DATA_OR_SEPARATION | No final unseen trigger. |
| REC_X10_TIME_48H | REJECTED | No robust correction; keep native. |
| REC_X11_TIME_48H | UNRESOLVED_DATA_OR_SEPARATION | Composite rel72>0 AND sym_ret12>0 gives 2/2 train, 1/1 validation, 1/1 test zero-FP, but only four events and threshold-jitter is sensitive to the rel72=0 boundary. |
| REC_X12_TIME_12H | REJECTED | Final unseen false positives. |
| REC_X13_TP1.5_SL1_H24 | REJECTED | No confirmed correction; keep native. |
| REC_X14_TIME_48H | REJECTED | Final unseen false positives. |
| REC_Y01_REV_D0_T72 | REJECTED | No robust correction; keep native. |
| REC_Y02_REV_D0_T12 | REJECTED | No robust correction; keep native. |
| REC_Y03_REV_D0_T36 | REJECTED | Final unseen false positives. |
| REC_Y06_REV_D0_T72 | UNRESOLVED_DATA_OR_SEPARATION | Major DD route. Static 1-3 condition, already-settled online shadow adaptation, and 1/2/3/6/12h rescue searches all produced zero acceptable train+validation zero-FP candidates. |
| REC_Y07_REV_D0_T72 | REJECTED | No robust correction; keep native. |
| REC_Y08_REV_D0_T6 | REJECTED | No robust correction; keep native. |
| REC_Y11_REV_D0_T36 | REJECTED | Final unseen false positives. |
| REC_Y12_REV_D0_T24 | REJECTED | No robust correction; keep native. |
| REC_Y15_REV_D0_T3 | REJECTED | No robust correction; keep native. |
| REC_Y16_REV_D0_T6 | REJECTED | No robust correction; keep native. |

### V4 summary

- No V4 direction-flip rule is promoted to ACCEPTED_CAUSAL_CANDIDATE in this checkpoint.
- X11 is the strongest remaining component candidate, but only four events are flagged and the result is sensitive to the rel72 > 0 sign boundary.
- Y06 remains the major unresolved route. Three distinct causal approaches (static entry, online settled-shadow adaptation, post-entry rescue) failed the strict zero-FP train+validation requirement.
- For routes marked REJECTED, the direction-correction proposal is rejected; the native route itself is not being disabled by this research.

## Independent validation / methodology findings

- Exact V4 H1 feature parity was independently recomputed: sym_vol72 equals population stdev of 72 hourly log returns; X07 3h returns and X11 rel72 match source H1 data.
- PENGU p_r2 was independently verified as original-entry price to the second completed H1 close.
- Delay reversal feasibility is checked before labeling: native final exit must be after the decision time and no native partial event may have occurred at/before the decision in the full-quantity replay.
- Rule selection uses chronological train/validation; final test is not used to select thresholds.
- Time/index and absolute-price-level features are excluded in the controlling PENGU normalized-only search to reduce non-stationary proxy leakage.
- Small samples remain a material caveat even when observed precision is 100%.

## Next V4/PENGU work before moving strategy family

1. Treat V64 2h as a research candidate and continue forward/OOS accumulation rather than weakening the gate to increase recall.
2. Do not promote V8/V20 rescue rules unless new independent OOS events create a test-confirmed separator.
3. For V4, keep X05/X07/X11 as research components only; Y06 remains unresolved. Any new Y06 work must introduce genuinely new causal information rather than more threshold mining on the same feature set.
4. Re-run integrated 10bps/30bps whenever an accepted candidate changes.
