# V71 + V35 Fixed-checkout Audit V95 Results

## Status

- Status: `V71_V35_FIXED_AUDIT_PASS`
- Same-checkout repeated V35 Growth calculation: identical
- Production / LIVE / VPS changed: NO
- Orders sent: NO

## Baseline V71

| Metric | Result |
|---|---:|
| Full compounded return | +1147.6867% |
| CAGR | +105.8307% |
| Max drawdown | -31.7730% |
| Severe return | +152.8386% |
| Severe max drawdown | -50.2383% |
| Large-wave-excluded return | +521.1113% |
| Large-wave-excluded Severe | +25.9583% |

## V71 drawdown-only fixed profiles

### BALANCED

Rule: after confirmed 12h high-turnover / direction-flip whipsaw, temporarily scale Core to 60%. PENGU V67 sequence and target Gross 1.15 remain unchanged; total observed Gross stays capped at 2.0.

| Metric | Result |
|---|---:|
| Full return | +993.0073% |
| Max drawdown | -28.2350% |
| Severe return | +212.0506% |
| Severe max drawdown | -45.6521% |
| Large-wave-excluded return | +444.1104% |
| Large-wave-excluded Severe | +45.3629% |

### DEFENSIVE

| Metric | Result |
|---|---:|
| Full return | +834.3361% |
| Max drawdown | -25.7488% |
| Severe return | +216.4693% |
| Severe max drawdown | -41.8888% |
| Large-wave-excluded return | +365.1209% |
| Large-wave-excluded Severe | +55.4047% |

## V35 improved profiles combined with PENGU Gross 1.15

Both profiles preserve immediate Entry / Exit / direction changes. They suppress only small same-direction weight changes below 5%, force refresh after 12 completed 12h bars, and keep total observed Gross capped at 2.0.

### GROWTH — recommended when minimizing lost return

| Metric | Result |
|---|---:|
| V35 Core-only return | +304.3938% |
| V35 Core-only Severe | +27.7977% |
| V35 Core-only max drawdown | -29.9590% |
| Combined full return | +1094.8712% |
| CAGR | +103.3000% |
| Combined max drawdown | -29.9590% |
| Combined Severe | +238.6445% |
| Combined Severe max drawdown | -45.6316% |
| Large-wave-excluded return | +494.8084% |
| Large-wave-excluded Severe | +68.6957% |
| Combined 2026 H1 | +34.0708% |
| Combined 2026 H1 Severe | +7.2361% |
| Best PENGU trade removed Severe | +58.0334% |
| Best PENGU month removed Severe | +42.6481% |
| Observed max Gross | 2.0 |
| Minimum PENGU clip ratio | 0.5642 |

Compared with baseline V71, GROWTH retains approximately 95.4% of full return and 95.0% of large-wave-excluded return, while improving normal DD by about 1.81 points and Severe DD by about 4.61 points.

### RESILIENT — selected by the robustness-first ranking

Adds a confirmed momentum-exhaustion guard: after one completed 12h overheat signal, scale Core to 80% for two completed 12h buckets.

| Metric | Result |
|---|---:|
| V35 Core-only return | +291.6255% |
| V35 Core-only Severe | +31.1593% |
| V35 Core-only max drawdown | -28.9109% |
| Combined full return | +1057.1445% |
| CAGR | +101.4430% |
| Combined max drawdown | -28.9109% |
| Combined Severe | +252.3710% |
| Combined Severe max drawdown | -44.8621% |
| Large-wave-excluded return | +476.0280% |
| Large-wave-excluded Severe | +75.5336% |
| Combined 2026 H1 | +35.2495% |
| Combined 2026 H1 Severe | +9.9442% |
| Best PENGU trade removed Severe | +64.4391% |
| Best PENGU month removed Severe | +48.4301% |
| Observed max Gross | 2.0 |
| Minimum PENGU clip ratio | 0.5642 |

Compared with baseline V71, RESILIENT retains approximately 92.1% of full return and 91.3% of large-wave-excluded return, while improving normal DD by about 2.86 points and Severe DD by about 5.38 points.

## Rejected structures

- Simple portfolio DD threshold: reduced too much return.
- Conditional DD alone: improved normal DD but did not improve Severe DD sufficiently.
- Strong-regime multiplier boost alone: increased Development profit but did not repair 2026 H1 Severe.
- Turnover-only filter: turnover was not the main 2026 loss source.
- Staged Entry: no candidate passed.
- ATR emergency stops: reduced profit and did not solve the 2026 loss regime.

## Interpretation

- Use `GROWTH` as the historical high-return candidate when preserving V71 profit is the first priority.
- Use `RESILIENT` as the historical default candidate when large-wave-excluded Severe and 2026 H1 Severe are the first priority.
- Keep `BALANCED` and `DEFENSIVE` as simpler V71-only fallback profiles.
- These are historical research results. 2026 H1 is reused acceptance evidence, not pristine Holdout. Freeze the selected profile and collect future evidence before Production promotion.
