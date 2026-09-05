#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_safe_absolute_path() {
  local name="$1"
  local value="$2"
  [[ "$value" == /* ]] || die "${name} must be absolute"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "${name} contains a control character"
  [[ "$value" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "${name} contains an unsafe path character"
  [[ "$value" != //* && "$value" != */./* && "$value" != */. && "$value" != */../* && "$value" != */.. ]] || die "${name} is not canonical"
}

canonical_existing_directory() {
  local name="$1"
  local value="$2"
  require_safe_absolute_path "$name" "$value"
  [[ -d "$value" && ! -L "$value" ]] || die "${name} must be a real directory"
  local physical
  physical="$(cd -P -- "$value" && pwd -P)" || die "${name} cannot be canonicalized"
  [[ "$physical" == "$value" ]] || die "${name} must not contain symlink components"
  printf '%s' "$physical"
}

canonical_directory_after_create() {
  local name="$1"
  local value="$2"
  require_safe_absolute_path "$name" "$value"
  [[ ! -L "$value" ]] || die "${name} must not be a symlink"
  mkdir -p -- "$value"
  canonical_existing_directory "$name" "$value"
}

if [[ "${EUID}" -ne 0 ]]; then
  die 'Run this installer as root.'
fi

REPO_ROOT_INPUT="${DISDEX_RUNNER_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)}"
REPO_ROOT="$(canonical_existing_directory 'DISDEX_RUNNER_REPO_ROOT' "$REPO_ROOT_INPUT")"
RELEASE_ROOT_INPUT="${DISDEX_RUNNER_RELEASE_ROOT:-${REPO_ROOT}}"
RELEASE_ROOT="$(canonical_existing_directory 'DISDEX_RUNNER_RELEASE_ROOT' "$RELEASE_ROOT_INPUT")"

