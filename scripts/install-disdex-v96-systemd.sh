#!/usr/bin/env bash
set -euo pipefail

DEPLOY_MODE="${DISDEX_V96_DEPLOY_MODE:-paper}"
SERVICE_NAME="${DISDEX_V96_SERVICE_NAME:-disdex-v96-${DEPLOY_MODE}}"
OLD_SERVICE_NAME="${DISDEX_V96_OLD_SERVICE_NAME:-}"
REPO_ROOT="${DISDEX_V96_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${DISDEX_V96_ENV_FILE:-${REPO_ROOT}/.env}"
RUN_USER="${DISDEX_V96_RUN_USER:-${SUDO_USER:-$(id -un)}}"
NPM_BIN="${DISDEX_V96_NPM_BIN:-$(command -v npm)}"
SYSTEMD_DIR="${DISDEX_V96_SYSTEMD_DIR:-/etc/systemd/system}"
UNIT_PATH="${SYSTEMD_DIR}/${SERVICE_NAME}.service"
STATE_DIR="${DISDEX_V96_STATE_DIR:-${REPO_ROOT}/.runtime-state/disdex-v96}"
FORWARD_FILE="${DISDEX_V96_FORWARD_EVIDENCE_FILE:-${REPO_ROOT}/.runtime-approval/disdex-v96-forward.json}"
PARITY_FILE="${DISDEX_V96_EXECUTION_PARITY_FILE:-${REPO_ROOT}/.runtime-approval/disdex-v96-parity.json}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo/root so systemd can be updated." >&2
  exit 1
fi
if [[ "${DEPLOY_MODE}" != "paper" && "${DEPLOY_MODE}" != "live" ]]; then
  echo "DISDEX_V96_DEPLOY_MODE must be paper or live." >&2
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

cd "${REPO_ROOT}"
git diff --quiet && git diff --cached --quiet || {
  echo "Working tree is dirty; refusing deployment." >&2
  git status --short >&2
  exit 1
}

sudo -u "${RUN_USER}" "${NPM_BIN}" ci
sudo -u "${RUN_USER}" "${NPM_BIN}" run strategy:disdex-v96:selftest
sudo -u "${RUN_USER}" "${NPM_BIN}" run strategy:disdex-v96:typecheck
sudo -u "${RUN_USER}" "${NPM_BIN}" run strategy:disdex-v46:selftest
sudo -u "${RUN_USER}" "${NPM_BIN}" run strategy:disdex-v46:typecheck
sudo -u "${RUN_USER}" "${NPM_BIN}" run strategy:disdex-v35:runner:typecheck
sudo -u "${RUN_USER}" "${NPM_BIN}" run build

LIVE_ENABLED=false
LIVE_ACK=""
if [[ "${DEPLOY_MODE}" == "live" ]]; then
  if ! grep -Eq 'liveTradingEnabled:[[:space:]]*true' "${REPO_ROOT}/config/disdexV96Runtime.ts"; then
    echo "V96 repository liveTradingEnabled is false. Forward and parity approval have not promoted this build." >&2
    exit 1
  fi
  if [[ ! -s "${FORWARD_FILE}" ]]; then
    echo "V96 Forward Evidence approval file is missing or empty: ${FORWARD_FILE}" >&2
    exit 1
  fi
  if [[ ! -s "${PARITY_FILE}" ]]; then
    echo "V96 execution-parity approval file is missing or empty: ${PARITY_FILE}" >&2
    exit 1
  fi
  LIVE_ENABLED=true
  LIVE_ACK="I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK"
fi

mkdir -p "${STATE_DIR}"
chown -R "${RUN_USER}:${RUN_USER}" "${STATE_DIR}"
chmod 700 "${STATE_DIR}"

cat > "${UNIT_PATH}" <<UNIT
[Unit]
Description=Dis-Dex Manager V96 Reserved PENGU (${DEPLOY_MODE})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REPO_ROOT}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=DISDEX_V96_RUNNER_MODE=${DEPLOY_MODE}
Environment=DISDEX_V96_LIVE_EXECUTION_ENABLED=${LIVE_ENABLED}
Environment=DISDEX_V96_LIVE_ACKNOWLEDGEMENT=${LIVE_ACK}
Environment=DISDEX_V96_STATE_DIR=${STATE_DIR}
Environment=DISDEX_V96_FORWARD_EVIDENCE_FILE=${FORWARD_FILE}
Environment=DISDEX_V96_EXECUTION_PARITY_FILE=${PARITY_FILE}
Environment=DISDEX_V96_CLOSE_UNMANAGED_POSITIONS=false
ExecStart=${NPM_BIN} run strategy:disdex-v96:daemon
Restart=on-failure
RestartSec=10
KillSignal=SIGTERM
TimeoutStopSec=60
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${STATE_DIR}

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"

# Another Dis-Dex service is stopped only when its exact unit name is explicitly supplied.
# This avoids accidental changes to unrelated services while preventing two runners from
# controlling the same Aster account when the operator intentionally performs a handoff.
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
