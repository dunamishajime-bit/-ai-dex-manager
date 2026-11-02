# DisDex route-neutral owner-approved deployment - preparation (2026-10-30)

**State:** SOURCE_READY / CI_READY / VPS_READONLY_AUDITED. OPERATOR PREFLIGHT
AND LIVE CUTOVER REMAIN BLOCKED BY MISSING OWNER ARTIFACTS AND EXISTING VPS
RELEASE-LINEAGE PERMISSIONS.

This PR unifies the deployment approval rules, safety gates, and audit
contract. It does **not** require every deployment to run through GitHub
Actions. GitHub Actions is the formal GPT/ChatGPT adapter; Codex may use the
direct SSH/operator-helper adapter. Both adapters must submit the same
route-neutral approval contract to the same root-owned VPS helper.

The source contains an explicit root-only execution boundary for the
first-stage `SHARED_CRYPTO_RISK_ONLY` scope. The PR branch baseline was
re-read at `31cfae65daabfbe07acd805925bc7c9e9db19c4d`; the final source SHA
for this preparation is `0fd02a5cce623fd3ce985ee86737e32998d92c12`. A
read-only VPS audit
did find the root wrapper and helper under `/usr/local`, but it did not find a
release for the PR branch and did not find the root-owned execution inputs.
The audit did not move a release symlink, change a position or protective
order, change Gross, change the Shared Risk limit, operate the Kill Switch,
submit an order, or claim `LIVE_VERIFIED`.

The installed helper component hashes observed on the VPS were:

| Component | SHA-256 |
| --- | --- |
| `disdex_unified_root_gate.py` | `0b2578d919a53c9d8cefe533c530e4703f461c674d57d1bcb67d686a208bf5b0` |
| `disdex_deployment_contract.py` | `955c2a983a7fe0cb0f10949dc8bb05546114dfc04f2b48b72ae2e475b9995fc8` |
| `disdex_deployment_plan.py` | `3fd3eb79285b2f2af536d6f7412753c7f4f6de8a18fe34bd7e42833fdd680371` |
| `disdex_owner_approval.py` | `9f033abce5cc2cc17b81d372a7421bde4c1b825cb21dc2720dc9d1f213d830f9` |

These hashes match the corresponding PR-302 source files currently under
audit, but they do not substitute for a final immutable release marker or an
owner-signed activation.

## 1. Common authorization contract

The approval is a short-lived Ed25519-signed grant. The owner enters the
password only on the owner's trusted device to unlock the encrypted private
key. The password and private key never enter GPT, Codex, GitHub, the VPS,
workflow inputs, repository files, or logs.

The signed grant uses schema `disdex-owner-deployment-approval/v2` and binds
all of the following:

| Field | Required rule |
| --- | --- |
| repository | `dunamishajime-bit/-ai-dex-manager` |
| deploymentTarget | `professional-dismanager.net` |
| operatorTarget | `DD1296_FINAL_ALLIN_10BPS` |
| sourceSha | exact lower-case 40-character immutable SHA |
| scope | one exact runner, Shared Risk-only, monitor-only, HP-only, full, or rollback scope |
| runner plan | canonical plan hash containing every runner SHA, UI SHA, monitor SHA and scope delta |
| route | exactly `GITHUB_ACTIONS` or `CODEX_SSH`; route is audit provenance, not extra authority |
| ordersEnabled | explicit boolean; never inferred from scope or route |
| operator | owner-approved operator identity |
| issuedAt/expiresAt | maximum five-minute window |
| nonce | root-side single-use replay journal |

The canonical plan uses schema `disdex-unified-deployment-plan/v2` and is
reconstructed from fresh runtime/systemd readback by the trusted root helper.
A repository copy is not venue truth. The helper must recompute the plan hash
and reject any mismatch before a mutation.

The plan explicitly carries `releaseRoots` for `runners`, `ui`, and
`monitor`. Runner releases use the canonical SHA-named production release
root. UI and monitor releases may have independent directory names, but each
must contain a root-owned, non-writable `.disdex-release-sha` marker matching
the corresponding SHA. A UI or monitor SHA is never silently looked up under
the Runner release root. Runner releases also fail closed when their
`node_modules` root is an external symlink; dependency closure must be
inside the immutable release or be provisioned as a separately pinned,
root-owned artifact.

The exact runner map includes:

`V12_V4`, `PENGU_V8`, `QUALITY102_CAUSAL_V1`, `V52`,
`FET_BRK48_RESIDUAL`, `HYPE_TREND_LONG`, `IDLE_PRIORITY_SHORT`,
`SHARED_CRYPTO_RISK`, and `MARGIN_GUARD`.

