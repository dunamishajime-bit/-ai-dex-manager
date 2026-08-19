#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

current_input="${1:-/home/deploy/disdex-trading/current}"
candidate_input="${2:-}"
source_repo="${3:-}"
base_sha="${4:-}"
[[ -n "$candidate_input" && "$source_repo" == /* && -d "$source_repo" && ! -L "$source_repo" && "$base_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'usage: %s [current-release] /home/deploy/disdex-trading/releases/<candidate-sha> /trusted/git/repo <base-sha>\n' "$0" >&2
  exit 2
}
command -v runuser >/dev/null || { printf 'VPS_DELTA_V2_RUNUSER_MISSING\n' >&2; exit 2; }
current="$(readlink -f "$current_input")"
candidate="$(readlink -f "$candidate_input")"
[[ -d "$current" && ! -L "$current" ]] || { printf 'VPS_DELTA_V2_CURRENT_INVALID\n' >&2; exit 2; }
[[ -d "$candidate" && ! -L "$candidate" ]] || { printf 'VPS_DELTA_V2_CANDIDATE_INVALID\n' >&2; exit 2; }

verify_release() {
  local path="$1" marker sha
  marker="$path/.disdex-release-sha"
  [[ -f "$marker" && ! -L "$marker" ]] || return 1
  sha="$(tr -d '[:space:]' < "$marker")"
  [[ "$sha" =~ ^[0-9a-f]{40}$ && "$(basename "$path")" == "$sha" ]] || return 1
}
verify_release "$current" || { printf 'VPS_DELTA_V2_CURRENT_MARKER_INVALID\n' >&2; exit 2; }
verify_release "$candidate" || { printf 'VPS_DELTA_V2_CANDIDATE_MARKER_INVALID\n' >&2; exit 2; }
current_sha="$(tr -d '[:space:]' < "$current/.disdex-release-sha")"
candidate_sha="$(tr -d '[:space:]' < "$candidate/.disdex-release-sha")"
for commit in "$base_sha" "$candidate_sha"; do
  resolved="$(runuser -u deploy -- git -C "$source_repo" rev-parse --verify "${commit}^{commit}" 2>/dev/null || true)"
  [[ "$resolved" == "$commit" ]] || { printf 'VPS_DELTA_V2_GIT_OBJECT_MISSING sha=%s\n' "$commit" >&2; exit 2; }
done

report_root="${DISDEX_V12_DELTA_REPORT_ROOT:-/home/deploy/disdex-ops/v12-release-delta}"
install -d -m 0700 "$report_root"
report="$report_root/${current_sha}-base-${base_sha}-to-${candidate_sha}-full-tree.txt"
: > "$report"; chmod 0600 "$report"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM HUP
base_list="$tmp/base.txt"; candidate_list="$tmp/candidate.txt"; current_list="$tmp/current.txt"; all_list="$tmp/all.txt"
runuser -u deploy -- git -C "$source_repo" ls-tree -r --name-only "$base_sha" | LC_ALL=C sort -u > "$base_list"
runuser -u deploy -- git -C "$source_repo" ls-tree -r --name-only "$candidate_sha" | LC_ALL=C sort -u > "$candidate_list"
base_tree="$tmp/base-tree"; candidate_tree="$tmp/candidate-tree"
mkdir -p "$base_tree" "$candidate_tree"
runuser -u deploy -- git -C "$source_repo" archive --format=tar "$base_sha" | tar -xf - -C "$base_tree"
runuser -u deploy -- git -C "$source_repo" archive --format=tar "$candidate_sha" | tar -xf - -C "$candidate_tree"

# Current-only files are included unless they are known build/runtime products or
# possible secret env/key material. Secret-like paths are never read or diffed.
(
  cd "$current"
  find . -type f -print | sed 's#^\./##' | while IFS= read -r rel; do
    case "$rel" in
      node_modules/*|.next/*|.git/*|.runtime-state/*|.codex-tmp/*|coverage/*|dist/*|.cache/*|tmp/*|logs/*) continue ;;
      .disdex-release-*|*.log|*.pid|*.sock|*/__pycache__/*|__pycache__/*|*.pyc|*.pre-*) continue ;;
      .env|.env.local|.env.production|.env.development|.env.test|*.pem|*.key|*private-key*|*secret*) continue ;;
    esac
    printf '%s\n' "$rel"
  done
) | LC_ALL=C sort -u > "$current_list"
cat "$base_list" "$candidate_list" "$current_list" | LC_ALL=C sort -u > "$all_list"

hash_file() { sha256sum "$1" | awk '{print $1}'; }
# Compare source text independent of CRLF/LF checkout normalization while
# retaining raw SHA256 above for immutable candidate identity verification.
compare_hash_file() {
  local path="$1"
  if LC_ALL=C grep -Iq . "$path"; then
    sed 's/\r$//' "$path" | sha256sum | awk '{print $1}'
  else
    hash_file "$path"
  fi
}
git_file() {
  local commit="$1" rel="$2" out="$3" src
  case "$commit" in
    "$base_sha") src="$base_tree/$rel" ;;
    "$candidate_sha") src="$candidate_tree/$rel" ;;
    *) return 1 ;;
  esac
  [[ -f "$src" ]] || return 1
  cp -- "$src" "$out"
}
append_diff() {
  local a_label="$1" a="$2" b_label="$3" b="$4"
  printf '%s\n' "--- $a_label -> $b_label" >> "$report"
  diff -u --label "$a_label" --label "$b_label" "$a" "$b" 2>/dev/null | head -n 200 >> "$report" || true
}
review_manifest="$candidate/ops/review/v12-vps-delta-reviewed.tsv"
reviewed_overlap() {
  local rel="$1" current_hash="$2" candidate_hash="$3"
  [[ -f "$review_manifest" && ! -L "$review_manifest" ]] || return 1
  awk -F '\t' -v p="$rel" -v c="$current_hash" -v n="$candidate_hash" '$1==p && $2==c && $3==n && $4=="INTENTIONAL_CANDIDATE_SUPERSEDES_CURRENT" {ok=1} END {exit !ok}' "$review_manifest"
}

vps_delta=0; preserved=0; reviewed=0; would_lose=0; overlap=0; candidate_only=0; unchanged=0; structural=0
{
  printf 'V12_CURRENT_RELEASE_FULL_TREE_DELTA_AUDIT_V2\n'
  printf 'baseSha=%s\ncurrentSha=%s\ncandidateSha=%s\n' "$base_sha" "$current_sha" "$candidate_sha"
  printf 'baseTrackedFiles=%s\ncandidateTrackedFiles=%s\ncurrentFilteredFiles=%s\n' "$(wc -l < "$base_list")" "$(wc -l < "$candidate_list")" "$(wc -l < "$current_list")"
  printf 'generatedAt=%s\nordersSent=false\nservicesChanged=false\nsecretsRead=false\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >> "$report"

while IFS= read -r rel; do
  [[ -n "$rel" ]] || continue
  # Never inspect secret-like paths even when accidentally Git-tracked.
  case "$rel" in
    .env|.env.local|.env.production|.env.development|.env.test|*.pem|*.key|*private-key*|*secret*)
      printf 'SECRET_LIKE_PATH_EXCLUDED pathHash=%s\n' "$(printf '%s' "$rel" | sha256sum | awk '{print $1}')" >> "$report"
      continue
      ;;
  esac

  safe="$(printf '%s' "$rel" | sha256sum | awk '{print $1}')"
  base_tmp="$tmp/$safe.base"; candidate_tmp="$tmp/$safe.candidate"
  base_exists=true; git_file "$base_sha" "$rel" "$base_tmp" || base_exists=false
  candidate_git_exists=true; git_file "$candidate_sha" "$rel" "$candidate_tmp" || candidate_git_exists=false
  current_exists=true; [[ -f "$current/$rel" ]] || current_exists=false
  candidate_exists=true; [[ -f "$candidate/$rel" ]] || candidate_exists=false

  # Candidate immutable release must match its exact Git object for every source
  # path considered here; otherwise deployment identity is broken.
  if [[ "$candidate_git_exists" == true ]]; then
    [[ "$candidate_exists" == true ]] || { printf 'CANDIDATE_RELEASE_SOURCE_MISSING path=%s\n' "$rel" >> "$report"; overlap=$((overlap+1)); continue; }
    if [[ "$(hash_file "$candidate_tmp")" != "$(hash_file "$candidate/$rel")" ]]; then
      printf 'CANDIDATE_RELEASE_SOURCE_MISMATCH path=%s\n' "$rel" >> "$report"; overlap=$((overlap+1)); continue
    fi
  elif [[ "$candidate_exists" == true && $(grep -Fx -- "$rel" "$current_list" >/dev/null 2>&1; echo $?) -ne 0 ]]; then
    # Generated candidate files are excluded by the path set; an unexpected
    # source-like candidate-only file is review-worthy.
    printf 'CANDIDATE_UNTRACKED_SOURCE_REVIEW path=%s\n' "$rel" >> "$report"; overlap=$((overlap+1)); continue
  fi

  if [[ "$base_exists" != "$current_exists" || "$base_exists" != "$candidate_git_exists" || "$current_exists" != "$candidate_exists" ]]; then structural=$((structural+1)); fi

  if [[ "$base_exists" != true ]]; then
    if [[ "$current_exists" != true && "$candidate_git_exists" == true ]]; then
      candidate_only=$((candidate_only+1)); printf 'CANDIDATE_INTENDED_ADD path=%s\n' "$rel" >> "$report"
    elif [[ "$current_exists" == true && "$candidate_git_exists" != true ]]; then
      vps_delta=$((vps_delta+1)); would_lose=$((would_lose+1)); printf 'VPS_DELTA_WOULD_BE_LOST path=%s reason=current-only-source\n' "$rel" >> "$report"
    elif [[ "$current_exists" == true && "$candidate_git_exists" == true ]]; then
      vps_delta=$((vps_delta+1))
      current_hash="$(compare_hash_file "$current/$rel")"; candidate_hash="$(compare_hash_file "$candidate_tmp")"
      if [[ "$current_hash" == "$candidate_hash" ]]; then preserved=$((preserved+1)); printf 'VPS_DELTA_PRESERVED path=%s reason=current-addition-preserved\n' "$rel" >> "$report"
      elif reviewed_overlap "$rel" "$current_hash" "$candidate_hash"; then reviewed=$((reviewed+1)); printf 'VPS_DELTA_REVIEWED_SUPERSEDED path=%s reason=current-addition-reviewed\n' "$rel" >> "$report"
      else overlap=$((overlap+1)); printf 'VPS_DELTA_OVERLAP_REVIEW path=%s reason=current-addition-differs\n' "$rel" >> "$report"; fi
    fi
    continue
  fi

  base_hash="$(compare_hash_file "$base_tmp")"
  if [[ "$current_exists" != true ]]; then
    vps_delta=$((vps_delta+1))
    if [[ "$candidate_git_exists" != true ]]; then preserved=$((preserved+1)); printf 'VPS_DELTA_PRESERVED path=%s reason=current-deletion-preserved\n' "$rel" >> "$report"
    elif [[ "$(compare_hash_file "$candidate_tmp")" == "$base_hash" ]]; then would_lose=$((would_lose+1)); printf 'VPS_DELTA_WOULD_BE_LOST path=%s reason=current-deletion-restored\n' "$rel" >> "$report"
    else overlap=$((overlap+1)); printf 'VPS_DELTA_OVERLAP_REVIEW path=%s reason=current-deletion-vs-candidate-change\n' "$rel" >> "$report"; fi
    continue
  fi

  current_hash="$(compare_hash_file "$current/$rel")"
  current_delta=false; [[ "$current_hash" != "$base_hash" ]] && current_delta=true
  if [[ "$candidate_git_exists" != true ]]; then
    if [[ "$current_delta" == false ]]; then candidate_only=$((candidate_only+1)); printf 'CANDIDATE_INTENDED_DELETE path=%s\n' "$rel" >> "$report"
    else vps_delta=$((vps_delta+1)); overlap=$((overlap+1)); printf 'VPS_DELTA_OVERLAP_REVIEW path=%s reason=candidate-deletes-vps-change\n' "$rel" >> "$report"; append_diff "base/$rel" "$base_tmp" "current/$rel" "$current/$rel"; fi
    continue
  fi

  candidate_hash="$(compare_hash_file "$candidate_tmp")"
  candidate_delta=false; [[ "$candidate_hash" != "$base_hash" ]] && candidate_delta=true
  if [[ "$current_delta" == false && "$candidate_delta" == false ]]; then unchanged=$((unchanged+1)); continue; fi
  if [[ "$current_delta" == false && "$candidate_delta" == true ]]; then candidate_only=$((candidate_only+1)); printf 'CANDIDATE_INTENDED_CHANGE path=%s\n' "$rel" >> "$report"; continue; fi

  vps_delta=$((vps_delta+1))
  if [[ "$current_hash" == "$candidate_hash" ]]; then preserved=$((preserved+1)); printf 'VPS_DELTA_PRESERVED path=%s\n' "$rel" >> "$report"; continue; fi
  if [[ "$candidate_hash" == "$base_hash" ]]; then would_lose=$((would_lose+1)); printf 'VPS_DELTA_WOULD_BE_LOST path=%s reason=candidate-restores-base\n' "$rel" >> "$report"
  elif reviewed_overlap "$rel" "$current_hash" "$candidate_hash"; then reviewed=$((reviewed+1)); printf 'VPS_DELTA_REVIEWED_SUPERSEDED path=%s reason=both-changed-reviewed\n' "$rel" >> "$report"
  else overlap=$((overlap+1)); printf 'VPS_DELTA_OVERLAP_REVIEW path=%s reason=both-changed-differently\n' "$rel" >> "$report"; fi
  append_diff "base/$rel" "$base_tmp" "current/$rel" "$current/$rel"
  append_diff "base/$rel" "$base_tmp" "candidate/$rel" "$candidate_tmp"
done < "$all_list"

{
  printf '\nsummaryVpsDelta=%d\nsummaryPreserved=%d\nsummaryReviewed=%d\nsummaryWouldBeLost=%d\nsummaryOverlapReview=%d\nsummaryCandidateOnly=%d\nsummaryUnchanged=%d\nsummaryStructural=%d\n' \
    "$vps_delta" "$preserved" "$reviewed" "$would_lose" "$overlap" "$candidate_only" "$unchanged" "$structural"
} >> "$report"
printf 'STATUS: VPS_RELEASE_FULL_TREE_DELTA_AUDIT_COMPLETE\nbaseSha=%s\ncurrentSha=%s\ncandidateSha=%s\n' "$base_sha" "$current_sha" "$candidate_sha"
printf 'vpsDelta=%d\npreserved=%d\nreviewed=%d\nwouldBeLost=%d\noverlapReview=%d\ncandidateOnly=%d\nstructural=%d\n' "$vps_delta" "$preserved" "$reviewed" "$would_lose" "$overlap" "$candidate_only" "$structural"
printf 'report=%s\nordersSent=false\nservicesChanged=false\nsecretsRead=false\n' "$report"
if (( would_lose > 0 )); then printf 'VPS_RELEASE_DELTA_BLOCKED\n'; exit 10; fi
if (( overlap > 0 )); then printf 'VPS_RELEASE_DELTA_REVIEW_REQUIRED\n'; exit 11; fi
printf 'VPS_RELEASE_FULL_TREE_DELTA_PRESERVATION_PASS\n'