MARKER="${RELEASE_ROOT}/.disdex-release-sha"
[[ -f "$MARKER" && ! -L "$MARKER" ]] || die 'release SHA marker missing'
[[ "$(awk 'END { print NR }' "$MARKER")" -eq 1 ]] || die 'release SHA marker must contain one line'
MARKER_SHA=''
IFS= read -r MARKER_SHA < "$MARKER" || true
[[ "$MARKER_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'release SHA marker is invalid'

RELEASE_SHA="${DISDEX_RUNNER_RELEASE_SHA:-${MARKER_SHA}}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'release SHA must be an exact lowercase 40-character value'
[[ "$MARKER_SHA" == "$RELEASE_SHA" ]] || die 'release SHA marker does not match requested release'
[[ "$(basename -- "$RELEASE_ROOT")" == "$RELEASE_SHA" ]] || die 'release root basename must match release SHA'
[[ "$(basename -- "$(dirname -- "$RELEASE_ROOT")")" == 'releases' ]] || die 'release root must be below a releases directory'

WATCHDOG_SCRIPT="${RELEASE_ROOT}/scripts/disdex-runner-watchdog.ts"
WATCHDOG_SERVICE="${RELEASE_ROOT}/ops/systemd/disdex-runner-watchdog.service"
WATCHDOG_TIMER="${RELEASE_ROOT}/ops/systemd/disdex-runner-watchdog.timer"
WATCHDOG_ENV_EXAMPLE="${RELEASE_ROOT}/ops/env/disdex-runner-watchdog.env.example"
for required_file in "$WATCHDOG_SCRIPT" "$WATCHDOG_SERVICE" "$WATCHDOG_TIMER" "$WATCHDOG_ENV_EXAMPLE"; do
  [[ -f "$required_file" && ! -L "$required_file" ]] || die "watchdog release file is missing or a symlink: ${required_file}"
done
[[ -x "${RELEASE_ROOT}/node_modules/.bin/tsx" && ! -L "${RELEASE_ROOT}/node_modules/.bin/tsx" ]] || die 'exact release tsx executable is missing or a symlink'

HEALTH_ROOT="${DISDEX_RUNNER_HEALTH_ROOT:-/var/lib/disdex/runner-health}"
SYSTEMD_DIR="${DISDEX_RUNNER_SYSTEMD_DIR:-/etc/systemd/system}"
ENV_DIR="${DISDEX_RUNNER_ENV_DIR:-/etc/disdex}"
[[ "$HEALTH_ROOT" == '/var/lib/disdex/runner-health' ]] || die 'DISDEX_RUNNER_HEALTH_ROOT must be the dedicated runner-health directory'
[[ "$SYSTEMD_DIR" == '/etc/systemd/system' ]] || die 'DISDEX_RUNNER_SYSTEMD_DIR cannot be changed'
[[ "$ENV_DIR" == '/etc/disdex' ]] || die 'DISDEX_RUNNER_ENV_DIR cannot be changed'
HEALTH_ROOT="$(canonical_directory_after_create 'DISDEX_RUNNER_HEALTH_ROOT' "$HEALTH_ROOT")"
SYSTEMD_DIR="$(canonical_existing_directory 'DISDEX_RUNNER_SYSTEMD_DIR' "$SYSTEMD_DIR")"
ENV_DIR="$(canonical_directory_after_create 'DISDEX_RUNNER_ENV_DIR' "$ENV_DIR")"

V12_RELEASE_ROOT="${DISDEX_RUNNER_V12_RELEASE_ROOT:-/opt/disdex/releases/${RELEASE_SHA}}"
Q102_RELEASE_ROOT="${DISDEX_RUNNER_QUALITY102_RELEASE_ROOT:-${RELEASE_ROOT}}"
COMBINED_RELEASE_ROOT="${DISDEX_RUNNER_COMBINED_RELEASE_ROOT:-${RELEASE_ROOT}}"
PENGU_SERVICE_UNIT="${DISDEX_RUNNER_PENGU_V8_SERVICE_UNIT:-disdex-v96-v52-live.service}"
V52_SERVICE_UNIT="${DISDEX_RUNNER_V52_SERVICE_UNIT:-disdex-v96-v52-live.service}"
[[ "$PENGU_SERVICE_UNIT" =~ ^(disdex-pengu-dual-ls-v2-v20|disdex-v96-v52-live)\.service$ ]] || [[ "$PENGU_SERVICE_UNIT" =~ ^disdex-pengu-dual-ls-v2-v20\.service$ ]] || die 'PENGU service unit is not allowlisted'
[[ "$V52_SERVICE_UNIT" =~ ^(disdex-v52-aster-only@[0-9a-f]{40}|disdex-v96-v52-live)\.service$ ]] || die 'V52 service unit is not allowlisted'
for runner_release in "$V12_RELEASE_ROOT" "$Q102_RELEASE_ROOT" "$COMBINED_RELEASE_ROOT"; do
  canonical_existing_directory 'runner release root' "$runner_release" >/dev/null
  runner_marker="${runner_release}/.disdex-release-sha"
  [[ -f "$runner_marker" && ! -L "$runner_marker" ]] || die "runner release SHA marker missing: ${runner_marker}"
  [[ "$(tr -d '\r\n' < "$runner_marker")" == "$RELEASE_SHA" ]] || die "runner release SHA marker mismatch: ${runner_release}"
done

HEALTH_GROUP='disdex-runner-health'
RUNNER_USER='deploy'
getent passwd "$RUNNER_USER" >/dev/null || die "runner user ${RUNNER_USER} is unavailable"
if ! getent group "$HEALTH_GROUP" >/dev/null; then
  groupadd --system "$HEALTH_GROUP"
fi
usermod -a -G "$HEALTH_GROUP" "$RUNNER_USER"

HEARTBEAT_ROOT="${HEALTH_ROOT}/heartbeats"
PRIVATE_ROOT="${HEALTH_ROOT}/private"
for directory in "$HEALTH_ROOT" "$HEARTBEAT_ROOT" "$PRIVATE_ROOT"; do
  [[ ! -L "$directory" ]] || die "health path is a symlink: ${directory}"
done
install -d -o root -g root -m 0711 "$HEALTH_ROOT"
install -d -o root -g "$HEALTH_GROUP" -m 0770 "$HEARTBEAT_ROOT"
install -d -o root -g root -m 0700 "$PRIVATE_ROOT"
chmod 0711 "$HEALTH_ROOT"
chown root:root "$HEALTH_ROOT"
chmod 0770 "$HEARTBEAT_ROOT"
chown root:"$HEALTH_GROUP" "$HEARTBEAT_ROOT"
chmod 0700 "$PRIVATE_ROOT"
chown root:root "$PRIVATE_ROOT"

temporary_env=''
temporary_service=''
temporary_timer=''
temporary_combined=''
cleanup() {
  [[ -z "$temporary_env" ]] || rm -f -- "$temporary_env"
  [[ -z "$temporary_service" ]] || rm -f -- "$temporary_service"
  [[ -z "$temporary_timer" ]] || rm -f -- "$temporary_timer"
  [[ -z "$temporary_combined" ]] || rm -f -- "$temporary_combined"
}
trap cleanup EXIT

temporary_env="$(mktemp "${ENV_DIR}/.disdex-runner-watchdog.env.XXXXXX")"
{
  printf 'DISDEX_RUNNER_HEALTH_ROOT=%s\n' "$HEALTH_ROOT"
  printf 'DISDEX_RUNNER_HEARTBEAT_ROOT=%s\n' "$HEARTBEAT_ROOT"
  printf 'DISDEX_RUNNER_RELEASE_ROOT=%s\n' "$RELEASE_ROOT"
  printf 'DISDEX_RUNNER_EXPECTED_SHA=%s\n' "$RELEASE_SHA"
  printf 'DISDEX_RUNNER_V12_EXPECTED_CWD=%s\n' "$V12_RELEASE_ROOT"
  printf 'DISDEX_RUNNER_PENGU_V8_EXPECTED_CWD=%s\n' "$COMBINED_RELEASE_ROOT"
  printf 'DISDEX_RUNNER_V52_EXPECTED_CWD=%s\n' "$COMBINED_RELEASE_ROOT"
  printf 'DISDEX_RUNNER_QUALITY102_CAUSAL_V1_EXPECTED_CWD=%s\n' "$Q102_RELEASE_ROOT"
  printf 'DISDEX_RUNNER_V12_SERVICE_UNIT=disdex-v12-x1-all@%s.service\n' "$RELEASE_SHA"
  printf 'DISDEX_RUNNER_PENGU_V8_SERVICE_UNIT=%s\n' "$PENGU_SERVICE_UNIT"
  printf 'DISDEX_RUNNER_V52_SERVICE_UNIT=%s\n' "$V52_SERVICE_UNIT"
  printf 'DISDEX_RUNNER_QUALITY102_CAUSAL_V1_SERVICE_UNIT=disdex-quality102-causal-v1@%s.service\n' "$RELEASE_SHA"
  printf 'DISDEX_RUNNER_WATCHDOG_HEARTBEAT_TIMEOUT_MS=300000\n'
  printf 'DISDEX_RUNNER_WATCHDOG_ATTEMPT_WINDOW_MS=1800000\n'
  printf 'DISDEX_RUNNER_WATCHDOG_MAX_ATTEMPTS=3\n'
  printf 'DISDEX_RUNNER_WATCHDOG_BACKOFF_MS=15000,60000,300000\n'
} > "$temporary_env"
chmod 0600 "$temporary_env"

render_watchdog_service() {
  local input="$1"
  local output="$2"
  local line
  local saw_root=0
  local saw_test=0
  local saw_sha=0
  local saw_exec=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      'WorkingDirectory=@DISDEX_RUNNER_RELEASE_ROOT@')
        printf 'WorkingDirectory=%s\n' "$RELEASE_ROOT"
        saw_root=1
        ;;
      'ExecStartPre=/usr/bin/test -f @DISDEX_RUNNER_RELEASE_ROOT@/.disdex-release-sha')
        printf 'ExecStartPre=/usr/bin/test -f %s/.disdex-release-sha\n' "$RELEASE_ROOT"
        saw_test=1
        ;;
      'ExecStartPre=/usr/bin/grep -Fxq @DISDEX_RUNNER_RELEASE_SHA@ @DISDEX_RUNNER_RELEASE_ROOT@/.disdex-release-sha')
        printf 'ExecStartPre=/usr/bin/grep -Fxq %s %s/.disdex-release-sha\n' "$RELEASE_SHA" "$RELEASE_ROOT"
        saw_sha=1
        ;;
      'ExecStart=@DISDEX_RUNNER_RELEASE_ROOT@/node_modules/.bin/tsx scripts/disdex-runner-watchdog.ts')
        printf 'ExecStart=%s/node_modules/.bin/tsx scripts/disdex-runner-watchdog.ts\n' "$RELEASE_ROOT"
        saw_exec=1
        ;;
      *)
        printf '%s\n' "$line"
        ;;
    esac
  done < "$input" > "$output"
  [[ "$saw_root" -eq 1 && "$saw_test" -eq 1 && "$saw_sha" -eq 1 && "$saw_exec" -eq 1 ]] || die 'watchdog unit template is missing release placeholders'
}

