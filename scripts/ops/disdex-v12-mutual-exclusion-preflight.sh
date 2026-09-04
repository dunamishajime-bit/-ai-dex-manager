#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

release_sha="${1:-}"
run_mode="${2:-}"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'V12 preflight requires an exact release SHA\n' >&2
  exit 1
}
[[ "$run_mode" == "runtime" ]] || {
  printf 'V12 preflight mode is invalid\n' >&2
  exit 1
}

release_dir="$(pwd -P)"
expected_dir="/home/deploy/disdex-trading/releases/$release_sha"
[[ "$release_dir" == "$expected_dir" ]] || {
  printf 'V12 preflight must run from the immutable release\n' >&2
  exit 1
}

marker="$release_dir/.disdex-release-sha"
[[ -f "$marker" && ! -L "$marker" ]] || {
  printf 'V12 release marker is missing\n' >&2
  exit 1
}
[[ "$(tr -d '[:space:]' < "$marker")" == "$release_sha" ]] || {
  printf 'V12 release marker does not match the requested SHA\n' >&2
  exit 1
}

# The runtime lock is authoritative. This preflight never deletes or repairs
# it: a live, malformed, or expired lock requires explicit operator review.
lock_path="${DISDEX_ACCOUNT_LOCK_PATH:-/var/lib/disdex/shared/account-order.lock}"
if [[ -e "$lock_path" ]]; then
  [[ -f "$lock_path" && ! -L "$lock_path" ]] || {
    printf 'V12 account lock path is not a regular file\n' >&2
    exit 1
  }
  command -v jq >/dev/null 2>&1 || {
    printf 'jq is required to inspect the V12 account lock\n' >&2
    exit 1
  }
  jq -e 'type == "object" and (.schema == "disdex-account-lock/v1") and (.accountScope == "ASTER_FUTURES") and ((.ownerId | type) == "string") and ((.leaseId | type) == "string") and ((.expiresAt | type) == "number")' "$lock_path" >/dev/null || {
    printf 'V12 account lock is malformed; operator review required\n' >&2
    exit 1
  }
  expires_at="$(jq -r '.expiresAt' "$lock_path")"
  now_ms="$(date +%s%3N)"
  if (( expires_at > now_ms )); then
    printf 'V12 account lock is held; refusing concurrent startup\n' >&2
  else
    printf 'V12 account lock is expired; explicit recovery is required\n' >&2
  fi
  exit 1
fi

printf 'DISDEX_V12_MUTUAL_EXCLUSION_PREFLIGHT_PASS\n'
printf 'releaseSha=%s\n' "$release_sha"
printf 'accountLock=absent\n'
