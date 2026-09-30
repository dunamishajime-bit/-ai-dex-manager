# Codex Handoff — Idle Priority SHORT LIVE Unblock (2026-09-30)

Status: **HISTORICAL OVERLAY RECONCILIATION RESOLVED — PROCEED TO PRODUCTION IMPLEMENTATION / LIVE DEPLOYMENT GATES**

This document supersedes the former stop status `BLOCKED_HISTORICAL_OVERLAY_REPLAY_NOT_RECONCILED`.

## 1. Controlling parity result

Do NOT continue searching for an historical `JPY268.05M / 1,342 trades / PF~2.055 / DD~-23.24%` 10bps ledger. That bundle was a mixed-cost / mixed-replay historical report and is not a coherent production parity target.

The source-backed reproducible primary acceptance case is:

- baseline cost case: **10bps round trip**
- canonical baseline: **1,284 trades**
- canonical baseline final equity: **JPY141,845,207.7243423**
- canonical baseline PF: **2.0771737482823114**
- canonical baseline max MTM DD: **-22.873351303266531%**
- Idle candidate stream: **495**
- filtered Idle candidates: **63**
- causal same-symbol admission: **61**
- Idle outcomes: **48 wins / 13 losses**
- baseline intents retained after Idle exposure: **1,278**
- baseline intents rejected after Idle exposure: **6**
- integrated completed trades: **1,339**
- integrated final equity: **JPY214,775,230.26444945**
- integrated PF: **2.046425970772986**
- integrated diagnostic max MTM DD: **-22.840597480157931%**
- Idle PF: **6.582814623608791**
- Idle PnL attribution: **JPY52,475,222.48842543**

The coherent 8bps sensitivity is:

- integrated completed trades: **1,339**
- final equity: **JPY268,148,071.9251832**
- PF: **2.0925476176754634**
- max MTM DD: **-22.688538434015348%**
- Idle PnL attribution: **JPY64,537,163.64162981**
- Idle PF: **6.739641037227033**

8bps is sensitivity only. Never mix its final equity with the 10bps baseline or 10bps PF/DD.

## 2. CI evidence

Authoritative diagnostic:

- workflow: `Idle Priority fixed intent dynamic gross diagnostic`
- GitHub Actions run: **36664690807**
- validated commit: **56400e878452acc251e73eb9b7747ac61d1f8aea**
- conclusion: **SUCCESS**

The workflow independently replays the 10bps and 8bps cases and emits the six exact baseline rejections.

10bps baseline rejects caused by real shared-cap interaction after Idle exposure:

1. V12 LINKUSDT C000111 @ 1756159200000 — `NO_GROSS_ROOM`
2. V12 DOGEUSDT C000115 @ 1756202400000 — `NO_GROSS_ROOM`
3. V12 ADAUSDT C000119 @ 1756216800000 — `NO_GROSS_ROOM`
4. PENGU PENGUUSDT C000245 @ 1758816000000 — `PENGU_NO_LOT_SHRINK`
5. V12 ETHUSDT C000280 @ 1759046400000 — `NO_GROSS_ROOM`
6. V12 DOGEUSDT C002150 @ 1780488000000 — `NO_GROSS_ROOM`

Do not replace, retune, or choose rejects from outcome.

## 3. Exact 63 -> 61 causal admission

The two Idle candidates excluded by same-symbol occupancy are fixed:

- DOTUSDT @ 1780318800000, blocked by prior DOT Idle position opened at 1780246800000 and held until 1780333200000
- TIAUSDT @ 1784250000000, blocked by prior TIA Idle position opened at 1784206800000 and held until 1784293200000

Required admitted counts:

- DOT 14
- JUP 14
- RENDER 15
- TAO 9
- TIA 9
- total 61
- 48W / 13L

## 4. Historical block is closed

The following status MUST NOT be emitted again unless the source-backed 10bps replay itself later fails:

`BLOCKED_HISTORICAL_OVERLAY_REPLAY_NOT_RECONCILED`

Historical overlay accounting is reconciled sufficiently for Production engineering. The unsupported 1,342 count and mixed JPY268.05M bundle are withdrawn as LIVE acceptance requirements.

## 5. Production implementation required now

