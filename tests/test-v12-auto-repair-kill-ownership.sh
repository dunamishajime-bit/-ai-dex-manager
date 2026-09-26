#!/usr/bin/env bash
set -Eeuo pipefail
# Isolated root-only integration regression for the auto-repair fail-closed writer.
# Uses temporary paths only. Never touches the live kill switch or trading state.
[[ "$(id -u)" == "0" ]] || { echo "SKIP_REQUIRES_ROOT"; exit 0; }
id deploy >/dev/null
command -v jq >/dev/null
source_file="${1:-scripts/ops/root/disdex-v12-kill-switch-auto-repair}"
[[ -r "$source_file" ]]
tmp="$(mktemp -d /tmp/disdex-kill-owner-test.XXXXXXXX)"
trap 'rm -rf "$tmp"' EXIT
chmod 0755 "$tmp"
install -d -o root -g root -m 0700 "$tmp/shared"
# Extract the writer only: sourcing the full auto-repair script might execute its main().
function_file="$tmp/isolated-writer.sh"
sed -n '/^write_fail_closed() {/,/^}/p' "$source_file" > "$function_file"
[[ "$(grep -c '^write_fail_closed() {' "$function_file")" == 1 ]]
# shellcheck disable=SC1090
source "$function_file"
KILL_SOURCE_PATH="$tmp/shared/kill-switch.json"
write_fail_closed "PERMISSIONS_REGRESSION_FIXTURE"
[[ "$(stat -c '%U:%G:%a' "$tmp/shared")" == "deploy:deploy:700" ]]
[[ "$(stat -c '%U:%G:%a' "$KILL_SOURCE_PATH")" == "deploy:deploy:600" ]]
runuser -u deploy -- test -r "$KILL_SOURCE_PATH"
runuser -u deploy -- test -w "$tmp/shared"
jq -e '.active == true and .action == "FLATTEN_MANAGED" and .automaticRepair == "FAIL_CLOSED"' "$KILL_SOURCE_PATH" >/dev/null
original="$(sha256sum "$KILL_SOURCE_PATH" | cut -d' ' -f1)"
ln -s "$KILL_SOURCE_PATH" "$tmp/shared/bad-link.json"
KILL_SOURCE_PATH="$tmp/shared/bad-link.json"
if write_fail_closed "MUST_REJECT_SYMLINK"; then
  echo "SYMLINK_REJECTION_FAILED" >&2
  exit 1
fi
[[ "$original" == "$(sha256sum "$tmp/shared/kill-switch.json" | cut -d' ' -f1)" ]]
echo "V12_AUTO_REPAIR_KILL_OWNERSHIP_REGRESSION_PASS"
echo "liveMutation=false"
