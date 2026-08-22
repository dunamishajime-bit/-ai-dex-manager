#!/usr/bin/env bash
set -Eeuo pipefail

sha="${1:-}"
mode="${2:-runtime}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'V12_MUTUAL_EXCLUSION_INVALID_SHA\n' >&2
  exit 1
}
[[ "$mode" == "initial" || "$mode" == "runtime" ]] || {
  printf 'V12_MUTUAL_EXCLUSION_INVALID_MODE mode=%s\n' "$mode" >&2
  exit 1
}
release="/home/deploy/disdex-trading/releases/$sha"
[[ -d "$release" && ! -L "$release" ]] || {
  printf 'V12_MUTUAL_EXCLUSION_RELEASE_INVALID\n' >&2
  exit 1
}
[[ -f "$release/.disdex-release-sha" && ! -L "$release/.disdex-release-sha" ]] || {
  printf 'V12_MUTUAL_EXCLUSION_RELEASE_MARKER_MISSING\n' >&2
  exit 1
}
[[ "$(tr -d '[:space:]' < "$release/.disdex-release-sha")" == "$sha" ]] || {
  printf 'V12_MUTUAL_EXCLUSION_RELEASE_MARKER_MISMATCH\n' >&2
  exit 1
}
[[ -f "$release/.disdex-release-source-tree" && ! -L "$release/.disdex-release-source-tree" ]] || {
  printf 'V12_MUTUAL_EXCLUSION_SOURCE_TREE_MARKER_MISSING\n' >&2
  exit 1
}
source_tree="$(tr -d '[:space:]' < "$release/.disdex-release-source-tree")"
[[ "$source_tree" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'V12_MUTUAL_EXCLUSION_SOURCE_TREE_MARKER_INVALID\n' >&2
  exit 1
}
[[ -s "$release/.disdex-release-source-files.sha256" && ! -L "$release/.disdex-release-source-files.sha256" ]] || {
  printf 'V12_MUTUAL_EXCLUSION_SOURCE_INVENTORY_MISSING\n' >&2
  exit 1
}
[[ -x "$release/node_modules/.bin/tsx" && -d "$release/.next" ]] || {
  printf 'V12_MUTUAL_EXCLUSION_LINUX_BUILD_INVALID\n' >&2
  exit 1
}

# The two known V96 production supervisors must both be inactive. Do not use
# this script to stop them; migration is always an explicit operator action.
for unit in disdex-v96-v52-live.service disdex-v13d-v11eq-v96.service; do
  if /usr/bin/systemctl is-active --quiet "$unit"; then
    printf 'V12_MUTUAL_EXCLUSION_V96_SERVICE_ACTIVE unit=%s\n' "$unit" >&2
    exit 1
  fi
done

# Defense in depth for detached/orphaned V96 runners. PENGU V2 and V52 are
# deliberately not matched here because they remain live after the migration.
if /usr/bin/pgrep -af '[d]isdex-v96-live-runner\.ts' >/dev/null 2>&1; then
  printf 'V12_MUTUAL_EXCLUSION_V96_PROCESS_ACTIVE\n' >&2
  exit 1
fi
if /usr/bin/pgrep -af '[d]isdex-v13d-v11eq-v96-live-runner\.ts' >/dev/null 2>&1; then
  printf 'V12_MUTUAL_EXCLUSION_COMBINED_V96_PROCESS_ACTIVE\n' >&2
  exit 1
fi

# Initial activation is stricter than an ordinary V12 restart. Before V12 has
# ever become live, re-query Aster and prove the retired V96 core is flat and
# has no orders. During later V12 restarts BTC/ETH/BNB/SOL may legitimately be
# owned by V12, so repeating that zero-core assertion would block safe recovery.
if [[ "$mode" == "initial" ]]; then
  [[ "$(id -u)" == "0" ]] || { printf 'V12_MUTUAL_EXCLUSION_INITIAL_REQUIRES_ROOT\n' >&2; exit 1; }
  stop_recheck_unit="disdex-v96-stop-recheck@$sha.service"
  /usr/bin/systemctl reset-failed "$stop_recheck_unit" >/dev/null 2>&1 || true
  /usr/bin/systemctl start "$stop_recheck_unit"
fi

printf 'V12_MUTUAL_EXCLUSION_PREFLIGHT_PASS\n'
printf 'releaseSha=%s\nsourceTree=%s\nmode=%s\nordersSent=false\n' "$sha" "$source_tree" "$mode"
