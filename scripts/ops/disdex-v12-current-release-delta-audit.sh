#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only source audit for the VPS-only release marker problem.  It never
# reads /etc/disdex secrets and never starts/stops a service or calls Aster.
current_input="${1:-/home/deploy/disdex-trading/current}"
candidate_input="${2:-}"
[[ -n "$candidate_input" ]] || {
  printf 'usage: %s [current-release-or-current-symlink] /home/deploy/disdex-trading/releases/<candidate-sha>\n' "$0" >&2
  exit 2
}
current="$(readlink -f "$current_input")"
candidate="$(readlink -f "$candidate_input")"
[[ -d "$current" && ! -L "$current" ]] || { printf 'VPS_DELTA_CURRENT_RELEASE_INVALID\n' >&2; exit 2; }
[[ -d "$candidate" && ! -L "$candidate" ]] || { printf 'VPS_DELTA_CANDIDATE_RELEASE_INVALID\n' >&2; exit 2; }

verify_release() {
  local path="$1" marker sha
  marker="$path/.disdex-release-sha"
  [[ -f "$marker" && ! -L "$marker" ]] || return 1
  sha="$(tr -d '[:space:]' < "$marker")"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ "$(basename "$path")" == "$sha" ]] || return 1
}
verify_release "$current" || { printf 'VPS_DELTA_CURRENT_RELEASE_MARKER_INVALID\n' >&2; exit 2; }
verify_release "$candidate" || { printf 'VPS_DELTA_CANDIDATE_RELEASE_MARKER_INVALID\n' >&2; exit 2; }

current_sha="$(tr -d '[:space:]' < "$current/.disdex-release-sha")"
candidate_sha="$(tr -d '[:space:]' < "$candidate/.disdex-release-sha")"
report_root="${DISDEX_V12_DELTA_REPORT_ROOT:-/home/deploy/disdex-ops/v12-release-delta}"
mkdir -p "$report_root"
report="$report_root/${current_sha}-to-${candidate_sha}.txt"
: > "$report"
chmod 0600 "$report"

critical_paths=(
  package.json
  package-lock.json
  config/disdexV96Runtime.ts
  config/penguDualLsV2Runtime.ts
  lib/aster-v3-client.ts
  lib/direct-trade-executor.ts
  lib/disdex-account-order-lock.ts
  lib/pengu-dual-ls-v2-portfolio-runner.ts
  lib/pengu-dual-ls-v2-runner-state.ts
  scripts/disdex-pengu-dual-ls-v2-live-runner.ts
  scripts/disdex_v11eq_aster_only_live_engine.py
  scripts/disdex_v52_aster_only_live_engine.py
  scripts/disdex_v52_margin_aware_live_engine.py
  scripts/disdex_v96_v52_margin_guard.py
  scripts/disdex_v96_v52_margin_guard_runtime.py
  scripts/disdex_stock_reference_pyth_iex_proxy.py
  scripts/ops/disdex-v96-v52-live.sh
  scripts/ops/disdex-v96-v52-live-policy.sh
  ops/systemd/disdex-v96-v52-live.service
  ops/env/disdex-v13d-v11eq-v96.env.example
)

changed=0
missing_current=0
missing_candidate=0
{
  printf 'V12_CURRENT_RELEASE_DELTA_AUDIT\n'
  printf 'currentRelease=%s\ncurrentSha=%s\n' "$current" "$current_sha"
  printf 'candidateRelease=%s\ncandidateSha=%s\n' "$candidate" "$candidate_sha"
  printf 'generatedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'ordersSent=false\nservicesChanged=false\nsecretsRead=false\n\n'
} >> "$report"

for rel in "${critical_paths[@]}"; do
  left="$current/$rel"
  right="$candidate/$rel"
  if [[ ! -f "$left" ]]; then
    printf 'CURRENT_MISSING %s\n' "$rel" >> "$report"
    missing_current=$((missing_current + 1))
    continue
  fi
  if [[ ! -f "$right" ]]; then
    printf 'CANDIDATE_MISSING %s\n' "$rel" >> "$report"
    missing_candidate=$((missing_candidate + 1))
    continue
  fi
  left_sha="$(sha256sum "$left" | awk '{print $1}')"
  right_sha="$(sha256sum "$right" | awk '{print $1}')"
  if [[ "$left_sha" == "$right_sha" ]]; then
    printf 'SAME %s sha256=%s\n' "$rel" "$left_sha" >> "$report"
  else
    changed=$((changed + 1))
    printf 'CHANGED %s currentSha256=%s candidateSha256=%s\n' "$rel" "$left_sha" "$right_sha" >> "$report"
    # Source-only unified diff; truncate each file diff so the report remains
    # bounded. No /etc env or credential file is ever included.
    diff -u --label "current/$rel" --label "candidate/$rel" "$left" "$right" 2>/dev/null | head -n 240 >> "$report" || true
    printf '\n' >> "$report"
  fi
done

{
  printf '\nsummaryChanged=%d\n' "$changed"
  printf 'summaryMissingCurrent=%d\n' "$missing_current"
  printf 'summaryMissingCandidate=%d\n' "$missing_candidate"
  printf 'reviewRequired=%s\n' "$([[ $changed -gt 0 || $missing_current -gt 0 || $missing_candidate -gt 0 ]] && printf true || printf false)"
} >> "$report"

printf 'STATUS: VPS_RELEASE_DELTA_AUDIT_COMPLETE\n'
printf 'currentSha=%s\ncandidateSha=%s\n' "$current_sha" "$candidate_sha"
printf 'changedCriticalFiles=%d\nmissingCurrent=%d\nmissingCandidate=%d\n' "$changed" "$missing_current" "$missing_candidate"
printf 'report=%s\nordersSent=false\nservicesChanged=false\n' "$report"
if [[ $changed -gt 0 || $missing_current -gt 0 || $missing_candidate -gt 0 ]]; then
  printf 'VPS_RELEASE_DELTA_REVIEW_REQUIRED\n'
else
  printf 'VPS_RELEASE_DELTA_NO_CRITICAL_DIFFERENCES\n'
fi