The approval is not valid if a caller changes the SHA, runner map, scope,
target, operator target, plan hash, route, order permission, or nonce after
signing.

The owner generates a token on the trusted device only. The command below is
illustrative; the private key path stays local and the token is transferred
only through the selected adapter's stdin. For the first Shared Risk-only
stage, `orders-enabled` must remain `false`.

```bash
python3 scripts/ops/deploy/disdex_owner_approval.py sign \
  --key /secure/local/disdex-owner-private.pem \
  --repository dunamishajime-bit/-ai-dex-manager \
  --deployment-target professional-dismanager.net \
  --operator-target DD1296_FINAL_ALLIN_10BPS \
  --sha EXACT_40_CHARACTER_SHA \
  --scope SHARED_CRYPTO_RISK_ONLY \
  --plan-sha256 CANONICAL_64_CHARACTER_PLAN_HASH \
  --operator OWNER_GITHUB_LOGIN \
  --route CODEX_SSH \
  --orders-enabled false
```

For the GPT route, use the same fields with `--route GITHUB_ACTIONS`. A
route-specific token cannot be replayed through the other adapter, while the
underlying target, scope, plan, order permission, and root safety checks stay
identical.

## 2. Shared safety gates for both routes

The root-owned helper is the final authority. It must fail closed unless all
of these checks pass:

1. The actual current release, runner-specific releases, release markers,
   systemd units, PIDs, working directories, health snapshots, runner pins,
   and heartbeat/tick readers agree with the submitted multi-SHA plan.
2. The requested scope is an exact subset of the plan delta. A Shared Risk
   deployment cannot change a peer runner, UI, monitor, or trading logic.
3. The target is the canonical XServer VPS and the operator target is the
   exact approved target. No arbitrary host, shell command, or alternate
   operator target is accepted.
4. A fresh signed Aster read-only proof, or an already accepted evidence
   record within the existing freshness policy, reconciles positions, open
   orders, protective STOP/TP ownership, pending exposure, and account lock.
   If the latest allowed venue proof is unavailable, preserve existing STOPs
   and do not grant new-order authority.
5. Shared Crypto Risk remains capped at **7.5% daily loss**. Gross caps,
   reservations, Margin Guard, Kill Switch state, API rate budget, account
   lock, and pending reconciliation must remain safe and unchanged outside
   the approved scope.
6. The old and new Shared Risk Writers cannot be active together. Unknown or
   partially reconciled STOPs are not classified as managed; the result is
   manual review/fail closed.
7. The helper has an immutable release marker, root-owned runner-pin
   manifest, single-use nonce record, and safe rollback target. Rollback must
   preserve existing protective orders and must not require a test order.
8. After a successful change, three read-only audit cycles verify runner
   SHA/PID/unit, actual tick versus supervisor heartbeat, positions and STOPs,
   Shared Risk/Gross/pending/API cooldown, Kill Switch, and HP truth.

`ordersEnabled=false` is the safe default. A route does not imply order
permission. If an existing production gate requires explicit order authority,
the helper must block until the owner signs a grant whose `ordersEnabled=true`
and the independent production gate accepts it. No approval may be expanded
from Shared Risk-only into trading permission.

## 3. GPT/ChatGPT deployment route: GitHub Actions

`.github/workflows/disdex-unified-production-deploy.yml` is the formal GPT
adapter. It is deliberately limited to `refs/heads/master`, the protected
`disdex-production` Environment, the configured allowed actor list, and the
owner-only Environment reviewer.

The workflow:

1. receives an exact SHA, exact scope, canonical plan hash, signed token, and
   explicit `orders_enabled` value;
2. verifies the grant as route `GITHUB_ACTIONS`, including target, operator
   target, plan hash, and order permission;
3. uses only the Environment-scoped SSH credential and pinned known hosts;
4. passes the signed token over stdin to the fixed root helper; and
5. never exposes a private key, password, general root shell, or arbitrary
   deployment command.

The protected Environment review is an additional Actions-specific control;
it does not replace the signed owner grant or the root helper's venue/risk
gates. A successful workflow dispatch without those gates is not a LIVE
approval.

## 4. Codex deployment route: direct SSH/operator helper

`scripts/ops/deploy/disdex_codex_ssh.py` is the Codex adapter. It is allowed
to use the existing formal direct-SSH/operator-helper route, but it is not a
general SSH shell. It accepts only:

- the canonical host `professional-dismanager.net`;
- a local identity file and pinned known-hosts file;
- an exact SHA, scope, plan hash, and explicit order permission; and
- the root SSH session as the route-specific authorization.

It constructs one fixed command for:

