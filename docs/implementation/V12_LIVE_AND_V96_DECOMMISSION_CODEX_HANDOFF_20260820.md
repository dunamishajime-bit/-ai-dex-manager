# V12 LIVE activation through V96 full decommission — Codex handoff

## Objective
Finish production in the final composition:

- V12_X1.00_ALL — LIVE
- PENGU_DUAL_LS_V2_FINAL — LIVE
- V52 — LIVE
- V96 runtime logic — removed from active runtime and executable source

Do not stop at source readiness. Do not stop at deployment. Complete the actual VPS transition, verify `LIVE_ACTIVATED_VERIFIED`, then remove V96 runtime/source dependencies in a second immutable release.

## Non-negotiable safety rules
- No SHADOW observation phase.
- No synthetic or artificial LIVE test order.
- Do not modify frozen V12 Entry/Exit/universe/timeframe/multiplier/backtest lineage.
- Do not modify PENGU V2 signal logic.
- Do not modify V52 signal/entry/exit logic or weaken its reference-quality gates.
- Never allow V96 and V12 to be simultaneously new-entry LIVE capable.
- UNKNOWN order/status/state mismatch is FAIL_CLOSED.
- Never auto-adopt or auto-close an unknown position.
- Never auto-clear a Kill Switch.
- Do not edit an immutable release in place.
- Do not delete a credential/state file until the replacement path is installed, verified and actively used.
- `ORDERS_SENT_FOR_TESTING=0` throughout.

# Phase A — activate V12 using the existing V3 path

Use the exact green HEAD of branch:

`chatgpt/v12-live-adapter-final-20260817`

Canonical activation handoff:

`docs/implementation/V12_CODEX_MINIMAL_VPS_HANDOFF_20260820_V3.md`

Canonical command from the exact Git object:

`scripts/ops/root/disdex-v12-live-activate-from-sha-v3`

Required result before proceeding:

`STATUS: LIVE_ACTIVATED_VERIFIED`

and all of:

- V12 service active with valid MainPID and no activation restart loop
- PENGU V2 active
- V52 active
- shared crypto risk active/fresh
- full-universe Margin Guard active
- V96 services inactive and disabled
- no orphan V96 runner process
- V12 runtime reconciliation PASS
- PENGU readiness PASS
- V52 readiness PASS
- V96/V12 simultaneous LIVE = FALSE
- `ORDERS_SENT_FOR_TESTING=0`

If Phase A does not reach `LIVE_ACTIVATED_VERIFIED`, do not perform V96 source/runtime deletion.

# Phase B — prove V96 runtime decommission readiness

Run from the activated immutable release:

`sudo /home/deploy/disdex-trading/current/scripts/ops/root/disdex-v96-runtime-decommission-readiness <ACTIVATED_SHA>`

Require:

`STATUS: V96_RUNTIME_DECOMMISSION_READY`

This check intentionally does not infer V96 ownership from BTC/ETH/BNB/SOL symbols after V12 is live, because V12 legitimately overlaps those symbols. V96 flatness was proved before the V12 start and mutual-exclusion prevents later V96 exposure.

# Phase C — create the V96-decommission source release

Create a new branch from the exact activated source SHA:

`codex/v96-decommission-after-v12-live-20260820`

Do not rewrite the already-activated SHA.

## C1. Neutralize shared dependencies before deleting V96

Shared functionality must survive, but must no longer depend on V96 runtime code or V96-only naming.

Keep/standardize these shared components:

- account-scoped order lock and reservation
- shared crypto daily risk
- shared Kill Switch
- Aster V3 adapter/executor
- portfolio Gross classifier/router
- full-universe Margin Guard
- V52 reference-quality service/gates
- V12 resident protection/restart reconciliation

Specific cleanup requirements:

1. PENGU V2 must stop importing V96 Kill Switch helpers. Migrate to `lib/disdex-shared-kill-switch.ts` or a neutral equivalent **without weakening malformed/missing-state fail-closed behavior**. Do not swap readers merely because the name is neutral; prove schema/path/error-behavior parity in self-tests first.
2. Any V12/PENGU/V52 runtime dependency on `lib/disdex-v96-*` or `config/disdexV96Runtime.ts` must be removed.
3. Rename shared environment variables whose names contain `V96` to neutral production names. During source migration, compatibility aliases may exist only long enough to migrate the live VPS config; the final decommission release must run on neutral names.
4. Rename shared Python/TS constants whose strategy/runtime identity incorrectly contains V96. If a durable state schema contains the old identity, implement an explicit one-time state migration with backup, exact old/new schema validation and no trading action.
5. Migrate active production state roots to neutral paths only with atomic copy/rename and byte/content validation. Never reset state. Preserve V12/PENGU/V52 durable position/pending/risk history.
6. Migrate Aster/reference credentials from the legacy V96-named environment file into a neutral root-owned secret environment file without printing secrets. Verify new services use the new file before the old file is retired.

Recommended neutral names (use consistently; equivalent neutral names are acceptable if already established in source):

- secret env: `/etc/disdex/disdex-aster-production.env`
- shared state root: `/var/lib/disdex/production`
- shared Kill Switch: `/var/lib/disdex/production/kill-switch.json`
- shared account lock: `/var/lib/disdex/production/account-order.lock`
- shared crypto risk: `/var/lib/disdex/production/crypto-daily-risk.json`

Do not move a live state file by deleting/recreating it. Use verified migration and retain a read-only backup until final validation finishes.

