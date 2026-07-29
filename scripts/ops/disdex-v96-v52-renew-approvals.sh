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
[[ "$service_state" == "inactive" || "$service_state" == "failed" ]] || {
  printf 'live service must be inactive before approval renewal\n' >&2
  exit 1
}

parity_file="${DISDEX_V96_EXECUTION_PARITY_FILE:?DISDEX_V96_EXECUTION_PARITY_FILE is required}"
override_file="${DISDEX_V96_OPERATOR_OVERRIDE_FILE:?DISDEX_V96_OPERATOR_OVERRIDE_FILE is required}"
approval_dir="$(dirname "$parity_file")"
[[ "$(dirname "$override_file")" == "$approval_dir" ]] || {
  printf 'approval files must share one directory\n' >&2
  exit 1
}
mkdir -p "$approval_dir"
tmp="$(mktemp -d "$approval_dir/.renew-$sha.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

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

DISDEX_V96_RUNTIME_COMMIT_SHA="$sha" \
DISDEX_V96_EXECUTION_PARITY_FILE="$tmp/parity.json" \
DISDEX_V96_OPERATOR_OVERRIDE_FILE="$tmp/operator-override.json" \
  /usr/bin/npm run strategy:disdex-v96-v52:preflight:readonly

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -f "$parity_file" ]]; then cp -a "$parity_file" "$parity_file.bak.$timestamp"; fi
if [[ -f "$override_file" ]]; then cp -a "$override_file" "$override_file.bak.$timestamp"; fi
install -m 0600 "$tmp/parity.json" "$parity_file.new.$sha"
install -m 0600 "$tmp/operator-override.json" "$override_file.new.$sha"
mv -f "$parity_file.new.$sha" "$parity_file"
mv -f "$override_file.new.$sha" "$override_file"

DISDEX_V96_RUNTIME_COMMIT_SHA="$sha" \
  /usr/bin/npm run strategy:disdex-v96-v52:preflight:readonly
printf 'DISDEX_V96_V52_APPROVAL_RENEWAL_PASS\n'
printf 'approvedCommitSha=%s\n' "$sha"
printf 'ordersSent=false\n'
printf 'positionsChanged=false\n'
printf 'runtimeStateChanged=false\n'
printf 'approvalChanged=true\n'
