# V4/PENGU independent research checkpoint — 2026-11-10

RESEARCH ONLY. No Production, LIVE, STOP, or order modifications.

## V4 Y06 (352 SHORTs)

The chronological TARGET split contains train 211 (39 beneficial flips), validation 70 (33), test 71 (48). Benefit prevalence shifted 18.5% -> 47.1% -> 67.6%, so global training precision is not stable across regimes.

Independently recomputed 3h/6h/12h/24h cross-sectional positive breadth and mean return over 30 non-BTC Aster H1 instruments, using only prior completed candles. 352 events x 8 features = **2,816 matched feature values**, max error about 1.4e-17. No ongoing H1 candle was used.

For label availability, 72h prior-to-boundary purging leaves 208 training and 54 mature validation events. A deterministic regularized entry-only classifier achieved full validation AUC 0.381, 0 beneficial and 5 harmful flags; unseen test 6 beneficial and 1 harmful flags. Adding market-breadth features worsened validation AUC to 0.329 and again caused 5 harmful validation flags; unseen test 3 beneficial and 1 harmful flag. A naive breadth_pos12 >= 0.70 switch harmed 125 originally correct native SHORTs in train.

**Y06 remains UNRESOLVED_DATA_OR_SEPARATION. Do not introduce the tested direction switch.**

Replay: [Y06 independent script](./scripts/y06-breadth-independent-validation-20261110.py) and [full metrics/source SHA256](./results/v4_y06_breadth_independent_validation_20261110.json).

## V4 X05/X11 fixed historical threshold jitter

The source feature ledger has SHA256 979b0a6399f4e3ba00223e245cd9fb47ba47cf5e5b322da04deec933f6afa4f6.

| Route | Baseline rule | Train | Validation | Test | All-split zero-FP jitter cells with test activation |
|---|---|---|---|---|---|
| X05 | sym_vol72 <= .00658 AND sym_ret6 > 0 | 1 beneficial / 0 harmful | 2/0 | 1/0 | 6 / 15 |
| X11 | rel72 > 0 AND sym_ret12 > 0 | 2/0 | 1/0 | 1/0 | 3 / 9 |

**X11 independence issue:** flagged events are 2025-11-07 02:00 and 04:00 UTC, plus 2026-06-07 06:00 and 10:00 UTC. The 48h exit horizon groups four flagged trades into only **two separate time episodes**. The validation and test flagged entries are four hours apart in one episode. The reported held-out 1/1 is not independent event-level corroboration; require fresh, episode-purged OOS.

X05 flagged on four separate dates but its sample is tiny and raw-price bear synthetic counterexamples remain. The recorded raw return differences on this feature table are not identical to full native-lifecycle PnL from other saved ledgers; do not cross-mix them.

Replay: [fixed-grid X05/X11 script](./scripts/v4_x05_x11_fixed_threshold_jitter_recheck_20261110.py) and [full results](./results/v4_x05_x11_fixed_threshold_jitter_recheck_20261110.json). These historical splits were previously inspected and are **not fresh OOS**.

## PENGU LONG V64 2h

A read of the saved native-lifecycle replay showed 7 beneficial reversal flags but only **five disjoint nonoverlapping trade episodes**. PENGU_00023 and _00024 entered 2025-12-09 17:00/19:00 UTC and shared exit 2025-12-11 21:00 UTC. PENGU_00098 and _00099 entered 2026-08-21 22:00 and 2026-08-22 03:00 UTC, sharing exit 2026-08-22 07:00 UTC. Both test flags are in the same episode. The saved continued-bull synthetic counterexample still defeats the Gate.

Thus V64 remains a **research candidate only**, not an approved Production change. Its 7/7 success is not seven independent positive trials. Require episode-grouped fresh OOS and synthetic/regime robustness.

PENGU V8 2h must be reviewed on the full 50 strictly feasible cases (21 beneficial vs 29 harmful unfiltered reversals), not the earlier selected seven; V20 remains unresolved/native.

## Next step and scope

For Y06, test new causal state transitions, no-flip early exits, and complete time-ordered event-grouped validation, not more thresholds mined from the same features. For X05/X11 and PENGU V64, require genuinely independent, embargoed forward data and raw-price synthetic stress. No new Gate passes acceptance. **No integrated 10bps/30bps portfolio BT was triggered by this negative-only checkpoint**. The ORACLE portfolio drawdown (-18.59% at 10bps / -19.85% at 30bps) remains a hypothetical bound, not deployable performance.

Permanent protocol: [DISDEX_BT_VALIDATION_PROTOCOL.md](../../docs/research/DISDEX_BT_VALIDATION_PROTOCOL.md).
