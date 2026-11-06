"""HYPE_TREND_LONG-only protected-hold cutover.

Requires a fresh exact owner/SSH authority, signed flat venue evidence and a
pre-existing GLOBAL HOLD_PROTECTED. Never clears the hold or submits orders.
Does not touch other runners, the current symlink or other STOP owners.
"""
from __future__ import annotations
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time

from disdex_deployment_contract import DEPLOYMENT_TARGET, OPERATOR_TARGET, REPO
from disdex_deployment_plan import IDS, canonical, digest, validate

RUNNER = "HYPE_TREND_LONG"
OLD = "7688ed7c93a1918d8b44837339b7da5584a868f5"
SERVICE = "disdex-hype-long"
STATE = Path("/var/lib/disdex/hype-zec-long/runner.json")
KILL = Path("/var/lib/disdex/shared/kill-switch.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
TICK = Path("/var/lib/disdex/runner-health/ticks/hype-trend-long.json")
JOB_DIR = Path("/var/lib/disdex/unified-deploy/jobs/hype")
SDK_SHA = "7b7719c65d2c6116d02463fc4603200f28e20762"
SHA = re.compile(r"^[a-f0-9]{40}$")
SHARED_RATE_BUDGET = "/var/lib/disdex/shared/aster-rate-budget.json"


def hype_budget_proxy_socket(v4_sha):
    require(isinstance(v4_sha, str) and SHA.fullmatch(v4_sha), "V4_BUDGET_PIN_INVALID")
    return f"/run/disdex-v4-budget-{v4_sha}/budget.sock"


def bind_hype_budget_proxy(sdk, socket_path):
    match = (re.fullmatch(r"/run/disdex-v4-budget-([a-f0-9]{40})/budget\.sock", socket_path)
             if isinstance(socket_path, str) else None)
    require(match is not None and hype_budget_proxy_socket(match.group(1)) == socket_path,
            "V4_BUDGET_PROXY_SOCKET_INVALID")
    original = getattr(sdk, "child_environment", None)
    require(callable(original), "V4_BUDGET_CHILD_ENVIRONMENT_MISSING")

    def child_environment(*args, **kwargs):
        environment = original(*args, **kwargs)
        require(isinstance(environment, dict)
                and environment.get("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH") == SHARED_RATE_BUDGET,
                "V4_BUDGET_CANONICAL_PATH_REQUIRED")
        result = dict(environment)
        result["DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET"] = socket_path
        return result

    sdk.child_environment = child_environment
    return sdk


def validate_v4_budget_proxy_sources(budget_source, proxy_source):
    require(isinstance(budget_source, str)
            and "DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET" in budget_source
            and "requestV4BudgetProxy" in budget_source,
            "V4_BUDGET_CLIENT_PROXY_MISSING")
    require(isinstance(proxy_source, str)
            and '"disdex-v4-budget-proxy/v1"' in proxy_source
            and all(priority in proxy_source for priority in ("RECONCILIATION", "RISK_READ", "MARKET_DATA")),
            "V4_BUDGET_PROXY_PROTOCOL_MISMATCH")
    return True


def run_worker_signed_read(release, deploy, environment, *, run=subprocess.run):
    # The canonical lock creates, renews, and unlinks its file in shared/.
    # Give that mount to the short-lived read-only CLI, not the cutover worker.
    # systemd receives only fixed argv; credentials travel through the pipe.
    bootstrap = (
        "import json, os, sys\n"
        "environment = json.loads(sys.stdin.read(16385))\n"
        "os.execve(sys.argv[1], sys.argv[1:], environment)\n"
    )
    command = [
        "/usr/bin/systemd-run", "--quiet", "--wait", "--pipe", "--collect",
        "--service-type=exec", f"--working-directory={release}",
        "-p", "NoNewPrivileges=yes", "-p", "ProtectSystem=strict",
        "-p", "ProtectHome=read-only", "-p", "PrivateTmp=yes",
        "-p", "PrivateDevices=yes", "-p", "LimitCORE=0",
        "-p", "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
        "-p", "RuntimeMaxSec=50s", "-p", "TimeoutStopSec=3s",
        "-p", "ReadWritePaths=/var/lib/disdex/shared",
        "-p", f"ReadOnlyPaths={KILL} {MARGIN}",
        "/usr/bin/setpriv", f"--reuid={deploy.pw_uid}", f"--regid={deploy.pw_gid}",
        "--clear-groups", "--no-new-privs", "/usr/bin/python3", "-I", "-c", bootstrap,
        "/usr/bin/node", "--import", str(release / "node_modules/tsx/dist/loader.mjs"),
        str(release / "scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts"),
        "--verify-only",
    ]
    payload = json.dumps(environment)
    require(len(payload) <= 16384, "SIGNED_READ_ENVIRONMENT_TOO_LARGE")
    result = run(command, input=payload, capture_output=True, text=True, timeout=57)
    require(result.returncode == 0, "WORKER_SIGNED_READ_FAILED_OR_DEFERRED")
    rows = [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]
    require(len(rows) == 1 and isinstance(rows[0], dict), "WORKER_SIGNED_READ_RESULT_INVALID")
    return rows[0]


def validate_hype_budget_broker(v4_sha, unit, *, process_cwd, process_argv, marker_sha,
                                socket_info, directory_info, deploy_uid, deploy_gid,
                                release_root="/home/deploy/disdex-trading/releases"):
    require(isinstance(v4_sha, str) and SHA.fullmatch(v4_sha), "V4_BUDGET_PIN_INVALID")
    require(isinstance(release_root, str) and release_root.startswith("/"),
            "V4_BUDGET_RELEASE_ROOT_INVALID")
    release = f"{release_root.rstrip('/')}/{v4_sha}"
    require(isinstance(unit, dict) and unit.get("ActiveState") == "active"
            and unit.get("SubState") == "running" and unit.get("User") == "deploy"
            and unit.get("WorkingDirectory") == release
            and isinstance(unit.get("ExecStart"), str)
            and isinstance(unit.get("MainPID"), str) and unit["MainPID"].isdigit()
            and int(unit["MainPID"]) > 1 and process_cwd == release
            and marker_sha == v4_sha, "V4_BUDGET_BROKER_LINEAGE")
    argv_field = re.search(r"(?:^|;\s*)argv\[\]=([^;]+)", unit["ExecStart"])
    configured_argv = argv_field[1].split() if argv_field else []
    launcher = ["/usr/bin/node", f"{release}/node_modules/tsx/dist/cli.mjs"]
    script = "scripts/ops/root/disdex-v4-rate-budget-broker.ts"
    expected_scripts = (script, f"{release}/{script}")
    for argv in (configured_argv, process_argv):
        require(len(argv) >= 3 and argv[:2] == launcher and argv[2] in expected_scripts,
                "V4_BUDGET_BROKER_LINEAGE")
    require(isinstance(directory_info, dict) and directory_info.get("is_dir") is True
            and directory_info.get("is_symlink") is False
            and directory_info.get("uid") == deploy_uid and directory_info.get("gid") == deploy_gid
            and directory_info.get("mode") == 0o750, "V4_BUDGET_SOCKET_DIRECTORY")
    require(isinstance(socket_info, dict) and socket_info.get("is_socket") is True
            and socket_info.get("is_symlink") is False
            and socket_info.get("uid") == deploy_uid and socket_info.get("gid") == deploy_gid
            and socket_info.get("mode") == 0o660, "V4_BUDGET_SOCKET_METADATA")
    return hype_budget_proxy_socket(v4_sha)


def require(condition, reason):
    if not condition:
        raise ValueError("HYPE_SCOPED_" + reason)


def validate_hype_plan(desired, current, pins, target_sha):
    validate(desired)
    validate(current)
    require(desired["scope"] == RUNNER and desired["ordersEnabled"] is True,
            "LIVE_SCOPE_AND_PERMISSION")
    require(desired["sourceSha"] == target_sha == desired["runners"][RUNNER],
            "EXACT_SOURCE_SHA")
    require(current["runners"] == pins, "PIN_BASELINE_CHANGED")
    require(desired["uiSha"] == current["uiSha"]
            and desired["monitorSha"] == current["monitorSha"]
            and desired["releaseRoots"] == current["releaseRoots"], "HYPE_ONLY_DELTA")
    require(all(desired["runners"][runner] == pins[runner]
                for runner in IDS if runner != RUNNER), "HYPE_ONLY_DELTA")
    require(pins[RUNNER] in (OLD, target_sha), "PIN_BASELINE_CHANGED")
    if pins[RUNNER] == OLD:
        require(current["runners"][RUNNER] == OLD
                and desired["runners"][RUNNER] == target_sha, "HYPE_ONLY_DELTA")
    else:
        require(current["runners"][RUNNER] == target_sha
                and desired["runners"][RUNNER] == target_sha, "HYPE_RESUME_PLAN_MISMATCH")
    return hashlib.sha256(canonical(desired)).hexdigest()


def classify_hype_plan(desired, current, pins, target_sha):
    """Distinguish a first cutover from the one exact interrupted state."""
    validate_hype_plan(desired, current, pins, target_sha)
    return "fresh" if pins[RUNNER] == OLD else "resume"


def rebase_hype_state_for_rollback(current, candidate_baseline, old_sha, new_sha):
    """Revert only the runtime SHA while retaining legitimate held decisions.

    The runner can update decision timestamps and its decision/failure journal
    between service start and a failed deployment audit. All other state must
    remain byte-semantically equal to the pre-start candidate baseline.
    """
    validate_flat_hype_state(candidate_baseline, new_sha)
    validate_flat_hype_state(current, new_sha)
    mutable = {"runtimeCommitSha", "updatedAt", "lastDecisionTs", "lastDecision", "failures"}
    baseline_fixed = {key: value for key, value in candidate_baseline.items() if key not in mutable}
    current_fixed = {key: value for key, value in current.items() if key not in mutable}
    require(current_fixed == baseline_fixed, "ROLLBACK_UNRECOGNIZED_LEDGER_CHANGE")
    require(type(current.get("updatedAt")) is int
            and current["updatedAt"] >= candidate_baseline["updatedAt"], "ROLLBACK_LEDGER_TIME_REGRESSED")
    base_decision_ts = candidate_baseline.get("lastDecisionTs")
    current_decision_ts = current.get("lastDecisionTs")
    if current_decision_ts is not None:
        require(type(current_decision_ts) is int and current_decision_ts > 0
                and (base_decision_ts is None or current_decision_ts >= base_decision_ts),
                "ROLLBACK_DECISION_TIME_REGRESSED")
    decision_changed = (current_decision_ts != base_decision_ts
                        or current.get("lastDecision") != candidate_baseline.get("lastDecision"))
    if decision_changed:
        decision = current.get("lastDecision")
        require(type(current_decision_ts) is int
                and (base_decision_ts is None or current_decision_ts > base_decision_ts)
                and isinstance(decision, dict) and decision.get("accepted") is False,
                "ROLLBACK_NEW_DECISION_NOT_HELD")
    before = candidate_baseline.get("failures", [])
    after = current.get("failures", [])
    require(isinstance(before, list) and isinstance(after, list) and len(after) <= 100,
            "ROLLBACK_FAILURE_HISTORY_INVALID")
    if len(before) < 100:
        require(len(after) >= len(before) and after[:len(before)] == before,
                "ROLLBACK_FAILURE_HISTORY_REWRITTEN")
        appended_rows = after[len(before):]
        for row in appended_rows:
            require(isinstance(row, dict) and type(row.get("occurredAt")) is int
                    and row["occurredAt"] >= candidate_baseline["updatedAt"],
                    "ROLLBACK_FAILURE_HISTORY_INVALID")
    elif after != before:
        require(len(after) == 100, "ROLLBACK_FAILURE_HISTORY_TRUNCATED")
        appended_rows = None
        for dropped in range(1, 101):
            prefix_length = 100 - dropped
            if after[:prefix_length] == before[dropped:]:
                appended_rows = after[prefix_length:]
                break
        require(appended_rows, "ROLLBACK_FAILURE_HISTORY_REWRITTEN")
        for row in appended_rows:
            require(isinstance(row, dict) and type(row.get("occurredAt")) is int
                    and row["occurredAt"] >= candidate_baseline["updatedAt"],
                    "ROLLBACK_FAILURE_HISTORY_INVALID")
    restored = dict(current, runtimeCommitSha=old_sha)
    validate_flat_hype_state(restored, old_sha)
    return restored


def validate_flat_hype_state(row, expected):
    require(isinstance(row, dict) and row.get("schema") == "disdex-hype-zec-long/v1"
            and row.get("runtimeCommitSha") == expected and row.get("mode") == "LIVE",
            "LEDGER_LINEAGE")
    require(row.get("positions") in (None, []) and not row.get("pending")
            and not row.get("manualReview")
            and isinstance(row.get("failures"), list), "LEDGER_NOT_FLAT")
    require(type(row.get("updatedAt")) is int and row["updatedAt"] > 0,
            "LEDGER_TIMESTAMP")
    return row


def validate_hype_candidate_sources(runner, cycle, heartbeat, entrypoint):
    """Validate candidate source text for entry HOLD and real tick contracts."""
    require('import { readSharedKillSwitch } from "./disdex-shared-kill-switch"' in runner
            and "private async sharedEntryHold(" in runner
            and '"/var/lib/disdex/shared/kill-switch.json"' in runner
            and "if (!kill.active) return;" in runner
            and 'const reason = "HYPE_ZEC_SHARED_KILL_SWITCH_ACTIVE";' in runner,
            "CANDIDATE_SHARED_HOLD_GATE_MISSING")
    first_hold = runner.find("const entryHold = await this.sharedEntryHold(state, signal);")
    pre_order_hold = runner.find("const preOrderHold = await this.sharedEntryHold(state, signal);")
    market_order = runner.find("this.dependencies.executor.executeMarket(", pre_order_hold)
    require(first_hold >= 0 and pre_order_hold > first_hold and market_order > pre_order_hold
            and "if (preOrderHold) return preOrderHold;" in runner,
            "CANDIDATE_PREORDER_HOLD_GATE_MISSING")
    require('"disdex-runner-tick/v1"' in heartbeat
            and all(field in heartbeat for field in (
                "newOrdersAllowed", "expectedSha", "mainPid", "workingDirectory",
                "tickStartedAt", "tickCompletedAt", "ordersSent", "cancelsSent",
                "positionChangesSent")), "CANDIDATE_TICK_CONTRACT_MISMATCH")
    require("await writeRunnerTickHeartbeat" in cycle
            and 'HYPE_TREND_LONG' in cycle and "newOrdersAllowed:false" in cycle
            and 'disdex-hype-long' in cycle,
            "CANDIDATE_TICK_WRITER_MISSING")
    require("observePeerDecisionCycle" in entrypoint
            and 'runnerId: "HYPE_TREND_LONG"' in entrypoint
            and "operation: () => runner.tick()" in entrypoint,
            "CANDIDATE_DECISION_CYCLE_NOT_CONNECTED")
    return True


def validate_hype_candidate_safety(release):
    """Require the immutable HYPE candidate's protected-entry and tick path."""
    try:
        return validate_hype_candidate_sources(
            (release / "lib/hype-zec-long-runner.ts").read_text(encoding="utf8"),
            (release / "lib/disdex-peer-decision-cycle.ts").read_text(encoding="utf8"),
            (release / "lib/disdex-runner-tick-heartbeat.ts").read_text(encoding="utf8"),
            (release / "scripts/disdex-hype-zec-long-live-runner.ts").read_text(encoding="utf8"),
        )
    except (OSError, UnicodeError):
        raise ValueError("HYPE_SCOPED_CANDIDATE_SAFETY_SOURCE_MISSING") from None


def valid_hold(row):
    require(isinstance(row, dict) and row.get("active") is True
            and row.get("action") == "HOLD_PROTECTED"
            and row.get("scope") == "GLOBAL", "GLOBAL_PROTECTED_HOLD_REQUIRED")
    return row


def read_hype_audit_tick(raw, prior):
    if raw == prior:
        return None
    tick = json.loads(raw)
    require(isinstance(tick, dict), "TICK_RECORD_INVALID")
    return tick


def validate_hype_tick(row, *, sha, pid, release, previous=None, started_after=0):
    now = time.time_ns() // 1000000
    require(isinstance(row, dict) and row.get("schema") == "disdex-runner-tick/v1"
            and row.get("runnerId") == RUNNER and row.get("runtimeSha") == sha
            and row.get("expectedSha") == sha
            and row.get("serviceUnit") == SERVICE + "@" + sha + ".service"
            and row.get("workingDirectory") == str(release)
            and row.get("mainPid") == pid
            and row.get("newOrdersAllowed") is False,
            "TICK_IDENTITY_OR_AUTHORITY")
    started, completed = row.get("tickStartedAt"), row.get("tickCompletedAt")
    require(type(started) is int and type(completed) is int
            and started_after <= started <= completed and 0 <= now - completed <= 120000
            and (previous is None or completed > previous), "TICK_TIME_NOT_ADVANCING")
    require(row.get("status") not in ("manual-review", "fatal", "")
            and isinstance(row.get("status"), str), "TICK_RUNNER_FAIL_CLOSED")
    for key in ("ordersSent", "cancelsSent", "positionChangesSent"):
        require(row.get(key, 0) == 0 and type(row.get(key, 0)) is int,
                "TICK_MUTATION_TELEMETRY")
    return completed


def _safe_bytes(path):
    from disdex_shared_risk_witness import file_bytes
    return file_bytes(path)


def _atomic(path, data, stat_before):
    from disdex_shared_risk_monitor_wiring import atomic_text
    atomic_text(path, data, (stat_before.st_uid, stat_before.st_gid,
                             stat_before.st_mode & 0o777))


def _root_file(path, raw, mode, created):
    from disdex_pending_maintenance_install import _new_file
    _new_file(path, raw, mode, lambda: created.append(path))


def _runtime_env(old_raw, old_sha, new_sha, release):
    # Preserve foreign peer-specific identities and economic settings.
    values = {
        "DISDEX_RELEASE_SHA": new_sha,
        "DISDEX_RUNTIME_SHA": new_sha,
        "DISDEX_RUNTIME_COMMIT_SHA": new_sha,
        "DISDEX_RELEASE_ROOT": str(release),
        "DISDEX_HYPE_ZEC_RUNTIME_SHA": new_sha,
        "DISDEX_HYPE_ZEC_ENABLED": "true",
        "DISDEX_HYPE_ZEC_MODE": "LIVE",
        "DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED": "true",
        "DISDEX_HYPE_ZEC_PRODUCTION_CONFIG_LIVE_ENABLED": "true",
        "DISDEX_HYPE_ZEC_OPERATOR_ARMED": "true",
        "DISDEX_HYPE_ZEC_SIGNAL_MODE": "TREND",
        "DISDEX_HYPE_ZEC_SYMBOLS": "HYPEUSDT",
        "DISDEX_RUNNER_TICK_HEARTBEAT_ROOT": "/var/lib/disdex/runner-health",
    }
    lines = old_raw.decode("utf8").splitlines()
    seen = {}
    out = []
    for line in lines:
        key, sep, value = line.partition("=")
        if not sep:
            out.append(line)
            continue
        require(not any(name in key.upper() for name in
                    ("PRIVATE_KEY", "API_SECRET", "PASSWORD", "ACCESS_TOKEN", "AUTH_TOKEN")),
                "CREDENTIAL_IN_RUNTIME_OVERRIDE")
        if key in seen:
            require(seen[key] == value, "CONFLICTING_DUPLICATE_ENVIRONMENT_KEY")
            continue
        seen[key] = value
        if key == "DISDEX_HYPE_ZEC_CORE_PREEMPT_SCRIPT":
            value = value.replace("/" + old_sha + "/", "/" + new_sha + "/")
        if key in values:
            value = values.pop(key)
        out.append(key + "=" + value)
    out.extend(k + "=" + v for k, v in values.items())
    return ("\n".join(out) + "\n").encode()


def build_activation(desired, authority, inventory_digest, at):
    sha = desired["sourceSha"]
    require(authority.get("sourceSha") == sha
            and authority.get("scope") == RUNNER
            and authority.get("planSha256") == hashlib.sha256(canonical(desired)).hexdigest()
            and authority.get("ordersEnabled") is True
            and authority.get("route") in ("CODEX_SSH", "GITHUB_ACTIONS")
            and type(authority.get("issuedAt")) is int
            and type(authority.get("expiresAt")) is int
            and authority["issuedAt"] <= at < authority["expiresAt"]
            and authority["expiresAt"] - authority["issuedAt"] <= 300,
            "EXACT_FRESH_APPROVAL_REQUIRED")
    return {
        "schema": "disdex-live-operator-activation/v1",
        "repository": REPO,
        "deploymentTarget": DEPLOYMENT_TARGET,
        "target": OPERATOR_TARGET,
        "scope": RUNNER,
        "approvedSha": sha,
        "approvedRunners": [RUNNER],
        "approvedShaByRunner": {RUNNER: sha},
        "activationClass": "FULL_LIVE",
        "operatorAcknowledgement": "I_ACK_REAL_MONEY_LIVE_ACTIVATION",
        "ordersEnabled": True,
        "approvedAt": datetime.datetime.fromtimestamp(
            authority["issuedAt"], datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "deploymentApprovalExpiresAt": authority["expiresAt"],
        "route": authority["route"],
        "authorizationMethod": authority.get("authorizationMethod"),
        "authorizedOperator": authority.get("operator"),
        "planSha256": authority["planSha256"],
        "nonceDigest": hashlib.sha256(authority["nonce"].encode()).hexdigest(),
        "formalCertification": False,
        "venueLifecycleCertified": False,
        "authorizesKillClearance": False,
        "evidence": {
            "signedAsterReadOnly": True,
            "inventoryDigest": inventory_digest,
            "startUnderProtectedHold": True,
            "killSwitchActive": True,
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
        },
        "notes": "HYPE-only protected-hold start. No owner authority for other runners or Kill clearance.",
    }


class HypeScopedOperations:
    def __init__(self, parent, args, token):
        self.parent, self.args, self.token = parent, args, token
        self.paths, self.systemd = parent.paths, parent.systemd
        self.old_unit = f"{SERVICE}@{OLD}.service"
        self.new_unit = f"{SERVICE}@{args.sha}.service"
        self.release = self.paths.releases / args.sha
        self.dropin = Path("/etc/systemd/system") / (self.new_unit + ".d")
        self.override = self.dropin / "zzzzzzzzzzzzzzzzzzzzzz-hype-certified.conf"
        self.env = Path("/etc/disdex/current-runtime") / (args.sha + ".env")
        self.operator_env = Path("/etc/disdex/current-runtime") / (args.sha + ".hype-operator.env")
        self.approval = Path("/var/lib/disdex/shared/operator-activation") / ("hype-" + args.sha + ".json")
        self.receipt = self.paths.receipts / ("hype-protected-hold-" + args.sha + ".json")
        self.created, self.replaced = [], []
        self.dropin_created = False
        self.state_changed = False
        self.new_started = False
        self.activation_written = False
        self.approval_replaced = False
        self.failure_phase = "prepare"

    def unit_override_bytes(self):
        root = str(self.release)
        sha = self.args.sha
        prestart = [
            "ExecStartPre=",
            "ExecStartPre=+/usr/bin/install -d -o deploy -g deploy -m 0700 /var/lib/disdex/hype-zec-long",
            "ExecStartPre=+/bin/sh -c 'if [ -e /var/lib/disdex/hype-zec-long/runner.json ]; then chown deploy:deploy /var/lib/disdex/hype-zec-long/runner.json && chmod 600 /var/lib/disdex/hype-zec-long/runner.json; fi'",
            "ExecStartPre=/usr/bin/test -f " + root + "/.disdex-release-sha",
            "ExecStartPre=/usr/bin/grep -Fxq " + sha + " " + root + "/.disdex-release-sha",
            "ExecStartPre=" + root + "/node_modules/.bin/tsx scripts/disdex-current-live-target-readiness.ts --require-implementation-ready",
            "ExecStartPre=+/usr/bin/node " + root + "/scripts/ops/root/disdex-live-operator-activation-gate.mjs --release-root " + root + " --sha " + sha + " --runner " + RUNNER + " --activation-path " + str(self.approval),
        ]
        return ("\n".join(["[Service]",
            "EnvironmentFile=" + str(self.env),
            "EnvironmentFile=" + str(self.operator_env),
            *prestart,
            "ReadWritePaths=/var/lib/disdex/runner-health/ticks",
            ""])).encode()

    def validate_staged_resume_files(self, assert_regular_secure):
        import stat
        from disdex_unified_root_gate import read_root_json
        require(self.dropin.is_dir() and not self.dropin.is_symlink(), "RESUME_DROPIN_MISSING")
        drop_meta = self.dropin.lstat()
        require(drop_meta.st_uid == self.parent.root_uid
                and stat.S_IMODE(drop_meta.st_mode) == 0o755, "RESUME_DROPIN_METADATA")
        override_meta = assert_regular_secure(self.override, root_uid=self.parent.root_uid, private=False)
        require(stat.S_IMODE(override_meta.st_mode) == 0o644
                and _safe_bytes(self.override) == self.unit_override_bytes(), "RESUME_DROPIN_CONTENT")
        for path, expected in ((self.env, self.runtime_bytes),
                               (self.operator_env, self.operator_bytes)):
            info = assert_regular_secure(path, root_uid=self.parent.root_uid, private=True)
            require(stat.S_IMODE(info.st_mode) == 0o600
                    and _safe_bytes(path) == expected, "RESUME_ENVIRONMENT_CONTENT")
        require(not self.approval.is_symlink(), "RESUME_ACTIVATION_SYMLINK")
        if self.approval.exists():
            info = assert_regular_secure(self.approval, root_uid=self.parent.root_uid, private=True)
            require(stat.S_IMODE(info.st_mode) == 0o600, "RESUME_ACTIVATION_METADATA")
            previous = read_root_json(self.approval, root_uid=self.parent.root_uid)
            require(previous.get("schema") == "disdex-live-operator-activation/v1"
                    and previous.get("target") == OPERATOR_TARGET
                    and previous.get("repository", REPO) == REPO
                    and previous.get("deploymentTarget", DEPLOYMENT_TARGET) == DEPLOYMENT_TARGET
                    and previous.get("scope", RUNNER) == RUNNER
                    and previous.get("approvedSha") == self.args.sha
                    and previous.get("approvedRunners") == [RUNNER]
                    and previous.get("approvedShaByRunner") == {RUNNER: self.args.sha}
                    and previous.get("planSha256") == self.args.plan_sha256
                    and previous.get("ordersEnabled") is True
                    and previous.get("authorizesKillClearance") is False,
                    "RESUME_OLD_ACTIVATION_SCOPE_MISMATCH")
            self.prior_activation_sha256 = hashlib.sha256(_safe_bytes(self.approval)).hexdigest()
        else:
            self.prior_activation_sha256 = None

    def command(self, *args):
        proc = subprocess.run(["/usr/bin/systemctl", *args], text=True, capture_output=True, timeout=50)
        require(proc.returncode == 0, "SYSTEMD_" + args[0].upper())
        return proc.stdout

    def verify_v4_budget_broker(self, release_marker):
        v4_sha = self.pins.get("V12_V4")
        socket_path = hype_budget_proxy_socket(v4_sha)
        release = self.paths.releases / v4_sha
        release_marker(v4_sha, self.paths.releases)
        reconcile = release / "scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts"
        broker_source = release / "scripts/ops/root/disdex-v4-rate-budget-broker.ts"
        loader = release / "node_modules/tsx/dist/loader.mjs"
        budget_source = release / "lib/disdex-aster-global-rate-budget.ts"
        proxy_source = release / "lib/disdex-v4-rate-budget-proxy.ts"
        try:
            require(reconcile.is_file() and not reconcile.is_symlink()
                    and broker_source.is_file() and not broker_source.is_symlink()
                    and loader.is_file(), "V4_SIGNED_GET_SOURCE_MISSING")
            validate_v4_budget_proxy_sources(
                budget_source.read_text(encoding="utf8"),
                proxy_source.read_text(encoding="utf8"),
            )
            marker_sha = (release / ".disdex-release-sha").read_text(encoding="ascii").strip()
        except (OSError, UnicodeError):
            raise ValueError("HYPE_SCOPED_V4_BUDGET_PROXY_SOURCE_MISSING") from None

        unit_name = f"disdex-v4-rate-budget-broker@{v4_sha}.service"
        properties = ("ActiveState", "SubState", "MainPID", "User", "WorkingDirectory", "ExecStart")

        def read_unit():
            output = self.command("show", unit_name,
                                  *[arg for key in properties for arg in ("-p", key)])
            return dict(line.split("=", 1) for line in output.splitlines() if "=" in line)

        unit = read_unit()
        require(isinstance(unit.get("MainPID"), str) and unit["MainPID"].isdigit()
                and int(unit["MainPID"]) > 1, "V4_BUDGET_BROKER_PID")
        try:
            process_cwd = str((Path("/proc") / unit["MainPID"] / "cwd").resolve(strict=True))
            process_argv = [arg.decode("utf8", errors="replace") for arg in
                            (Path("/proc") / unit["MainPID"] / "cmdline").read_bytes().split(b"\0")
                            if arg]
            socket = Path(socket_path)
            socket_stat = socket.lstat()
            directory_stat = socket.parent.lstat()
            deploy = self.deploy
            validated = validate_hype_budget_broker(
                v4_sha, unit, process_cwd=process_cwd, process_argv=process_argv,
                marker_sha=marker_sha,
                socket_info={
                    "uid": socket_stat.st_uid, "gid": socket_stat.st_gid,
                    "mode": stat.S_IMODE(socket_stat.st_mode),
                    "is_socket": stat.S_ISSOCK(socket_stat.st_mode),
                    "is_symlink": stat.S_ISLNK(socket_stat.st_mode),
                },
                directory_info={
                    "uid": directory_stat.st_uid, "gid": directory_stat.st_gid,
                    "mode": stat.S_IMODE(directory_stat.st_mode),
                    "is_dir": stat.S_ISDIR(directory_stat.st_mode),
                    "is_symlink": stat.S_ISLNK(directory_stat.st_mode),
                },
                deploy_uid=deploy.pw_uid, deploy_gid=deploy.pw_gid,
                release_root=str(self.paths.releases),
            )
        except OSError:
            raise ValueError("HYPE_SCOPED_V4_BUDGET_BROKER_FILESYSTEM") from None
        after = read_unit()
        require(all(after.get(key) == unit.get(key) for key in properties),
                "V4_BUDGET_BROKER_CHANGED_DURING_PREFLIGHT")
        self.venue_release = release
        self.budget_proxy_socket = validated
        return validated

    def signed_flat(self):
        if getattr(getattr(self, "args", None), "_hype_job_worker", False):
            environment = self.sdk.child_environment(
                self.venue_release.name, self.deploy.pw_dir, credentials=self.credentials)
            result = run_worker_signed_read(self.venue_release, self.deploy, environment)
        else:
            result = self.sdk.run_signed_child(self.venue_release, self.deploy, credentials=self.credentials)
        require(result.get("status") == "PENDING_READONLY_RECONCILE_VERIFIED"
                and all(type(result.get(key)) is int and result[key] == 0
                    for key in ("positionCount", "openOrderCount", "ordersSent", "cancelsSent",
                                "positionChangesSent")), "FRESH_SIGNED_FLAT_REQUIRED")
        verified = result.get("verifiedAt")
        require(type(verified) is int and 0 <= time.time_ns()//1000000 - verified <= 30000,
                "SIGNED_PROOF_STALE")
        return result

    def health(self):
        risk = self.reader.read_risk()
        require(risk.get("sourceComplete") is True and risk.get("tripped") is False
                and risk.get("maximumLossPct") == 7.5
                and type(risk.get("lossPct")) in (float, int)
                and 0 <= risk["lossPct"] < 7.5, "SHARED_RISK_BLOCK")
        now = time.time_ns() // 1000000
        margin = json.loads(_safe_bytes(MARGIN))
        pending = json.loads(_safe_bytes(PENDING))
        require(margin.get("stage") == "HEALTHY" and margin.get("ordersAllowed") is True
                and type(margin.get("checkedAt")) is int
                and 0 <= now-margin["checkedAt"] <= 900000, "MARGIN_UNHEALTHY")
        require(type(pending.get("updatedAt")) is int
                and 0 <= now-pending["updatedAt"] <= 900000
                and isinstance(pending.get("entries"), list)
                and all(isinstance(x, dict) and x.get("status") == "RELEASED"
                        for x in pending["entries"]), "PENDING_UNRECONCILED")
        raw = _safe_bytes(KILL)
        valid_hold(json.loads(raw))
        require(hashlib.sha256(raw).hexdigest() == self.hold_hash, "KILL_CHANGED")

    def prepare(self):
        self.failure_phase = "prepare"
        import pwd
        from disdex_unified_root_gate import (assert_private_dir, read_root_json,
            parse_live_pins, release_marker, assert_regular_secure)
        from disdex_shared_risk_witness import ProductionSharedRiskReader
        from disdex_pending_maintenance_install import _load_sdk
        require(self.args.scope == RUNNER and self.args.orders_enabled == "true",
                "EXACT_SCOPE")
        for p in (self.paths.root, self.paths.root/"plans", self.paths.root/"plans"/RUNNER,
                  self.paths.nonce_dir, self.paths.receipts):
            assert_private_dir(p, root_uid=self.parent.root_uid)
        self.desired = read_root_json(self.paths.root/"plans"/RUNNER/(self.args.sha+".json"))
        self.current = read_root_json(self.paths.current_plan)
        self.manifest = read_root_json(self.paths.pins, private=False)
        self.pins = parse_live_pins(self.manifest, releases=self.paths.releases)
        self.plan_mode = classify_hype_plan(self.desired, self.current, self.pins, self.args.sha)
        require(validate_hype_plan(self.desired, self.current, self.pins, self.args.sha)
                == self.args.plan_sha256, "PLAN_HASH_MISMATCH")
        require(self.parent._read_current_sha(unchanged_identity_only=True)
                == self.current["sourceSha"], "CURRENT_SYMLINK_CHANGED")
        release_marker(self.args.sha, self.paths.releases)
        for relative in ("scripts/disdex-hype-trend-live-runner.ts",
                         "scripts/disdex-hype-zec-long-live-runner.ts",
                         "lib/hype-zec-long-runner.ts",
                         "lib/disdex-peer-decision-cycle.ts",
                         "lib/disdex-runner-tick-heartbeat.ts",
                         "scripts/ops/root/disdex-live-operator-activation-gate.mjs"):
            require((self.release/relative).is_file(), "CANDIDATE_SOURCE_MISSING")
        validate_hype_candidate_safety(self.release)
        require(not self.systemd.is_active(self.old_unit)
                and self.systemd.main_pid(self.old_unit) == 0
                and not self.systemd.is_active(self.new_unit)
                and self.systemd.main_pid(self.new_unit) == 0, "HYPE_ALREADY_ACTIVE")
        require(not self.receipt.exists() and not self.receipt.is_symlink(), "TARGET_ALREADY_EXISTS")
        self.old_enabled = self.systemd.is_enabled(self.old_unit)
        self.new_enabled = self.systemd.is_enabled(self.new_unit)
        require(not self.new_enabled, "NEW_UNIT_MUST_START_DISABLED")
        if self.plan_mode == "fresh":
            for path in (self.dropin, self.env, self.operator_env, self.approval):
                require(not path.exists() and not path.is_symlink(), "TARGET_ALREADY_EXISTS")
        self.hold_hash = hashlib.sha256(_safe_bytes(KILL)).hexdigest()
        valid_hold(json.loads(_safe_bytes(KILL)))
        self.reader = ProductionSharedRiskReader()
        self.sdk_release = self.paths.releases/SDK_SHA
        self.sdk = _load_sdk(self.sdk_release)
        self.credentials = self.sdk.load_server_credentials()
        self.deploy = pwd.getpwnam("deploy")
        self.budget_proxy_socket = self.verify_v4_budget_broker(release_marker)
        bind_hype_budget_proxy(self.sdk, self.budget_proxy_socket)
        self.parent._verify_token(self.args, self.token)
        self.health()
        self.before_proof = self.signed_flat()
        self.inventory_digest = hashlib.sha256(canonical({
            "positions": 0, "openOrders": 0,
            "accountSha256": hashlib.sha256(
                self.credentials["ASTER_USER_ADDRESS"].lower().encode()).hexdigest(),
        })).hexdigest()
        self.state_before = _safe_bytes(STATE)
        self.state_stat = STATE.lstat()
        self.state_before_row = json.loads(self.state_before)
        expected_state_sha = OLD if self.plan_mode == "fresh" else self.args.sha
        validate_flat_hype_state(self.state_before_row, expected_state_sha)
        self.baselines = {p: (_safe_bytes(p), p.lstat())
                          for p in (self.paths.pins, self.paths.current_plan)}
        self.next_manifest = copy.deepcopy(self.manifest)
        self.next_manifest["runners"][RUNNER].update(
            sha=self.args.sha, serviceUnit=self.new_unit, releaseRoot=str(self.release),
            evidenceMode="tick-v1")
        self.next_current = copy.deepcopy(self.current)
        self.next_current["runners"] = self.desired["runners"].copy()
        old_env = Path("/etc/disdex/current-runtime")/(OLD+".env")
        old_operator = Path("/etc/disdex/current-runtime")/(OLD+".hype-operator.env")
        assert_regular_secure(old_env)
        assert_regular_secure(old_operator)
        self.runtime_bytes = _runtime_env(_safe_bytes(old_env), OLD, self.args.sha, self.release)
        # Only the existing HYPE notification configuration is inherited.
        operator_lines = _safe_bytes(old_operator).decode("utf-8").splitlines()
        require(not any(word in line.split("=", 1)[0].upper()
                        for line in operator_lines
                        for word in ("PRIVATE_KEY", "API_SECRET", "PASSWORD")),
                "SECRET_IN_OPERATOR_ENV")
        operator_lines = [line for line in operator_lines
                          if not line.startswith("DISDEX_HYPE_ZEC_OPERATOR_ARMED=")]
        operator_lines.append("DISDEX_HYPE_ZEC_OPERATOR_ARMED=true")
        self.operator_bytes = ("\n".join(operator_lines) + "\n").encode()
        if self.plan_mode == "resume":
            self.validate_staged_resume_files(assert_regular_secure)
        self.health()

    def consume(self):
        self.failure_phase = "consume"
        self.parent._assert_expected_pins(self.pins)
        self.health()
        proof = self.signed_flat()
        authority = self.parent._verify_token(self.args, self.token,
                                              nonce_dir=self.paths.nonce_dir)
        self.authorization_at = self.parent.clock()
        self.activation = build_activation(self.desired, authority,
                                           self.inventory_digest, self.authorization_at)
        require(proof["positionCount"] == self.before_proof["positionCount"],
                "VENUE_CHANGED")

    def publish(self):
        self.failure_phase = "publish"
        self.approval_bytes = canonical(self.activation)+b"\n"
        if self.plan_mode == "fresh":
            self.dropin.mkdir(mode=0o755)
            self.dropin_created = True
            self.dropin.chmod(0o755)
            for path, content, mode in (
                (self.env, self.runtime_bytes, 0o600),
                (self.operator_env, self.operator_bytes, 0o600),
                (self.approval, self.approval_bytes, 0o600),
                (self.override, self.unit_override_bytes(), 0o644)):
                _root_file(path, content, mode, self.created)
            self.activation_written = True
        else:
            # The interrupted transaction may have left a stale activation.
            # Replace it only with the fresh, just-consumed authorization.
            if self.approval.exists():
                old = _safe_bytes(self.approval)
                metadata = self.approval.lstat()
                self.approval_replaced = True
                _atomic(self.approval, self.approval_bytes, metadata)
                require(_safe_bytes(self.approval) == self.approval_bytes,
                        "RESUME_ACTIVATION_READBACK")
            else:
                _root_file(self.approval, self.approval_bytes, 0o600, self.created)
            self.activation_written = True
        self.command("daemon-reload")
        proc = subprocess.run(["/usr/bin/systemd-analyze","verify",self.new_unit],
                              capture_output=True, text=True, timeout=45)
        require(proc.returncode == 0, "UNIT_VERIFY_FAIL")
        show = self.command("show",self.new_unit,"-p","ExecStartPre",
                            "-p","ExecStart","-p","WorkingDirectory","-p","User")
        require(str(self.release) in show and str(self.approval) in show
                and "WorkingDirectory=" + str(self.release) in show
                and "User=deploy" in show and OLD not in show,
                "EFFECTIVE_UNIT_MISMATCH")
        self.health()

    def switch(self):
        self.failure_phase = "switch"
        require(self.systemd.main_pid(self.old_unit)==0 and
                not self.systemd.is_active(self.old_unit), "OLD_UNIT_RACE")
        require(_safe_bytes(STATE)==self.state_before, "LEDGER_RACE")
        self.health()
        self.signed_flat()
        if self.plan_mode == "fresh":
            new_state = dict(self.state_before_row,
                             runtimeCommitSha=self.args.sha,
                             updatedAt=int(time.time()*1000))
            self.state_after = json.dumps(new_state, sort_keys=True,
                                          separators=(",", ":")).encode()+b"\n"
            validate_flat_hype_state(new_state, self.args.sha)
            self.candidate_state_baseline = new_state
            _atomic(STATE, self.state_after, self.state_stat)
            self.state_changed = True
            for path, raw in ((self.paths.pins, canonical(self.next_manifest)+b"\n"),
                              (self.paths.current_plan,canonical(self.next_current)+b"\n")):
                old,meta=self.baselines[path]
                require(_safe_bytes(path)==old, "PIN_OR_PLAN_CAS")
                self.replaced.append((path,raw))
                _atomic(path, raw, meta)
        else:
            self.state_after = self.state_before
            self.candidate_state_baseline = self.state_before_row
            require(self.parent._assert_expected_pins(self.desired["runners"]) is None,
                    "RESUME_PIN_READBACK")
        self.parent._assert_expected_pins(self.desired["runners"])
        self.health()
        # Keep the unsafe legacy instance from returning on reboot while the
        # candidate collects three actual decision-cycle ticks.
        self.systemd.disable(self.old_unit)
        require(not self.systemd.is_enabled(self.old_unit), "OLD_UNIT_NOT_DISABLED")
        try:
            self.pre_start_tick = _safe_bytes(TICK)
        except FileNotFoundError:
            self.pre_start_tick = None
        self.tick_start_boundary = time.time_ns() // 1000000
        self.new_started=True
        self.systemd.start(self.new_unit)

    def audit(self):
        self.failure_phase = "audit"
        stamps=[]
        deadline=time.monotonic()+3600
        pid=None
        while len(stamps)<3:
            require(time.monotonic()<deadline,"THREE_TICKS_TIMEOUT")
            require(not self.systemd.is_active(self.old_unit),
                    "DUPLICATE_HYPE")
            require(not self.systemd.is_enabled(self.old_unit),
                    "OLD_UNIT_ENABLED_DURING_AUDIT")
            require(self.systemd.active_state(self.new_unit)=="active",
                    "NEW_UNIT_STOPPED")
            new_pid=self.systemd.main_pid(self.new_unit)
            require(new_pid>0 and (pid is None or new_pid==pid),"PID_CHANGED")
            pid=new_pid
            require(self.systemd._state(self.new_unit,"NRestarts")=="0",
                    "RUNNER_RESTARTED")
            require(Path("/proc",str(pid),"cwd").resolve(strict=True)==self.release,
                    "PID_CWD_MISMATCH")
            self.parent._assert_expected_pins(self.desired["runners"])
            self.health()
            state=json.loads(_safe_bytes(STATE))
            validate_flat_hype_state(state,self.args.sha)
            try:
                tick=read_hype_audit_tick(_safe_bytes(TICK), self.pre_start_tick)
            except FileNotFoundError:
                self.parent.sleep_fn(3);continue
            if tick is None or tick.get("tickCompletedAt") in stamps:
                self.parent.sleep_fn(3);continue
            stamp=validate_hype_tick(tick,sha=self.args.sha,pid=pid,release=self.release,
                                     previous=stamps[-1] if stamps else None,
                                     started_after=self.tick_start_boundary)
            self.signed_flat()
            stamps.append(stamp)
            self.parent.sleep_fn(3)
        return stamps

    def commit(self, stamps):
        self.failure_phase = "commit"
        self.health()
        self.parent._assert_expected_pins(self.desired["runners"])
        receipt = {
            "status":"HYPE_PROTECTED_HOLD_VERIFIED_NOT_ORDER_ENABLED",
            "scope": RUNNER, "sourceSha":self.args.sha,
            "recoveryMode":self.plan_mode,
            "planSha256":self.args.plan_sha256,
            "runtimeLive":True,"effectiveNewOrdersAllowed":False,
            "protectedHoldPreserved":True,"authorizesKillClearance":False,
            "priorActivationSha256":getattr(self,"prior_activation_sha256",None),
            "threeRealTickTimes":stamps,
            "oldServiceEnabled":False,
            "ordersSent":0,"cancelsSent":0,"positionChangesSent":0,
            "committedAt":self.parent.clock(),
        }
        _root_file(self.receipt, canonical(receipt)+b"\n", 0o400, self.created)
        self.systemd.enable(self.new_unit)
        require(not self.systemd.is_enabled(self.old_unit), "OLD_UNIT_NOT_DISABLED_AT_COMMIT")
        return receipt

    def rollback(self):
        errors=[]
        def attempt(fn):
            try: fn()
            except Exception as error: errors.append(str(type(error).__name__))
        if self.new_started:
            attempt(lambda:self.systemd.stop(self.new_unit))
            require(self.systemd.main_pid(self.new_unit)==0 and
                    not self.systemd.is_active(self.new_unit),
                    "ROLLBACK_NEW_UNIT_STILL_RUNNING")
            attempt(lambda:self.systemd.disable(self.new_unit))
        if self.old_enabled:
            # The old HYPE release does not enforce the current shared HOLD.
            # Never re-enable or restart it as a rollback action.
            attempt(lambda:self.systemd.disable(self.old_unit))
        if self.plan_mode == "resume":
            self.health()
            current_state = _safe_bytes(STATE)
            validate_flat_hype_state(json.loads(current_state), self.args.sha)
            self.signed_flat()
            require(_safe_bytes(STATE) == current_state, "RESUME_ROLLBACK_LEDGER_RACE")
            if self.activation_written:
                activation_now = _safe_bytes(self.approval)
                require(activation_now == self.approval_bytes, "RESUME_ROLLBACK_ACTIVATION_RACE")
                self.approval.unlink()
                self.activation_written = False
            attempt(lambda:self.command("daemon-reload"))
            if errors:
                raise RuntimeError("HYPE_SCOPED_ROLLBACK_INCOMPLETE:" + ",".join(errors))
            return
        if self.state_changed:
            cur=_safe_bytes(STATE)
            current_state=json.loads(cur)
            restored_state=rebase_hype_state_for_rollback(
                current_state,self.candidate_state_baseline,OLD,self.args.sha)
            restored=canonical(restored_state)+b"\n"
            metadata=STATE.lstat()
            self.signed_flat()
            require(_safe_bytes(STATE)==cur,"ROLLBACK_LEDGER_RACE")
            _atomic(STATE,restored,metadata)
            require(_safe_bytes(STATE)==restored,"ROLLBACK_LEDGER_READBACK")
        for path, written in reversed(self.replaced):
            old,meta=self.baselines[path]
            def undo(p=path,w=written,b=old,m=meta):
                require(_safe_bytes(p) in (b,w),"ROLLBACK_CAS_CONFLICT")
                _atomic(p,b,m)
            attempt(undo)
        for path in reversed(self.created):
            attempt(lambda p=path:p.unlink(missing_ok=True))
        if self.dropin_created:
            attempt(self.dropin.rmdir)
        attempt(lambda:self.command("daemon-reload"))
        if errors:
            raise RuntimeError("HYPE_SCOPED_ROLLBACK_INCOMPLETE:" + ",".join(errors))


class HypeScopedRootExecutor:
    def __init__(self, parent):
        self.parent=parent

    def submit(self, args, token):
        from disdex_unified_root_gate import assert_private_dir
        require(args.scope == RUNNER and args.orders_enabled == "true"
                and args.deployment_target == "professional-dismanager.net"
                and args.operator_target == "DD1296_FINAL_ALLIN_10BPS",
                "EXACT_SCOPED_SUBMISSION_REQUIRED")
        for directory in (JOB_DIR.parent, JOB_DIR):
            if not directory.exists():
                directory.mkdir(mode=0o700)
                os.chown(directory, self.parent.root_uid, self.parent.root_uid)
                directory.chmod(0o700)
            assert_private_dir(directory, root_uid=self.parent.root_uid)
        payload = self.parent._verify_token(args, token)
        nonce = payload.get("nonce")
        require(isinstance(nonce,str) and re.fullmatch(r"[a-f0-9]{32}",nonce),
                "FRESH_APPROVAL_NONCE_REQUIRED")
        row = {
            "schema": "disdex-hype-scoped-job/v1", "jobId": nonce,
            "deploymentTarget": args.deployment_target,
            "operatorTarget": args.operator_target,
            "sourceSha": args.sha, "scope": args.scope,
            "ordersEnabled": True, "planSha256": args.plan_sha256,
            "route": args.route, "owner": args.owner,
        }
        if args.route == "CODEX_SSH":
            row["authorization"] = payload
        else:
            require(isinstance(token,str) and 0 < len(token) <= 16384,
                    "OWNER_SIGNED_TOKEN_REQUIRED")
            row["approvalToken"] = token
        job_path = JOB_DIR/(nonce+".json")
        flags = os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,"O_NOFOLLOW",0)
        fd = os.open(job_path,flags,0o600)
        try:
            os.fchown(fd,self.parent.root_uid,self.parent.root_uid)
            data = canonical(row)+b"\n"
            view = memoryview(data)
            while view:
                written = os.write(fd,view)
                require(written > 0,"JOB_REQUEST_SHORT_WRITE")
                view = view[written:]
            os.fsync(fd)
        finally:
            os.close(fd)
        directory = os.open(JOB_DIR,os.O_RDONLY|getattr(os,"O_DIRECTORY",0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        unit = "disdex-hype-scoped-cutover@"+nonce+".service"
        proc = subprocess.run(["/usr/bin/systemctl","start","--no-block",unit],
                              capture_output=True,text=True,timeout=20)
        require(proc.returncode == 0,"PERSISTENT_JOB_START_FAILED")
        return {
            "status":"HYPE_SCOPED_JOB_QUEUED_NOT_LIVE",
            "jobId":nonce,"scope":RUNNER,"sourceSha":args.sha,
            "planSha256":args.plan_sha256,"route":args.route,
            "ordersEnabled":True,"workerUnit":unit,
            "receiptPath":"/var/lib/disdex/unified-deploy/receipts/hype-protected-hold-"+args.sha+".json",
        }

    def execute(self, args, token):
        from disdex_v52_scoped_root_cutover import run_scoped_transaction
        if not getattr(args,"_hype_job_worker",False):
            return self.submit(args,token)
        operations = HypeScopedOperations(self.parent,args,token)
        try:
            return run_scoped_transaction(operations)
        except Exception as error:
            try:
                error.hype_failure_phase = operations.failure_phase
            except Exception:
                pass
            raise
