#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

sha="${DISDEX_V96_APPROVED_COMMIT_SHA:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'invalid exact approval SHA\n' >&2
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

/usr/bin/npm run strategy:disdex-v96-v52:preflight:readonly:selftest
/usr/bin/npm run strategy:disdex-v52:contract
/usr/bin/npm run strategy:disdex-v96:typecheck
/usr/bin/npm run strategy:disdex-v96:selftest
/usr/bin/npm run strategy:disdex-v96:frequency:selftest
/usr/bin/npm run strategy:disdex-v96:execution:selftest

/usr/bin/npm run strategy:disdex-v96:parity:renew -- "$tmp/parity.json"
/usr/bin/npm run strategy:disdex-v96:override:create -- "$tmp/operator-override.json"

DISDEX_V96_EXECUTION_PARITY_FILE="$tmp/parity.json" \
DISDEX_V96_OPERATOR_OVERRIDE_FILE="$tmp/operator-override.json" \
  /usr/bin/npm run strategy:disdex-v96-v52:preflight:readonly

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "$parity_file" "$parity_file.bak.$timestamp"
cp -a "$override_file" "$override_file.bak.$timestamp"
install -o deploy -g deploy -m 0600 "$tmp/parity.json" "$parity_file.new.$sha"
install -o deploy -g deploy -m 0600 "$tmp/operator-override.json" "$override_file.new.$sha"
mv -f "$parity_file.new.$sha" "$parity_file"
mv -f "$override_file.new.$sha" "$override_file"

/usr/bin/npm run strategy:disdex-v96-v52:preflight:readonly
printf 'DISDEX_V96_V52_APPROVAL_RENEWAL_PASS\n'
printf 'approvedCommitSha=%s\n' "$sha"
printf 'ordersSent=false\n'
printf 'positionsChanged=false\n'
printf 'runtimeStateChanged=false\n'
printf 'approvalChanged=true\n'
