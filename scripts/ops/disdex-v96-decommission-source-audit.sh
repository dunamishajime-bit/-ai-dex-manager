#!/usr/bin/env bash
set -Eeuo pipefail

root="${1:-.}"
mode="${2:---pre}"
[[ -d "$root" ]] || { printf 'V96_DECOMMISSION_AUDIT_ROOT_INVALID\n' >&2; exit 2; }
[[ "$mode" == "--pre" || "$mode" == "--expect-clean" ]] || { printf 'V96_DECOMMISSION_AUDIT_MODE_INVALID\n' >&2; exit 2; }

cd "$root"

# This audit is read-only. It distinguishes historical/documentation references
# from executable/runtime references. The latter must be eliminated or renamed
# before a post-V12 clean release can be declared V96-free.
runtime_paths=(config lib scripts ops package.json .github)
pattern='DISDEX_V96|V96_|_V96|disdex-v96|disdex_v96|V96 LIVE|V96_LIVE'

# Prefer ripgrep when present, but do not make the audit depend on it. The
# production/decommission host only needs standard GNU grep for the fallback.
set +e
if command -v rg >/dev/null 2>&1; then
  runtime_hits="$(rg -n --hidden \
    --glob '!docs/**' \
    --glob '!research/**' \
    --glob '!artifacts/**' \
    --glob '!node_modules/**' \
    --glob '!.next/**' \
    --glob '!scripts/ops/disdex-v96-decommission-source-audit.sh' \
    --glob '!scripts/ops/root/disdex-v96-runtime-decommission-readiness' \
    --glob '!.github/workflows/v96-decommission-prep-ci.yml' \
    "$pattern" "${runtime_paths[@]}" 2>/dev/null)"
  scan_status=$?
  scan_tool=rg
else
  runtime_hits="$(grep -RInE \
    --exclude-dir=docs \
    --exclude-dir=research \
    --exclude-dir=artifacts \
    --exclude-dir=node_modules \
    --exclude-dir=.next \
    --exclude='disdex-v96-decommission-source-audit.sh' \
    --exclude='disdex-v96-runtime-decommission-readiness' \
    --exclude='v96-decommission-prep-ci.yml' \
    -- "$pattern" "${runtime_paths[@]}" 2>/dev/null)"
  scan_status=$?
  scan_tool=grep
fi
set -e
if (( scan_status != 0 && scan_status != 1 )); then
  printf 'V96_DECOMMISSION_AUDIT_SCAN_FAILED tool=%s code=%s\n' "$scan_tool" "$scan_status" >&2
  exit "$scan_status"
fi

printf 'V96_DECOMMISSION_AUDIT_SCAN_TOOL=%s\n' "$scan_tool"
printf 'V96_DECOMMISSION_RUNTIME_REFERENCE_COUNT=%s\n' "$(printf '%s\n' "$runtime_hits" | sed '/^$/d' | wc -l | tr -d ' ')"
if [[ -n "$runtime_hits" ]]; then
  printf '%s\n' '--- executable/runtime V96 references ---'
  printf '%s\n' "$runtime_hits"
fi

# Known shared responsibilities that must survive under neutral names. These are
# not permission to keep V96 runtime logic; they are a checklist for refactoring
# before deletion.
printf '%s\n' 'SHARED_SURVIVORS_REQUIRED=account-order-lock,shared-crypto-risk,shared-kill-switch,portfolio-gross,margin-guard,aster-adapter,v52-reference-quality'
printf '%s\n' 'V96_RUNTIME_DELETE_REQUIRED=runner,supervisor,preflight,operator-override,v96-state-migration,v96-systemd,v96-start-interlocks,v96-only-env'
printf '%s\n' 'ORDERS_SENT_FOR_AUDIT=0'

if [[ "$mode" == "--expect-clean" && -n "$runtime_hits" ]]; then
  printf 'STATUS: V96_DECOMMISSION_SOURCE_NOT_CLEAN\n' >&2
  exit 3
fi

if [[ "$mode" == "--expect-clean" ]]; then
  printf 'STATUS: V96_DECOMMISSION_SOURCE_CLEAN\n'
else
  printf 'STATUS: V96_DECOMMISSION_PREP_AUDIT_COMPLETE\n'
fi
