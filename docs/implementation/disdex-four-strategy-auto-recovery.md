# Dis-Dex four-strategy auto-recovery runbook

This runbook covers read-only verification and bounded recovery for V12, PENGU Recovery V8, V52, and `QUALITY102_CAUSAL_V1`. The watchdog observes health and may restart an allowlisted service after an operational failure; it never submits, cancels, modifies, or closes orders or positions, and it never enables LIVE mode.

## State meanings

| State | Meaning | Watchdog action |
| --- | --- | --- |
| `LIVE` | Fresh heartbeat, matching release identity, and the runner’s own gates permit operation. | No-op when service identity is healthy. |
| `WAITING` | Intentionally non-live/SHADOW/PAPER or waiting for an existing gate. | Preserve the hold; do not manufacture LIVE. |
| `FAIL_CLOSED` | The runner stopped admitting new work because a safety or runtime gate failed. | Do not clear the gate; inspect and reconcile. |
| `RECOVERING` | The watchdog has authorized a bounded restart after a missing/stale process observation. | At most three attempts in 30 minutes, with 15s, 60s, and 300s backoff. |
| `RECOVERY_EXHAUSTED` | The bounded restart budget is consumed. | No further restart; operator investigation required. |
| `KILL_SWITCH`, `DAILY_LOSS_LATCH`, `STALE_DATA`, `RECONCILIATION_FAILED`, `MANUAL_REVIEW`, `UNKNOWN` | Safety-latched or uncertain state reported by the runner. | `HOLD_FAIL_CLOSED`; never restart to clear it. |
| `要確認` | HP projection cannot prove fresh, exact-SHA, safe runtime identity. | Treat as not ready; do not infer health from partial evidence. |

Safety-latched states require ordinary operator clearance under the existing procedure and a fresh reconciliation. The watchdog does not clear latches, kill switches, manual review, or reconciliation failures.

## Read-only inspection

Run these on the release host as an operator with access to the service state. Substitute only the already-approved release SHA; never paste credentials or raw environment values into a report.

```bash
release_sha='<exact lowercase 40-character release SHA>'
release_root="/opt/disdex/releases/${release_sha}"
health_root=/var/lib/disdex/runner-health

git rev-parse HEAD
cat "${release_root}/.disdex-release-sha"
systemctl is-active 'disdex-v12-x1-all@'"${release_sha}"'.service'
systemctl is-active 'disdex-quality102-causal-v1@'"${release_sha}"'.service'
systemctl is-active disdex-v96-v52-live.service
systemctl is-active disdex-runner-watchdog.timer
v12_unit="disdex-v12-x1-all@${release_sha}.service"
q102_unit="disdex-quality102-causal-v1@${release_sha}.service"
v12_pid="$(systemctl show "${v12_unit}" --property=MainPID --value)"
q102_pid="$(systemctl show "${q102_unit}" --property=MainPID --value)"
v52_pid="$(systemctl show disdex-v96-v52-live.service --property=MainPID --value)"
systemctl show "${v12_unit}" --property=MainPID,ActiveState,SubState
systemctl show "${q102_unit}" --property=MainPID,ActiveState,SubState
systemctl show disdex-v96-v52-live.service --property=MainPID,ActiveState,SubState
for pid in "${v12_pid}" "${q102_pid}" "${v52_pid}"; do
  readlink "/proc/${pid}/cwd"
  tr '\0' ' ' < "/proc/${pid}/cmdline"; printf '\n'
done
find "${health_root}/heartbeats" -maxdepth 1 -type f -name '*.json' -print
for file in "${health_root}"/heartbeats/*.json; do
  jq '{runnerId,serviceUnit,runtimeSha,expectedSha,workingDirectory,safetyState,heartbeatAt,lastTickAt,lastReconciliationAt,reason,symbols,caps,restartAttempts,updatedAt,quality102}' "$file"
done
```

The exact evidence is: release SHA from the immutable marker and `git rev-parse`, each `MainPID`, `/proc/<pid>/cwd`, the complete allowlisted command identity, heartbeat `runtimeSha` and `expectedSha`, heartbeat timestamp in UTC, service/timer state, and reconciliation timestamp/result. A missing, malformed, stale, mismatched, or redacted-away field is `要確認`, not success.

## Restart and reconciliation

1. Freeze the evidence above and confirm the account is readable. Record open-order and managed-position counts and stable identifiers without recording secrets.
2. Confirm the failure is operational: process absence, stale heartbeat, or exact release/cwd drift. Do not restart a runner that reported a safety latch or intentional stop.
3. Let the watchdog perform only its allowlisted, bounded restart. Do not run `systemctl start`, launch a second singleton, or invoke an exchange client.
4. After restart, verify the exact release marker, SHA, cwd, command, and fresh heartbeat. The first tick must pass the existing preflight, account lock, duplicate-order protection, and position/pending-order reconciliation path.
5. Confirm Q102 remains `DERIVED_HIGH_VOL_ONLY`, historical selector parity is `false`, `brkLiveEnabled` is `false`, and no selector flag was promoted to LIVE. A Q102-local failure does not authorize restarts of the other runners.

## Q102 canonical safety contract

Q102’s target symbols come from the effective runtime heartbeat/configuration (`symbols`), not a fixed historical CSV or a report-time invention. Its canonical caps are strategy `0.50x`, combined crypto `2.00x`, and total `2.50x`. The selector is `DERIVED_HIGH_VOL_ONLY`; `historicalSelectorParity=false` is fail-closed and `brkLiveEnabled=false`. Missing or conflicting symbol/cap/identity evidence blocks readiness.

## Rollback

Rollback is an operator-controlled release action, never a watchdog action. Stop automatic recovery for the affected unit according to the ordinary stop protocol, select the previously approved immutable release, verify its `.disdex-release-sha` and service configuration, then run the same read-only preflight and reconciliation sequence before resuming. Do not alter orders or positions to make the rollback appear healthy. If account state is unreadable or reconciliation is ambiguous, remain fail-closed and escalate.

## Final no-order proof

Every recovery or release report must include:

```text
BRANCH=<branch>
RELEASE_SHA=<exact SHA, no secrets>
CI_WORKFLOW=disdex-runner-health-ci.yml
CI_CONCLUSION=<success/failure>
V12_STATE=<state>
PENGU_V8_STATE=<state>
V52_STATE=<state>
Q102_STATE=<state>
HEARTBEAT_SHA_MATCHES=<true/false per runner>
HEARTBEAT_TIMESTAMPS=<UTC values>
RECONCILIATION=<PASS or explicit fail-closed reason>
Q102_TARGET_SYMBOLS=<symbols from heartbeat>
Q102_CAPS=0.50/2.00/2.50
OPEN_ORDERS_BEFORE=<count and stable IDs>
OPEN_ORDERS_AFTER=<count and stable IDs>
MANAGED_POSITIONS_BEFORE=<count and stable IDs>
MANAGED_POSITIONS_AFTER=<count and stable IDs>
LIVE_ORDERS_SENT=0
TEST_ORDERS=0
SYNTHETIC_ORDERS=0
CANCELS_SENT=0
MODIFICATIONS_SENT=0
POSITION_CHANGES_SENT=0
```

Do not include API keys, private keys, wallet addresses, tokens, mnemonics, raw environment files, or credential-bearing logs. The zero counters must come from self-test output and the read-only audit/recovery evidence; a successful restart alone is not proof of zero orders.
