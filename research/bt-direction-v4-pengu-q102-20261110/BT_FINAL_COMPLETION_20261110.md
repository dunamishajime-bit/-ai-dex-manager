# BT final completion — 2026-11-10

## Status

**BT_RESEARCH_COMPLETE_NOT_PRODUCTION_CERTIFIED**

This research backtest is now reproducible and closed for this dataset. No LIVE order, position, STOP, runner state, GitHub Production deployment, or venue mutation was performed.

The fixed profit target was intentionally removed. Profit remains an important output, but the primary evaluation order is:

1. causality / no hindsight,
2. max drawdown,
3. win rate,
4. profit after fees and funding,
5. trade count / over-filtering.

## Periods and costs

- Historical: 2025-10-01 00:00 UTC through 2026-10-01 00:00 UTC, end-exclusive.
- Forward holdout: 2026-10-01 00:00 UTC through 2026-11-08 20:00 UTC.
- Initial equity: JPY 10,000.
- Round-trip cost cases: 10bps and 30bps.

## Finding 1 — old V4 V2 body is not valid causal evidence

The historical V4 V2 population of 1,394 entries can be traced to 1,394 underlying native source events, but the later V2 route/filter selection was trained with realized outcomes from the same broad period.

Therefore the old high-return V4-integrated replay remains useful only as an implementation/research counterfactual. It cannot certify expected performance.

The current best implementation-replay research case was:

| Cost | Final JPY | Max DD | Win rate | PF | Fills |
|---|---:|---:|---:|---:|---:|
| 10bps | 2,710,806.74 | -25.19% | 60.32% | 1.664 | 804 |
| 30bps | 689,399.89 | -28.90% | 57.48% | 1.427 | 802 |

Research rules in that case:
- IDLE JUP: rel24 >= -0.04089204262472046
- PENGU Recovery V8: btc24h <= 0.011611625094354983
- Q102 FET family: ret14 <= 0.048722800378429465
- V4 REC_Y concurrent gross cap: 0.6x
- When portfolio DD <= -12%, PENGU+Q102+IDLE shared gross cap: 2.0x

**Do not treat the table above as causal-certified performance because the V4 V2 body remains retrospectively filtered.**

## Finding 2 — clean forward V4 body fails

The V4 source was regenerated on forward data with only completed H1/H2 information and without loading the V2 full-year route priority/filter.

Forward clean source:
- 184 candidates
- 181 completed
- 3 right-censored

Results:

| Source | Cost | Win rate | Mean unit net | PF |
|---|---:|---:|---:|---:|
| Clean native V4 body | 10bps | 38.12% | -0.224% | 0.499 |
| Clean native V4 body | 30bps | 28.73% | -0.424% | 0.272 |
| Native FAILED_BREAK core | 10bps | 62.50% | +0.485% | 6.688 |
| Native FAILED_BREAK core | 30bps | 62.50% | +0.285% | 2.779 |

Conclusion:
- The unfiltered native V4 body is not currently acceptable.
- The independent FAILED_BREAK core remains promising but small.
- The causal-conservative integrated portfolio therefore removes all 1,394 historical V4 V2 body candidates and keeps only the 49 historical native FAILED_BREAK core events selected by frozen Top3/ATR sizing.

## Finding 3 — three causal-ish gates survive validation/forward checks

### IDLE JUP
Rule:
- rel24 >= -0.04089204262472046

Forward 30bps:
- baseline: 16 trades, WR 43.75%, mean -0.796%, PF 0.667
- gated: 7 trades, WR 71.43%, mean +2.401%, PF 3.999

### PENGU Recovery V8
Rule:
- btc24h <= 0.011611625094354983

Forward sample only has 4 V8 trades and all four pass the rule:
- WR 75.00%
- mean +1.122%
- PF 1.712 at 30bps

This rule remains weakly evidenced because forward N=4.

### Q102 FET family
Rule:
- ret14 <= 0.048722800378429465

Forward 30bps:
- baseline: 15 trades, WR 53.33%, mean +0.480%, PF 1.461
- gated: 14 trades, WR 57.14%, mean +0.612%, PF 1.600

## Final causal-conservative full-period integrated BT

All 1,394 retrospectively filtered V4 V2 body candidates were removed.
Only 49 native FAILED_BREAK core events were restored using:
- source timestamp grouping,
- score-descending/symbol tie-break Top3 selection,
- frozen ATR risk sizing:
  `gross=min(1, 0.0319/(max(2.477*ATR, price*0.005)/price))`,
- rank3 cap 0.10x.

### Without the three gates

| Cost | Final JPY | Max DD | Win rate | PF | Fills |
|---|---:|---:|---:|---:|---:|
| 10bps | 377,920.53 | -39.17% | 56.51% | 1.220 | 538 |
| 30bps | 135,883.71 | -50.38% | 53.62% | 1.158 | 539 |

### With the three gates

| Cost | Final JPY | Max DD | Win rate | PF | Fills |
|---|---:|---:|---:|---:|---:|
| 10bps | 1,173,171.21 | -30.26% | 58.25% | 1.613 | 515 |
| 30bps | 401,286.19 | -36.26% | 55.34% | 1.426 | 515 |

The three gates materially improve the causal-conservative model in both cost cases.

## Acceptance result

- Profit positive at both 10bps and 30bps: **PASS**
- Max DD <=20% at both costs: **FAIL**
- Win rate >=70% at both costs: **FAIL**
- Deterministic rerun: **PASS**
- Production parity: **FAIL / not claimable**

The correct conclusion is not to force more thresholds from the same historical year. The causal-conservative portfolio is profitable but still too volatile and below the win-rate target.

## Determinism

The causal-conservative three-gate case was rerun from the same inputs.

All 8 key artifacts matched exactly:
- 10bps SUMMARY
- 10bps FILLS
- 10bps EQUITY_30MIN
- 10bps DECISIONS
- 30bps SUMMARY
- 30bps FILLS
- 30bps EQUITY_30MIN
- 30bps DECISIONS

Determinism status: **PASS**.

See:
- `results/BT_FINAL_COMPLETION_20261110.json`
- `results/DETERMINISM_RECHECK_20261110.json`
- `results/FORWARD_FUNDING_MANIFEST_20261110.json`

## Remaining non-parity that cannot be repaired from the supplied historical evidence

1. V52 historical executable order-book / exact historical fill evidence is unavailable; the integrated model uses the existing price proxy.
2. RESIDUAL retains 79 historical exit-model gaps inherited from the base engine.
3. Market fills and some exits are modeled rather than signed historical venue fills.
4. Current V4 live-decision code imports the V2 shadow policy; because that V2 policy was derived from realized historical outcomes, it cannot be used to certify an untouched historical causal backtest.

These limitations are now explicit rather than hidden inside a single headline return number.

## Final decision for this BT

This dataset's BT is complete.

The old headline high-return BT should not be reused as certified evidence.

For future strategy changes, start from:
- causal-conservative V4 core-only baseline,
- three validated gates,
- separate 10bps and 30bps accounting,
- independent forward checks,
- exact reproducibility hashes.

No Production/LIVE adoption is authorized by this research result alone.
