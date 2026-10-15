# Codex handoff: DisDex V12 V4 41-route + Idle acceptance correction

Date: 2026-10-15 JST
Status: **NOT YET CERTIFIED FOR PRODUCTION**. This document authorizes no live orders, no gate bypass, no operator artifact forgery, and no deployment by itself.

## Exact source
Repository: `dunamishajime-bit/-ai-dex-manager`
Branch: `fix/idle-margin-flat-freshness-20261015`
Implementation patch SHA: `139090a734ec7bf78800fc9ecc42f90f0f5885d6`. This handoff document was committed afterward, so **resolve and freeze the current remote branch HEAD before any certificate or operator artifact; never reuse the implementation-only SHA as the final release SHA**.

Observed production at last successful read-only VPS audit (2026-10-15 10:58 JST, must reconfirm):
- Peer/current trading release: `e8cc2e73f8d3981d708ee52f013241597c038b10`.
- Independent V12 V4 production: `6f97d2cf03877674ec1a845f6c08414f32899f36`.
- UI: `cce756b3c5baafeefdd4e6d62b6fd8045e21f988`.
- Operator activation record for peers binds old `e8cc...` only.
- Kill Switch OFF, Shared Risk not tripped, Margin Guard HEALTHY, 9 services active then. **This historical snapshot is not today's venue certification.**
- Disk was cleared from 97% used to ~93% used, 3.5 GiB free, preserving rollback/order records.

## Staged changes to verify
1. `lib/idle-margin-age-policy.ts` plus Idle runner call: 300-second guard cadence, effective 330-second allowance only with independently flat signed account; original strict age used when any position or pending gross is present. Preserve pre-order guard fail-closed.
2. `lib/idle-quantity-audit.ts` and `lib/idle-quantity-feasibility.ts`: venue minimum lot, step, minNotional, exact <=1.0x, max 1% underfill by one venue step. No upward quantity rounding.
3. `lib/idle-priority-short-runner.ts` now records quantity rejects, accepts only bounded one-step rounding, and passes `maxEntryNotionalUsd: equity` to order-time executor.
4. `lib/direct-trade-executor.ts` now refuses an exposure-increasing order if the refreshed market quote produces notional above the supplied max. This check runs before order mutation. Refused Idle order releases the reservation without a venue order.
5. `lib/v12-v4-independent-route-audit.ts`: read-only examination of each of the 41 registered V4 routes and potential fallbacks after first-route repair rejection. Never auto-select or send orders. Includes V4 active-window/downtime exclusion.
6. `scripts/research/v4-idle-rejection-decomposition-20261015.py`: exact formal original rejection attribution (no trade or state edits).
7. `.github/workflows/disdex-v4-idle-remediation-checks-20261015.yml`: isolated read-only tests/typecheck/original rejection replay. **CI completion not yet independently confirmed.**

## Historical 1-year formal 10/20/30bps price-model benchmark (NOT corrected-policy results)
10bps: initial 10,000 JPY, final 291,326,102.62 JPY, PF 4.0489918, DD -20.4200138%, WR 71.6039%, 1,222 trades; 828 V12.
20bps: final 231,193,740.03 JPY, PF 3.6556831, DD -20.9659013%, WR 69.9346%, 1,224 trades; 828 V12.
30bps: final 174,749,524.32 JPY, PF 3.2776408, DD -18.3887653%, WR 68.3087%, 1,218 trades; 824 V12.
These source outputs are H1 **price-model only**, not independently venue L2 verified. Do not represent old BT as improved BT.

Candidate rejection counts:
- 10bps V12 gross 52; venue min quantity 11; minNotional 4; opposite symbol active 50. Idle full 1x quantity block 87.
- 20bps V12 gross 58; 30bps V12 gross 60.
- 41/41 historical route coverage does NOT mean independently evaluating all 41 at each LIVE opportunity.

## Codex mandatory remaining certifications and cutover sequence
A. Read root `AGENTS.md` and `docs/ops/DISDEX_VPS_SSH_ACCESS_20261012.md`; establish owner-PC Git SSH -CheckOnly.
B. Compare GitHub candidate tree against actual peer `e8cc...` and V4 `6f97...`; DO NOT replace independent V4 source with older peer code or mass-promote peers. Check whether to produce separate V4 and peer release SHAs, both properly approved.
C. Run new targeted tests and full relevant regression suite and root/runtime TypeScript checks. Review pre-order cap and all partial-fill/protection/reconciliation error paths. Check that price precision/tick, minQty, minNotional, step size and rejection context are logged for RENDER and TIA.
D. Run causal 41-route read-only observer over real closed H1/H2 source, split by source engine and by first candidate rejection, and exclude runner downtime/startup. Demonstrate no synthetic exposure or orders. **Do not change production fallback selection without new portfolio BT parity.**
E. Re-run the original causal portfolio BT engine with identical market data/fees/FX/rank/Gross constraints for unchanged baseline and proposed variation at 10, 20, 30 bps. Compare final equity, PF, maximum MTM DD, WR, accepted/rejected counts by strategy and route, missed second route and gross. No claims from simply reclassifying rejected candidates. Reject variation if formal parity or causal validity fails.
F. Obtain fresh signed Aster GET-only positions/open orders/resident reduce-only protection, accounting pending/gross reservations and all locks/rate-budget; last recheck was blocked by `ASTER_GLOBAL_RATE_BUDGET_SATURATED`. No bypass, no forced lock release, no evidence substitution. Verify protection STOP lifecycle (partial fills, restart, duplicate suppression, cancellation reconciliation).
G. Freeze final Commit SHA, stage immutable release, verify code bytes/tree == GitHub SHA, create matching root-owned Operator approval artifact through normal governed process, verify Shared Risk / Margin Guard / account lock / Kill Switch / watchdog / rollback, then switch only the approved runners.
H. After Codex cutover independently repeat signed Aster/runner/UI checks and document current vs previous release, actual orders/positions/stops, PIDs/restarts and the rollback trigger. Roll back if any certification fails.

**Do not change any currently running production service until A–G pass.** Previously confirmed production LIVE stays active while auditing. No forced order merely to demonstrate a signal.
