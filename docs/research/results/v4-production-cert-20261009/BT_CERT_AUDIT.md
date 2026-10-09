# V4 production certification — independent BT evidence (2026-10-09)

**BLOCKED exact current-runtime/full8 external certification. Research baseline parity PASS. No live orders or deployments.**

| Cost | Final JPY | PF | MTM DD | All / V12 trades |
|---|---:|---:|---:|---:|
| PRICE_MODEL_10BPS | 291,326,102.62 | 4.048992 | -20.420014% | 1222 / 828 |
| PRICE_MODEL_20BPS | 231,193,740.03 | 3.655683 | -20.965901% | 1224 / 828 |
| PRICE_MODEL_30BPS | 174,749,524.32 | 3.277641 | -18.388765% | 1218 / 824 |

12/12 original trade/equity/funding/metrics hashes match; 30/30 imported modules normalize exactly to frozen y06 source. All eight systems are present in the model. Original source worktrees were read-only; output redirects exclusively to this certification worktree.

Recorded October 7 current Aster quantity filters: all 1,222 / 1,224 / 1,218 closed quantities normalize exactly; no would-floor/minQty/minNotional failures. This is a modeled current-filter diagnostic, not a historical filter archive or actual venue-fill certification. strict_quantity=false refers to an admission option and does not imply illegal fractional modeled quantities.

Research V52 funding_verified and model_complete are true in all scenarios. That model evidence does not prove current live stock-funding/ownership parity.

Original V4 external rerun: 274 events reproduce full route ledger exactly. 299 source-feature evaluations only read H1 bars strictly before entry. Independently recomputed Y06 relative24 predicate and reversed SHORT72h exit:102 events,38 wins, PF10/20/30 =0.299519/0.286658/0.274162.

Selected V2 causal external translation:41 frozen route definitions, two repair passes, full-training hindsight rank/gross recorded without external reoptimization. 288 pre-repair /258 post-repair events; PF10/20/30 =0.570027/0.544400/0.519875. Y06 remains102 with same independent results. This applies causal predicates instead of training inc_keys, and has not proved exact training-baseline translation parity. Fixed priority is retrospective within training and frozen before external evaluation.

Neither external study replays full8 ownership/gross/quantity/funding/MTM DD. External date range has previously been viewed and is not pristine prospective OOS.

| System | Exact runtime parity | Evidence / remaining gap |
|---|---|---|
| V12 | BLOCKED | Selected repaired model rerun exact; current runtime X1 ALL and2.0 cap differ; causal41 translation parity unproved. |
| PENGU | BLOCKED | Model67 closed events at all costs; current V2 max gross1.0; no current-flag eventwise history replay. |
| Q102 | BLOCKED | Fixed HIGH_VOL + noncolliding S34 delta; runtime CAUSAL_V4 max3.0 requires full selector stream. |
| V52 | BLOCKED | Research model/funding complete; current state/reference/venue history parity unproved. |
| HYPE_LONG | BLOCKED | H1 source exits modeled; runtime TREND/preemption-disabled flag history not replayed eventwise. |
| FET | BLOCKED |7 modeled closed events; exact current residual/ownership event history unproved. |
| IDLE | BLOCKED |47/51/53 modeled events; live shared reservations/daily governor/asynchronous cadence unproved. |
| RESIDUAL | BLOCKED |22 modeled events; enabled inside IDLE runner; exact live preemption/lifecycle history unproved. |

Effective runtime caps V12=2.0/Crypto=3.0/Total=4.25 differ from selected3.0/3.5/4.75. Raising one cap alone cannot establish portfolio parity.

Artifacts: BT_CERT_AUDIT.json; bt-baseline/fresh-run-summary.json, rerun-manifest.json, perlogic-metrics.json, observed-filter-counterfactual.json; bt-external and bt-selected-external summaries/ledgers; run logs.

Reproduce: python -B scripts/research/v4-production-cert-baseline-20261009.py; python -B scripts/research/v4-production-cert-external-20261009.py; python -B scripts/research/v4-production-cert-selected-external-20261009.py; python -B scripts/research/v4-production-cert-audit-20261009.py.

The final audit recomputes source comparison and current-filter quantity diagnostics. Perlogic metrics separate raw USD settlement values from modeled realized JPY at exit FX. No source edits, checkout, commit, deployment or live writes occurred.
