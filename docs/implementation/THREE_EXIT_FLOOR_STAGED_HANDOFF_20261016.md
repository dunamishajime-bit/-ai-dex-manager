# Three selected profit floors — staged implementation handoff (2026-10-16)

**STATUS: STAGED OFF-BY-DEFAULT SHADOW; REAL VENUE STOP REPLACEMENT NOT CONNECTED; NO LIVE APPROVAL.**

## Exact parameters

| Owner | Exact selector | Causal activation | Secured entry PnL |
|---|---|---:|---:|
| Q102 | family MR only | Completed 1H close favorable >=3.0% | +1.0% |
| V12 V4 | route REC_G5_SLOW_TREND only | Completed 1H close favorable >=2.0% | +0.5% |
| V12 V4 | route REC_X05_TIME_36H only | Completed 1H close favorable >=2.5% | +1.0% |

Only Q102 MR and two independent V4 routes are selected. No PENGU, HYPE, FET, Idle, V52, other Q102 families or other 39 V4 routes may change exits.

- For LONG: stopPrice = actual average entry fill × (1 + securedReturn).
- For SHORT: stopPrice = actual average entry fill × (1 − securedReturn).
- H1 candle may be consumed only after close; floor is effective NEXT H1; after activation, old emergency stop must remain protected until the new reduceOnly stop is independently read back.
- Entry, time expiry, existing STOPs, account/gross locks, funding accounting and exit ownership retain precedence. Never place a floor STOP when the mark has already crossed the trigger.

## Distinct currently running releases — critical

- Common production read-only VPS audited 2026-10-16 16:31 JST: **ea289577256af9c19544a1883013a128bbb53ec5**. Dedicated Q102 staged branch `feature/q102mr-three-exit-from-common-ea289-20261016`, PR #254, base `review-base/common-live-ea289-20261016`.
- V12 V4 independent running release: **6f97d2cf03877674ec1a845f6c08414f32899f36**. Dedicated V4 branch `feature/v12v4-three-exit-floors-from-live-6f97-20261016`, PR #253, base `review-base/v4-live-6f97-20261016`.
- Initial combined PR #252 was CLOSED and superseded to avoid reverting the independent V4 release's existing lifecycle file by accident.
- Shared Risk was **tripped=true** even when last observed loss rate was 6.259% below configured 7.5% limit; the latch must not be silently cleared. Kill Switch showed OFF. Neither snapshot grants permission to send orders.

## Code actually staged

1. `lib/exit-profit-floor-three.ts`: pure whitelisted three-route H1 arm/stop policy and owner-signed venue STOP preflight. Returns `orderEnabled:false`, `ordersSent:0`.
2. `lib/exit-profit-floor-three-observers.ts`: causal contiguous completed-H1 replay and strict state validation.
3. `lib/exit-profit-floor-three-shadow-store.ts`: separate atomic, fsynced file storing profit-floor *observations*, with owner lineage and monotonic time constraints. The original Q102 position schema and original V4 event/STOP journal remain **unchanged** so a rollback does not fail to parse unfamiliar fields.
4. `lib/exit-profit-floor-three-cutover.ts`: pure state-machine describing future STOP replacement choreography, **without exchange API calls**. Persist intent first, record attempt before any submission, read new stop by exact client ID (no blind retry if ACK unknown), independently verify open reduceOnly + remaining qty, record cancel intent, cancel old only after new readback, final signed venue readback. Ambiguous fills, duplicate STOPs, partial quantities, orphaned intent and mismatched mark -> MANUAL_REVIEW.
5. Q102 MR runner: optional `threeExitFloorShadowEnabled` and independent store injected by `DISDEX_EXIT_FLOOR_THREE_SHADOW=1`. Initially **OFF**; no order mutation; if shadow fails existing trading exit unaffected.
6. V4 runner: same independently OFF feature flag and separate sidecar. Historical entry/fill/event journals remain original 6f97 format; original H1 exit feed is byte-identical to baseline, including 41 routes and PENGU protection.

## Research quality, not a claim of LIVE profitability

- In-sample model Aug 10 2025–Aug 10 2026, 10bps baseline JPY291,326,103 -> candidate JPY302,658,260, PF4.049->4.175, MTM DD −20.420% -> −20.238%.
- 30bps baseline JPY174,749,524 -> candidate JPY198,928,950, PF3.278->3.635, DD −18.389% -> −18.341%.
- Historical out-of-development Aug–Oct 2026 G5 2 trades + X05 1 trade, **zero floor activations**. Q102 MR has no sufficiently strong independent external activation study. The proposal is in-sample selected and MUST NOT be represented as forward certified.
- The *new staged implementation* is only H1 shadow and non-ordering venue preflight, not full repeatable execution/portfolio BT parity of a live STOP replacement.

## Explicit blocking conditions before a real order can ever be authorized

