#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ROOT_REQUIRED" >&2
  exit 77
fi

RELEASE="${1:-}"
if [[ -z "${RELEASE}" || ! -d "${RELEASE}" || -L "${RELEASE}" ]]; then
  echo "IMMUTABLE_RELEASE_REQUIRED" >&2
  exit 78
fi

MARKER="${RELEASE}/.disdex-release-sha"
if [[ ! -f "${MARKER}" || ! "$(tr -d '[:space:]' < "${MARKER}")" =~ ^[0-9a-f]{40}$ ]]; then
  echo "RELEASE_MARKER_INVALID" >&2
  exit 78
fi

SOURCE="${RELEASE}/apps/disdex-research-commander"
for required in server.mjs package.json lib/policy.mjs lib/github.mjs lib/diagnostics.mjs; do
  [[ -f "${SOURCE}/${required}" ]] || { echo "RESEARCH_SOURCE_MISSING=${required}" >&2; exit 78; }
done

if ! id disdex-research >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin disdex-research
fi

install -d -o disdex-research -g disdex-research -m 0750 /home/deploy/disdex-research-commander
if ! namei -m /home/deploy/disdex-research-commander >/dev/null 2>&1; then
  echo "RESEARCH_PATH_NOT_TRAVERSABLE" >&2
  exit 78
fi

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude '.env*' --exclude 'node_modules' "${SOURCE}/" /home/deploy/disdex-research-commander/
else
  echo "RSYNC_REQUIRED" >&2
  exit 78
fi
chown -R disdex-research:disdex-research /home/deploy/disdex-research-commander
find /home/deploy/disdex-research-commander -type d -exec chmod 0750 {} +
find /home/deploy/disdex-research-commander -type f -exec chmod 0640 {} +

install -o root -g root -m 0644 "${RELEASE}/ops/disdex-research-commander.service" /etc/systemd/system/disdex-research-commander.service
systemctl daemon-reload
systemctl enable disdex-research-commander.service >/dev/null

if [[ ! -f /etc/disdex-research-commander.env ]]; then
  echo "ENVIRONMENT_FILE_REQUIRED=/etc/disdex-research-commander.env" >&2
  echo "DISDEX_RESEARCH_COMMANDER_INSTALL_PASS serviceStarted=false" >&2
  exit 78
fi
if [[ "$(stat -c '%U:%G %a' /etc/disdex-research-commander.env)" != "root:root 600" ]]; then
  echo "RESEARCH_ENV_PERMISSION_INVALID" >&2
  exit 78
fi

echo "DISDEX_RESEARCH_COMMANDER_INSTALL_PASS"
echo "serviceStarted=false"
echo "productionPathsTouched=false"
echo "liveServiceTouched=false"
echo "ordersSent=false"
echo "positionsChanged=false"

