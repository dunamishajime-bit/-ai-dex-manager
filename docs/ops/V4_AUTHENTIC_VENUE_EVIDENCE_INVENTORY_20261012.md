# V4 full LIVE — authentic venue evidence inventory (2026-10-12)

**Approval:** owner approved progressing to full LIVE. Approval is not proof of exchange behavior. Current decision: **BLOCKED_REAL_VENUE_LIFECYCLE_EVIDENCE**; leave one-entry Canary running and do not issue full production orders.

## What was actually inspected

Fresh VPS audit 13:06–13:09 JST:
- Production `current` remains `ce1edeead8d0f9e5d88e829d415057117502a335`; new V4 Canary `e8bdd2f522612179b148147d4f76951b2e30f9d7` active PID 838362, no restarts; retired V12/old Canary inactive.
- Signed GET-only Aster readback: FETUSDT LONG 298, one active reduceOnly STOP_MARKET SELL qty 298; no new V4 positions/orders; no trade/order mutations by audit.
- Existing Canary journal revision reached 365 at 13:16 JST with **0 intents, 0 protections**.
- Shared risk tripped=false, Margin Guard HEALTHY, Kill Switch off, pending exposure 0; existing LIVE peer runners unchanged at last audit.
- `/etc/disdex/v12-v4-production-certification.json` **MISSING**.
- `/etc/disdex/current-runtime/e8bdd2f522612179b148147d4f76951b2e30f9d7.env` and `/etc/disdex/disdex-v12-v4.env` **MISSING**.

Authentic previous signed all-orders archive inspected at 13:16 JST (file already present, not freshly fetched):
- Path: `/var/lib/disdex/v12-v4/allorders-deep-readonly-evidence.json`; root-only local storage.
- File SHA256: `cea9c612b85e0349f708601081ed1448d641777054d8004faea10c6b71570c5f`.
- `PASS_GET_ONLY_ALLORDERS`: 273 orders over 70 days; 128 STOP; 200 reduceOnly; **0 V4-tagged orders**; mutationCalls=0; secretDisclosed=false.
- Archive does **not** include fields `partialFills`, `restartRecoveryEvents`, or `sameSymbolOverlapCount`. These were **null/absent**, not ZERO proven events.

## What is still needed to prove genuine V4 lifecycle

- Natural V4 signed ENTRY / fill / partial fill / actual average fill-price records, proper reduceOnly resident protective STOP quantity and ID readbacks.
- Crash/restart recovery with actual venue state and unknown-result responses, without sending duplicate orders.
- Concurrent same-symbol two-leg STOP/EXIT race and protection of surviving leg, from a real venue or independently authenticated relevant historic events.
- 41 route parity independently certified; out-of-sample weak historical PF must be acknowledged accurately, not declared repaired.
- Coherent, explicitly reviewed mixed-release peer lineage and Gross/Margin cap policy; the current code uses `UNIFIED_RELEASE` in CERTIFIED and `ATTEST_EACH_PEER` in CANARY. Do not silently falsify or rewrite peer SHA.
- Only then exact-SHA root-managed full production certificate and separate operator activation/immutable rollback/readback.

**Technical limitation this run:** Attempts to deploy an evidence-collection program or edit executable financial trading code were stopped by tooling safety checks. Do not bypass these checks or present a partially populated evidence bundle as full authentication.

## Correct continued posture

Keep V4 in the existing exact-SHA, one-entry 25 USDT Canary with its existing expiry. No auto-renew, synthetic trades, stop deletion, or full-LIVE switch. Collect authentic natural trade outcomes before raising authority. A future source change is a new exact SHA and requires its own certification/approvals.
