#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
# shellcheck source=scripts/ops/root/disdex-promotion-transaction-lib.sh
source "$repo_root/scripts/ops/root/disdex-promotion-transaction-lib.sh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

releases="$tmp/releases"
old_sha="1111111111111111111111111111111111111111"
new_sha="2222222222222222222222222222222222222222"
old_release="$releases/$old_sha"
new_release="$releases/$new_sha"
mkdir -p "$old_release" "$new_release" "$tmp/shared/approval" "$tmp/shared/state/crypto-v96" "$tmp/shared/state/stock" "$tmp/transaction"
printf '%s\n' "$old_sha" > "$old_release/.disdex-release-sha"
printf '%s\n' "$new_sha" > "$new_release/.disdex-release-sha"
ln -s "$old_release" "$tmp/current"

parity="$tmp/shared/approval/parity.json"
override="$tmp/shared/approval/operator-override.json"
crypto="$tmp/shared/state/crypto-v96/runner-live.json"
stock="$tmp/shared/state/stock/runner-live.json"
printf '%s\n' '{"approvedCommitSha":"old","kind":"parity"}' > "$parity"
printf '%s\n' '{"approvedCommitSha":"old","kind":"override"}' > "$override"
printf '%s\n' '{"approvedCommitSha":"old","kind":"crypto"}' > "$crypto"
printf '%s\n' '{"approvedCommitSha":"old","kind":"stock"}' > "$stock"

old_parity="$(disdex_txn_sha256 "$parity")"
old_override="$(disdex_txn_sha256 "$override")"
old_crypto="$(disdex_txn_sha256 "$crypto")"
old_stock="$(disdex_txn_sha256 "$stock")"

disdex_txn_snapshot_current "$tmp/current" "$releases" "$tmp/transaction"
disdex_txn_snapshot_file "$parity" "$tmp/transaction" parity.json
disdex_txn_snapshot_file "$override" "$tmp/transaction" operator-override.json
disdex_txn_snapshot_file "$crypto" "$tmp/transaction" crypto-runner-live.json
disdex_txn_snapshot_file "$stock" "$tmp/transaction" stock-runner-live.json

disdex_txn_atomic_symlink "$tmp/current" "$new_release"
printf '%s\n' '{"approvedCommitSha":"new","kind":"parity"}' > "$parity"
printf '%s\n' '{"approvedCommitSha":"new","kind":"override"}' > "$override"
printf '%s\n' '{"approvedCommitSha":"new","kind":"crypto"}' > "$crypto"
printf '%s\n' '{"approvedCommitSha":"new","kind":"stock"}' > "$stock"

disdex_txn_restore_file "$tmp/transaction" parity.json "$parity"
disdex_txn_restore_file "$tmp/transaction" operator-override.json "$override"
disdex_txn_restore_file "$tmp/transaction" crypto-runner-live.json "$crypto"
disdex_txn_restore_file "$tmp/transaction" stock-runner-live.json "$stock"
disdex_txn_restore_current "$tmp/transaction" "$tmp/current" "$releases"
disdex_txn_verify_current "$tmp/transaction" "$tmp/current"

[[ "$(disdex_txn_sha256 "$parity")" == "$old_parity" ]]
[[ "$(disdex_txn_sha256 "$override")" == "$old_override" ]]
[[ "$(disdex_txn_sha256 "$crypto")" == "$old_crypto" ]]
[[ "$(disdex_txn_sha256 "$stock")" == "$old_stock" ]]
[[ "$(readlink -f "$tmp/current")" == "$old_release" ]]

# A damaged rollback backup must be rejected rather than silently restored.
printf '%s\n' 'tampered' >> "$tmp/transaction/parity.json"
if disdex_txn_restore_file "$tmp/transaction" parity.json "$parity" 2>/dev/null; then
  printf 'tampered rollback backup was incorrectly accepted\n' >&2
  exit 1
fi

printf 'DISDEX_V96_V52_PROMOTION_ROLLBACK_SELFTEST_PASS\n'
printf 'currentRestored=true\n'
printf 'approvalRestored=true\n'
printf 'cryptoStateRestored=true\n'
printf 'stockStateRestored=true\n'
printf 'tamperRejected=true\n'
