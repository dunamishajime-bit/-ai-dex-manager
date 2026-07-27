# Split VPS Layout to Exact-SHA Atomic Releases

## Authority

This document supersedes the single-`VPS_APP_DIR` deployment assumptions in the earlier Plus runner handoff. The read-only VPS inspection found three independent locations:

| Purpose | Current path | Current provenance |
|---|---|---|
| Git source checkout | `/home/deploy/ai-dex-manager-v96-live` | Git SHA `a4529372...` during inspection |
| Trading execution directory | `/home/deploy/ai-dex-manager-v96-paper` | Not a Git working tree; exact running SHA is unverifiable |
| UI execution directory | `/home/deploy/ai-dex-manager-ui` | Git SHA `014ea910...`; `.next` build SHA is unverifiable |

The services observed without changes were:

- UI: PM2 process `ai-dex-manager-ui`, cwd `/home/deploy/ai-dex-manager-ui`, PID `344878` at inspection time.
- Trading: systemd `disdex-v96-v52-live.service`, WorkingDirectory `/home/deploy/ai-dex-manager-v96-paper`, PID `334855` at inspection time.
- Trading environment files: `/etc/disdex/disdex-v13d-v11eq-v96.env` and `/etc/disdex/disdex-v96-v52-live-overrides.env`.
- UI shared environment file: `/home/deploy/ai-dex-manager/.env.local`, currently linked from the legacy UI directory.
- Trading shared runtime state: `/home/deploy/ai-dex-manager-v96-paper/.runtime-state`.
- Trading shared approval path: `/home/deploy/ai-dex-manager-v96-paper/.runtime-approval`.

Do not claim an exact deployed SHA until both services run through release links containing `.disdex-release-sha` markers.

## Target layout

UI and trading use separate release roots so a UI deployment can never change the trading daemon's future code path.

```text
/home/deploy/disdex-ui/
  releases/<40-char-sha>/
  current -> releases/<sha>

/home/deploy/disdex-trading/
  releases/<40-char-sha>/
  current -> releases/<live-sha>
  staged  -> releases/<tested-sha>

/home/deploy/ai-dex-manager-v96-live/
  # source Git checkout used only to fetch and materialize exact commits
```

Each release contains a root-owned-by-runner immutable marker:

```text
.disdex-release-sha
```

The UI release links `.env.local` to the existing shared file. Trading releases link `.runtime-state` and `.runtime-approval` to the existing shared paths. Secrets and runtime state are never committed or copied into artifacts.

## Required repository variables

Configure these only after the repository-dedicated runner exists. The values below match the inspected VPS and the target layout.

| Variable | Value |
|---|---|
| `VPS_SOURCE_REPO_DIR` | `/home/deploy/ai-dex-manager-v96-live` |
| `VPS_UI_APP_DIR` | `/home/deploy/ai-dex-manager-ui` |
| `VPS_TRADING_APP_DIR` | `/home/deploy/ai-dex-manager-v96-paper` |
| `VPS_UI_RELEASES_DIR` | `/home/deploy/disdex-ui/releases` |
| `VPS_UI_CURRENT_LINK` | `/home/deploy/disdex-ui/current` |
| `VPS_UI_SHARED_ENV_FILE` | `/home/deploy/ai-dex-manager/.env.local` |
| `VPS_TRADING_RELEASES_DIR` | `/home/deploy/disdex-trading/releases` |
| `VPS_TRADING_CURRENT_LINK` | `/home/deploy/disdex-trading/current` |
| `VPS_TRADING_STAGED_LINK` | `/home/deploy/disdex-trading/staged` |
| `VPS_TRADING_SHARED_STATE_DIR` | `/home/deploy/ai-dex-manager-v96-paper/.runtime-state` |
| `VPS_TRADING_SHARED_APPROVAL_DIR` | `/home/deploy/ai-dex-manager-v96-paper/.runtime-approval` |
| `VPS_TRADING_PREFLIGHT_SERVICE_TEMPLATE` | `disdex-v96-v52-preflight@.service` |
| `VPS_OPS_STATE_DIR` | `/var/lib/disdex-ops` or another dedicated runner-owned directory |
| `VPS_CONTROL_HELPER` | `/usr/local/sbin/disdex-vps-control` |
| `VPS_STATE_ROOT` | The real combined state root identified on the VPS; do not guess from the legacy working directory |
| `VPS_UI_SERVICE_MANAGER` | `pm2` |
| `VPS_UI_SERVICE` | `ai-dex-manager-ui` |
| `VPS_TRADING_SERVICE_MANAGER` | `systemd` |
| `VPS_TRADING_SERVICE` | `disdex-v96-v52-live.service` |
| `VPS_UI_HEALTH_URL` | Existing HTTP-200 UI health URL |
| `VPS_API_HEALTH_URL` | Existing HTTP-200 API health URL |
| `VPS_TRADING_HEALTH_URL` | Existing trading health URL, if available |
| `VPS_DEPLOYMENT_LAYOUT_MODE` | Leave unset until migration is completed; then set exactly `split-atomic-v2` |
| `VPS_ENABLE_APPROVED_TRADING_RESTART` | Keep `false` during runner setup and layout migration preparation |

