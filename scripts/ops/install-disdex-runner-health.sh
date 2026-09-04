#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

if [[ "${EUID}" -ne 0 ]]; then
  printf 'Run this installer as root.\n' >&2
  exit 1
fi

REPO_ROOT="${DISDEX_RUNNER_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)}"
RELEASE_ROOT="${DISDEX_RUNNER_RELEASE_ROOT:-${REPO_ROOT}}"
RELEASE_ROOT="$(cd "${RELEASE_ROOT}" && pwd -P)"
MARKER="${RELEASE_ROOT}/.disdex-release-sha"

[[ -f "${MARKER}" && ! -L "${MARKER}" ]] || {
  printf 'release SHA marker missing\n' >&2
  exit 1
}

MARKER_SHA="$(tr -d '[:space:]' < "${MARKER}")"
RELEASE_SHA="${DISDEX_RUNNER_RELEASE_SHA:-${MARKER_SHA}}"
[[ "${RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'release SHA must be an exact lowercase 40-character value\n' >&2
  exit 1
}
[[ "${MARKER_SHA}" == "${RELEASE_SHA}" ]] || {
  printf 'release SHA marker does not match requested release\n' >&2
  exit 1
}

WATCHDOG_SCRIPT="${RELEASE_ROOT}/scripts/disdex-runner-watchdog.ts"
WATCHDOG_SERVICE="${RELEASE_ROOT}/ops/systemd/disdex-runner-watchdog.service"
WATCHDOG_TIMER="${RELEASE_ROOT}/ops/systemd/disdex-runner-watchdog.timer"
WATCHDOG_ENV_EXAMPLE="${RELEASE_ROOT}/ops/env/disdex-runner-watchdog.env.example"
[[ -f "${WATCHDOG_SCRIPT}" && -f "${WATCHDOG_SERVICE}" && -f "${WATCHDOG_TIMER}" && -f "${WATCHDOG_ENV_EXAMPLE}" ]] || {
  printf 'watchdog release files are incomplete\n' >&2
  exit 1
}
[[ -x "${RELEASE_ROOT}/node_modules/.bin/tsx" ]] || {
  printf 'exact release tsx executable is missing\n' >&2
  exit 1
}

HEALTH_ROOT="${DISDEX_RUNNER_HEALTH_ROOT:-/var/lib/disdex/runner-health}"
SYSTEMD_DIR="${DISDEX_RUNNER_SYSTEMD_DIR:-/etc/systemd/system}"
ENV_DIR="${DISDEX_RUNNER_ENV_DIR:-/etc/disdex}"
[[ "${HEALTH_ROOT}" == /* ]] || {
  printf 'DISDEX_RUNNER_HEALTH_ROOT must be absolute\n' >&2
  exit 1
}
[[ "${HEALTH_ROOT}" != "/" ]] || {
  printf 'DISDEX_RUNNER_HEALTH_ROOT must be a dedicated directory\n' >&2
  exit 1
}

V12_UNIT="disdex-v12-x1-all@${RELEASE_SHA}.service"
PENGU_UNIT="disdex-v96-v52-live.service"
V52_UNIT="disdex-v96-v52-live.service"
Q102_UNIT="disdex-quality102-causal-v1@${RELEASE_SHA}.service"

mkdir -p "${SYSTEMD_DIR}" "${ENV_DIR}"
install -d -o root -g root -m 0700 "${HEALTH_ROOT}"

temporary_env=""
cleanup() {
  if [[ -n "${temporary_env}" ]]; then
    rm -f -- "${temporary_env}"
  fi
}
trap cleanup EXIT

temporary_env="$(mktemp "${ENV_DIR}/.disdex-runner-watchdog.env.XXXXXX")"
install -o root -g root -m 0600 "${WATCHDOG_ENV_EXAMPLE}" "${temporary_env}"

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[\\&|]/\\&/g'
}

escaped_root="$(escape_sed_replacement "${RELEASE_ROOT}")"
escaped_health="$(escape_sed_replacement "${HEALTH_ROOT}")"
escaped_sha="$(escape_sed_replacement "${RELEASE_SHA}")"
escaped_v12="$(escape_sed_replacement "${V12_UNIT}")"
escaped_pengu="$(escape_sed_replacement "${PENGU_UNIT}")"
escaped_v52="$(escape_sed_replacement "${V52_UNIT}")"
escaped_q102="$(escape_sed_replacement "${Q102_UNIT}")"

sed -i \
  -e "s|^DISDEX_RUNNER_HEALTH_ROOT=.*$|DISDEX_RUNNER_HEALTH_ROOT=${escaped_health}|" \
  -e "s|^DISDEX_RUNNER_RELEASE_ROOT=.*$|DISDEX_RUNNER_RELEASE_ROOT=${escaped_root}|" \
  -e "s|^DISDEX_RUNNER_EXPECTED_SHA=.*$|DISDEX_RUNNER_EXPECTED_SHA=${escaped_sha}|" \
  -e "s|^DISDEX_RUNNER_V12_SERVICE_UNIT=.*$|DISDEX_RUNNER_V12_SERVICE_UNIT=${escaped_v12}|" \
  -e "s|^DISDEX_RUNNER_PENGU_V8_SERVICE_UNIT=.*$|DISDEX_RUNNER_PENGU_V8_SERVICE_UNIT=${escaped_pengu}|" \
  -e "s|^DISDEX_RUNNER_V52_SERVICE_UNIT=.*$|DISDEX_RUNNER_V52_SERVICE_UNIT=${escaped_v52}|" \
  -e "s|^DISDEX_RUNNER_QUALITY102_CAUSAL_V1_SERVICE_UNIT=.*$|DISDEX_RUNNER_QUALITY102_CAUSAL_V1_SERVICE_UNIT=${escaped_q102}|" \
  "${temporary_env}"

chmod 0600 "${temporary_env}"
install -o root -g root -m 0600 "${temporary_env}" "${ENV_DIR}/disdex-runner-watchdog.env"
install -o root -g root -m 0644 "${WATCHDOG_SERVICE}" "${SYSTEMD_DIR}/disdex-runner-watchdog.service"
install -o root -g root -m 0644 "${WATCHDOG_TIMER}" "${SYSTEMD_DIR}/disdex-runner-watchdog.timer"

/usr/bin/systemctl daemon-reload
/usr/bin/systemctl enable disdex-runner-watchdog.timer

printf 'DISDEX_RUNNER_HEALTH_INSTALL_PASS releaseSha=%s\n' "${RELEASE_SHA}"
