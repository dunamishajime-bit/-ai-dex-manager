# V52 Resident STOP Decision — 2026-10-05

## Decision

Do **not** add an entry-reference-fixed resident emergency STOP to V52 in Phase 1.

Keep the current dynamic Basis Stop and `basisStopMultiple = 1.75`.

## Comparison

### Current-production-equivalent portfolio

| Model | Final equity | PF | Max DD |
|---|---:|---:|---:|
| Current | JPY 3.283600927bn | 2.4758 | -23.5709% |
| Resident STOP conservative | JPY 3.283600927bn | 2.4758 | -23.5709% |
| Entry-bar upper-bound fixed STOP | JPY 3.236161965bn | 2.4443 | -23.5709% |

### DD12.96 final portfolio

| Model | Final equity | PF | Max DD |
|---|---:|---:|---:|
| Current | JPY 4.067358397bn | 2.9602 | -12.9646% |
| Resident STOP conservative | JPY 4.067358397bn | 2.9602 | -12.9646% |
| Entry-bar upper-bound fixed STOP | JPY 3.715409685bn | 2.9190 | -12.9646% |

The conservative reconstruction produced zero additional V52 stop hits. The upper-bound model produced seven additional hits and materially reduced profit without improving maximum drawdown.

Because V52 entries occur at NY :30 and the available research series is H1, the entry bar contains pre-entry price action. Therefore the upper-bound model is not used as a causal production parity model; it is used only to show the plausible downside of a fixed entry-reference STOP.

## Phase 2

Research separately with 1-minute or better data:
- current dynamic Basis Stop;
- reference-updated resident STOP;
- distant disaster-only resident STOP.

Until then, the fixed V52 emergency STOP is explicitly out of scope for Production.
