# V12 Multi-Logic V4 Shadow + HP Implementation Evidence — 2026-10-09

## Scope

This implementation preserves the existing order-enabled V12 runner unchanged and adds V4 as a separate read-only / non-ordering shadow architecture.

It also preserves the latest Oct 8 operational fixes by combining:
- runner recovery base: 13f143a4467d6a562042dfdecd467649b130670e
- PENGU route display fix: f91f34db09711c85dc1f303944ae00979cfdad07

Integration branch:
- codex/v12-v4-shadow-hp-20261009

Research source:
- branch: research/v12-entry-phase-20261008
- ledger/contract SHA: eaa64a7ff5916fe4c60fb9247bac03c1dfe5af16

## Implemented

### Frozen BT ledger
- docs/research/V12_MULTILOGIC_V4_BT_LEDGER_20261009.csv
- docs/research/V12_MULTILOGIC_V4_BT_LEDGER_20261009.md
- docs/research/V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json

41 routes are recorded with:
- family
- exact entry-rule tokens and readable rule
- side transform
- entry delay
- exit policy
- gross policy
- Min-Lift policy
- preemption policy
- 10/20/30bps trades / wins / losses / WR / PF / PnL

Preferred frozen BT candidate is Final1000 + G5 fixed 48h.

### Pure V4 shadow engine
- lib/v12-multilogic-v4-shadow.ts

Implements:
- 41-route evaluation
- Core + Robust special predicates
- G / X / Y / Z route token predicates
- source-side -> effective-side transformation
- route-specific entry delay
- route-specific planned exit policy
- same-symbol same-side Virtual Legs
- opposite-side exclusivity
- REC_Y preemption of opposite REC_X / REC_G only
- 16 recovery legs per route
- recovery family gross <= 1.00x
- normal recovery gross 0.10x
- robust max gross 0.25x
- Min-Lift <= 0.30x
- V12 gross <= 2.00x
- crypto gross <= 3.00x
- total gross <= 4.25x

Hard invariant:
- shadow=true
- orderEnabled=false
- tradingMutation=0

### Shadow state generator
- scripts/v12-multilogic-v4-shadow-runner.ts

Supported:
- --self-test
- --once

Input:
- V12_V4_SHADOW_INPUT_PATH
- default .runtime-state/v12-v4-shadow-input.json

Output:
- V12_V4_SHADOW_STATE_PATH
- default .runtime-state/v12-v4-shadow-state.json

The runner only reads feature input and writes a JSON observation state. It does not import any venue executor.

### HP
- apps/production-ui/lib/server/v12-v4-shadow-observability.ts
- apps/production-ui/components/features/V12V4ShadowPanel.tsx
- apps/production-ui/app/api/system/decision-status/route.ts
- apps/production-ui/app/decision-status/v12/page.tsx
- apps/production-ui/components/features/DecisionStatusPanel.tsx

V12 HP now supports:
- explicit Multi-Logic V4 Shadow panel
- SHADOW / 注文無効 badge
- orderEnabled=false and tradingMutation=0
- route count
- raw/qualified/admitted/rejected/unique-symbol counts
- gross caps and slot caps
- 10/20/30bps aggregate BT ledger
- current shadow route rows when state exists
- full 41-route expandable catalog with rule / side / delay / exit / gross / cost-stress metrics
- state unavailable mode that still shows frozen BT/catalog without inventing a live V4 decision

## Verification

Self-test:
- V12_MULTILOGIC_V4_SHADOW_SELFTEST_PASS

Unit tests:
- 10 tests
- 10 PASS
- 0 FAIL

Verified behaviors:
- G5 0.10x + fixed 48h
- Robust max 0.25x
- REC_Y side reversal and delay
- same-side stacking
- opposite-side rejection
- REC_Y preemption X/G only
- Core protection
- Min-Lift <= 0.30x
- real-order-enabled V4 count = 0
- HP reader state/catalog parity
- HP missing-state safe behavior

Static mutation audit:
- no createOrder / placeOrder / cancelOrder / closePosition / direct-trade-executor / submitOrder references in V4 shadow implementation
- no MULTILOGIC_V4 reference in existing V12 order-enabled runner

Production UI TypeScript:
- PASS

## Activation boundary

This commit does not activate V4 real orders.
The existing V12 order-enabled runner is intentionally unchanged.
Any future real-order promotion requires a separate review/process and is not part of this shadow implementation.