`/usr/local/sbin/disdex-unified-production-deploy`

with route `CODEX_SSH` and the fixed `--codex-ssh` mode. The root helper
requires an actual sshd connection (`SSH_CONNECTION` and `SSH_CLIENT`), the
root identity, the fixed `codex-ssh` operator, and the same multi-SHA plan,
release, venue, STOP, rollback, and audit gates as the Actions route. It does
not read an owner password or Ed25519 token. The root SSH credential is the
authentication for the Codex route; it is not a general shell because the
forced-command dispatcher accepts only the exact helper arguments.

The Actions route remains owner-token based. The two routes therefore share
the safety contract and audit schema, but do not require the same
authentication ceremony. Codex may perform source edits, CI, backtests,
staging, read-only audits, and direct LIVE mutation through this fixed helper.

Illustrative invocation (the identity and known-host files remain local and
are never committed or printed):

```bash
python3 scripts/ops/deploy/disdex_codex_ssh.py \
  --identity-file /secure/local/DisDex.pem \
  --known-hosts /secure/local/disdex-known-hosts \
  --sha EXACT_40_CHARACTER_SHA \
  --scope SHARED_CRYPTO_RISK_ONLY \
  --plan-sha256 CANONICAL_64_CHARACTER_PLAN_HASH \
  --orders-enabled false
```

The local SSH identity and known-host file remain private and are never
committed, uploaded, copied into a report, or included in command output. The
adapter does not read or request the owner's password.

## 5. Shared Risk-only first-stage boundary

The intended first-stage Shared Risk Writer change is explicitly limited to
the Shared Risk Writer and its state/ownership reconciliation. It must keep
the existing V4, Q102, V52, PENGU, FET, HYPE, and IDLE runner SHAs, positions,
STOPs, strategy conditions, and new-order permissions unchanged.

For `SHARED_CRYPTO_RISK_ONLY`:

- `ordersEnabled` must be `false` in both the plan and signed grant;
- the plan may change only `SHARED_CRYPTO_RISK`;
- existing STOPs and positions are preserved and re-read before/after;
- old/new Writer mutual exclusion is mandatory;
- the 7.5% daily loss limit, risk snapshot freshness/date/latch, pending
  registry, account lock, Gross and Kill Switch are rechecked; and
- a missing or stale venue proof blocks the cutover and grants no new order
  capability.

This scope must not invoke the existing all-runner
`disdex-current-runtime-wiring --apply` path. A Shared Risk approval is not
an approval to enable any Runner's trading orders.

## 6. Owner setup and secret boundaries

Before any LIVE enablement, the owner and authorized VPS operator must
independently complete the following. This PR does not claim that they are
complete:

1. Protect `master`, workflow files, approval code, and deployment policy.
2. Configure the owner-only `disdex-production` Environment for the Actions
   route; do not use repository-level broad root credentials.
3. Generate a new password-encrypted Ed25519 key on the owner's device and
   install only its public key in the protected Environment and the forced
   root helper.
4. The root wrapper/helper exists on the VPS, but its installed source must be
   re-verified against the final pushed PR SHA before execution. Before any
   execution, the owner/operator must still provision and independently
   certify the exact activation artifact, current plan, runner-pin manifest,
   owner public key, signed venue evidence, and rollback baseline. The source
   executor is mutation-capable only for `SHARED_CRYPTO_RISK_ONLY`; all other
   scopes remain fail-closed until their own transaction and audit
   implementation is certified.  The source-level
   `LIVE_EXECUTOR_CONTRACT_CERTIFIED` report now proves the Shared Risk
   transaction boundary (root authority, signed owner token, single-use nonce,
   fresh read-only venue evidence, peer preservation, rollback, and three audit
   cycles).  It is deliberately not a production grant: owner approval,
   current venue evidence, and post-cutover observations remain external
   requirements.
5. Verify the Codex adapter and Actions adapter against the same helper in a
   non-mutating or staging dry-run. Do not treat an HTTP 200, an anonymous HP
   page, or a source-only CI pass as production authentication.
6. Set `DISDEX_DEPLOYMENT_POLICY_READY=OWNER_ENV_LOCKED_V1` only after the
   above are independently evidenced and the existing production gate accepts
   the exact scope.

The following may exist only as protected Environment/operator configuration,
never in repository files or logs: SSH private key, owner password, venue
credentials, or token values. The repository may contain only the verifier,
fixed adapters, public policy, and tests.

### V4 evidence-refresh and release-loader boundary

