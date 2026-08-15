# Profit-Tier + Frozen Loss Firewall V1 — Result (2026-08-16)

Research-only. No Fresh OOS, production, VPS, LIVE, orders, or deployment changes.

## Input corpus

- V96+ normalized trades: 14,422
- positive/flat corpus available before profit discovery: 5,795 positive trades used
- Frozen Loss Firewall V1 was applied before profit-pattern discovery
- feature-usable, firewall-clean positive trades: 1,074
  - Discovery: 157
  - Validation: 917

## Frozen profit tiers

Discovery P33/P67 boundaries:

- SMALL: `0 < return <= 0.3599513294%`
- MEDIUM: `0.3599513294% < return < 1.4307152739%`
- BIG: `return >= 1.4307152739%`

Counts:

- Discovery: BIG 53 / MEDIUM 51 / SMALL 53
- Validation: BIG 257 / MEDIUM 350 / SMALL 310

## Frozen recurring patterns

BIG:

1. `sideRelative72=STRONG_WITH`
   - Discovery lift 1.925, 20 matched positives
   - Validation lift 1.128, 174 matched positives
2. `extensionState=EXTENDED_CHASE`
   - Discovery lift 1.399, 36 matched positives
   - Validation lift 1.111, 350 matched positives

MEDIUM:

1. `horizonState=LONG_HORIZON_COUNTER`
2. `sideRelative72=WITH`

SMALL:

1. `sideRelative24=NEUTRAL`
2. `extensionState=NOT_EXTENDED`
3. `volState=COMPRESSED`
4. `sideZ24=WITH`
5. `volPathState=OTHER`

The pattern set was frozen before candidate backtest.

## First combined candidate

Predeclared rules:

- evaluate LONG and SHORT hypothetical causal features every 6h;
- reject any Frozen Loss Firewall V1 match;
- BIG=4, MEDIUM=2, SMALL=1;
- require at least one BIG pattern and score >=4;
- if both sides qualify for one symbol, higher score wins; exact tie rejects;
- maximum 2 fixed positions;
- equal 0.5 slots, total gross <=1.0;
- fixed 24h hold;
- Normal 10bps/side delay0;
- Stress 30bps/side delay1h;
- no pair-specific parameters, grid, learned exit, or leverage increase.

Run: `31911981741`
Artifact: `9253932042`
Artifact digest: `sha256:f5113c4d8150a4d51eef777bcc356e3440f0fd45ff1aeacc30d2456f911d5938`

### Normal

| Period | Return | PF | PF w/o best | Max DD | Trades |
|---|---:|---:|---:|---:|---:|
| 2023-24 | -21.22% | 0.888 | 0.824 | -36.04% | 195 |
| 2024-25 | -37.27% | 0.757 | 0.707 | -46.94% | 156 |
| 2025-26 | -18.70% | 0.840 | 0.731 | -22.74% | 127 |
| Combined 3Y | -62.70% | 0.813 | 0.787 | -71.22% | 481 |

Combined 3Y CAGR: **-28.01%**.

### Stress

| Period | Return | PF | PF w/o best | Max DD |
|---|---:|---:|---:|---:|
| 2023-24 | -32.55% | 0.789 | 0.720 | -33.65% |
| 2024-25 | -47.04% | 0.678 | 0.634 | -52.24% |
| 2025-26 | -29.23% | 0.709 | 0.635 | -31.33% |
| Combined 3Y | -76.58% | 0.714 | 0.689 | -77.64% |

Status: `ANNUAL_80_FLOOR_FAIL`.

## Contribution diagnosis

Normal Combined 3Y contribution points:

- LINK: +1.86
- ETH: -4.39
- BNB: -15.24
- AVAX: -30.08
- SOL: -34.82

Entries:

- LONG 292
- SHORT 189
- qualifying Profit hypotheses before slot competition: 509
- loss-blocked hypothetical sides: 36,046

Trade-record post-analysis showed that a higher additive Profit Pattern score was not
monotonic with realized return. For example, score 4 and score 7 subsets were positive,
while many higher-score subsets were negative. This result is descriptive only; the
score is NOT retuned from this evidence.

## Interpretation

The Loss Firewall is doing what it was designed to do: it rejects a very large number
of historically loss-like hypothetical entry states. The failure is downstream of the
veto.

The key structural finding is that the recurring profit features were discovered
*conditional on historical strategies having already decided to enter*. They are
therefore evidence of **entry quality / opportunity context**, not proof that the same
feature state is a self-contained market-wide trigger.

When the frozen profit patterns were promoted to an independent trigger and evaluated
at every 6h decision point, the original strategy-specific opportunity context was
removed. The resulting candidate generated entries in states that shared profitable
features but did not share the causal trigger that created the original profitable
trade. Hence the historical profit enrichment did not translate to an unconditional
forward return edge.

This explains why the user's loss-avoidance hypothesis improved filtering but why
`profit feature + no loss blocker` still did not by itself create a profitable system.

## Evidence-set rule

Do not rescue this V1 on the same 3Y data by deleting losing symbols, removing SHORT,
changing pattern weights, changing BIG requirements, or cherry-picking score bands.
Those would be post-result optimizations.

The reusable result is structural:

`Opportunity Trigger -> Frozen Profit Quality Context -> Frozen Loss Firewall -> Entry`

rather than:

`Profit Pattern -> Entry`.

The next research line, if continued, should preserve a separately-defined causal
Opportunity Trigger and use the frozen profit/loss knowledge only as quality gates.
