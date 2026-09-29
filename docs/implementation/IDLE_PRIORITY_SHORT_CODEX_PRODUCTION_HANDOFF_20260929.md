# Idle Priority SHORT — Codex Production Handoff

Status: **IMPLEMENTATION HANDOFF — LIVE activation is forbidden until every acceptance gate below passes.**

## Controlling source
- Branch: `design/idle-priority-bt-parity-20260929`
- Spec: `docs/superpowers/specs/2026-09-29-idle-priority-bt-parity-design.md`
- Candidate evidence SHA256: `5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48`
- Candidate rows: 63
- Broader candidate stream: 495 rows, SHA256 `09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb`

## Non-negotiable BT parity
Do not retune to hit the anchors. Rebuild the exact causal replay and fail closed on divergence.
1. broader stream = 495
2. final route candidates = exactly 63, no extras
3. route counts: DOT 15 / JUP 14 / RENDER 15 / TAO 9 / TIA 10
4. integrated admission = exactly 61
5. admitted symbol counts: DOT14/JUP14/RENDER15/TAO9/TIA9
6. wins = 48, losses = 13, WR 78.7%
7. integrated final equity approximately JPY268.05M and max MTM DD approximately -23.24%
8. identify the exact rejected DOT and TIA rows and their contemporaneous portfolio/admission reason; never choose them by future PnL
9. baseline-five same-timestamp acceptance always beats Idle
10. an already-open Idle position is not preempted by a later baseline signal
11. residual 0.5x or any partial gross must skip; accepted gross is exactly 1.00x
12. any HYPE/other crypto sidecar exposure or pending exposure blocks a new Idle entry
13. venue must read back 5x Cross and all shared safety gates must pass
14. per-symbol broader-candidate lifecycle cooldown = 12h
15. emergency reduce-only stop 10% / TP25% must be shown not to change the historical 63 candidate exits

## Baseline replay provenance
Do not substitute the nearby 2026-09-28 10bps baseline (JPY130,287,867 / 1,046 trades). The controlling Idle experiment used the later approximately JPY141.85M / 1,284-trade baseline. Recover/rebuild that exact baseline from its source lineage and portfolio admission semantics. The integrated result has 1,342 closed trades, so the Idle exposure changes baseline admission; do not compute 1,284+61 independently.

The known audited replay pipeline is:
Aster H1/funding -> V12/PENGU/FET causal scan -> Q102 causal scan -> crypto candidate lifecycle -> V52 Aster/Yahoo price-only ledger -> contribution-aware shared-gross portfolio -> Idle candidate/admission integration.

## Production implementation
Dedicated strategy family `IDLE_PRIORITY_SHORT`; do not fold into V12/HYPE.
Symbols: TAOUSDT,TIAUSDT,DOTUSDT,JUPUSDT,RENDERUSDT. SHORT only.
Gross=1.00x exactly, leverage=5x Cross, no partial sizing.
Fixed strategy holds: TAO12h/TIA24h/DOT24h/JUP12h/RENDER12h.
Emergency protection: reduce-only STOP10%, TP25%, venue readback mandatory.

Before LIVE, complete:
- dedicated runner and systemd unit
- SHA-bound atomic state/pending/manual-review semantics
- ownership proof; never adopt unknown positions/orders
- account lock + pending registry + Shared Risk + Margin Guard + Kill Switch + operator activation
- quantity/min-notional/filter validation
- protection placement/readback
- fixed-hold exit and restart recovery
- HP read-only decision state, runtime health, history, performance and attribution
- tests for malformed/stale state, SHA mismatch, incomplete H1, sidecar exposure, insufficient gross, unconfirmed 5x Cross, unknown order, ambiguous same-timestamp capacity, protection failure

## Deployment procedure
1. fresh read-only VPS probe; capture actual production SHA, UI SHA, open positions/orders/protections, pending registry, locks, disk and service health.
2. Never reset production backward to the design branch base. Cherry-pick/port onto the actual current production lineage.
3. compile + unit/integration tests + deterministic parity replay.
4. build isolated release and record rollback SHA/path.
5. create/update root-owned operator activation artifact bound to the exact deployment SHA.
6. start Idle only after all existing core/risk services are healthy.
7. never place a forced/test order to prove deployment.
8. verify runtime SHA/PID/restarts, Kill Switch=false, Shared Risk/Margin Guard healthy, pending/locks clean, venue positions/orders/protections reconciled, HP SHA/status consistent.

Final report must be exactly one status family:
- `LIVE_ACTIVATED_VERIFIED`
- `BLOCKED_<EXACT_REASON>`

If any parity anchor or safety proof is missing, use BLOCKED and do not arm LIVE.
