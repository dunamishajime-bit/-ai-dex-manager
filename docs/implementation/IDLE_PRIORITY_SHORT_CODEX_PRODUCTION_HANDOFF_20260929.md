> **2026-09-30 LIVE unblock authority:** Read `docs/implementation/CODEX_IDLE_PRIORITY_LIVE_UNBLOCK_20260930.md` first. Historical overlay reconciliation is complete. `BLOCKED_HISTORICAL_OVERLAY_REPLAY_NOT_RECONCILED` is no longer a valid stop reason unless the source-backed 10bps replay later fails. Proceed with the guarded Production order path, CI, VPS deployment and LIVE verification.

> **2026-09-30 controlling cost/replay correction:** Read `docs/implementation/IDLE_PRIORITY_COST_RECONCILIATION_20260930.md` first. The historical `JPY268.05M / 1,342 / PF~2.055 / DD~-23.24%` bundle is not a coherent single 10bps run and MUST NOT be used as a LIVE parity certificate. The primary coherent research reference is the 10bps fixed-intent dynamic-Gross overlay (61 Idle, 1,339 total trades, ~JPY214.78M). Where older text conflicts, the cost/replay correction controls.

> **2026-09-30 controlling correction:** Before using this handoff, read `docs/implementation/IDLE_PRIORITY_HISTORICAL_OVERLAY_PARITY_CORRECTION_20260930.md`. The historical JPY268.05M run used a frozen accepted-baseline-ledger overlay, not a full regeneration of all baseline candidate decisions. Where this handoff conflicts with the correction, the correction controls.

# Idle Priority SHORT — Codex Production Handoff

> **2026-10-01 post-audit redeploy requirement:** The previous VPS deployment predates the source repair series. Only the current branch HEAD after the successful post-audit handoff gate may be used as the repair source. Production must first read the actual VPS `current/.disdex-release-sha` and port the repair onto that lineage; never reset Production to the design branch or assume `a09ea45c...` is still current without readback.
>
> The only permitted Idle systemd source unit is `ops/systemd/disdex-idle-priority-short@.service`. The legacy unpinned `systemd/disdex-idle-priority-short.service` has been removed and CI fails if it reappears. Any loaded/active `disdex-idle-priority-short.service` on VPS is a hard deployment conflict and must be stopped/disabled before the SHA-pinned instance is activated.


Status: **IMPLEMENTATION HANDOFF — LIVE activation is forbidden until every acceptance gate below passes.**

## Controlling source
- Branch: `design/idle-priority-bt-parity-20260929`
- Spec: `docs/superpowers/specs/2026-09-29-idle-priority-bt-parity-design.md`
- Candidate evidence SHA256: `5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48`
- Candidate rows: 63
- Broader candidate stream: 495 rows, SHA256 `09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb`
- Five-symbol generic lifecycle subset: 393 rows, SHA256 `d32ed3a07a6338e8fae792ec6d9071ea27a1dee548eed6a3825dfbda3270019a`
- Generic lifecycle model: `BASELINE_CONTINUOUS_IDLE__BREAKOUT_RELATIVE_MOMENTUM__12H_PER_SYMBOL`
- Immutable Release H1 reproduces 391/393 rows causally; the only source gaps are RENDERUSDT at `1767798000000` and `1767841200000`, both pinned to the source CSV and selected as `RENDER_RELATIVE_SHORT`.

## Non-negotiable BT parity
Do not retune to hit the anchors. Rebuild the exact causal replay and fail closed on divergence.
1. broader stream = 495
2. final route candidates = exactly 63, no extras
3. route counts: DOT 15 / JUP 14 / RENDER 15 / TAO 9 / TIA 10
4. integrated admission = exactly 61
5. admitted symbol counts: DOT14/JUP14/RENDER15/TAO9/TIA9
6. wins = 48, losses = 13, WR 78.7%
7. primary 10bps coherent overlay reconciles to 61 Idle / 1,339 total trades / approximately JPY214.78M; 8bps sensitivity is approximately JPY268.15M. Never combine metrics across cost cases
8. identify the exact rejected DOT and TIA rows and their contemporaneous portfolio/admission reason; never choose them by future PnL
9. baseline-five same-timestamp acceptance always beats Idle
10. an already-open Idle position is not preempted by a later baseline signal
11. residual 0.5x or any partial gross must skip; accepted gross is exactly 1.00x
12. any HYPE/other crypto sidecar exposure or pending exposure blocks a new Idle entry
13. venue must read back 5x Cross and all shared safety gates must pass
14. per-symbol broader-candidate lifecycle cooldown = 12h. The lifecycle is consumed by the generic candidate BEFORE the five-route filter; generic LONG and route-unselected candidates consume the same per-symbol lifecycle slot when the baseline is fully Idle.
15. generic candidate priority is BREAKOUT -> RELATIVE -> MOMENTUM. BREAKOUT uses closed-H1 close versus prior-24H high/low plus |24h return| >= 2%; RELATIVE uses |rel24| >= 3% plus |24h return| >= 1.5%; MOMENTUM uses |ret12| >= 3%; all retain their source volume/ATR gates.
16. baseline Idle is evaluated on the exact continuous entry/exit intervals of the 1,284-trade baseline, not a rounded hourly position counter. Same-timestamp baseline entry blocks Idle; an exit at t is flat for t.
17. parity certificate schema must be `disdex-idle-priority-parity-cert/v3` and must pin 393 rows / generic SHA / exactly two source-gap rows / the lifecycle model above.
18. emergency reduce-only stop 10% / TP25% must be shown not to change the historical 63 candidate exits


## Baseline replay provenance
Do not substitute the nearby 2026-09-28 10bps baseline (JPY130,287,867 / 1,046 trades). The controlling baseline is the exact 10bps JPY141.845M / 1,284-trade Release case. The coherent fixed-intent dynamic-Gross overlay retains 1,278 baseline trades and 61 Idle trades for 1,339 total. The historical 1,342 count is unsupported and must not be forced.

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