render_combined_service() {
  local input="$1"
  local output="$2"
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      'WorkingDirectory=@DISDEX_RUNNER_RELEASE_ROOT@') printf 'WorkingDirectory=%s\n' "$COMBINED_RELEASE_ROOT" ;;
      'ExecStart=@DISDEX_RUNNER_RELEASE_ROOT@/scripts/ops/disdex-v96-v52-live.sh') printf 'ExecStart=%s/scripts/ops/disdex-v96-v52-live.sh\n' "$COMBINED_RELEASE_ROOT" ;;
      'ExecStartPre=/usr/bin/test -f @DISDEX_RUNNER_RELEASE_ROOT@/.disdex-release-sha') printf 'ExecStartPre=/usr/bin/test -f %s/.disdex-release-sha\n' "$COMBINED_RELEASE_ROOT" ;;
      'ExecStartPre=/usr/bin/grep -Fxq @DISDEX_RUNNER_RELEASE_SHA@ @DISDEX_RUNNER_RELEASE_ROOT@/.disdex-release-sha') printf 'ExecStartPre=/usr/bin/grep -Fxq %s %s/.disdex-release-sha\n' "$RELEASE_SHA" "$COMBINED_RELEASE_ROOT" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$input" > "$output"
}

temporary_service="$(mktemp "${SYSTEMD_DIR}/.disdex-runner-watchdog.service.XXXXXX")"
render_watchdog_service "$WATCHDOG_SERVICE" "$temporary_service"
temporary_timer="$(mktemp "${SYSTEMD_DIR}/.disdex-runner-watchdog.timer.XXXXXX")"
install -o root -g root -m 0644 "$WATCHDOG_TIMER" "$temporary_timer"
temporary_combined="$(mktemp "${SYSTEMD_DIR}/.disdex-v96-v52-live.service.XXXXXX")"
render_combined_service "${RELEASE_ROOT}/ops/systemd/disdex-v96-v52-live.service" "$temporary_combined"

install -o root -g root -m 0600 "$temporary_env" "${ENV_DIR}/disdex-runner-watchdog.env"
install -o root -g root -m 0644 "$temporary_service" "${SYSTEMD_DIR}/disdex-runner-watchdog.service"
install -o root -g root -m 0644 "$temporary_timer" "${SYSTEMD_DIR}/disdex-runner-watchdog.timer"
install -o root -g root -m 0644 "$temporary_combined" "${SYSTEMD_DIR}/disdex-v96-v52-live.service"

/usr/bin/systemctl daemon-reload
/usr/bin/systemctl enable disdex-runner-watchdog.timer

printf 'DISDEX_RUNNER_HEALTH_INSTALL_PASS releaseSha=%s\n' "$RELEASE_SHA"
