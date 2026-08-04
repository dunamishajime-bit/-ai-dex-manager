#!/usr/bin/env bash

# Shared filesystem transaction primitives for DisDex release promotion.
# This file never starts services or submits/cancels orders.

disdex_txn_sha256() {
  sha256sum "$1" | awk '{print $1}'
}

disdex_txn_require_regular_file() {
  local path="$1"
  local label="$2"
  [[ -f "$path" && ! -L "$path" ]] || {
    printf 'transaction source must be a regular non-symlink file: %s\n' "$label" >&2
    return 1
  }
}

disdex_txn_snapshot_file() {
  local source="$1"
  local transaction_dir="$2"
  local key="$3"
  local backup="$transaction_dir/$key"
  disdex_txn_require_regular_file "$source" "$key"
  cp -a "$source" "$backup"
  disdex_txn_sha256 "$backup" > "$backup.sha256"
}

disdex_txn_restore_file() {
  local transaction_dir="$1"
  local key="$2"
  local target="$3"
  local backup="$transaction_dir/$key"
  local expected temporary
  disdex_txn_require_regular_file "$backup" "rollback backup $key"
  [[ -f "$backup.sha256" && ! -L "$backup.sha256" ]] || {
    printf 'rollback checksum missing: %s\n' "$key" >&2
    return 1
  }
  expected="$(tr -d '[:space:]' < "$backup.sha256")"
  [[ "$(disdex_txn_sha256 "$backup")" == "$expected" ]] || {
    printf 'rollback backup checksum mismatch: %s\n' "$key" >&2
    return 1
  }
  [[ ! -L "$target" ]] || {
    printf 'rollback target unexpectedly became a symlink: %s\n' "$target" >&2
    return 1
  }
  mkdir -p "$(dirname "$target")"
  temporary="${target}.rollback.$$.$RANDOM"
  rm -f "$temporary"
  cp -a "$backup" "$temporary"
  mv -f "$temporary" "$target"
  [[ "$(disdex_txn_sha256 "$target")" == "$expected" ]] || {
    printf 'restored file checksum mismatch: %s\n' "$key" >&2
    return 1
  }
}

disdex_txn_validate_release_target() {
  local target="$1"
  local releases_root="$2"
  local sha
  [[ -d "$target" && ! -L "$target" ]] || {
    printf 'release target is not an immutable directory\n' >&2
    return 1
  }
  [[ "$(dirname "$target")" == "$releases_root" ]] || {
    printf 'release target is outside the fixed releases root\n' >&2
    return 1
  }
  sha="$(basename "$target")"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
    printf 'release target basename is not an exact SHA\n' >&2
    return 1
  }
  [[ -f "$target/.disdex-release-sha" && ! -L "$target/.disdex-release-sha" ]] || {
    printf 'release SHA marker missing\n' >&2
    return 1
  }
  [[ "$(tr -d '[:space:]' < "$target/.disdex-release-sha")" == "$sha" ]] || {
    printf 'release SHA marker mismatch\n' >&2
    return 1
  }
}

disdex_txn_atomic_symlink() {
  local link_path="$1"
  local target="$2"
  local owner_group="${3:-}"
  local temporary="${link_path}.txn.$$.$RANDOM"
  rm -f "$temporary"
  ln -s "$target" "$temporary"
  if [[ -n "$owner_group" ]]; then
    chown -h "$owner_group" "$temporary"
  fi
  mv -Tf "$temporary" "$link_path"
  [[ "$(readlink -f "$link_path")" == "$target" ]] || {
    printf 'atomic symlink verification failed\n' >&2
    return 1
  }
}

disdex_txn_snapshot_current() {
  local current_link="$1"
  local releases_root="$2"
  local transaction_dir="$3"
  local target sha
  [[ -L "$current_link" ]] || {
    printf 'current release link is not set\n' >&2
    return 1
  }
  target="$(readlink -f "$current_link")"
  disdex_txn_validate_release_target "$target" "$releases_root"
  sha="$(basename "$target")"
  printf '%s\n' "$target" > "$transaction_dir/old-current-target"
  printf '%s\n' "$sha" > "$transaction_dir/old-current-sha"
}

disdex_txn_restore_current() {
  local transaction_dir="$1"
  local current_link="$2"
  local releases_root="$3"
  local owner_group="${4:-}"
  local target
  [[ -f "$transaction_dir/old-current-target" && ! -L "$transaction_dir/old-current-target" ]] || {
    printf 'old current target snapshot missing\n' >&2
    return 1
  }
  target="$(tr -d '\r\n' < "$transaction_dir/old-current-target")"
  disdex_txn_validate_release_target "$target" "$releases_root"
  disdex_txn_atomic_symlink "$current_link" "$target" "$owner_group"
}

disdex_txn_verify_current() {
  local transaction_dir="$1"
  local current_link="$2"
  local expected
  expected="$(tr -d '\r\n' < "$transaction_dir/old-current-target")"
  [[ -L "$current_link" && "$(readlink -f "$current_link")" == "$expected" ]] || {
    printf 'rollback current verification failed\n' >&2
    return 1
  }
}