PR #304 keeps V4 evidence refresh independent from trading authorization.  The
refresh lease is exact-SHA, V4-only, and always carries `ordersEnabled=false`.
An active lease cannot be extended or overwritten.  Once expired, replacement
requires a new owner-signed approval with a new nonce; a nonce digest recorded
in the expired lease is rejected even if the separate nonce journal is missing.
The refresh path cannot change `current`, runner pins, systemd Runner units,
orders, positions, STOPs, or Kill Switch state.

V4 Runner systemd, watchdog, and V4 health-alert wiring use the release-local
`node_modules/tsx/dist/cli.mjs` entrypoint.  V4 watchdog self-tests reject the
cross-release `.bin/tsx` shim, while peer Runner loader contracts remain
unchanged.  This keeps the process command, working directory, release marker,
health snapshot, and watchdog SHA on the same V4 release lineage.

## 7. Current VPS boundary

The read-only audit was captured on `x162-43-50-223` at
`2026-10-29T23:17:44Z`. The live `current` symlink remains pinned to
`7688ed7c93a1918d8b44837339b7da5584a868f5`, and the active SHA map was:

| Runner | Active systemd SHA | Main PID | Restart count |
| --- | --- | ---: | ---: |
| V12 V4 | `53a0be396719f0284af4e11b35c66a4ac7d58f79` | 806758 | 0 |
| Q102 | `ef1ab178e26a7bf5bddb6473467765edba242e1d` | 805183 | 0 |
| V52 | `97830672e2f139b39f7194166d7dc8c36e8c8933` | 1112659 | 0 |
| PENGU / FET / HYPE / IDLE / Shared Risk / Margin Guard | `7688ed7c93a1918d8b44837339b7da5584a868f5` | PENGU 3065213; FET 440551; HYPE 2269754; IDLE 3065918; Risk 3064641; Guard 3064744 | 0 except FET=3 |

The current symlink is `root:deploy` mode `777`; its release directory and
marker are `deploy:deploy` (directory mode `2755`, marker mode `644`). The
runner-specific releases for V4, Q102, and V52 have the same deploy-owned
lineage. The root gate therefore correctly rejects the current release as
production immutable lineage until an authorized operator establishes the
root-owned release contract. This report does not change those permissions.

The following root-owned execution inputs are not provisioned on the VPS:
`/etc/disdex/runner-pins.json`,
`/var/lib/disdex/unified-deploy/current-plan.json`, the owner public key,
nonce directory, scoped activation artifact, and before/after signed
read-only venue evidence.

The existing root-owned candidate `c9beb423ae9b6b18333ae9426a21a69cf35baeef`
has an immutable marker and the Shared Risk writer source, but it does not
contain the PR-302 unified root gate/deployment-plan sources. Its release
payload also contains group/other-writable files, so it is not accepted as a
complete immutable PR-302 activation target. It was not modified.

Aster read-only evidence was obtained without mutation in three spaced
rounds. All three rounds matched `DOGEUSDT` short `226` and one `BUY
STOP_MARKET` `reduceOnly=true` order for quantity `226` at stop price
`0.086960`, client id `v12-v4-98ded39746ed3502a4d7b0e26ef9`, status `NEW`,
and `executedQty=0`. Each round reported zero orders, cancels, and position
changes. This is venue evidence only, not an owner activation artifact. The
pending-exposure registry currently has zero non-`RELEASED` entries, but its
`updatedAt` is stale and both `activeCount` and `entriesCount` are null; it
therefore cannot be promoted to a formal fresh zero-pending proof.

The active Margin Guard readback was `stage=HEALTHY`, `ordersAllowed=true`,
and `consecutiveFailures=0`; Shared Risk was complete, untripped, and capped
at 7.5%; the Kill Switch was inactive with its existing V52 reference-only
reason preserved. The Aster global rate-budget record was read without
changing it. The shared heartbeat writer was current, but its runner
`lastTickAt` values were not uniformly current: V52/FET/V4 were fresh while
HYPE, PENGU, Q102, and IDLE were stale relative to the shared heartbeat.
This is a monitoring/preflight blocker, not a reason to alter or restart a
runner during this task.

Until those genuine operator artifacts and accepted venue evidence exist, the
helper must remain a staging/read-only installation. No token, approval date,
nonce, runner map, or venue proof may be copied or synthesized to make the
gate pass.

## 8. Legacy path retirement

`audit_legacy_deploy_paths.py` remains a read-only inventory. It found 10
workflow paths with VPS access and 9 retirement candidates. The candidates
are the older rate-budget recovery, full-order production/read-only audit,
Idle redeploy/read-only audit, PENGU normalization, remnant diagnostic,
Q102 deploy, and V4 history read-only audit workflows. The current
`disdex-unified-production-deploy.yml` is the only listed path marked as the
current policy path. The old write-capable workflows and broad SSH
references are not silently deleted by this PR. After both adapters, the
root helper, rollback, and three-cycle audit are independently proven, the
owner/operator must:

