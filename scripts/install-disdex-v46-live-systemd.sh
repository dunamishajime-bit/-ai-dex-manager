#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="disdex-v46-live.service"
REPO_ROOT="/home/deploy/ai-dex-manager-v46-live"
ENV_FILE="/home/deploy/ai-dex-manager/.env.local"
STATE_DIR="/home/deploy/ai-dex-manager-v46-live/.runtime-state/disdex-v46-live"
ACCOUNT_LOCK_DIR="/home/deploy"
RUN_USER="deploy"

if [ "$(id -u)" -ne 0 ]; then
  echo "This LIVE installer must run as root." >&2
  exit 1
fi

if [ ! -d "$REPO_ROOT" ] || [ ! -f "$REPO_ROOT/package.json" ]; then
  echo "LIVE repository is missing: $REPO_ROOT" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "LIVE EnvironmentFile is missing: $ENV_FILE" >&2
  exit 1
fi
if [ ! -x "$REPO_ROOT/node_modules/.bin/tsx" ]; then
  echo "Dependencies are not installed in the LIVE clone." >&2
  exit 1
fi

cd "$REPO_ROOT"
if ! grep -q 'mode: "LIVE"' config/disdexV46Runtime.ts; then
  echo "LIVE runtime mode is not present in the clean clone." >&2
  exit 1
fi
if ! grep -q 'liveTradingEnabled: true' config/disdexV46Runtime.ts; then
  echo "LIVE runtime code gate is not enabled." >&2
  exit 1
fi
if ! grep -q 'closeUnmanagedPositions: false' config/disdexV46Runtime.ts; then
  echo "closeUnmanagedPositions=false is required." >&2
  exit 1
fi
if ! grep -q 'DISDEX_V46_LIVE_EXECUTION_ENABLED' scripts/disdex-v46-live-runner.ts; then
  echo "LIVE double-gate runner is missing." >&2
  exit 1
fi
if ! grep -q 'function mode' scripts/disdex-v46-live-runner.ts; then
  echo "LIVE runner mode handling is missing." >&2
  exit 1
fi

active_units="$(systemctl list-units --type=service --state=active --no-legend 2>/dev/null || true)"
paper_units="$(printf '%s\n' "$active_units" | awk '{print $1}' | grep -Ei 'disdex.*(paper|v35)' || true)"
if [ -n "$paper_units" ]; then
  echo "An existing Dis-Dex Paper service is active; refusing to start LIVE: $paper_units" >&2
  exit 1
fi
other_live_units="$(printf '%s\n' "$active_units" | awk '{print $1}' | grep -Ei 'disdex.*live' | grep -Fvx "$SERVICE_NAME" || true)"
if [ -n "$other_live_units" ]; then
  echo "Another Dis-Dex LIVE service is active; refusing to start: $other_live_units" >&2
  exit 1
fi

install -d -o "$RUN_USER" -g "$RUN_USER" -m 700 "$STATE_DIR"

npm_bin="$(command -v npm)"
if [ -z "$npm_bin" ]; then
  echo "npm is not installed." >&2
  exit 1
fi

cat > "/etc/systemd/system/$SERVICE_NAME" <<UNIT
[Unit]
Description=Dis-Dex Manager V35 Core plus PENGU V46 LIVE
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=3
ConditionPathExists=$REPO_ROOT/package.json
ConditionPathExists=$ENV_FILE

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$REPO_ROOT
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
Environment=DISDEX_V46_RUNNER_MODE=live
Environment=DISDEX_V46_LIVE_EXECUTION_ENABLED=true
Environment=DISDEX_V46_MAX_GROSS=2
Environment=DISDEX_V46_CASH_RESERVE_PCT=2
Environment=DISDEX_V46_CLOSE_UNMANAGED_POSITIONS=false
Environment=DISDEX_V46_STATE_DIR=$STATE_DIR
Environment=DISDEX_V46_ACCOUNT_LOCK_DIR=$ACCOUNT_LOCK_DIR
ExecStart=$npm_bin run strategy:disdex-v46:daemon
Restart=on-failure
RestartSec=15
KillSignal=SIGTERM
TimeoutStopSec=60
NoNewPrivileges=true
PrivateTmp=true
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT

chmod 0644 "/etc/systemd/system/$SERVICE_NAME"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

systemctl is-enabled "$SERVICE_NAME"
systemctl is-active "$SERVICE_NAME"
