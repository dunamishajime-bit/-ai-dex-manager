# ChatGPT Plus VPS Runner Handoff

## Codex instruction — execute this, do not redesign it

Use the existing implementation on `codex/research-trade-history-sync-pr98`. Fetch the remote branch first and treat its current remote HEAD as authoritative.

The GitHub-side implementation is already written. Do **not** replace it with a new architecture. Review it, make only required VPS-specific or correctness fixes, install the repository-dedicated self-hosted runner on the production VPS, configure the listed repository variables and protected environment, and complete the no-order/no-restart end-to-end checks below.

```bash
git fetch origin codex/research-trade-history-sync-pr98
git checkout codex/research-trade-history-sync-pr98
git reset --hard origin/codex/research-trade-history-sync-pr98
bash -n scripts/ops/vps-common.sh
bash -n scripts/ops/vps-deploy-ui.sh
bash -n scripts/ops/vps-deploy-trading-code.sh
bash -n scripts/ops/vps-restart-trading-approved.sh
node --check scripts/ops/vps-inspection.mjs
node --check scripts/ops/vps-trading-restart-gate.mjs
node scripts/ops/vps-ops-selftest.mjs
```

## Goal

With ChatGPT Plus and no custom MCP, support this operator-directed flow through GitHub:

1. ChatGPT updates `ops/requests/vps-inspection-request.json`.
2. The VPS self-hosted runner performs a read-only inspection.
3. Sanitized JSON/Markdown results are stored in the Actions summary and artifact.
4. ChatGPT reviews the result and changes GitHub code.
5. ChatGPT updates the UI or trading-code request file.
6. The runner tests and deploys the exact workflow commit SHA.
7. The runner performs a post-deploy read-only inspection.
8. Trading code staging never restarts the live daemon.
9. A trading daemon restart remains a separate manual, protected-environment action.

## GitHub implementation already present

### Request files

- `ops/requests/vps-inspection-request.json`
- `ops/requests/ui-deploy-request.json`
- `ops/requests/trading-code-deploy-request.json`

The request files accept only fixed fields. They do not accept commands, paths, service names, or arbitrary shell text. For a GitHub-triggered deployment, `targetCommit` must remain `workflow-head`; the exact deployed SHA is `github.sha` from the request commit.

### Workflows

- `.github/workflows/inspect-vps.yml`
- `.github/workflows/deploy-ui-vps.yml`
- `.github/workflows/deploy-trading-code-vps.yml`
- `.github/workflows/restart-trading-approved.yml`
- `.github/workflows/vps-ops-static-ci.yml`

All VPS jobs require the fixed runner labels:

```yaml
runs-on: [self-hosted, linux, x64, disdex-vps]
```

The VPS workflows must not gain `pull_request`, `issue_comment`, or arbitrary external-input execution triggers. The repository is public, so this restriction and protected branches are security-critical.

### Fixed scripts

- `scripts/ops/vps-common.sh`
- `scripts/ops/vps-inspection.mjs`
- `scripts/ops/vps-deploy-ui.sh`
- `scripts/ops/vps-deploy-trading-code.sh`
- `scripts/ops/vps-trading-restart-gate.mjs`
- `scripts/ops/vps-restart-trading-approved.sh`
- `scripts/ops/vps-ops-selftest.mjs`

The implementation intentionally uses fixed scripts and allowlisted service managers instead of accepting shell commands from workflow inputs.

## Codex VPS tasks

### 1. Discover and record the real VPS values

Over the existing SSH connection, identify without changing trading behavior:

- deployed repository absolute path;
- combined runtime-state absolute path;
- UI service manager and exact service/process name;
- trading service manager and exact service/process name;
- UI health URL;
- API health URL;
- trading health URL;
- exact path to `systemctl` when systemd is used;
- existing deployment user, ownership and permissions;
- current deployed SHA, service PIDs, positions/Open Orders safety state and Kill Switch state.

Do not print `.env`, API keys, private keys, signatures, approval values, cookies or authorization headers.

### 2. Install a repository-dedicated runner