1. Authenticated Aster signed GET independently verifies account, equity, all current positions, the correct Q102/V4 owner ledger, signed mark, open STOP orders, quantity/price filters, old stop identity, pending exposure, PENGU and same-symbol virtual legs, margin guard, shared lock, shared risk and Kill Switch.
2. Aster-specific owner-scoped reduceOnly STOP adapter and persisted replacement intent must be implemented and tested *offline with a mocked venue first*; existing file `lib/exit-profit-floor-three-cutover.ts` has **NO exchange transport**. The current Q102 `stopFraction` is loss-only, cannot specify a profitable stop. Existing V4 owner validator expects exactly one active STOP per virtual leg and will reject intermediate dual-STOP state until a separately certified transition reconciler exists.
3. Prove on exact venue semantics: no unprotected window, partial fill, unknown PLACE/CANCEL ACK, duplicate client IDs, journal readback, accounting, quantities below venue step/notional floors, funding, H1 boundary, order-rate budget and restart/rollback within signed risk lock. If the venue rejects a second reduceOnly STOP, design a certified alternative without exposing an unprotected position.
4. Replay original full-eight 10bps/30bps model and candidate in same engine, with same H1 boundaries, gross/margin occupancy, fees/funding and 50–100bps additional STOP execution adverse scenarios. Confirm PENGU 67/67 historical event parity. New forward evidence including *actual activations* is required to remove empirical blocker.
5. Exact per-release/operator-scoped activation approval for **the final promotion SHAs**, verified risk latch, account inventory flat or fully certified live migration, retention of previously active protective orders, release marker and rollback targets. **Do not bypass or auto-clear Shared Risk or operator gates**.
6. No user exposure to hidden order ability: the staged observation feature is OFF unless explicitly configured, and even when ON it emits no orders. Never equate `SHADOW_READY` or passing CI with `LIVE_VERIFIED`.

## Backout / rollback plan

- Keep current Production symlink and both services unchanged while staging. No old code or protected position modified.
- Deactivate `DISDEX_EXIT_FLOOR_THREE_SHADOW` or restore original exact release (common EA and independent V4 6f). Since the shadow record is in an isolated file, original position, order and V4 durable journals still parse in the old binaries.
- Do not delete the sidecar or invalidate existing STOP identities while positions may remain open. If any future order transition is started, rollback requires signed order+position readback and handoff to existing resident STOP owner, not merely a code rollback.

**Status**: code created on two independent GitHub review branches; test results and latest exact commit SHAs are tracked in the respective CI/PR. No LIVE deployment, no STOP replacement, no transfer of risk authorization.

## Final local isolated code verification (2026-10-16 JST)

The staged candidates were cloned into **two new disposable, isolated source directories** on the user's authorized Windows PC, leaving existing research worktrees and the VPS Production state untouched. Node v24.13.1; dependencies installed with `npm ci --ignore-scripts --no-audit --no-fund`. No broker credentials or mutation APIs were called.

- **Q102 branch** (`fd77f336f594acca9585a541a8ac8aee4cdc6a7c`): `node node_modules/typescript/bin/tsc --noEmit --pretty false` **PASS**. Local `node node_modules/tsx/dist/cli.mjs --test` for new policy/observer/cutover/sidecar and existing STOP ledger: **58 passed, 0 failed**.
- **V12 V4 branch** (test fixture updated at `e4bf6fa9cbc820006ea16d34ef5d235a76d51a73`): same full TypeScript check **PASS**. Local new policy/observer/cutover/sidecar + exact independent V4 41-route lifecycle/exit feed/runner/STOP regression: **69 passed, 0 failed**. Initially one floating price assertion wrongly used strict equality for 100.49999999999999 vs 100.5; test updated to a <1e-9 tolerance and entire 69-suite rerun PASS.
- Independent check against original GitHub blob SHA proves unchanged **Q102 state schema**, unchanged **V4 production event lifecycle**, and unchanged **V4 live exit feed**. No legacy state migrations or operator switches.
- Targeted GitHub Actions queued amid repository-wide workflow backlog at time of local tests. Older staged revisions completed in CI SUCCESS, but do **not** claim latest branch GH CI has passed without separately confirming the exact final SHA.
- Post-implementation VPS **read-only** audit at **2026-10-16 17:02:05 JST**:
  - Common production exact SHA `ea289577256af9c19544a1883013a128bbb53ec5`, previous release `9df89474b36f01608ed6155697de342f861d3626`.
  - Independently running V4 `6f97d2cf03877674ec1a845f6c08414f32899f36`, PID1216532, 0 restarts, active.
  - Q102 common EA PID1216155, 0 restarts, active; PENGU PID1215747, 0 restarts, active.
  - Shared Risk **tripped=true**, lossPct **5.638403%** versus 7.5% limit (latched). Shared Kill Switch **active=false**. Latched Shared Risk not reset or bypassed.
  - Signed Aster position/order inventory was **not** fetched for this final audit; a local state/SHA/PID reading alone is NOT proof of protected venue status.
- **Operational verdict**: model scope and off-by-default SIDE-CAR SHADOW fully staged/tested; zero Aster orders sent, zero STOPs cancelled, zero runners restarted, zero Production deployments. Real Aster reduceOnly-profit-STOP replacement, forward out-of-sample activation evidence and operator SHA-scoped authorization are STILL BLOCKED. DRAFT PR only, keep production untouched.
