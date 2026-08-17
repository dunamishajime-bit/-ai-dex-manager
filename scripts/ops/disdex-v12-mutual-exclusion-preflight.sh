#!/usr/bin/env bash
set -Eeuo pipefail

sha="${1:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'V12_MUTUAL_EXCLUSION_INVALID_SHA\n' >&2
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

# The two known V96 production supervisors must both be inactive.  Do not use
# this script to stop them; migration is an explicit operator action.
for unit in disdex-v96-v52-live.service disdex-v13d-v11eq-v96.service; do
  if /usr/bin/systemctl is-active --quiet "$unit"; then
    printf 'V12_MUTUAL_EXCLUSION_V96_SERVICE_ACTIVE unit=%s\n' "$unit" >&2
    exit 1
  fi
done

# Defense in depth for a detached/orphaned V96 runner that survived a service
# transition.  PENGU V2 and V52 are deliberately not matched here.
if /usr/bin/pgrep -af '[d]isdex-v96-live-runner\.ts' >/dev/null 2>&1; then
  printf 'V12_MUTUAL_EXCLUSION_V96_PROCESS_ACTIVE\n' >&2
  exit 1
fi
if /usr/bin/pgrep -af '[d]isdex-v13d-v11eq-v96-live-runner\.ts' >/dev/null 2>&1; then
  printf 'V12_MUTUAL_EXCLUSION_COMBINED_V96_PROCESS_ACTIVE\n' >&2
  exit 1
fi

cd "$release"
"$release/node_modules/.bin/tsx" scripts/disdex-v96-stop-recheck.ts
printf 'V12_MUTUAL_EXCLUSION_PREFLIGHT_PASS\n'
printf 'releaseSha=%s\nordersSent=false\n' "$sha"
