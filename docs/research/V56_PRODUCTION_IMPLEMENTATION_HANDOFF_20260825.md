# V56 Production Implementation Handoff — 2026-08-25

## Status

`V56_PENGU_LONG_BOUNDARY_PASS_RESEARCH_ONLY`

This document freezes the final research candidate for Codex production implementation work. It is research evidence only. Do **not** deploy this research branch or research SHA directly to VPS/LIVE.

## Repository / Research lineage

- Repository: `dunamishajime-bit/-ai-dex-manager`
- Research branch: `research/v56-pengu-long-boundary-20260825`
- V56 BT workflow run: `32814696622`
- V56 BT job: `97700540133`
- V56 artifact: `9550992596`
- Locked fresh V12/PENGU ledger run: `32783392588`
- Locked ledger artifact: `9540872862`
- Production firing-path lineage that must be preserved: `ef91f81e86f819ba1e37ff9325e8972489e1544f`
- Latest HP/UI commit reported separately: `fde79e33` (UI/observability, not a strategy-source baseline)

## Final research candidate

### PENGU

PENGU signal logic remains `PENGU_DUAL_LS_V2_FINAL`.

Only side-specific requested gross sizing changes:

- Long multiplier: `1.25x`
- Short multiplier: `1.00x`
- Existing base PENGU gross: `0.75x`
- Effective maximum requested PENGU Long gross: `0.9375x`
- Effective maximum requested PENGU Short gross: `0.75x`
- Crypto gross cap remains `1.5x`
- Global gross cap remains `2.5x`

Do not change PENGU entry/exit/signal logic merely to reproduce the BT result.

### V50 structural rules

Fixed V55/V56 winning structure:

- window set: `POST_EARLY3`
- hold: `4h`
- direction: `BOTH`
- selection depth: `2`
- rank mode: `ENTRY_ABS`
- partial convergence exit: disabled (`None`)
- basis stop multiple: `1.75x` of entry absolute basis
- maximum adverse basis move: `10bps`
- raw research entry-basis floor: `50bps`

The stock sizing tiers below impose the effective admission thresholds.

#### V50 Rank1 tiers

1. basis >= `65bps` and net edge >= `5bps` -> requested gross `1.00x`
2. basis >= `100bps` and net edge >= `15bps` -> requested gross `1.25x`

#### V50 Rank2 tier

- basis >= `85bps` and net edge >= `10bps` -> requested gross `0.25x`

No Rank2 entry below those thresholds.

### V11 dynamic sizing tiers

V11 signal logic remains unchanged. Only requested gross becomes quality-tiered:

1. default -> `0.75x`
2. basis >= `80bps` and net edge >= `10bps` -> `1.00x`
3. basis >= `110bps` and net edge >= `20bps` -> `1.25x`
4. basis >= `140bps` and net edge >= `30bps` -> `1.50x`

Stock gross cap remains `1.5x`.

## V56 boundary result

Preferred research point: PENGU Long `1.25x`, Short `1.00x`.

- Full Return: `+751.07413135%`
- Profit Factor: `3.50601577`
- MaxDD: `-12.84885779%`
- Win Rate: `59.4488189%`
- Severe Return: `+155.52964791%`
- Events: `254`
- 4-fold pre-holdout wins vs V53: `4/4`
- Confirmation/reused holdout Return: `+25.78426497%`
- Confirmation/reused holdout PF: `2.16268193`
- Confirmation/reused holdout DD: `-7.16040733%`
- Confirmation/reused holdout Severe Return: `+0.89125923%`
- Observed max total gross: `2.5x`
- Observed max stock gross: `1.5x`
- Observed max crypto gross: `1.5x`
- Observed max V50 concurrent: `2`

Reference V53 full:

- Return: `+588.30805676%`
- PF: `3.35348445`
- DD: `-11.40594734%`

Reference V55 no-PENGU-size-increase candidate:

- Return: `+730.80376734%`
- PF: `3.51779109`
- DD: `-11.40594734%`

Boundary behavior:

