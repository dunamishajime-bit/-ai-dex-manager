#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

sha="${DISDEX_V96_RUNTIME_COMMIT_SHA:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'invalid exact runtime SHA\n' >&2
  exit 1
}
marker="$(pwd -P)/.disdex-release-sha"
[[ -f "$marker" && "$(tr -d '[:space:]' < "$marker")" == "$sha" ]] || {
  printf 'release marker does not match runtime SHA\n' >&2
  exit 1
}
[[ "$(pwd -P)" == "/home/deploy/disdex-trading/releases/$sha" ]] || {
  printf 'candidate preflight must run from the immutable release\n' >&2
  exit 1
}

service_state="$(systemctl is-active disdex-v96-v52-live.service 2>/dev/null || true)"
service_pid="$(systemctl show disdex-v96-v52-live.service --property MainPID --value)"
[[ "$service_state" == "inactive" || "$service_state" == "failed" ]] || {
  printf 'LIVE service must be inactive during candidate preflight\n' >&2
  exit 1
}
[[ "$service_pid" == "0" ]] || {
  printf 'LIVE MainPID must be zero during candidate preflight\n' >&2
  exit 1
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home"
export npm_config_cache="$tmp/npm-cache"
export PYTHONPYCACHEPREFIX="$tmp/pycache"
export PYTHONPATH="${PYTHONPATH:-/home/deploy/dis-dex-manager/.venv-stock/lib/python3.12/site-packages}"
mkdir -p "$HOME" "$npm_config_cache" "$PYTHONPYCACHEPREFIX"

DISDEX_V96_RUNTIME_COMMIT_SHA="$sha" \
  /usr/bin/npm run strategy:disdex-v96-v52:preflight:readonly

DISDEX_V96_RUNTIME_COMMIT_SHA="$sha" \
DISDEX_V96_CONFIG_MIGRATION_MODE=true \
  /usr/bin/npm run strategy:disdex-v52:preflight

printf 'DISDEX_V96_V52_CANDIDATE_PREFLIGHT_PASS\n'
printf 'runtimeCommitSha=%s\n' "$sha"
printf 'ordersSent=false\n'
printf 'cancelSent=false\n'
printf 'positionChangesSent=false\n'
printf 'runtimeStateChanged=false\n'
printf 'approvalChanged=false\n'
