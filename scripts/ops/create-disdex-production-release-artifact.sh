#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

sha="${1:-}"
out_dir="${2:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'DISDEX_ARTIFACT_INVALID_SHA' >&2; exit 2; }
[[ "$out_dir" == /* ]] || { echo 'DISDEX_ARTIFACT_OUTPUT_MUST_BE_ABSOLUTE' >&2; exit 2; }
repo="$(git rev-parse --show-toplevel)"
resolved="$(git -C "$repo" rev-parse --verify "${sha}^{commit}")"
[[ "$resolved" == "$sha" ]] || { echo 'DISDEX_ARTIFACT_COMMIT_MISMATCH' >&2; exit 3; }
[[ "$(git -C "$repo" rev-parse HEAD)" == "$sha" ]] || { echo 'DISDEX_ARTIFACT_HEAD_MISMATCH' >&2; exit 3; }
source_tree="$(git -C "$repo" rev-parse "${sha}^{tree}")"
[[ "$source_tree" =~ ^[0-9a-f]{40}$ ]] || { echo 'DISDEX_ARTIFACT_TREE_INVALID' >&2; exit 3; }
[[ -x "$repo/node_modules/.bin/tsx" ]] || { echo 'DISDEX_ARTIFACT_TSX_MISSING' >&2; exit 4; }
[[ -d "$repo/.next" ]] || { echo 'DISDEX_ARTIFACT_NEXT_BUILD_MISSING' >&2; exit 4; }

mkdir -p "$out_dir"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT INT TERM HUP
git -C "$repo" archive --format=tar "$sha" | tar -xf - -C "$staging"
manifest_tmp="$out_dir/.disdex-source-manifest-$sha-$$"
(
  cd "$staging"
  find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum
) > "$manifest_tmp"
mv "$manifest_tmp" "$staging/.disdex-release-source-files.sha256"
printf '%s\n' "$sha" > "$staging/.disdex-release-sha"
printf '%s\n' "$source_tree" > "$staging/.disdex-release-source-tree"

cp -a "$repo/node_modules" "$staging/node_modules"
cp -a "$repo/.next" "$staging/.next"

package_lock_sha="$(sha256sum "$repo/package-lock.json" | awk '{print $1}')"
cat > "$staging/.disdex-ci-build-attestation" <<EOF
releaseSha=$sha
sourceTree=$source_tree
packageLockSha256=$package_lock_sha
nodeVersion=$(node --version)
npmVersion=$(npm --version)
workflow=${GITHUB_WORKFLOW:-LOCAL}
workflowRunId=${GITHUB_RUN_ID:-LOCAL}
workflowRunAttempt=${GITHUB_RUN_ATTEMPT:-LOCAL}
EOF
for required in \
  scripts/ops/root/install-disdex-v12-live \
  scripts/ops/root/disdex-v96-to-v12-live-migrate-final \
  scripts/ops/root/disdex-v12-live-status-report; do
  [[ -f "$staging/$required" && ! -L "$staging/$required" ]] || {
    echo "DISDEX_ARTIFACT_REQUIRED_FILE_MISSING path=$required" >&2
    exit 5
  }
done
[[ -x "$staging/node_modules/.bin/tsx" && -d "$staging/.next" ]] || {
  echo 'DISDEX_ARTIFACT_RUNTIME_INVALID' >&2
  exit 5
}
[[ "$(tr -d '[:space:]' < "$staging/.disdex-release-sha")" == "$sha" ]] || exit 5
[[ "$(tr -d '[:space:]' < "$staging/.disdex-release-source-tree")" == "$source_tree" ]] || exit 5

archive="$out_dir/disdex-release-$sha.tar.gz"
checksum="$archive.sha256"
tmp_archive="$archive.tmp.$$"
tar -czf "$tmp_archive" -C "$staging" .
mv "$tmp_archive" "$archive"
(
  cd "$out_dir"
  sha256sum "$(basename "$archive")" > "$(basename "$checksum")"
)
echo 'DISDEX_PRODUCTION_RELEASE_ARTIFACT_PASS'
echo "releaseSha=$sha"
echo "sourceTree=$source_tree"
echo "archive=$archive"
echo "checksum=$checksum"
echo "archiveSha256=$(awk '{print $1}' "$checksum")"
echo 'ordersSent=false'
echo 'servicesChanged=false'
