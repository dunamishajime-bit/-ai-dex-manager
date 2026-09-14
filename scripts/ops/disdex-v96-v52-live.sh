#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

marker="$(pwd -P)/.disdex-release-sha"
[[ -f "$marker" && ! -L "$marker" ]] || {
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

policy_script="$(pwd -P)/scripts/ops/disdex-v96-v52-live-policy.sh"
[[ -f "$policy_script" && ! -L "$policy_script" ]] || {
  printf 'fixed LIVE policy script missing\n' >&2
  exit 1
}
# shellcheck source=scripts/ops/disdex-v96-v52-live-policy.sh
source "$policy_script"
disdex_apply_v96_v52_fixed_live_policy
disdex_assert_v96_v52_fixed_live_policy
disdex_apply_v96_v52_shared_runtime_paths
disdex_assert_v96_v52_shared_runtime_paths

export DISDEX_V96_RUNTIME_COMMIT_SHA="$sha"
export DISDEX_V96_V52_MARGIN_GUARD_SCRIPT="scripts/disdex_v96_v52_margin_guard_runtime.py"
export DISDEX_V96_CONFIG_MIGRATION_MODE=true
export DISDEX_V96_OPERATOR_AUDIT_SYNC_ACKNOWLEDGEMENT=I_SYNC_CURRENT_EXACT_OPERATOR_OVERRIDE_AUDIT

mkdir -p "$DISDEX_V96_V52_MARGIN_GUARD_STATE_DIR"
chmod 0700 "$DISDEX_V96_V52_MARGIN_GUARD_STATE_DIR"

kill_switch_active() {
  [[ -f "$DISDEX_V96_KILL_SWITCH_FILE" ]] \
    && /usr/bin/jq -e '.active == true' "$DISDEX_V96_KILL_SWITCH_FILE" >/dev/null 2>&1
}

# Never wait indefinitely at startup. If the Kill Switch is already active,
# execute one bounded emergency reduce-only reconciliation and leave LIVE off.
# A later formal operator clearance and explicit restart are required.
if kill_switch_active; then
  /usr/bin/python3 scripts/disdex_v96_v52_margin_guard_runtime.py \
    --mode live \
    --emergency-once
  printf 'DISDEX_V96_V52_LIVE_NOT_STARTED_KILL_SWITCH_ACTIVE\n'
  printf 'runtimeCommitSha=%s\n' "$sha"
  printf 'startupWaitLoop=false\n'
  printf 'liveSupervisorStarted=false\n'
  printf 'formalOperatorClearanceRequired=true\n'
  exit 0
fi

/usr/bin/npm run strategy:disdex-v96:override:audit:sync

# Close the small race in which a Kill Switch is activated during audit sync.
if kill_switch_active; then
  /usr/bin/python3 scripts/disdex_v96_v52_margin_guard_runtime.py \
    --mode live \
    --emergency-once
  printf 'DISDEX_V96_V52_LIVE_NOT_STARTED_KILL_SWITCH_ACTIVATED_DURING_STARTUP\n'
  printf 'runtimeCommitSha=%s\n' "$sha"
  printf 'startupWaitLoop=false\n'
  printf 'liveSupervisorStarted=false\n'
  printf 'formalOperatorClearanceRequired=true\n'
  exit 0
fi

intentional_stop=false
guard_pid=""
supervisor_pid=""

stop_children() {
  intentional_stop=true
  [[ -z "$guard_pid" ]] || kill -TERM "$guard_pid" >/dev/null 2>&1 || true
  [[ -z "$supervisor_pid" ]] || kill -TERM "$supervisor_pid" >/dev/null 2>&1 || true
  [[ -z "$guard_pid" ]] || wait "$guard_pid" >/dev/null 2>&1 || true
  [[ -z "$supervisor_pid" ]] || wait "$supervisor_pid" >/dev/null 2>&1 || true
}
trap 'stop_children; exit 0' INT TERM HUP

/usr/bin/python3 scripts/disdex_v96_v52_margin_guard_runtime.py --mode live --daemon &
guard_pid=$!
/usr/bin/npm run strategy:disdex-v52:daemon &
supervisor_pid=$!

printf 'DISDEX_V96_V52_LIVE_PROCESS_GROUP_START\n'
printf 'runtimeCommitSha=%s\nmarginGuardPid=%s\nsupervisorPid=%s\n' "$sha" "$guard_pid" "$supervisor_pid"
printf 'marginGuardRuntime=serialized\n'
printf 'healthyMarginPollIntervalMs=300000\nwarningMarginPollIntervalMs=60000\n'
printf 'ordersSentByLauncher=false\n'

set +e
wait -n "$guard_pid" "$supervisor_pid"
child_status=$?
set -e

if [[ "$intentional_stop" == "true" ]]; then
  stop_children
  exit 0
fi

reason="LIVE child exited unexpectedly"
if ! kill -0 "$guard_pid" >/dev/null 2>&1; then
  reason="Serialized adaptive Margin Guard exited unexpectedly with status $child_status"
elif ! kill -0 "$supervisor_pid" >/dev/null 2>&1; then
  reason="V96/V52 trading supervisor exited unexpectedly with status $child_status"
fi

DISDEX_UNEXPECTED_CHILD_REASON="$reason" \
DISDEX_UNEXPECTED_CHILD_KILL_SWITCH="$DISDEX_V96_KILL_SWITCH_FILE" \
/usr/bin/python3 <<'PY'
import datetime as dt
import json
import os
import tempfile
from pathlib import Path

path = Path(os.environ["DISDEX_UNEXPECTED_CHILD_KILL_SWITCH"])
reason = os.environ["DISDEX_UNEXPECTED_CHILD_REASON"]
path.parent.mkdir(parents=True, exist_ok=True)
payload = {
    "active": True,
    "strategyId": "DISDEX_V35_STRONG_RESERVED_PENGU_V96",
    "combinedStrategyId": "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",
    "action": "FLATTEN_MANAGED",
    "reason": reason,
    "operator": "disdex-v96-v52-live-launcher",
    "activatedAt": dt.datetime.now(tz=dt.timezone.utc).isoformat(),
}
handle, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
try:
    with os.fdopen(handle, "w", encoding="utf-8") as writer:
        json.dump(payload, writer, ensure_ascii=False, indent=2, sort_keys=True)
        writer.write("\n")
        writer.flush()
        os.fsync(writer.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

printf 'DISDEX_V96_V52_LIVE_CHILD_FAILURE_FAIL_CLOSED\n' >&2
printf 'reason=%s\nkillSwitchActivated=true\n' "$reason" >&2
stop_children
exit 1