The existing Idle runner is intentionally SHADOW-only and currently throws `IDLE_LIVE_ORDER_PATH_NOT_CERTIFIED` in LIVE mode. Codex must now replace that deliberate stop with a fully guarded Production order path while preserving all existing safety infrastructure.

Required strategy contract:

- strategy family: `IDLE_PRIORITY_SHORT`
- symbols: TAOUSDT, TIAUSDT, DOTUSDT, JUPUSDT, RENDERUSDT
- direction: SHORT only
- accepted Gross: exactly **1.00x**
- leverage: **5x Cross**
- no partial sizing
- TAO hold 12h
- TIA hold 24h
- DOT hold 24h
- JUP hold 12h
- RENDER hold 12h
- emergency protection: reduce-only STOP 10% and TP 25%
- baseline same-timestamp acceptance beats a new Idle entry
- an already-open Idle position is not preempted by a later baseline signal
- one active Idle position per symbol
- sidecar/pending/shared exposure must count toward actual Gross
- do not bypass Shared Risk, Margin Guard, Kill Switch, pending registry, account lock, venue margin, quantity/min-notional or protective-order readback

Historical idle qualification may use a causal shadow-baseline-only state to reproduce the historical definition of “baseline idle”; actual account admission must still enforce real current safety/capacity.

## 6. Production completion gates

Before changing VPS current or arming LIVE, all of the following must pass on the exact Production candidate SHA:

1. deterministic 495 -> 63 evidence hash verification
2. deterministic 63 -> 61 same-symbol replay
3. 10bps fixed-intent dynamic-Gross replay matching:
   - baseline 1,284
   - baseline rejected 6
   - Idle 61
   - total 1,339
   - final JPY214,775,230.26444945 within declared numerical tolerance
   - PF 2.046425970772986
   - DD -22.840597480157931%
4. parity certificate bound to exact runtime SHA
5. runner/state/parity/market-data/selftests
6. malformed/stale/SHA-mismatch fail-closed tests
7. account-lock and pending-exposure tests
8. 5x Cross confirmation test
9. quantity/min-notional/filter tests
10. entry submit/reconcile idempotency tests
11. protection placement + venue readback tests
12. fixed-hold reduce-only exit tests
13. restart recovery tests
14. unknown/ambiguous order -> manual review fail-closed tests
15. Shared Risk / Margin Guard / Kill Switch integration tests
16. HP decision-status/history/runtime attribution checks
17. full TypeScript typecheck/build
18. no existing Production service regression

## 7. VPS deployment sequence

After all code/CI gates pass:

1. perform fresh READ-ONLY VPS inspection
2. capture current Production SHA, UI SHA, current symlink, all strategy/risk service health, open positions, open orders, protections, pending registry, account lock, Kill Switch, disk and API health
3. NEVER reset/clean/checkout the existing primary worktree and never discard unrelated uncommitted work
4. port/cherry-pick the Idle Production implementation onto the actual current Production lineage; do not deploy an older design-branch tree over Production
5. build an isolated versioned release
6. record rollback SHA/path
7. create the exact-SHA root-owned operator activation artifact
8. validate parity certificate against that exact runtime SHA
9. start/restart the Idle service only after core runners + Shared Risk + Margin Guard are healthy
10. do not place a forced/test trade merely to demonstrate deployment
11. verify service PID/runtime SHA/restart count
12. verify Kill Switch=false, pending clean or correctly reconciled, account lock healthy
13. verify Aster positions/orders/protection ownership
14. verify 5x Cross configuration and actual margin mode before any Idle entry
15. verify HP displays the same runtime SHA and current Idle decision/health
16. only then arm LIVE

## 8. No retroactive unsafe repair

Forbidden:

- loosening Gross caps to recover JPY268M
- excluding Idle exposure from shared Gross
- outcome-selected rejects
- fee/quantity tuning to force historical final equity
- using the 51/63 path-dependent replay as the historical parity target
- using 8bps final equity as the 10bps acceptance target
- force-closing existing unrelated positions
- resetting Production backward to this research branch

## 9. Final Codex status contract

Codex should continue through implementation, CI, VPS deployment and verification without asking for the historical JPY268.05M replay source again.

Final status must be one of:

- `LIVE_ACTIVATED_VERIFIED`
- `BLOCKED_<NEW_EXACT_REASON>`

A valid new BLOCKED reason must be a current Production/CI/VPS safety failure, not the superseded historical-overlay reconciliation issue.
