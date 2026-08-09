#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

sha="${DISDEX_V96_APPROVED_COMMIT_SHA:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'invalid exact approval SHA\n' >&2
  exit 1
}
[[ "${DISDEX_V96_EXECUTION_PARITY_REVIEW_ACKNOWLEDGEMENT:-}" == "I_REVIEWED_DISDEX_V96_EXECUTION_PARITY_FOR_EXACT_COMMIT" ]] || {
  printf 'execution parity review acknowledgement missing\n' >&2
  exit 1
}
marker="$(pwd -P)/.disdex-release-sha"
[[ -f "$marker" && "$(tr -d '[:space:]' < "$marker")" == "$sha" ]] || {
  printf 'release marker does not match approval SHA\n' >&2
  exit 1
}
[[ "$(pwd -P)" == "/home/deploy/disdex-trading/releases/$sha" ]] || {
  printf 'approval renewal must run from the immutable release\n' >&2
  exit 1
}
service_state="$(systemctl is-active disdex-v96-v52-live.service 2>/dev/null || true)"
service_pid="$(systemctl show disdex-v96-v52-live.service --property MainPID --value)"
[[ "$service_state" == "inactive" || "$service_state" == "failed" ]] || {
  printf 'live service must be inactive before approval renewal\n' >&2
  exit 1
}
[[ "$service_pid" == "0" ]] || {
  printf 'live service MainPID must be zero before approval renewal\n' >&2
  exit 1
}

parity_file="${DISDEX_V96_EXECUTION_PARITY_FILE:?DISDEX_V96_EXECUTION_PARITY_FILE is required}"
override_file="${DISDEX_V96_OPERATOR_OVERRIDE_FILE:?DISDEX_V96_OPERATOR_OVERRIDE_FILE is required}"
state_root="${DISDEX_V96_STATE_DIR:?DISDEX_V96_STATE_DIR is required}"
state_file="${state_root%/}/runner-live.json"
approval_dir="$(dirname "$parity_file")"
[[ "$(dirname "$override_file")" == "$approval_dir" ]] || {
  printf 'approval files must share one directory\n' >&2
  exit 1
}
[[ -f "$state_file" && ! -L "$state_file" ]] || {
  printf 'established crypto runner state is required for approval renewal\n' >&2
  exit 1
}
mkdir -p "$approval_dir"
tmp="$(mktemp -d "$approval_dir/.renew-$sha.XXXXXX")"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
parity_backup="$parity_file.bak.$timestamp"
override_backup="$override_file.bak.$timestamp"
state_backup="$state_file.before-approval-renewal-$timestamp"
parity_existed=false
override_existed=false
mutation_started=false
success=false

