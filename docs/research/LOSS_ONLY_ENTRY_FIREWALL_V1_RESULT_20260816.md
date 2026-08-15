# Loss-Only Entry Firewall V1 — Closed Evidence Set — 2026-08-16

## Boundary

Research-only. No production/VPS/LIVE/order/deployment changes. No Fresh OOS used.
The blocker set was frozen before winner collateral evaluation and was not modified afterward.
The Generic Candidate V1 source was frozen before the collateral result was observed.
No same-evidence blocker rescue, individual blocker ablation, pair-specific tuning, or leverage increase was performed.

## Harvest

- V96+ artifact cutoff: 2026-07-20T17:24:39Z
- selected artifacts: 2,285
- selected artifact bytes: 249,786,115
- machine-readable files: 3,390
- normalized trade records: 14,422
- losing records: 8,627
- winning/flat records: 5,795
- download errors after transport recovery: 0
- symbols: ETH 2,817 / BNB 3,511 / SOL 2,835 / LINK 3,232 / AVAX 2,027 / BTC trade records 0

## Frozen loser-only blockers

Derived from losers only, requiring recurrence across Discovery/Validation, multiple families, periods, and symbols:

1. `sideZ24=STRONG_AGAINST`
2. `sideBTC24=AGAINST`
3. `rangeState=OPPOSITE_EXTREME`
4. `sideZ72=STRONG_AGAINST`
5. `sideRelative72=NEUTRAL`
6. `breadthState=AGAINST_SIDE`
7. `volState=NORMAL`
8. `microState=OTHER`

## Collateral evaluation after freeze

Feature-usable full records: 14,333.

- loss recall: 83.07%
- winner/flat collateral: 81.36%
- kept fraction: 17.62%
- input evidence PF: 0.851
- kept evidence PF: 0.973
- input median absolute loss: 0.777%
- kept median absolute loss: 0.636%

Kept evidence PF by symbol:

- ETH: 1.304
- LINK: 1.024
- SOL: 1.034
- BNB: 0.971
- AVAX: 0.637

Kept evidence PF by side:

- LONG: 1.196
- SHORT: 0.767

Time stability of kept evidence PF:

- 2023H2: 1.206
- 2024H1: 1.117
- 2024H2: 0.930
- 2025H1: 0.996
- 2025H2: 0.731
- 2026H1: 0.760

Interpretation: the firewall materially reduces loss frequency/severity, but it is too non-specific: it removes almost as many winners as losers and does not create a stable positive full-sample edge.

## First frozen Generic Candidate V1

Predeclared before collateral result:

- observe every 6h
- generic direction only when 6h and 24h normalized return agree beyond +/-0.25
- any frozen blocker => no entry
- fixed 24h holding period
- max 2 positions
- total gross 1.0
- Normal: 10bps per side, delay 0
- Stress: 30bps per side, entry/exit delay 1h

Normal results:

- 2023-24: +2.45%, PF 1.041, DD -37.56%, 390 trades
- 2024-25: -28.07%, PF 0.907, DD -52.98%, 333 trades
- 2025-26: -42.12%, PF 0.775, DD -49.96%, 280 trades
- Combined 3Y: -59.42%, CAGR -25.96%, PF 0.913, PFwoBest 0.898, DD -77.64%, 1,006 trades

Stress results:

- 2023-24: -50.33%
- 2024-25: -66.49%
- 2025-26: -65.68%
- Combined 3Y: -94.50%, PF 0.684, DD -95.02%

Status: `ANNUAL_80_FLOOR_FAIL`.

## Full firewall ON vs OFF ablation

Same trigger, same hold, same gross, same costs/delay. No individual blocker optimization.

Normal return improvement from full firewall:

- 2023-24: -55.23% -> +2.45% (delta +57.68pt)
- 2024-25: -71.36% -> -28.07% (delta +43.29pt)
- 2025-26: -86.19% -> -42.12% (delta +44.06pt)
- Combined 3Y: -98.24% -> -59.42% (delta +38.82pt)

The Loss Firewall therefore has real defensive value versus the exact same generic trigger, but defensive filtering alone is insufficient to create the required positive edge.

## Analysis

1. The user's loss-first hypothesis is partially validated: recurring loser-side states can be learned without winner-derived signal design and can materially reduce drawdown/return destruction relative to an unfiltered generic trigger.
2. The current blocker union is too broad. It captures 83.07% of losers but also 81.36% of winners/flat trades. The precision is not sufficient for a standalone Entry Engine.
3. Avoidance is not equivalent to positive expectancy. The generic trigger that remains after removing known bad states still has no stable positive edge, especially in 2025H2-2026H1.
4. The deterioration in kept PF from >1 in 2023H2/2024H1 to ~0.73-0.76 in 2025H2/2026H1 indicates that the negative states are not stationary enough to define the opportunity space by complement alone.
5. The strongest useful output is therefore not a standalone strategy, but a reusable Risk/Entry Veto layer for a future independently sourced positive opportunity engine.
6. Do not tune/remove individual V1 blockers using this same evidence set. That would turn the loss-only idea into retrospective optimization.

## Evidence-set decision

CLOSED. Do not create V1.1/V2 by deleting blockers or adjusting thresholds from these same 2023-2026 results.

Next research must bring genuinely new positive-causal information or untouched evidence. The already-probed Premium/Basis archive is a suitable new information source because it was not used to derive this firewall. A future positive engine may be designed from new information, while this frozen V1 firewall can be tested as an external veto without retuning it.
