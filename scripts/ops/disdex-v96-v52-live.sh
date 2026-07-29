#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

marker="$(pwd -P)/.disdex-release-sha"
[[ -f "$marker" ]] || {
  printf 'release marker missing\n' >&2
  exit 1
}
sha="$(tr -d '[:space:]' < "$marker")"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'invalid release SHA marker\n' >&2
  exit 1
}
expected="/home/deploy/disdex-trading/releases/$sha"
[[ "$(pwd -P)" == "$expected" ]] || {
  printf 'working directory does not match immutable release SHA\n' >&2
  exit 1
}
[[ "$(readlink -f /home/deploy/disdex-trading/current)" == "$expected" ]] || {
  printf 'current link does not target this immutable release\n' >&2
  exit 1
}

shared_repo="/home/deploy/ai-dex-manager-v96-paper"
shared_state="$shared_repo/.runtime-state/disdex-v13d-v11eq-v96"
shared_approval="$shared_repo/.runtime-approval"

export DISDEX_V96_RUNTIME_COMMIT_SHA="$sha"
export DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT="$shared_state"
export DISDEX_V13D_V11EQ_V96_STATE_DIR="$shared_state"
export DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE="$shared_state/kill-switch.json"
export DISDEX_V52_ASTER_ONLY_STATE_DIR="$shared_state/stock"
export DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE="$shared_state/kill-switch.json"
export DISDEX_V96_STATE_DIR="$shared_state/crypto-v96"
export DISDEX_V96_KILL_SWITCH_FILE="$shared_state/kill-switch.json"
export DISDEX_V96_FORWARD_EVIDENCE_FILE="$shared_approval/disdex-v96-forward.json"
export DISDEX_V96_EXECUTION_PARITY_FILE="$shared_approval/disdex-v96-parity.json"
export DISDEX_V96_OPERATOR_OVERRIDE_FILE="$shared_approval/disdex-v96-operator-override.json"
export DISDEX_V96_CONFIG_MIGRATION_MODE=true
export DISDEX_V96_OPERATOR_AUDIT_SYNC_ACKNOWLEDGEMENT=I_SYNC_CURRENT_EXACT_OPERATOR_OVERRIDE_AUDIT

/usr/bin/npm run strategy:disdex-v96:override:audit:sync
exec /usr/bin/npm run strategy:disdex-v52:daemon
