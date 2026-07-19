#!/usr/bin/env bash
set -euo pipefail

DEPLOY_MODE="${DISDEX_V46_DEPLOY_MODE:-paper}"
SERVICE_NAME="${DISDEX_V46_SERVICE_NAME:-disdex-v46-paper}"
OLD_SERVICE_NAME="${DISDEX_V46_OLD_SERVICE_NAME:-}"
REPO_ROOT="${DISDEX_V46_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${DISDEX_V46_ENV_FILE:-${REPO_ROOT}/.env}"
RUN_USER="${DISDEX_V46_RUN_USER:-${SUDO_USER:-$(id -un)}}"
NPM_BIN="${DISDEX_V46_NPM_BIN:-$(command -v npm)}"
SYSTEMD_DIR="${DISDEX_V46_SYSTEMD_DIR:-/etc/systemd/system}"
UNIT_PATH="${SYSTEMD_DIR}/${SERVICE_NAME}.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo/root so systemd can be updated." >&2
  exit 1
fi
if [[ "${DEPLOY_MODE}" != "paper" ]]; then
  echo "V46 installation is PAPER-only. Live deployment is blocked by repository policy." >&2
  exit 1
fi
if [[ ! -d "${REPO_ROOT}/.git" ]]; then
  echo "Repository root not found: ${REPO_ROOT}" >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Environment file not found: ${ENV_FILE}" >&2
  exit 1
fi
if [[ -z "${NPM_BIN}" || ! -x "${NPM_BIN}" ]]; then
  echo "npm executable not found." >&2
  exit 1
fi
if grep -Eq 'liveTradingEnabled:[[:space:]]*true' "${REPO_ROOT}/config/disdexV46Runtime.ts"; then
  echo "Unexpected V46 live flag detected. Refusing Paper deployment until reviewed." >&2
  exit 1
fi

cd "${REPO_ROOT}"
git diff --quiet && git diff --cached --quiet || {
  echo "Working tree is dirty; refusing deployment." >&2
  git status --short >&2
  exit 1
}

sudo -u "${RUN_USER}" "${NPM_BIN}" ci
sudo -u "${RUN_USER}" "${NPM_BIN}" run strategy:disdex-v46:selftest
sudo -u "${RUN_USER}" "${NPM_BIN}" run strategy:disdex-v46:typecheck
sudo -u "${RUN_USER}" "${NPM_BIN}" run strategy:disdex-v35:runner:typecheck
sudo -u "${RUN_USER}" "${NPM_BIN}" run strategy:live:typecheck
sudo -u "${RUN_USER}" "${NPM_BIN}" run build

cat > "${UNIT_PATH}" <<UNIT
[Unit]
Description=Dis-Dex Manager V35 Core plus PENGU V46 Dual Engine (paper)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REPO_ROOT}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=DISDEX_V46_RUNNER_MODE=paper
Environment=DISDEX_V46_LIVE_EXECUTION_ENABLED=false
Environment=DISDEX_V46_STATE_DIR=${REPO_ROOT}/.runtime-state/disdex-v46
Environment=DISDEX_V46_CLOSE_UNMANAGED_POSITIONS=true
ExecStart=${NPM_BIN} run strategy:disdex-v46:daemon
Restart=on-failure
RestartSec=10
KillSignal=SIGTERM
TimeoutStopSec=60
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"

# An old Paper service is stopped only when its exact unit name is explicitly supplied.
# This prevents V35 and V46 from controlling the same Paper portfolio concurrently.
if [[ -n "${OLD_SERVICE_NAME}" ]]; then
  if [[ "${OLD_SERVICE_NAME}" == "${SERVICE_NAME}" ]]; then
    echo "Old and new service names must differ." >&2
    exit 1
  fi
  if systemctl list-unit-files "${OLD_SERVICE_NAME}.service" --no-legend 2>/dev/null | grep -q "${OLD_SERVICE_NAME}"; then
    systemctl stop "${OLD_SERVICE_NAME}.service"
    systemctl disable "${OLD_SERVICE_NAME}.service" || true
  else
    echo "Requested old service was not found: ${OLD_SERVICE_NAME}.service" >&2
    exit 1
  fi
fi

systemctl restart "${SERVICE_NAME}.service"
sleep 3
systemctl --no-pager --full status "${SERVICE_NAME}.service"
journalctl -u "${SERVICE_NAME}.service" -n 100 --no-pager
