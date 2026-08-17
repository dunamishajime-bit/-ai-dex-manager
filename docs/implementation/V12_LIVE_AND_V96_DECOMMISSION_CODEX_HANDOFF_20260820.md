# V12 LIVE activation through V96 full decommission — FINAL Codex handoff

This file is the canonical handoff for the complete production job. Use the exact latest green SHA of branch `chatgpt/v12-live-adapter-final-20260817`. Do not stop at source readiness or deployment.

## Final target
- V12_X1.00_ALL — LIVE
- PENGU_DUAL_LS_V2_FINAL — LIVE
- V52 — LIVE
- V96 trading runtime — removed
- V96 executable production dependencies — removed
- V96/V12 migration interlocks — removed after V96 service removal

## Phase A — actual V12 activation
Use the canonical V3 activation path and command from the exact green Git object:

- `docs/implementation/V12_CODEX_MINIMAL_VPS_HANDOFF_20260820_V3.md`
- `scripts/ops/root/disdex-v12-live-activate-from-sha-v3`

No SHADOW period. No synthetic/artificial LIVE order. Do not weaken any risk/reference/Gross/freshness gate.

Do not continue to V96 deletion unless actual VPS evidence ends with:

`STATUS: LIVE_ACTIVATED_VERIFIED`

and proves V12/PENGU/V52/shared-risk/Margin Guard active, V96 inactive/disabled, runtime reconciliation PASS, V96/V12 simultaneous LIVE FALSE, and `ORDERS_SENT_FOR_TESTING=0`.

## Phase B — prove V96 can be decommissioned
Run:

`sudo /home/deploy/disdex-trading/current/scripts/ops/root/disdex-v96-runtime-decommission-readiness <ACTIVATED_SHA>`

Require:

`STATUS: V96_RUNTIME_DECOMMISSION_READY`

Do not infer V96 ownership from overlapping BTC/ETH/BNB/SOL symbols after V12 is live. V96 flatness must have been proved before V12 activation and V96 must have remained unable to create new exposure by the transition interlocks.

## Phase C — create a second immutable V96-free release
Create `codex/v96-decommission-after-v12-live-20260820` from the exact ACTIVATED SHA. Never rewrite/edit the activated immutable release.

Before deleting V96 code, neutralize shared functionality still carrying V96 names/dependencies. Preserve and keep fail-closed:

- account order lock/reservation
- shared crypto daily risk
- shared Kill Switch
- Aster adapter/executor
- portfolio Gross and Margin Guard
- V52 reference-quality gates
- V12 resident STOP/restart reconciliation

Mandatory neutralization:

1. Remove V12/PENGU/V52 runtime imports from `lib/disdex-v96-*` and `config/disdexV96Runtime.ts`.
2. PENGU Kill Switch migration must preserve or strengthen current schema/path/malformed-state fail-closed behavior. Do not replace a strict reader with a weaker neutral reader merely to remove the V96 name.
3. Rename shared `V96` env/config identifiers to neutral production names. Temporary compatibility aliases may exist only for verified migration; the final clean runtime must use neutral names.
4. If durable state identity/schema contains V96, implement an explicit one-time migration with backup, exact old/new validation, atomic write/rename, and zero trading actions.
5. Migrate active state roots atomically without resetting V12/PENGU/V52 positions, pending state, protection state, daily-risk state or audit continuity.
6. Move Aster/reference secrets from the V96-named env into a neutral root-owned env without printing secrets; verify every active unit uses the neutral env before retiring the legacy file.

Preferred neutral paths:

- `/etc/disdex/disdex-aster-production.env`
- `/var/lib/disdex/production`
- `/var/lib/disdex/production/kill-switch.json`
- `/var/lib/disdex/production/account-order.lock`
- `/var/lib/disdex/production/crypto-daily-risk.json`

After shared dependencies are neutral, remove V96-only executable runtime material: V96 runners/supervisors/runtime config/operator overrides/V96-only preflights and migration commands/V96 systemd units/V96 deploy-start scripts/V96 package scripts/V96-only CI/runtime contract tests. Remove V96↔V12 start interlocks only after the V96 trading service definitions no longer exist.

Historical docs/research may retain the string V96. Executable production paths may not.

Run:

`bash scripts/ops/disdex-v96-decommission-source-audit.sh . --expect-clean`

Require:

`STATUS: V96_DECOMMISSION_SOURCE_CLEAN`

## Phase D — CI and V96-free immutable SHA
Require all relevant tests to PASS: application TS build/typecheck, V12 frozen parity/live lifecycle/crash recovery/resident+trailing STOP, PENGU V2 typecheck/self-test/parity, shared crypto risk, Kill Switch schema/fail-closed parity, Node/Python priority/reservation/crash recovery, portfolio Gross caps, V52 contract/reference safety, full-universe Margin Guard, state/env migration tests, V96 source-clean audit, Linux production build.

Tests must not contain production Aster credentials and must send zero real orders.

Create a new immutable 40-char DECOMMISSION_SHA. Do not edit ACTIVATED_SHA in place.

## Phase E — switch to clean release without forced liquidation
Before switching, re-run current V12 final status, require no unresolved V12/PENGU/V52 pending order, validate shared risk/Kill Switch, and validate resident V12 protection for any open V12 position. Back up state/env without exposing secrets.

Do not force-liquidate positions merely for source cleanup. Restart into the clean release with the same durable state and first reconcile actual Aster positions/open orders/protection. Any mismatch => FAIL_CLOSED, no new entry.

Only after the clean release is verified active may legacy V96 VPS remnants be removed.

## Phase F — final VPS V96 removal
- remove obsolete V96 systemd unit files and V96-only drop-ins
- daemon-reload
- prove no V96 trading service is active, enabled or loadable
- remove V96/V12 mutual-exclusion helpers/drop-ins because V96 no longer exists
- retire the V96-named secret env only after neutral secret env use is verified
- remove V96-only active state paths from production configuration
- retain old V96 state only as read-only forensic archive if desired; never feed it to live services
- do not delete PENGU/V52/V12 live state just because the old path historically contained `v96`

## Prohibited
- source-only success label
- SHADOW observation period
- artificial LIVE order
- direct edit of an immutable release
- force-liquidating valid positions solely to remove V96 source
- V96 auto-restart
- unknown-position auto-adopt/auto-close
- UNKNOWN order resubmit under a different ID
- Kill Switch auto-clear
- risk/reference/Gross gate relaxation
- deleting old secret/state before the neutral replacement is actively verified
- deleting shared V52/PENGU/V12 functionality just because a filename/env currently contains V96

## Final acceptance
Do not use the final success label unless every field is proven:

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

If any field cannot be proven, report the exact blocker and remain FAIL_CLOSED. Partial completion is not `V12_LIVE_V96_DECOMMISSIONED`.
