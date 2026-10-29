# DisDex Multi-SHA Production Safety Implementation — 2026-10-29

## Scope and safety boundary

This implementation covers the source-side safety contracts requested for the DisDex production family:

- runner-specific SHA wiring and operator-gate identity;
- truthful decision-cycle tick markers and supervisor heartbeat separation;
- shared risk/STOP ownership evidence and fail-closed classification;
- shared persistence, account-lock, retry, cooldown, and atomic-write concurrency;
- fixed Gross caps and pending-exposure safety;
- authenticated HP snapshot identity and cross-page observability;
- immutable release evidence generation and CI contracts.

The work is isolated on branch `codex/disdex-production-safety-20261029`. It does not connect to the VPS, Aster, systemd, the production HP, or an order endpoint. No order, cancellation, position change, STOP change, Kill Switch action, or LIVE restart was performed.

## Source changes by task

| Task | Source result | Commit | Verification | LIVE state |
| --- | --- | --- | --- | --- |
| 01 | Production/候補の runner pin contract and source classification | `30de5ddf` | multi-SHA contract tests | `SOURCE_READY_NOT_LIVE` |
| 02 | runtime wiring, health/watchdog, operator gate, and STOP owner identity use runner-specific SHA | `b4a60939` | runner identity and wiring tests; TypeScript check | `SOURCE_READY_NOT_LIVE` |
| 03 | UUID/exclusive tick publication, root-owned storage contract, systemd write-path contract, truthful tick/heartbeat semantics | `19077a82` | tick/storage/heartbeat/watchdog tests and syntax checks | `SOURCE_READY_NOT_LIVE` |
| 04 | shared state, rate budget, IDLE/HYPE persistence, account-lock and retry collision protection | `21c721d7` | shared-state and shared-risk concurrency tests; 80-way contention coverage | `SOURCE_READY_NOT_LIVE` |
| 05 | runner-scoped STOP ownership, manifest-derived pin proof, risk preflight, 7.5% UTC daily scope, fail-closed unknown/partial evidence | `e38487bc` | STOP/risk regression, preflight self-test, multi-SHA Python tests | `SOURCE_READY_NOT_LIVE` |
| 06 | fixed Gross policy, stale/future/invalid pending rejection, lock release race handling, no dynamic Gross allocation | `140e8e4f` | Gross/pending/lock/V4 tests and Python tests | `SOURCE_READY_NOT_LIVE` |
| 07 | authenticated canonical HP snapshot, runner observability, Q102/V4/pending/risk/Gross fields, heartbeat/tick separation | `1efedcca` | HP contract, health/tick/watchdog/alert tests, TypeScript and self-tests | `SOURCE_READY_NOT_LIVE` |
| 08 | canonical current target fixed-Gross boundary, immutable release evidence generator, release-evidence CI | this branch's Task 08 commit | release evidence contract and self-test; final full verification | `SOURCE_READY_NOT_LIVE` |

The prior merged SHA `06555dcaaf8b62fd8f8fcec2b6fa650225012f2c` is treated as the candidate source baseline only. It is not substituted for any independently running V4, Q102, V52, old-common, or other runner SHA.

## Runner identity and ownership rules

The source contract preserves runner-specific identity. A common SHA fallback is rejected for runtime monitoring, operator activation, risk preflight, health snapshots, and STOP ownership. The required map remains explicit for V4, Q102, V52, PENGU, FET, HYPE, IDLE, and RESIDUAL where applicable.

STOP evidence is accepted only when owner SHA, release marker, service, heartbeat/tick evidence, side, quantity, reduce-only state, and venue readback agree. Unknown, partial, stale, mismatched, or failed-restoration evidence remains unprotected and therefore fail-closed. The source does not classify an unknown STOP as managed.

## Heartbeat and tick contract

`heartbeatAt` is the supervisor observation time. `lastTickAt` is the last real decision-cycle completion time. The tick writer uses an exclusive UUID temporary file and atomic rename; no manual marker generation path was added. The migration contract requires the writer and the monitoring reader to be deployed as a compatible pair; monitoring-only migration for an old writer is not accepted.

The health snapshot and alert source now expose runner identity, tick/heartbeat age, service mismatch, evidence presence, reason, and intentional no-signal/lock/held/market-closed outcomes without representing a supervisor heartbeat as a strategy decision.

