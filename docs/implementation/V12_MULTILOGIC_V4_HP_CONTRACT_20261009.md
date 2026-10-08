# V12 Multi-Logic V4 HP Contract - 2026-10-09

Status: V4 SHADOW DISPLAY ONLY

## V12 decision-status page

Show an architecture badge Multi-Logic V4 and an execution badge SHADOW / 注文無効.

For every symbol, render all independently evaluated V4 routes rather than only the top route.

Required fields:
- route / family
- source side -> effective side
- route rank
- eligibility
- entry delay and eligible entry time
- momentum-condition age
- signed 6h return
- EMA12 ATR distance
- BTC 6h / BTC 24h
- relative 12h / relative 24h
- breakout24 ATR
- volume ratio
- ER24
- range location24
- pullback12 ATR
- compression
- body ATR
- CLV
- requested gross
- Min-Lift result and post-lift gross
- route slots used / 16
- recovery-family gross / 1.0x
- V12 gross / 2.0x
- crypto gross / 3.0x
- total gross / 4.25x
- opposite-side conflict
- REC_Y preemption eligibility and target virtual legs
- planned exit policy
- final shadow decision and exact reason

## Counters

Keep these separate:
1. raw route-symbol evaluations
2. independently qualifying candidates
3. admitted shadow Virtual Legs
4. rejected shadow legs
5. unique symbols with at least one admitted shadow leg
6. real-order-enabled V4 count - must remain 0

## Route catalog page

Source the catalog from docs/research/V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json.
Show all 41 routes with family, rule, side transform, entry delay, exit, gross policy, preemption policy and 10/20/30bps n/WR/PF/PnL.
REC_G5_SLOW_TREND must display fixed 48h exit.

## Shadow history

Persist and display:
- architecture
- route
- virtualLegId
- source/effective side
- shadow entry / exit
- modeled PnL
- exit reason
- preempted flag and preempting route
- shadow=true
- orderEnabled=false

Never merge a V4 shadow row into real trade history without an explicit SHADOW label.

## Rendering rule

Prefer runner-produced machine-readable reasons. The browser must not recreate trading reasons independently from UI heuristics.