- `1.20x`: Return `+747.03655697%`, DD `-12.5602757%`, folds `4/4`
- `1.25x`: Return `+751.07413135%`, DD `-12.84885779%`, folds `4/4`
- `1.30x`: Return `+755.10292712%`, DD `-13.13743988%`, folds `3/4`
- `1.35x+`: Return plateaus near `+755.3457062%`, DD near `-13.15485064%`, folds `3/4`

Therefore `1.25x` is the preferred boundary point: it keeps 4/4 fold wins while capturing most of the available return increase before the portfolio-capacity plateau.

## Critical limitation

The final segment used in prior studies is **not an untouched holdout anymore**. It is confirmation-only. Production implementation must not falsely report it as fresh independent holdout evidence. If a new untouched forward/holdout segment is available, use it as an additional gate without tuning after viewing it.

## Production implementation requirements

1. Create production implementation work from the **current official production/LIVE source branch**, not this research branch.
2. Preserve all current V52 Top2 LIVE firing-path improvements, including retry-aware 20-second decision-window behavior and frozen signal snapshot semantics.
3. Preserve V12 X1.00 ALL signal logic.
4. Preserve PENGU Dual LS V2 signal/exit logic; only apply the approved Long-side sizing multiplier.
5. Preserve V11 signal logic; implement only quality-tiered requested gross sizing and the V50 structure/sizing changes listed above.
6. Keep hard caps unchanged:
   - Global Gross `2.5x`
   - Stock Gross `1.5x`
   - Crypto Gross `1.5x`
   - V50 concurrent max `2`
   - V50 daily entries max `3`
7. Preserve AccountOrderLock/durable reservations so concurrent entries cannot exceed caps.
8. Preserve Margin Guard, daily-loss gates, Kill Switch, Fail Closed, reference freshness, source-clock, spread, depth, cost, adverse-move, same-symbol and reconciliation contracts.
9. Do not force-close V12/PENGU/V11/V50 positions to make room for a new entry.
10. No synthetic LIVE test orders and no artificial signal generation.
11. Research SHA must never be deployed directly.

## Required production parity tests

At minimum, add deterministic tests that prove:

- PENGU Long `0.75 x 1.25 = 0.9375` maximum requested gross.
- PENGU Short remains `0.75` maximum requested gross.
- PENGU signal decisions are unchanged by the sizing layer.
- V50 Rank1: 65/5 -> 1.00; 100/15 -> 1.25.
- V50 Rank2: 85/10 -> 0.25; below threshold -> reject.
- V11 tiers: 0.75 / 1.00 / 1.25 / 1.50 exactly as frozen above.
- V50 4h maximum hold and basis-stop `1.75x` behavior.
- hard convergence behavior remains intact.
- adverse move cap remains 10bps.
- V50 concurrent <=2 and daily <=3.
- stock gross <=1.5, crypto gross <=1.5, global gross <=2.5 under parallel reservations.
- retry-aware firing path remains active and is not reverted to old one-shot behavior.
- strategy rejects are not incorrectly converted into transient retry.
- no test order is sent by CI.

## Deployment gate

After implementation, run production CI and a production-parity replay. If parity or safety fails, do not merge/deploy.

If all production gates pass, merge to official production source, create the immutable production SHA/release, then deploy once using the existing request-ID-safe deployment process.

If queued, follow the same request ID to completion. Do not duplicate an unknown/failed request.

## Final requested LIVE state after successful production promotion

- V12 X1.00 ALL: ACTIVE
- PENGU Dual LS V2: ACTIVE
  - Long sizing multiplier: 1.25
  - Short sizing multiplier: 1.00
  - Max requested Long gross: 0.9375
  - Max requested Short gross: 0.75
- V52: ACTIVE
- V52 Top2: ACTIVE
- V52 retry-aware path: ACTIVE
- V50 Rank1: 1.00 normal / 1.25 strong
- V50 Rank2: 0.25 at 85bps/10bps minimum
- V50 hold: 4h max
- V50 basis stop: 1.75x
- V11 requested gross tiers: 0.75 / 1.00 / 1.25 / 1.50
- Global Gross cap: 2.5
- Stock Gross cap: 1.5
- Crypto Gross cap: 1.5
- V50 concurrent max: 2
- V50 daily max: 3
- Fail Closed: enabled
- Kill Switch: enabled/healthy according to runtime state
- test/artificial orders: 0