- Create or use a dedicated unprivileged Linux account such as `disdex-runner`.
- Register the runner for `dunamishajime-bit/-ai-dex-manager` only.
- Add the custom label `disdex-vps`.
- Install it as a boot-persistent service.
- Do not run it as root.
- Do not share this runner with other repositories.
- Ensure only trusted protected branches can modify or invoke VPS workflows.
- Prefer an ephemeral/replaceable runner setup if practical; otherwise document update and removal procedures.

Do not commit the runner registration token. Delete transient registration material after setup.

### 3. Configure repository variables

Set these GitHub Actions repository variables using the real VPS values:

| Variable | Meaning |
|---|---|
| `VPS_APP_DIR` | Absolute path of the deployed Git working tree |
| `VPS_STATE_ROOT` | Absolute combined V96/V52 runtime-state root |
| `VPS_OPS_STATE_DIR` | Runner-owned operations state directory, recommended `/var/lib/disdex-ops` |
| `VPS_UI_SERVICE_MANAGER` | Exactly `systemd` or `pm2` |
| `VPS_UI_SERVICE` | Exact UI service/process name |
| `VPS_TRADING_SERVICE_MANAGER` | Exactly `systemd` or `pm2` |
| `VPS_TRADING_SERVICE` | Exact V96/V52 service/process name |
| `VPS_UI_HEALTH_URL` | UI URL returning HTTP 2xx |
| `VPS_API_HEALTH_URL` | API/health URL returning HTTP 2xx |
| `VPS_TRADING_HEALTH_URL` | Trading service health URL returning HTTP 2xx |
| `VPS_ENABLE_APPROVED_TRADING_RESTART` | Keep `false` during setup and all requested E2E tests |

No secret belongs in these variables. Existing trading credentials and LIVE gates remain only on the VPS.

### 4. Configure filesystem ownership

- The runner user must be able to fetch and check out exact SHAs in `VPS_APP_DIR`.
- The runner user must own `VPS_OPS_STATE_DIR` with mode `0700`.
- The runner must not be granted read access to unrelated private files.
- Existing `.env` and runtime state stay untracked and are never copied into Actions artifacts.
- Do not change the runtime-state schema or clear/recreate state as part of setup.

### 5. Configure minimal sudo

Only when systemd requires it, grant exact passwordless commands for the configured services. Resolve the actual `systemctl` path first. Use no wildcard service names and no general shell/root grant.

Conceptual example only — replace paths and service names with the exact VPS values:

```sudoers
disdex-runner ALL=(root) NOPASSWD: /usr/bin/systemctl reload-or-restart exact-ui.service
disdex-runner ALL=(root) NOPASSWD: /usr/bin/systemctl restart exact-trading.service
```

Forbidden sudo permissions include unrestricted `systemctl`, editors, shells, `sudo -i`, package managers, `cp`, `mv`, `rm`, `chown`, `chmod`, or wildcard command arguments.

### 6. Configure protected restart environment

Create the GitHub Environment `trading-production` and require the repository owner/operator as reviewer. Keep `VPS_ENABLE_APPROVED_TRADING_RESTART=false` until the operator separately decides to enable live restart capability.

The restart workflow must stay manual-only and must retain all three gates:

1. protected `trading-production` environment approval;
2. exact staged/deployed SHA match;
3. exact phrase `I_APPROVE_LIVE_TRADING_DAEMON_RESTART`.

Do not run the restart workflow during this setup.

## Required review points

Review and fix only genuine issues in the existing implementation:

1. Confirm the actual VPS service manager/name combinations work with `vps-common.sh`.
2. Confirm UI reload cannot target the trading service.
3. Confirm `vps-deploy-trading-code.sh` contains no restart path and verifies the trading PID/state did not change.
4. Confirm official V52/V96 preflight sends zero orders and prints both `PASS_NO_ORDERS_SENT` and `"ordersSent": false`.
5. Confirm preflight does not clear the Kill Switch, delete pending state, fabricate order truth or alter strategy thresholds.
6. Confirm inspection never reads `.env` and artifacts contain no secrets or raw account credentials.
7. Confirm runtime-state scanning fails closed on invalid JSON and never writes to runtime state.
8. Confirm deployment refuses tracked VPS modifications rather than overwriting them.
9. Confirm exact SHA fetch/checkout and rollback work with the real repository remote.
10. Confirm concurrent deployments are blocked by the global lock.
11. Confirm the public repository cannot execute VPS jobs from pull requests or forks.
12. Confirm Actions artifact upload and GitHub network access work from the VPS.

