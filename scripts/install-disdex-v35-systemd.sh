#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${DISDEX_V35_SERVICE_NAME:-disdex-v35}"
OLD_SERVICE_NAME="${DISDEX_V35_OLD_SERVICE_NAME:-}"
REPO_ROOT="${DISDEX_V35_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${DISDEX_V35_ENV_FILE:-${REPO_ROOT}/.env}"
RUN_USER="${DISDEX_V35_RUN_USER:-$(id -un)}"
NPM_BIN="${DISDEX_V35_NPM_BIN:-$(command -v npm)}"
SYSTEMD_DIR="${DISDEX_V35_SYSTEMD_DIR:-/etc/systemd/system}"
UNIT_PATH="${SYSTEMD_DIR}/${SERVICE_NAME}.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo/root so systemd can be updated." >&2
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
if ! grep -Eq '^ASTER_USER_ADDRESS=.+' "${ENV_FILE}"; then
  echo "ASTER_USER_ADDRESS is missing from ${ENV_FILE}." >&2
  exit 1
fi
if ! grep -Eq '^ASTER_API_PRIVATE_KEY=.+' "${ENV_FILE}"; then
  echo "ASTER_API_PRIVATE_KEY is missing from ${ENV_FILE}." >&2
  exit 1
fi

cd "${REPO_ROOT}"
git diff --quiet && git diff --cached --quiet || {
  echo "Working tree is dirty; refusing deployment." >&2
  git status --short >&2
  exit 1
}

npm ci
npm run strategy:disdex-v35:selftest
npm run strategy:disdex-v35:runner:selftest
npm run strategy:disdex-v35:runner:typecheck
npm run strategy:live:typecheck
npm run build

cat > "${UNIT_PATH}" <<UNIT
[Unit]
Description=Dis-Dex Manager V35 Aster Portfolio Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REPO_ROOT}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=DISDEX_V35_RUNNER_MODE=live
Environment=DISDEX_V35_LIVE_EXECUTION_ENABLED=true
Environment=DISDEX_V35_STATE_DIR=${REPO_ROOT}/.runtime-state/disdex-v35
Environment=DISDEX_V35_CLOSE_UNMANAGED_POSITIONS=true
ExecStart=${NPM_BIN} run strategy:disdex-v35:daemon
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

if [[ -n "${OLD_SERVICE_NAME}" ]]; then
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
journalctl -u "${SERVICE_NAME}.service" -n 80 --no-pager
