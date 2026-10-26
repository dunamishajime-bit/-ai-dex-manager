# CODEX LIVE final handoff: V12 V4 C/D Gross (2026-10-26)

Repository: dunamishajime-bit/-ai-dex-manager
Branch: research/render-dual-production-prep-20261025
PIN and use the EXACT remote HEAD SHA after final document Push. No older/current fork substitution.

## User-approved sizing (NEW entries only)
S 9 = .60x, A 5 = .45x, B 10 = .30x, all unchanged.
C Recovery 9 = .25x (previously .18x), approved.
D G3 = .25x, D X13 = .15x, D CONT_SHORT = .15x, user approved.
Remaining D 4 = .05x; Core retains native gross. No changes to rank/route entry/exit/cooldown, global and family caps or seven peer strategy policies.
DO NOT add to or close existing AAVE/NEAR positions.

C route IDs (9):
- REC_X06_TIME_12H
- REC_Y08_REV_D0_T6
- REC_G2_EARLY_BTC_OPPOSE_VOL
- REC_X02_TIME_36H
- REC_Y17_REV_D1_T3
- REC_X04_TIME_24H
- REC_Y19_REV_D1_TP2_SL1_H36
- REC_X09_TIME_48H
- REC_G1_MID_REL_LOWVOL

New D route sizes (3):
- REC_G3_LATE_BTC_REL: 0.25x
- REC_X13_TP1.5_SL1_H24: 0.15x
- CONT_SHORT_MID_AGE24_48: 0.15x

Unchanged D routes (4):
- REC_X07_TIME_6H: 0.05x
- REC_X14_TIME_48H: 0.05x
- REC_Y15_REV_D0_T3: 0.05x
- REC_Y18_REV_D2_T18: 0.05x

## Zero shared Gross D handoff rule
Only consider yielding a currently protected, selected G3/X13/CONT D leg when an upper-priority entry has passed ALL ordinary admission/risk/owner/slot/venue minimum checks and its applicable free shared Gross is exactly ZERO after signed pending reservations. If any usable free shared Gross exists, DO NOT yield merely to upsize the new order.

Source lib/v12-v4-d-tier-zero-gross-yield.ts is a pure, fail-closed NO-ACTION proposal evaluator, NOT yet an executable cross-runner signed venue two-phase lifecycle. Its return explicitly sets venueMutationAuthorized=false. This must not be interpreted as permission to submit or cancel venue orders. Its tests cover zero/positive Gross, stale candidate, stop/lock, risk/margin/kill, owner and priority, selected D allowlist and insufficient victim Gross. If safe venue/owner choreography cannot be certified, leave yield OFF and report BLOCKED; do not pretend the subfeature is LIVE.

## Implemented code and deterministic verification
lib/v12-v4-v2-shadow.ts resolves new Gross for exactly nine C Recovery and three D routes via the existing production feature candidate call chain.
tests/v12-v4-v2-shadow.test.ts proves all 41 route tiers and unchanged 29 other routes including native core.
tests/v12-v4-d-tier-zero-gross-yield.test.ts proves conservative eligibility without any order side effect.
TypeScript noEmit PASS, V4-focused 257 tests PASS on Windows research checkout, including STOP/partial-fill/restart/shared reservations.

## Frozen eight-sleeve 10/30bps model results (not current LIVE parity)
Historical 2025-08-10 to 2026-08-10, archived October 9 H1 source:
C .25/D .05 original: 10bps final 298,359,667 JPY DD -20.482% 1220 trades; 30bps final 185,858,225 JPY DD -18.395% 1217 trades.
C .25/D three raised: 10bps final 304,799,546 JPY DD -20.340% 1218 trades; 30bps final 193,683,203 JPY DD -18.349% 1217 trades.
Economic difference +6,439,878 JPY / +7,824,978 JPY. Two independent economic reruns matched metrics and trade ledger hashes; source gross sweep 37 cases x 10/30bps and all accounting PASS.
No-free-Gross yield: ZERO historical yield triggers in both cost settings, results exactly match no-yield baseline. Earlier any-deficit yield lost ~1,940,410 JPY at 10bps from unnecessary G3 AVAX close to slightly upsize an already admissible V52 AMZN order. User rejected it.
This is an in-sample archived price model, not 2026-10-26 signed Aster L2, current updated RENDER/other stops, partial fill or live eight-strategy parity. Do not claim production profitability proved.

## Production state observed by read-only VPS audit
Common current release: /home/deploy/disdex-trading/releases/7688ed7c93a1918d8b44837339b7da5584a868f5.
V4 dedicated release unit: disdex-v12-v4@23ddd4b01fcff38cd10d4d4614221f93dc6b44e5.service FAILED, PID 0, exit status 2, since 2026-10-26 12:17 JST; V4_EVIDENCE_STALE:routeSourceParity. IDLE shared runner active. Stale evidence predates these C/D patches.
lib/v12-v4-certified-gates.ts enforces 24h SHA-bound evidence capturedAt; root-managed proof /etc/disdex/v12-v4-evidence/route-source-parity.json and other four artifacts. Must genuinely revalidate evidence on exact release SHA, not alter timestamp, relax TTL, forge status, bypass risk or force systemd restart.

## Codex final cutover tasks, no shortcuts
1. Fetch and PIN final remote branch SHA; compare exact content with Production V4 SHA 23ddd4 and shared 7688ed7c. Stage immutable signed release, retain rollback, preserve all already approved changes including RENDER dual, avoid disapproved dynamic market-fit allocation.
2. Certify GitHub CI exact SHA, LF, typecheck and full tests, 41 route Gross map, no unapproved entry/exit modifications; production certified quantity rounding and actual margin/Gross for small Aster account. Historical model alone is not current live authorization.
3. Rebuild current-source eight-strategy integrated BT 10bps and 30bps with newest V4/C/D/RENDER and all peer exits. Reconcile current runner code, venue constraints, account lock and open/pending exposure; report real trade count/PF/WR/DD and uncertainty. Do not fabricate absent data.
4. For any LIVE D-yield: implement and certify cross-sleeve event link (not yet wired) across both owners under shared account lease. Signed upper candidate must be blocked SOLELY because usable free Gross=0. Atomic reservation/acknowledged owner; submit minimum required D reduce-only EXIT only after proving persistent protected STOP, confirm signed fill and STOP retirement/protection of remainder, refresh wallet/Gross/quote/upper signal then ENTRY + resident STOP. Race/partial fill, restart, stale signal, no available yield proof, wrong symbol, pending and kill switch all FAIL CLOSED. No forced D close if the upper order can already fit.
5. Refresh root-owned route parity and all evidence authentically, handle 24h expiry safely by periodic real re-attestation/alert (never fake freshness). Check existing AAVE/NEAR positions and their resident STOPs and all peer runners. Verify shared risk/margin/kill, pending reservations, disk/health, rollback.
6. Only after operator proof and exact-SHA authorization, perform the Production cutover, reconcile signed venue fills/protection and HP. If missing real order lifecycle proof, leave D yield disabled; if other certification incomplete, do NOT promote the release; report precise BLOCKED_*.

Boundary: CODE/GROSS READY, test PASS; D-yield only NO-ACTION proposal, not a final LIVE executor. GitHub commit/Push does not mean VPS deployment. This preparation made NO VPS edits and NO orders/cancels/position modifications.
