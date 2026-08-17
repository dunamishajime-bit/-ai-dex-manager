#!/usr/bin/env bash
set -Eeuo pipefail

# Three-way, read-only source audit for the VPS-only release marker problem.
# It compares:
#   A) Git base commit used by the V12 implementation branch,
#   B) the currently deployed VPS release (which may not be a Git commit),
#   C) the candidate immutable V12 release.
# It never reads /etc/disdex secrets, calls Aster, or mutates a service.
current_input="${1:-/home/deploy/disdex-trading/current}"
candidate_input="${2:-}"
source_repo="${3:-}"
base_sha="${4:-}"
[[ -n "$candidate_input" && "$source_repo" == /* && -d "$source_repo" && ! -L "$source_repo" && "$base_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'usage: %s [current-release-or-current-symlink] /home/deploy/disdex-trading/releases/<candidate-sha> /absolute/trusted/git/repo <base-sha>\n' "$0" >&2
  exit 2
}
command -v runuser >/dev/null || { printf 'VPS_DELTA_RUNUSER_MISSING\n' >&2; exit 2; }
current="$(readlink -f "$current_input")"
candidate="$(readlink -f "$candidate_input")"
[[ -d "$current" && ! -L "$current" ]] || { printf 'VPS_DELTA_CURRENT_RELEASE_INVALID\n' >&2; exit 2; }
[[ -d "$candidate" && ! -L "$candidate" ]] || { printf 'VPS_DELTA_CANDIDATE_RELEASE_INVALID\n' >&2; exit 2; }
resolved_base="$(runuser -u deploy -- git -C "$source_repo" rev-parse --verify "${base_sha}^{commit}" 2>/dev/null || true)"
[[ "$resolved_base" == "$base_sha" ]] || { printf 'VPS_DELTA_BASE_COMMIT_NOT_AVAILABLE\n' >&2; exit 2; }

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
report="$report_root/${current_sha}-base-${base_sha}-to-${candidate_sha}.txt"
: > "$report"
chmod 0600 "$report"

tmp_root="$(mktemp -d)"
cleanup() { rm -rf "$tmp_root"; }
trap cleanup EXIT INT TERM HUP

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

hash_file() { sha256sum "$1" | awk '{print $1}'; }
base_file() {
  local rel="$1" out="$2"
  runuser -u deploy -- git -C "$source_repo" show "${base_sha}:${rel}" > "$out" 2>/dev/null
}

vps_delta_count=0
preserved_count=0
would_lose_count=0
overlap_count=0
candidate_only_count=0
missing_count=0
{
  printf 'V12_CURRENT_RELEASE_THREE_WAY_DELTA_AUDIT\n'
  printf 'baseSha=%s\nsourceRepo=%s\n' "$base_sha" "$source_repo"
  printf 'currentRelease=%s\ncurrentSha=%s\n' "$current" "$current_sha"
  printf 'candidateRelease=%s\ncandidateSha=%s\n' "$candidate" "$candidate_sha"
  printf 'generatedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'ordersSent=false\nservicesChanged=false\nsecretsRead=false\n\n'
} >> "$report"

for rel in "${critical_paths[@]}"; do
  current_file="$current/$rel"
  candidate_file="$candidate/$rel"
  safe_name="$(printf '%s' "$rel" | tr '/ ' '__')"
  base_file_path="$tmp_root/$safe_name.base"

  base_exists=true
  if ! base_file "$rel" "$base_file_path"; then base_exists=false; fi
  current_exists=true; [[ -f "$current_file" ]] || current_exists=false
  candidate_exists=true; [[ -f "$candidate_file" ]] || candidate_exists=false

  if [[ "$base_exists" != true || "$current_exists" != true || "$candidate_exists" != true ]]; then
    missing_count=$((missing_count + 1))
    printf 'MISSING_OR_NEW path=%s base=%s current=%s candidate=%s\n' "$rel" "$base_exists" "$current_exists" "$candidate_exists" >> "$report"
    # A current-only file is an explicit VPS delta that cannot be silently lost.
    if [[ "$current_exists" == true && "$base_exists" != true && "$candidate_exists" != true ]]; then
      would_lose_count=$((would_lose_count + 1))
      vps_delta_count=$((vps_delta_count + 1))
      printf 'VPS_DELTA_WOULD_BE_LOST path=%s reason=current-only-file\n' "$rel" >> "$report"
    elif [[ "$current_exists" == true && "$base_exists" != true && "$candidate_exists" == true ]]; then
      vps_delta_count=$((vps_delta_count + 1))
      current_hash="$(hash_file "$current_file")"; candidate_hash="$(hash_file "$candidate_file")"
      if [[ "$current_hash" == "$candidate_hash" ]]; then
        preserved_count=$((preserved_count + 1)); printf 'VPS_DELTA_PRESERVED path=%s reason=current-new-file-preserved\n' "$rel" >> "$report"
      else
        overlap_count=$((overlap_count + 1)); printf 'VPS_DELTA_OVERLAP_REVIEW path=%s reason=current-new-file-differs\n' "$rel" >> "$report"
      fi
    fi
    continue
  fi

  base_hash="$(hash_file "$base_file_path")"
  current_hash="$(hash_file "$current_file")"
  candidate_hash="$(hash_file "$candidate_file")"
  current_delta=false; [[ "$current_hash" != "$base_hash" ]] && current_delta=true
  candidate_delta=false; [[ "$candidate_hash" != "$base_hash" ]] && candidate_delta=true

  if [[ "$current_delta" != true && "$candidate_delta" != true ]]; then
    printf 'UNCHANGED path=%s sha256=%s\n' "$rel" "$base_hash" >> "$report"
    continue
  fi
  if [[ "$current_delta" != true && "$candidate_delta" == true ]]; then
    candidate_only_count=$((candidate_only_count + 1))
    printf 'CANDIDATE_INTENDED_CHANGE path=%s base=%s candidate=%s\n' "$rel" "$base_hash" "$candidate_hash" >> "$report"
    continue
  fi

  # Anything current!=base is a VPS-side delta relative to the implementation
  # branch base and must be explicitly preserved or reviewed.
  vps_delta_count=$((vps_delta_count + 1))
  if [[ "$current_hash" == "$candidate_hash" ]]; then
    preserved_count=$((preserved_count + 1))
    printf 'VPS_DELTA_PRESERVED path=%s sha256=%s\n' "$rel" "$current_hash" >> "$report"
    continue
  fi
  if [[ "$candidate_hash" == "$base_hash" ]]; then
    would_lose_count=$((would_lose_count + 1))
    printf 'VPS_DELTA_WOULD_BE_LOST path=%s base=%s current=%s candidate=%s\n' "$rel" "$base_hash" "$current_hash" "$candidate_hash" >> "$report"
  else
    overlap_count=$((overlap_count + 1))
    printf 'VPS_DELTA_OVERLAP_REVIEW path=%s base=%s current=%s candidate=%s\n' "$rel" "$base_hash" "$current_hash" "$candidate_hash" >> "$report"
  fi

  printf '%s\n' "--- base -> current: $rel" >> "$report"
  diff -u --label "base/$rel" --label "current/$rel" "$base_file_path" "$current_file" 2>/dev/null | head -n 160 >> "$report" || true
  printf '%s\n' "--- base -> candidate: $rel" >> "$report"
  diff -u --label "base/$rel" --label "candidate/$rel" "$base_file_path" "$candidate_file" 2>/dev/null | head -n 160 >> "$report" || true
  printf '\n' >> "$report"
done

{
  printf '\nsummaryVpsDelta=%d\n' "$vps_delta_count"
  printf 'summaryPreserved=%d\n' "$preserved_count"
  printf 'summaryWouldBeLost=%d\n' "$would_lose_count"
  printf 'summaryOverlapReview=%d\n' "$overlap_count"
  printf 'summaryCandidateOnly=%d\n' "$candidate_only_count"
  printf 'summaryMissingOrNew=%d\n' "$missing_count"
} >> "$report"

printf 'STATUS: VPS_RELEASE_THREE_WAY_DELTA_AUDIT_COMPLETE\n'
printf 'baseSha=%s\ncurrentSha=%s\ncandidateSha=%s\n' "$base_sha" "$current_sha" "$candidate_sha"
printf 'vpsDelta=%d\npreserved=%d\nwouldBeLost=%d\noverlapReview=%d\ncandidateOnly=%d\nmissingOrNew=%d\n' \
  "$vps_delta_count" "$preserved_count" "$would_lose_count" "$overlap_count" "$candidate_only_count" "$missing_count"
printf 'report=%s\nordersSent=false\nservicesChanged=false\nsecretsRead=false\n' "$report"
if [[ $would_lose_count -gt 0 ]]; then
  printf 'VPS_RELEASE_DELTA_BLOCKED\n'
  exit 10
elif [[ $overlap_count -gt 0 ]]; then
  printf 'VPS_RELEASE_DELTA_REVIEW_REQUIRED\n'
  exit 11
else
  printf 'VPS_RELEASE_DELTA_PRESERVATION_PASS\n'
fi