cleanup() {
  status=$?
  if [[ "$success" != "true" && "$mutation_started" == "true" ]]; then
    if [[ "$parity_existed" == "true" ]]; then
      install -m 0600 "$parity_backup" "$parity_file"
    else
      rm -f "$parity_file"
    fi
    if [[ "$override_existed" == "true" ]]; then
      install -m 0600 "$override_backup" "$override_file"
    else
      rm -f "$override_file"
    fi
    install -m 0600 "$state_backup" "$state_file"
    printf 'DISDEX_V96_V52_APPROVAL_RENEWAL_ROLLBACK\n' >&2
    printf 'approvedCommitSha=%s\n' "$sha" >&2
    printf 'ordersSent=false\n' >&2
    printf 'positionsChanged=false\n' >&2
  fi
  rm -rf "$tmp"
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

# The release tree is intentionally read-only under systemd. Route every cache,
# bytecode and temporary write into the approval transaction directory.
export HOME="$tmp/home"
export npm_config_cache="$tmp/npm-cache"
export PYTHONPYCACHEPREFIX="$tmp/pycache"
export PYTHONPATH="${PYTHONPATH:-/home/deploy/dis-dex-manager/.venv-stock/lib/python3.12/site-packages}"
mkdir -p "$HOME" "$npm_config_cache" "$PYTHONPYCACHEPREFIX"

golden="$tmp/disdex-v95-golden.json"
/usr/bin/python3 scripts/disdex_v96_golden_vector_generator.py --output "$golden"
node_modules/.bin/tsx scripts/disdex-v95-golden-parity.ts "$golden"
/usr/bin/npm run strategy:disdex-v96-v52:preflight:readonly:selftest
/usr/bin/npm run strategy:disdex-v52:contract
/usr/bin/npm run strategy:disdex-v96:typecheck
/usr/bin/npm run strategy:disdex-v96:selftest
/usr/bin/npm run strategy:disdex-v96:frequency:selftest
/usr/bin/npm run strategy:disdex-v96:execution:selftest

DISDEX_V96_PRODUCTION_COMMIT_SHA="$sha" \
DISDEX_V96_PARITY_REVIEWER="${DISDEX_V96_EXECUTION_PARITY_REVIEWER:?reviewer is required}" \
  node_modules/.bin/tsx scripts/disdex-v96-write-execution-parity-approval.ts "$golden" "$tmp/parity.json"
/usr/bin/npm run strategy:disdex-v96:override:create -- "$tmp/operator-override.json"

# Validate the candidate approvals before touching the shared approval/state files.
DISDEX_V96_RUNTIME_COMMIT_SHA="$sha" \
DISDEX_V96_EXECUTION_PARITY_FILE="$tmp/parity.json" \
DISDEX_V96_OPERATOR_OVERRIDE_FILE="$tmp/operator-override.json" \
  /usr/bin/npm run strategy:disdex-v96-v52:preflight:readonly

if [[ -f "$parity_file" ]]; then
  parity_existed=true
  cp -a "$parity_file" "$parity_backup"
fi
if [[ -f "$override_file" ]]; then
  override_existed=true
  cp -a "$override_file" "$override_backup"
fi
cp -a "$state_file" "$state_backup"

mutation_started=true
install -m 0600 "$tmp/parity.json" "$parity_file.new.$sha"
install -m 0600 "$tmp/operator-override.json" "$override_file.new.$sha"
mv -f "$parity_file.new.$sha" "$parity_file"
mv -f "$override_file.new.$sha" "$override_file"

# Formally synchronize the established state audit to the exact approval. A
# renewal for the release currently selected by `current` is a current-release
# audit; a renewal for another immutable release is a candidate-release audit.
# Both routes remain explicit and require their own acknowledgement.
current_release="$(readlink -f /home/deploy/disdex-trading/current 2>/dev/null || true)"
if [[ "$current_release" == "/home/deploy/disdex-trading/releases/$sha" ]]; then
  audit_mode=CURRENT_RELEASE
  audit_ack=I_SYNC_CURRENT_EXACT_OPERATOR_OVERRIDE_AUDIT
else
  audit_mode=CANDIDATE_RELEASE
  audit_ack=I_SYNC_CANDIDATE_EXACT_OPERATOR_OVERRIDE_AUDIT
fi
DISDEX_V96_RUNTIME_COMMIT_SHA="$sha" \
DISDEX_V96_OPERATOR_AUDIT_SYNC_MODE="$audit_mode" \
DISDEX_V96_OPERATOR_AUDIT_SYNC_ACKNOWLEDGEMENT="$audit_ack" \
  /usr/bin/npm run strategy:disdex-v96:override:audit:sync

# Run the same authenticated + integrated preflight used by the promotion
# helper. Any failure restores approval and state backups before exit.
DISDEX_V96_RUNTIME_COMMIT_SHA="$sha" \
DISDEX_V96_CONFIG_MIGRATION_MODE=true \
  /usr/bin/bash scripts/ops/disdex-v96-v52-candidate-preflight.sh

success=true
printf 'DISDEX_V96_V52_APPROVAL_RENEWAL_PASS\n'
printf 'approvedCommitSha=%s\n' "$sha"
printf 'maximumGross=%s\n' "${DISDEX_V96_MAX_GROSS:-}"
printf 'initialPenguGross=%s\n' "${DISDEX_V96_INITIAL_PENGU_GROSS:-}"
printf 'maximumDailyLossPct=%s\n' "${DISDEX_V96_MAX_DAILY_LOSS_PCT:-}"
printf 'ordersSent=false\n'
printf 'positionsChanged=false\n'
printf 'runtimeStateChanged=true\n'
printf 'approvalChanged=true\n'