## Shared API and persistence contract

Shared rate budget, IDLE/HYPE state, and account lock writes use collision-resistant temporary names and exclusive creation. Retry logic preserves cooldown/backoff/jitter and records diagnostic ownership/wait context. A malformed or unresolvable lock remains fail-closed. Pending exposure rejects missing, non-finite, negative, future, and stale rows and does not provide a stale row as order authorization.

The implementation keeps the account lock and venue rate controls enabled. It does not send an API request to Aster and does not relax 429/418 handling.

## Gross and economic-change boundary

The canonical target is now explicitly `FIXED_BASE_CAPS_ONLY`:

- crypto Gross cap: `3`;
- total portfolio Gross cap: `4.25`;
- reserve: `15%`;
- shared daily loss limit: `7.5%`;
- dynamic/profit-tier Gross allocation: disabled;
- formal hard caps remain `5` crypto and `8` total where the existing target defines them.

The V4 internal `4.75x` limit and the shared portfolio `4.25x` limit remain distinct. Final permission must satisfy both the runner-local contract and the shared portfolio cap. Research-only dynamic allocation and unapproved priority-trading changes are not imported into LIVE source.

No source change in this branch authorizes FET full liquidation, stock-shortage resolution by crypto liquidation, or an economic priority change before formal economic authentication.

## HP and authenticated source

The canonical snapshot is intended to be served only through the authenticated runner-health route. Anonymous HTTP 200 is not a success criterion. The route requires the `disdex_auth` cookie, validates the snapshot schema and read-only marker, and disables caching. The snapshot reports venue-dependent Gross/order data as unavailable until signed venue evidence exists; it does not invent current positions or balances.

## CI and release evidence

The new release evidence generator records source Git SHA, SHA-256 hashes of the safety-critical files, release-marker status, runner-pin source status, `ordersSent: 0`, `cancelSent: 0`, `positionChangesSent: 0`, fixed-Gross status, and external blockers. It refuses to treat a local checkout as a live release when `.disdex-release-sha` and formal approval evidence are absent.

The release evidence CI runs the contract test, the read-only self-test, and TypeScript type checking. It does not create a release marker, copy an operator artifact, alter an approval date, or perform a deployment.

## Explicit blockers and classification

### `FIXED_AND_VERIFIED`

The source contracts listed above are implemented and verified by the focused tests, self-tests, syntax checks, TypeScript checks, and diff checks recorded in the task ledger. This classification applies only to source behavior and repository evidence; it does not mean the corresponding service is live.

### `SOURCE_READY_NOT_LIVE`

The branch contains the source and CI changes, but no production deployment or runtime SHA change has been performed. The local checkout has no release marker and is not a production release.

### `BLOCKED_OPERATOR_AUTH`

Formal root-owned operator activation is not present. The missing evidence must include the exact approved SHA, `professional-dismanager.net` target, complete runner-scoped `approvedRunners` map, root ownership and permissions, auditable approval timestamp, target release marker, and the exact runner scope. Copying or editing an existing artifact is not acceptable.

### `BLOCKED_NATIVE_HISTORY`

The requested Aster-native annual history for `2025-08-10..2026-08-10` is not available in this environment. Binance or another venue cannot substitute for the missing native evidence, and no synthetic history is accepted as formal economic authentication. The requested 10bps/30bps integrated BT remains blocked as an official certification until the native data gap is closed.

### `BLOCKED_VENUE_EVIDENCE`

The required Desktop SSH key is unavailable at the instructed location, so VPS/Aster signed read-only GET, position/STOP/TP/open-order reconciliation, and the current DOGEUSDT SHORT/BUY STOP readback cannot be verified. The source therefore does not report historical values as current values.

### `LIVE_VERIFIED`

None. This status requires formal operator authentication, production deployment, signed venue evidence, and three post-cutover audit cycles. Those actions were intentionally not performed in this source-only turn.

## Safe next gate

The next operator-controlled gate is to obtain the formal approval artifact and signed read-only venue evidence. Until both are independently verified, keep the existing LIVE runners, positions, STOPs, Kill Switch state, API budget, and account lock unchanged; do not grant order authority; and do not call a deployment or restart command.