Repository variables are not secrets. Do not place API keys, environment-file contents, LIVE acknowledgements, cookies or runner registration tokens in repository variables.

## GitHub implementation

The branch contains:

- split-layout read-only inspection with source/UI/trading provenance;
- exact-SHA release materialization by `git archive`;
- atomic symlink replacement via temporary link plus `mv -Tf`;
- UI release switch, PM2 reload, health checks and automatic link rollback;
- trading release staging to `staged` only, with no live-link change and no daemon restart;
- authenticated preflight through the fixed systemd template `ops/systemd/disdex-v96-v52-preflight@.service`;
- a separate protected-environment restart workflow that switches `current` only after explicit approval;
- static tests that forbid in-place deployment, arbitrary shell inputs and trading restart during staging.

All mutation scripts fail closed unless `VPS_DEPLOYMENT_LAYOUT_MODE=split-atomic-v2` and the corresponding service working directory already points at its `current` link.

## One-time migration sequence

This sequence changes service configuration and must not be performed under the previous no-change instruction. Obtain a new explicit operator approval before starting it.

1. Register an unprivileged repository-dedicated self-hosted runner with label `disdex-vps`.
2. Configure only the read-only variables first and run `inspect-vps.yml`.
3. Install `scripts/ops/root/disdex-vps-control` as `/usr/local/sbin/disdex-vps-control`, owned by `root:root` and mode `0755`. Grant the runner account passwordless sudo only for that exact helper path. The helper hardcodes the inspected UI process, trading service and preflight template; do not replace it with unrestricted `systemctl`, `pm2`, shell or command arguments.
4. Install `ops/systemd/disdex-v96-v52-preflight@.service`; run `systemctl daemon-reload`. Do not start or restart the live trading service.
5. Create the release roots with `deploy:deploy` ownership and permissions that prevent unrelated users from writing them.
6. Materialize and fully test an exact GitHub SHA for the UI. Link its `.env.local` to the existing shared file.
7. Update the PM2 configuration to use `/home/deploy/disdex-ui/current`. The committed example is `ops/pm2/ai-dex-manager-ui.atomic.config.cjs.example`.
8. With explicit UI-change approval, initialize the UI `current` link, reload only `ai-dex-manager-ui`, and verify UI/API HTTP 200. Trading PID must remain unchanged.
9. Materialize and fully test an exact GitHub SHA for trading. Link `.runtime-state` and `.runtime-approval` to the existing shared paths. Run the authenticated no-order preflight through the template service.
10. Do not point the live trading service to the release yet. Record the exact SHA as staged and obtain a separate explicit approval for the one-time trading migration/restart.
11. Install the systemd drop-in based on `ops/systemd/disdex-v96-v52-live.atomic-override.conf.example`, so WorkingDirectory becomes `/home/deploy/disdex-trading/current`; run `systemctl daemon-reload`.
12. Immediately before the approved restart, re-check Kill Switch, pending/manual-review/UNKNOWN state, positions, Open Orders, Gross, exact staged SHA and no-order preflight.
13. Atomically initialize/switch `current` to the staged release and restart the trading service once. Verify PID change, active state, health and exact release marker. Do not clear a Kill Switch or edit runtime state.
14. Only after both services are proven release-aware, set `VPS_DEPLOYMENT_LAYOUT_MODE=split-atomic-v2`.
15. Keep `VPS_ENABLE_APPROVED_TRADING_RESTART=false` except during a specifically approved restart window.

## Runner registration and GitHub settings

GitHub CLI is optional. The runner can be registered from the repository's **Settings → Actions → Runners → New self-hosted runner** page using a short-lived registration token. Never paste that token into ChatGPT, a commit, an issue or an Actions log.

Repository variables can also be entered in **Settings → Secrets and variables → Actions → Variables** without GitHub CLI.

Protect the branches that can trigger VPS workflows. Because the repository is public, never add `pull_request`, `issue_comment`, fork-controlled triggers or arbitrary command/path inputs to a self-hosted VPS workflow.

## Required proof after migration

Report all of the following:

- final branch and commit SHA;
- runner name, service account and labels;
- repository variables by name and non-secret path value;
- source, UI current, trading current and trading staged release SHAs;
- service working directories and PIDs before/after each approved change;
- UI/API/trading health results;
- authenticated no-order preflight output containing `PASS_NO_ORDERS_SENT` and `ordersSent=false`;
- exact confirmation that no real order, position change, Kill Switch change or direct runtime-state edit occurred;
- any service reload/restart performed, including the explicit approval that authorized it.

## Fixed control helper and sudo boundary

The production runner must not receive general sudo access and must not manage the `deploy` user's PM2 daemon directly. Install the committed helper as root:

```bash
sudo install -o root -g root -m 0755 scripts/ops/root/disdex-vps-control /usr/local/sbin/disdex-vps-control
```

Create a sudoers rule for the dedicated runner account that permits only `/usr/local/sbin/disdex-vps-control` and validate it with `visudo -cf`. The helper exposes fixed actions for sanitized UI/trading status, cwd, logs, UI reload, authenticated preflight and explicitly approved trading restart. It accepts no service name, path or shell command from GitHub inputs.