- remove or disable unrestricted write-capable Actions workflows;
- rotate/revoke broad repository-level root keys and obsolete VPS
  `authorized_keys`/sudo permissions;
- retain read-only audits and CI; and
- rerun the inventory with `--require-retired`.

If the new route is not independently verified, the safe state is to leave
the current LIVE release and existing protection in place, with new mutation
blocked.

## 9. Current PR status

This PR is source/CI work only. It has no root-owned helper installation,
operator activation artifact, GitHub Environment configuration, password
authentication, VPS deployment, release promotion, order, STOP change, Gross
change, Kill Switch operation, or LIVE audit. The correct status remains
`SOURCE_READY_NOT_LIVE` until those external gates are completed; if an
operator gate is requested without the required artifact, the result is
`BLOCKED_OPERATOR_AUTH`.

The final implementation/source commit is
`0fd02a5cce623fd3ce985ee86737e32998d92c12`. PR #302 remains OPEN and Draft
with merge state CLEAN. The branch may carry a later documentation-only
evidence commit; the exact current remote tip is always read back separately
and is not self-referenced here. The required checks passed at the
implementation commit:
production parity `40973489222`, V13D/V11-EQ/V96 runner validation
`40973489208`, owner authorization contract `40973489164`, margin risk
`40973489174`, source/runtime heartbeat contract `40973489288`, and VPS
release boundary `40973489180` (including the non-blocking historical
compatibility check). The branch is clean and `git diff --check` passes.

Read-only GitHub settings inspection found no configured
`disdex-production` Environment and no protection record for the base branch.
No repository settings were changed because creating owner-review rules or
granting deployment secrets requires the owner's GitHub administration and
reviewer identity.

## Root-gate implementation stage (source and staging boundary)

Source adds `scripts/ops/deploy/disdex_unified_root_gate.py` plus root wrapper
and an SSH authorized_keys forced-command dispatcher. The helper implements
both `--preflight-readonly` and an explicit `--execute` mode. The execute path
validates the owner grant, exact multi-SHA plan hash, root-only current plan,
root-owned `/etc/disdex/runner-pins.json`, immutable release markers, scoped
activation artifact, signed read-only venue evidence, target, scope, STOP
ownership metadata, and the 7.5% Shared Risk limit. It consumes a single-use
nonce only after the read-only checks pass, changes only the exact Shared Risk
unit, preserves the global `current` symlink and peer pins, and rolls back the
manifest and systemd state on any failed postcondition. Three advancing
read-only audit cycles are required before the helper emits a verified
receipt. Every receipt reports zero orders, cancels, and position changes.

The source implementation is not yet a production authentication proof. Do
not install or invoke `--execute` until the owner has independently provisioned
the root-owned activation artifact and venue evidence, protected the Actions
Environment, installed the public key, and approved the exact plan. Missing,
stale, copied, edited, replayed, or mismatched artifacts remain fail-closed.
Both Actions and Codex pass explicit owner identity and the fixed execution
mode to the same root gate.

## 10. Windows portability verification

The remaining Windows-only test failures were addressed without changing the
Linux production contract. The heartbeat writer retains mode `0750` on POSIX;
on Windows it uses the inherited user-writable ACL instead of asking
Microsoft Store Python to translate a POSIX mode into a restrictive ACL.
The heartbeat and VPS-retention tests use disposable user-writable fixtures on
Windows, while POSIX-only symlink coverage remains enabled on Linux and
explicitly skipped on Windows where the required privilege is unavailable.

The final local verification completed with 77 focused Python tests (`OK`, 28
platform/crypto-library skips) and 46 passing focused TypeScript tests (2
skips, 0 failures). The margin-guard self-test, release-evidence self-test,
research TypeScript compile, legacy-path inventory, and `git diff --check`
also passed. These are source and test results only; no VPS or venue state was
changed.

The complete Python unit-test discovery was also rerun after the final
portability fixes: `250 tests`, `OK (skipped=32)`. This included the Aster
global rate-budget lock/retry tests, V52 safety regressions, Idle/Q102
ownership, fill notification, margin guard, VPS/UI retention, and deployment
helper contracts. The Windows skips are limited to symlink fixtures requiring
the unavailable Windows symlink privilege. The Aster lock uses the inherited
Windows ACL only for Windows test/runtime portability; Linux keeps the
existing private-directory and shared-group permission behavior. No order,
cancel, position, STOP, or production state was changed.
