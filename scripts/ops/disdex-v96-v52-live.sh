#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

marker="$(pwd -P)/.disdex-release-sha"
[[ -f "$marker" ]] || {
  printf 'release marker missing\n' >&2
  exit 1
}
sha="$(tr -d '[:space:]' < "$marker")"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'invalid release SHA marker\n' >&2
  exit 1
}
expected="/home/deploy/disdex-trading/releases/$sha"
[[ "$(pwd -P)" == "$expected" ]] || {
  printf 'working directory does not match immutable release SHA\n' >&2
  exit 1
}
[[ "$(readlink -f /home/deploy/disdex-trading/current)" == "$expected" ]] || {
  printf 'current link does not target this immutable release\n' >&2
  exit 1
}
export DISDEX_V96_RUNTIME_COMMIT_SHA="$sha"
exec /usr/bin/npm run strategy:disdex-v52:daemon