If the real VPS layout requires a small code change, make the narrowest safe change and add it to `vps-ops-selftest.mjs`. Do not replace fixed scripts with arbitrary workflow inputs.

## End-to-end validation — no orders and no trading restart

Perform the following in order:

### A. Static validation

Run all syntax checks and `node scripts/ops/vps-ops-selftest.mjs`. Confirm `VPS Operations Static Safety CI` passes.

### B. Read-only inspection

Update only the inspection request ID/time and run `VPS Read-Only Inspection`.

Verify the artifact contains:

- deployed SHA and target comparison;
- tracked Git status;
- important file hashes;
- Node/npm/Python versions;
- UI and trading service state/PID;
- UI/API HTTP status;
- sanitized ERROR/WARNING summary;
- CPU, memory and disk summary;
- Kill Switch/pending/manual-review indicators;
- last recorded no-order preflight status;
- explicit `ordersSent=false`, `positionsChanged=false`, `servicesRestarted=false`, `runtimeStateEdited=false`.

### C. UI deployment test

Use a harmless UI-only change or an already-approved UI SHA. Set `enabled=true` in `ui-deploy-request.json` only for the trigger commit.

Verify:

- exact SHA checkout;
- `npm ci`, typecheck and build pass;
- only the UI service reloads;
- UI/API return HTTP 2xx;
- trading PID is unaffected;
- post-deploy inspection reports the new SHA;
- rollback works in a controlled non-production-impacting test or is otherwise dry-run verified safely.

After the run, return the request template to `enabled=false` in a separate commit.

### D. Trading code staging test

Set `enabled=true` in `trading-code-deploy-request.json` only for the trigger commit.

Verify:

- full V96/V52 safety suite passes;
- exact SHA is staged;
- authenticated no-order preflight passes;
- the output explicitly says no orders were sent;
- trading service state and PID are unchanged;
- no restart command occurs;
- post-deploy inspection reports the staged SHA;
- `trading-staged.sha` and `trading-last-preflight.json` are written only under `VPS_OPS_STATE_DIR`.

After the run, return the request template to `enabled=false` in a separate commit.

### E. Do not execute live restart

Do not enable or execute `.github/workflows/restart-trading-approved.yml` in this task. Validate it statically and report the remaining operator step.

## Strategy and production invariants

Do not change:

- V96 entry logic, symbol selection, Strong Boost, PENGU behavior or ETH one-time skip;
- Crypto Gross cap `1.0`;
- V11 entry basis `50 bps` and New York schedule;
- V50 entry basis `75 bps`, `11:30`, `12:30`, `13:30` New York windows, three-hour limit, convergence `15 bps`, basis stop `1.5x`;
- V11 slot `1.0`, V50 slot `1.0`, Stock cap `1.5`, Portfolio cap `2.5`;
- same-symbol concurrency prohibition and V96 Margin Priority;
- Daily Loss `2%`, Kill Switch, One-way Mode, double LIVE gate, idempotency, pending recovery and `closeUnmanagedPositions=false`;
- V13D and Hyperliquid disabled status.

## Absolute prohibitions

- No real order.
- No position change.
- No Kill Switch clearing.
- No direct runtime-state edit.
- No production trading daemon restart or stop.
- No `.env`, key, token, approval value, runtime state or raw log commit.
- No arbitrary shell input in Actions.
- No unrestricted sudo.
- No PR #98 merge or retarget.
- No strategy threshold modification.

## Completion report

Report exactly:

1. remote branch HEAD at start and final commit SHA;
2. files changed and why;
3. runner name, version, service status and labels;
4. runner Linux user and directory permissions;
5. configured repository variables with values redacted where appropriate;
6. exact sudoers command allowlist, with no secrets;
7. protected environment status;
8. static CI result and run URL;
9. inspection run result and artifact name;
10. UI deployment test result and rollback evidence;
11. trading code staging/no-order preflight result;
12. before/after deployed SHA and service PIDs;
13. proof of zero trading restarts, zero orders, zero position changes, zero Kill Switch changes and zero direct runtime-state edits;
14. remaining manual operator action for enabling approved live restart.
