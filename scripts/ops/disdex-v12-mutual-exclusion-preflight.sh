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

# The runtime lock is authoritative. Never delete, steal, or repair it here.
# A short-lived valid peer lease is normal on the shared account, so bounded
# startup waiting avoids random V4 restart failures while preserving fail-close
# semantics for malformed, expired, or persistently-held locks.
lock_path="${DISDEX_ACCOUNT_LOCK_PATH:-/var/lib/disdex/shared/account-order.lock}"
wait_ms="${DISDEX_V12_PREFLIGHT_LOCK_WAIT_MS:-15000}"
retry_ms="${DISDEX_V12_PREFLIGHT_LOCK_RETRY_MS:-500}"
[[ "$wait_ms" =~ ^[0-9]+$ && "$retry_ms" =~ ^[0-9]+$ ]] || {
  printf 'V12 preflight lock wait configuration is invalid\n' >&2
  exit 1
}
(( wait_ms >= 0 && wait_ms <= 30000 && retry_ms >= 250 && retry_ms <= 2000 )) || {
  printf 'V12 preflight lock wait configuration is out of bounds\n' >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  printf 'jq is required to inspect the V12 account lock\n' >&2
  exit 1
}
started_ms="$(date +%s%3N)"
attempt=0
while [[ -e "$lock_path" ]]; do
  [[ -f "$lock_path" && ! -L "$lock_path" ]] || {
    printf 'V12 account lock path is not a regular file\n' >&2
    exit 1
  }
  jq -e 'type == "object" and (.schema == "disdex-account-lock/v1") and (.accountScope == "ASTER_FUTURES") and ((.ownerId | type) == "string") and ((.leaseId | type) == "string") and ((.expiresAt | type) == "number")' "$lock_path" >/dev/null || {
    printf 'V12 account lock is malformed; operator review required\n' >&2
    exit 1
  }
  expires_at="$(jq -r '.expiresAt' "$lock_path")"
  owner_id="$(jq -r '.ownerId' "$lock_path")"
  now_ms="$(date +%s%3N)"
  if (( expires_at <= now_ms )); then
    printf 'V12 account lock is expired; explicit recovery is required owner=%s\n' "$owner_id" >&2
    exit 1
  fi
  elapsed_ms=$(( now_ms - started_ms ))
  if (( elapsed_ms >= wait_ms )); then
    printf 'V12 account lock remained held after bounded wait; refusing concurrent startup owner=%s elapsedMs=%s attempts=%s\n' "$owner_id" "$elapsed_ms" "$attempt" >&2
    exit 1
  fi
  attempt=$(( attempt + 1 ))
  printf 'V12 account lock temporarily held; waiting owner=%s attempt=%s elapsedMs=%s\n' "$owner_id" "$attempt" "$elapsed_ms" >&2
  sleep "$(awk -v m="$retry_ms" 'BEGIN{printf "%.3f",m/1000}')"
done

printf 'DISDEX_V12_MUTUAL_EXCLUSION_PREFLIGHT_PASS\n'
printf 'releaseSha=%s\n' "$release_sha"
printf 'accountLock=absent\n'
