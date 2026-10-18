# DisDex direct production activation and repair plan (2026-10-19)

Status: SOURCE-LEVEL OPERATIONAL POLICY; **NOT an operator approval, Production certificate, or order authorization**.
Baseline Production SHA: `486091bc4ac26f7b7fa0af600f7f03b4d7a221e7`.
Use current GitHub/VPS HEAD if this SHA changes; never copy authorization to a different SHA.

## Decision: no mandatory two-stage LIVE process

For **V12 V4**, the code already supports a direct `CERTIFIED` mode backed by `disdex-v12-v4-production-certification/v3`. A preceding V4-specific canary fill, Testnet trade, or artificial order **is not a required prerequisite** for that V3 path. Instead use authenticated established Aster Production execution evidence, independently verified 41-route parity, exact-SHA evidence and separate explicit operator authorization.

The current `CANARY` mode remains a valid optional conservative mode, **not a mandatory phase**. `CANARY` may not be relabeled `CERTIFIED` by changing `V12_V4_OPERATION_MODE` or flags alone. `CERTIFIED` requires an independently revalidated certificate for the current SHA. Real V4 first-fill, STOP placement and restart lifecycle still warrant post-activation monitoring and must remain marked *unobserved* until observed.

The older `V12_V4_VENUE_CERTIFICATION_WITHOUT_TESTNET_20261010.md` describes V2 evidence; the current V3 implementation in `lib/v12-v4-certified-gates.ts` is the controlling V4 path.

## Distinguish independent authorities

1. **V4 certified approval:** exact current SHA, all 41 routes, five root-owned SHA-256-sealed evidence files, real established Aster execution provenance, live source/safety checks, root-owned V4 Production certificate and explicit V4 operator authorization. Do **not** require an unrelated FET preemption proof or V52 activation to be the *criterion* for V4 certification. V4 must still reconcile **all actual peer exposures and pending reservations**, whether V52 is enabled or disabled.
2. **Overlay approval:** Q102, HYPE, Idle separately approved for their current executable STOP and exit changes, with their own tests and signed ownership reconciliation. An unchanged peer should not need an overlay-specific additional certification merely because another feature changed.
3. **V52 LIVE:** requires its own explicit authorization, executable runner checks, no duplicated ownership, compatible Gross caps and live shared risk/margin readiness. Current limited-overlay scope intentionally disables V52; it must not be started by deleting an intentional-stop marker before these checks pass.
4. **FET Core preemption:** optional cross-strategy feature. When not separately certified it remains `false` while the base FET strategy can run unchanged. Do not turn `FET_BRK48_CORE_PREEMPTION_READY`, durable config, or approval flags on without confirming same-symbol cross-runner ownership and order-transition safety. Distinguish `DISABLED_NOT_CERTIFIED` monitoring from a broken base-FET Runner; do not falsely report it as certified.
5. **Whole-system FULL_LIVE** is a *reporting result*, not an additional authorization gate. Mark whole-system status FULL only when every desired runner has its own valid evidence and healthy execution. Runner-specific activation must not be blocked solely because another independent optional feature has no certification.

## Conditions which remain mandatory

- Exact current release SHA, immutable release/rollback, correct signed/privileged operator approval and evidence byte hashes.
- Reconcile fresh signed venue positions, existing STOP/TP, reduce-only quantities and order ownership. No forged or stale account snapshots.
- Check shared risk, margin guard, kill switch, pending Gross, account lock, Aster shared rate budget, venue filters, causal closed candles and native route parity.
- Uncertain fill, partial fill, STOP replacement, existing JUPUSDT position, and restart must fail closed without duplicate sends or cancel-before-replace; verified protection must remain intact.
- Operator sign-off is distinct from any automated test report. A CI success, config toggle, source comment, or legacy certificate from an earlier SHA does **not** grant a real-money order authorization.

## Required work items and acceptance tests

**P0 — existing position / API safety**
- Confirm JUPUSDT SHORT 22 against signed Aster position + active STOP_MARKET/TAKE_PROFIT_MARKET 22, both reduceOnly; reassess if account state changes.
- Reduce redundant H1 market-data queries. Cache **confirmed immutable bars only** within their causal hourly boundary; refresh when a new H1 is finalized. Never cache signed positions/orders or STOP read-back in place of fresh venue evidence.
- Coordinate query admission across V4/Q102/FET/Idle/PENGU/HYPE. Use weighted global IP budget with endpoint-level weights, protect protective/reconciliation headroom, bounded jitter and per-runner backoff; never simply disable/raise the venue rate guard to conceal HTTP 429 or -1003.
- Telemetry should include budget wait, weight and priority, source runner/API, 429/418, deferred protection readbacks, and per-runner degraded status. Validate with sustained 1-hour audit, then monitor 24 hours. New entries must not proceed on stale ownership/protection evidence.

**P1 — direct V4 certification, without mandatory canary**
- Recreate/revalidate five evidence files for the **current** SHA: `route-source-parity.json`, `established-aster-orders.json`, `signed-aster-account.json`, `v4-execution-tests.json`, `shared-risk-and-peers.json`.
- Old V3 certificate for `6f97d2cf...` and files referencing `72aae8cf...` do not establish current SHA certification. Historical Aster orders (273, including 128 STOP and 200 reduceOnly) are authentic evidence, **not V4-specific first fill**.
- Check why an old evidence snapshot recorded `marginGuardHealthy=false`; require fresh healthy signed and risk evidence.
- Resolve V3 cert Gross envelope (V12 3.0 / Crypto 3.5 / Total 4.75 / recovery 2.5) versus current runtime (V12 2.0 / Crypto 3.0 / Total 4.25). Do not silently increase runtime Gross; approve an exact consistent envelope after portfolio parity validation.
- Renew root certificate and scoped V4 operator authorization for the current SHA after evidence verification. Direct `CERTIFIED` activation can then be performed under protective risk controls, without waiting for a V4 first-fill solely to establish eligibility.

**P2 — restore optional peers independently**
- V52: reconcile its flat state / intentional-stop marker / stock Gross and prior ownership. Authorize and activate separately only if the actual present account and shared risk support it; otherwise keep disabled and clearly report why.
- FET preemption: independently certify its exact-SHA cross-runner contract, ordered exit/entry lifecycle, pending reservation, failure/restart cases. Base FET remains LIVE with preemption false until ready.
- Q102 profit floor, HYPE wallet-risk STOP, Idle DOT/RENDER trail: test effective runtime flags, monotonic STOP replacement, 5m closed-bar causality, risk parity and actual log reporting.
- Repair historical V96/V52 Gross CI job and PENGU trade-9 entry-time parity mismatch **without rewriting trading history to force a green test**.

**P3 — site and operations**
- Verify signed-in HP realtime/ranking/decision status/trade history and labels V4 `CANARY` vs `CERTIFIED`, Q102/HYPE/Idle, V52 and FET status; unsigned HTTP 401 alone is not a signed-in UI test.
- Check all exact-SHA Runner PID/NRestarts, watchdog, Aster shared rate budget, account lock, pending exposures, open positions, protective STOP, disk, rollback and release marker.
- All PASS claims must include observed timestamp, commit SHA, test job and venue source. Distinguish not-observed real-order lifecycle from verified code tests.

## Implementation boundary

This document updates the **operational requirement** by rejecting the unnecessary blanket rule 'V4 itself must first fill a production trade and complete its own lifecycle before certified V3 activation'. It does not alter executable gates, grant credentials, modify orders, or authorize LIVE by itself. Any implementation edit must be reviewed against the existing authenticated certificate and protective stop contracts, tested and explicitly approved before Production cutover.
