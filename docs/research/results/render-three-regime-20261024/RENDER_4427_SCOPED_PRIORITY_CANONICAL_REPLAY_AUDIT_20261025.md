# RENDER #4427: scoped independent SHORT priority Native8 audit (2026-10-25)

STATUS: RESEARCH ONLY; economic/MTM replay deterministic after canonicalization; formal Owner/Route unproven; DO NOT ADOPT LIVE.

| Cost | Baseline JPY | Scoped JPY | Modeled delta JPY | Baseline trades | Scoped trades | MTM DD |
|---|---:|---:|---:|---:|---:|---:|
| 10bps | 288,587,378.771 | 290,070,131.972 | +1,482,753.201 | 1291 | 1293 | -14.514985% |
| 30bps | 174,459,200.220 | 175,324,355.253 | +865,155.034 | 1290 | 1292 | -15.014724% |

## New verified findings
- 3 replays per cost have identical economic metrics, canonical modeled trade ledgers, portfolio events, and exact MTM time series.
- Raw decision reproducibility FAILS: first run contains 20 extra rejected V12 adverse-side cooldown decisions (2543 vs 2523), shifting candidate IDs and event sequence. Second and third decision files match.
- 2026-06-23 01:00 UTC and 2026-06-25 07:00 UTC modeled RENDER SHORTs enter under the scoped counterfactual. 2026-05-27 21:00 UTC remains rejected.

## Critical limitations
- Scoped in-memory Core overlay change is a counterfactual, NOT formal independent Owner/Route registration; full safety parity remains unproven.
- Aster 2025 RENDER H1 mark missing, signed venue M5 fills and funding unverified. SELL55 was selected after reviewing past losses.
- All evaluated periods have already been explored; not untouched OOS. No LIVE, VPS, Production, HP, or orders changed.

Reproduction script and JSON audit are in C:/tmp/render-mtf-study-20261024.
