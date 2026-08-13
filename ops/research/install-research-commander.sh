#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo 'ROOT_REQUIRED' >&2
  exit 77
fi

RELEASE="${1:-}"
[[ "${RELEASE}" =~ ^/home/deploy/disdex-trading/releases/[0-9a-f]{40}$ ]] || { echo 'IMMUTABLE_RELEASE_REQUIRED' >&2; exit 64; }
[[ -d "${RELEASE}" && ! -L "${RELEASE}" ]] || { echo 'RELEASE_INVALID' >&2; exit 65; }
[[ "$(tr -d '[:space:]' < "${RELEASE}/.disdex-release-sha")" == "${RELEASE##*/}" ]] || { echo 'RELEASE_MARKER_MISMATCH' >&2; exit 66; }

APP_SRC="${RELEASE}/apps/disdex-research-commander"
APP_DST='/home/deploy/disdex-research-commander'
ENV_FILE='/etc/disdex-research-commander.env'
UNIT_SRC="${RELEASE}/ops/disdex-research-commander.service"
UNIT_DST='/etc/systemd/system/disdex-research-commander.service'

[[ -d "${APP_SRC}" && -f "${APP_SRC}/server.mjs" && -f "${APP_SRC}/package.json" && -d "${APP_SRC}/node_modules" ]] || { echo 'RESEARCH_APP_NOT_READY' >&2; exit 67; }
[[ -f "${ENV_FILE}" && ! -L "${ENV_FILE}" ]] || { echo 'RESEARCH_ENVIRONMENT_FILE_REQUIRED' >&2; exit 68; }
[[ "$(stat -c '%U:%G:%a' "${ENV_FILE}")" == 'root:root:600' ]] || { echo 'RESEARCH_ENVIRONMENT_PERMISSIONS_INVALID' >&2; exit 69; }
[[ -f "${UNIT_SRC}" ]] || { echo 'RESEARCH_UNIT_MISSING' >&2; exit 70; }

if ! id -u disdex-research >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin disdex-research
fi

install -d -o disdex-research -g disdex-research -m 0750 "${APP_DST}"
find "${APP_DST}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a "${APP_SRC}/." "${APP_DST}/"
chown -R disdex-research:disdex-research "${APP_DST}"
find "${APP_DST}" -type d -exec chmod 0750 {} +
find "${APP_DST}" -type f -exec chmod 0640 {} +
install -o root -g root -m 0644 "${UNIT_SRC}" "${UNIT_DST}"
systemctl daemon-reload
systemctl enable disdex-research-commander.service >/dev/null

echo 'DISDEX_RESEARCH_COMMANDER_INSTALL_PASS'
echo 'serviceStarted=false'
echo 'productionPathsTouched=false'
echo 'liveServiceTouched=false'
echo 'ordersSent=false'
echo 'positionsChanged=false'