## C2. Delete V96-only executable logic

After C1 has removed every active dependency, delete V96-only runtime implementation, including as applicable:

- V96 runner(s)
- V96 supervisor/combined supervisor logic
- V96 strategy runtime config
- V96 operator-override runtime
- V96-only preflight/readiness
- V96 pending/state migration utilities that are not needed by V12/PENGU/V52
- V96-only kill-switch command implementation after all consumers use shared Kill Switch
- V96-only systemd service/target definitions
- V96-only deploy/start scripts
- V96-only package scripts
- V96-only Actions/workflows and runtime contract tests
- V96↔V12 mutual-exclusion interlocks once V96 service definitions themselves no longer exist

Historical implementation documents or research records may retain the string `V96`, but no executable production path may depend on V96 code after decommission.

Run:

`bash scripts/ops/disdex-v96-decommission-source-audit.sh . --expect-clean`

Require:

`STATUS: V96_DECOMMISSION_SOURCE_CLEAN`

If executable/runtime references remain, do not declare V96 removed.

# Phase D — decommission CI and immutable clean release

The new V96-free SHA must pass at minimum:

- application TypeScript compile
- PENGU V2 typecheck/self-test/parity
- V12 frozen parity and latest required parity
- V12 live execution/crash-recovery tests
- resident STOP and trailing STOP tests
- shared crypto risk tests
- Node/Python shared lock priority tests
- portfolio Gross classifier/cap tests
- V52 self-test/contract
- full-universe Margin Guard self-test
- migration/state-schema tests introduced by C1
- shared Kill Switch schema/path/fail-closed parity tests
- `disdex-v96-decommission-source-audit.sh . --expect-clean`
- Linux production build

No test may contain production Aster credentials or submit a real order.

Create a new immutable 40-char SHA release. Do not modify the activated V12 release.

# Phase E — switch from activated V12 release to the V96-free clean release

Before changing runtime:

1. Re-run the current activated release final status and require PASS.
2. Confirm no unresolved pending order for V12/PENGU/V52.
3. Confirm shared Kill Switch/risk state is valid.
4. Confirm resident V12 protection is valid for any open V12 position.
5. Back up active durable state and old environment files without exposing secrets.

Deploy the clean release using a controlled restart/reconciliation sequence. Do not force-liquidate positions merely to perform source cleanup.

For any existing position, the new release must reuse the same durable state and reconcile the actual Aster position/open orders/protection before evaluating a new signal. If reconciliation is not exact, FAIL_CLOSED and do not start new entries.

After the clean release is active, verify V12, PENGU V2, V52, shared risk and Margin Guard independently. Do not remove legacy files until this passes.

# Phase F — remove V96 runtime remnants from VPS

Only after the V96-free release is confirmed active:

- remove obsolete V96 systemd unit files and V96-only drop-ins
- `systemctl daemon-reload`
- verify no V96 unit is active, enabled or loadable as a trading service
- remove V96/V12 mutual-exclusion drop-ins/helpers that are now unnecessary
- remove the old V96-named credential env only after all active units use the verified neutral secret env
- remove V96-only active state paths from production configuration
- preserve old V96 state as a read-only forensic archive rather than feeding it to any live service; do not treat archived state as active
- do not delete V12/PENGU/V52 state merely because it resides under a historically V96-named directory until it has been verified migrated to the neutral state root

# Final acceptance

Final production composition must be exactly:

- V12 LIVE
- PENGU V2 LIVE
- V52 LIVE
- shared account order lock
- shared crypto risk
- shared Kill Switch
- shared portfolio Gross/Margin Guard
- Aster adapter
- V52 reference service

No V96 trading service or executable production dependency remains.

Required final report:

```text
STATUS: V12_LIVE_V96_DECOMMISSIONED

ACTIVATION_SHA=<40-char>
DECOMMISSION_SHA=<40-char>
CURRENT_RELEASE=<path>

V12_LIVE_STARTED=TRUE
V12_SERVICE_ACTIVE=TRUE
V12_RESTART_RECONCILIATION_PASS=TRUE
PENGU_V2_RUNNING=TRUE
V52_RUNNING=TRUE
SHARED_CRYPTO_RISK_RUNNING=TRUE
FULL_UNIVERSE_MARGIN_GUARD_RUNNING=TRUE

V96_SERVICE_PRESENT=FALSE
V96_SERVICE_ENABLED=FALSE
V96_PROCESS_COUNT=0
V96_EXECUTABLE_SOURCE_DEPENDENCIES=0
V96_MUTUAL_EXCLUSION_INTERLOCK_REQUIRED=FALSE
V96_LEGACY_SECRET_ENV_ACTIVE=FALSE

CRYPTO_GROSS_CAP=1.5
STOCK_GROSS_CAP=1.5
PORTFOLIO_GROSS_CAP=2.5
V12_GROSS_CAP=1.0
PENGU_GROSS_CAP=0.75

V12_PENGU_CRYPTO_DAILY_LOSS=5%
V52_DAILY_LOSS=3.5%
KILL_SWITCH_STICKY=TRUE
V52_REFERENCE_GATES_UNCHANGED=TRUE

ORDERS_SENT_FOR_TESTING=0
ARTIFICIAL_LIVE_ORDERS=0
```

If any final field cannot be proven, report the exact blocker and remain FAIL_CLOSED. Do not use `V12_LIVE_V96_DECOMMISSIONED` as a partial-success label.
