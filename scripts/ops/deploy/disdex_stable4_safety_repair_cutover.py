#!/usr/bin/env python3
"""Fail-closed, monitor-only V52/Q102 safety repair cutover.

This file is intentionally parameterized only by the exact candidate and plan
below.  It never clears the GLOBAL HOLD, enables orders, or calls an exchange
mutation endpoint.  All changes are reversible root-owned pin/unit/state
transactions; a failed postcondition restores the captured files and starts
the previous generation only after a fresh unchanged venue reconciliation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from disdex_owner_approval import verify as verify_owner_token

TARGET = "c7310d34ba1b6de07071d8883a2ed0de8dcce2a7"
PLAN_SHA256 = "542b30ea87fa0e6ea9d27dd63fecc00181e95d4040a544aa9004fed579f4d68f"
V52_OLD = "8495daf24e53a6cf0dd5e38f022008fa8f78c688"
Q102_OLD = "ef1ab178e26a7bf5bddb6473467765edba242e1d"
HOLD_DIGEST = "928a1c83b08c6445211639631ed69ccf7ea935741cb21786c41fc63e294322cf"
BASE = Path("/home/deploy/disdex-trading/releases")
CURRENT = Path("/home/deploy/disdex-trading/current")
PINS = Path("/etc/disdex/runner-pins.json")
CURRENT_PLAN = Path("/var/lib/disdex/unified-deploy/current-plan.json")
V52_PIN = Path("/etc/disdex/current-runtime/v52-current.env")
Q102_STATE = Path("/var/lib/disdex/quality102-causal-v1/state.json")
HOLD = Path("/var/lib/disdex/shared/kill-switch.json")
RISK = Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
MARGIN_GUARD_UNIT = "disdex-v12-v52-margin-guard@7688ed7c93a1918d8b44837339b7da5584a868f5.service"
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
HEARTBEATS = {
    "V52": Path("/var/lib/disdex/runner-health/heartbeats/v52.json"),
    "Q102": Path("/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json"),
}
HEARTBEAT_TICKS = {
    "V52": Path("/var/lib/disdex/runner-health/ticks/v52.json"),
    "Q102": Path("/var/lib/disdex/runner-health/ticks/quality102-causal-v1.json"),
}
V52_UNIT_OLD = f"disdex-v52-aster-only@{V52_OLD}.service"
V52_UNIT_NEW = f"disdex-v52-aster-only@{TARGET}.service"
Q102_UNIT_OLD = f"disdex-quality102-causal-v1@{Q102_OLD}.service"
Q102_UNIT_NEW = f"disdex-quality102-causal-v1@{TARGET}.service"
BACKUP_ROOT = Path("/var/backups/disdex-stable4-safety-repair")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PLAN_RE = re.compile(r"^[0-9a-f]{64}$")
REPO = "dunamishajime-bit/-ai-dex-manager"
SCOPE = "FULL_PROJECT"
OPERATOR = "dunamishajime-bit"
DEPLOYMENT_TARGET = "professional-dismanager.net"
ROUTE = "GITHUB_ACTIONS"
DEFAULT_PUBLIC_KEY = Path("/var/lib/disdex/unified-deploy/owner-approval-public.pem")
DEFAULT_NONCE_DIR = Path("/var/lib/disdex/unified-deploy/nonces")


class ContractError(RuntimeError):
    pass


def cutover_blocked_reason(error: BaseException) -> str:
    """Keep the fail-closed cutover error actionable without changing behavior."""
    detail = str(error).strip() or type(error).__name__
    # Keep the bounded systemd context ahead of the generic ``Job failed``
    # sentence, otherwise the outer 240-character contract message would hide
    # the exact Result/status fields needed to diagnose the failed preflight.
    if (
        detail.startswith("COMMAND_FAILED:systemctl start")
        and "|show=" in detail
        and ":status=" not in detail.split("|show=", 1)[0]
    ):
        command, context = detail.split("|show=", 1)
        detail = "show=" + context + "|" + command
    return f"CUTOVER_BLOCKED:{type(error).__name__}:{detail[:240]}"


def margin_guard_error_class(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    error = value.lower()
    if "aster_global_rate_budget" in error or "rate budget" in error:
        return "RATE_BUDGET"
    if any(token in error for token in ("401", "403", "unauthor", "signature", "credential")):
        return "AUTH_OR_SIGNATURE"
    if any(token in error for token in ("timeout", "timed out")):
        return "TIMEOUT"
    if any(token in error for token in ("position-risk row missing", "leverage mismatch", "margin type mismatch")):
        return "POSITION_RISK_SCHEMA"
    if any(token in error for token in ("ownership state", "identity mismatch")):
        return "OWNERSHIP_STATE"
    if any(token in error for token in ("json", "decode", "schema")):
        return "STATE_SCHEMA"
    if any(token in error for token in ("enospc", "no space left")):
        return "STORAGE"
    if any(token in error for token in ("connection", "connect", "dns", "network", "ssl")):
        return "NETWORK"
    return "ERROR_PRESENT"


def margin_guard_ownership_diagnostic(value: object) -> dict | None:
    """Extract only the state filename and safe code values from an ownership error."""
    if not isinstance(value, str) or "ownership state" not in value.lower():
        return None
    unavailable = re.search(
        r"ownership state unavailable:\s*(.+?)(?::|$)", value, flags=re.IGNORECASE
    )
    if unavailable:
        path = Path(unavailable.group(1).strip())
        return {"directory": path.parent.name[:120], "file": path.name[:120], "kind": "UNAVAILABLE"}
    not_object = re.search(
        r"ownership state is not an object:\s*(.+)$", value, flags=re.IGNORECASE
    )
    if not_object:
        path = Path(not_object.group(1).strip())
        return {"directory": path.parent.name[:120], "file": path.name[:120], "kind": "NOT_OBJECT"}
    invalid_entry = re.search(
        r"ownership state entry is invalid:\s*(.+?)(?::|$)", value, flags=re.IGNORECASE
    )
    if invalid_entry:
        path = Path(invalid_entry.group(1).strip())
        return {"directory": path.parent.name[:120], "file": path.name[:120], "kind": "INVALID_ENTRY"}
    match = re.search(
        r"identity mismatch:\s*(.+?):\s*expected=([^,]+),\s*got=(.*)$",
        value,
        flags=re.IGNORECASE,
    )
    if not match:
        return {"directory": "UNKNOWN", "file": "UNKNOWN", "kind": "UNCLASSIFIED"}
    path = Path(match.group(1).strip())
    return {
        "directory": path.parent.name[:120],
        "file": path.name[:120],
        "kind": "IDENTITY_MISMATCH",
        "expected": match.group(2).strip()[:80],
        "got": match.group(3).strip()[:80],
    }


def margin_guard_service_diagnostic() -> str:
    """Expose only non-sensitive systemd health fields for the canonical guard."""
    payload = {}
    for key in ("ActiveState", "SubState", "Result", "NRestarts", "MainPID", "ExecMainStatus"):
        try:
            payload[key] = unit_property(MARGIN_GUARD_UNIT, key)
        except Exception:
            payload[key] = "UNAVAILABLE"
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def margin_guard_diagnostic(value: dict, now_ms: int | None = None) -> str:
    """Return only non-sensitive Margin Guard fields needed for diagnosis.

    The guard file may contain account or venue details.  Never dump that JSON
    into an Action log; expose only the state, order flag, freshness age, and a
    short structured reason code.
    """
    now = int(time.time() * 1000) if now_ms is None else int(now_ms)
    checked = value.get("checkedAt")
    age = None
    if isinstance(checked, (int, float)) and not isinstance(checked, bool):
        age = now - int(checked)
    reason = value.get("reason")
    if isinstance(reason, str):
        reason = reason.strip()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9_.:-]{0,119}", reason):
            reason = "UNSAFE_OR_UNSTRUCTURED_REASON"
    else:
        reason = None
    payload = {
        "stage": str(value.get("stage") or "")[:80],
        "ordersAllowed": value.get("ordersAllowed") if isinstance(value.get("ordersAllowed"), bool) else None,
        "checkedAtAgeMs": age,
        "reason": reason,
        "consecutiveFailures": value.get("consecutiveFailures") if isinstance(value.get("consecutiveFailures"), int) else None,
        "pollIntervalMs": value.get("pollIntervalMs") if isinstance(value.get("pollIntervalMs"), int) else None,
        "lastErrorClass": margin_guard_error_class(value.get("lastError")),
        "ownership": margin_guard_ownership_diagnostic(value.get("lastError")),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise ContractError(reason)


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def inventory_digest(value: dict) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def validate_plan(plan: dict) -> bool:
    require(plan.get("schema") == "disdex-stable4-safety-repair-plan/v1", "PLAN_SCHEMA_INVALID")
    require(plan.get("target") == DEPLOYMENT_TARGET, "PLAN_TARGET_INVALID")
    require(plan.get("operatorTarget") == "DD1296_FINAL_ALLIN_10BPS", "PLAN_OPERATOR_TARGET_INVALID")
    require(plan.get("candidateType") == "combined-v52-q102-safety-repair", "PLAN_TYPE_INVALID")
    components = plan.get("components") or {}
    require(components.get("v52", {}).get("baseRuntimeSha") == V52_OLD, "PLAN_V52_BASE_INVALID")
    require(components.get("q102", {}).get("baseRuntimeSha") == Q102_OLD, "PLAN_Q102_BASE_INVALID")
    require(components.get("v52", {}).get("ordersEnabled") is False, "PLAN_V52_ORDER_FLAG_INVALID")
    require(components.get("q102", {}).get("ordersEnabled") is False, "PLAN_Q102_ORDER_FLAG_INVALID")
    hold = plan.get("globalHold") or {}
    for key, expected in {
        "active": True, "strategyId": "STABLE4_H48_CUTOVER", "action": "HOLD_PROTECTED",
        "scope": "GLOBAL", "operator": "disdex-stable4-formal-owner-hold",
        "mustRemainByteIdentical": True,
        "digestSha256": HOLD_DIGEST,
    }.items():
        require(hold.get(key) == expected, "GLOBAL_HOLD_CONTRACT_INVALID:" + key)
    venue = plan.get("venuePreflight") or {}
    require(venue.get("signedAsterGets") == 3, "SIGNED_GET_COUNT_INVALID")
    require(venue.get("requireFlatPositions") is True and venue.get("requireNoOpenOrders") is True,
            "VENUE_FLAT_CONTRACT_INVALID")
    for key in ("ordersSent", "cancelsSent", "positionChangesSent"):
        require(venue.get(key) == 0, "NONZERO_MUTATION_CONTRACT:" + key)
    cutover = plan.get("cutover") or {}
    for key, expected in {
        "v52TargetMustDifferFrom": V52_OLD,
        "q102TargetMustDifferFrom": Q102_OLD,
        "dualRunnerForbidden": True,
        "clearGlobalHold": False,
        "enableNewOrders": False,
        "rootOwnedImmutableRelease": True,
        "formalGithubActionsOnly": True,
    }.items():
        require(cutover.get(key) == expected, "CUTOVER_CONTRACT_INVALID:" + key)
    rollback = plan.get("rollback") or {}
    require(rollback.get("automaticOnFailure") is True
            and rollback.get("restoreV52") == V52_OLD
            and rollback.get("restoreQ102") == Q102_OLD
            and rollback.get("requireFreshVenueReconciliationBeforeRestart") is True,
            "ROLLBACK_CONTRACT_INVALID")
    verification = plan.get("verification") or {}
    require(verification.get("postCutoverCycles") == 3
            and verification.get("requireV52RestartCountStable") is True
            and verification.get("requireQ102Freshness") is True
            and verification.get("requireGlobalHoldDigestUnchanged") is True
            and verification.get("requireTradingMutationZero") is True,
            "VERIFICATION_CONTRACT_INVALID")
    return True


def _sanitize_failure_text(value: object, limit: int = 180) -> str:
    """Keep service diagnostics useful without copying credentials into logs."""
    text = " ".join(str(value or "").split())
    if not text:
        return ""
    # Redact the value after common credential-bearing words while retaining
    # the surrounding error text (for example, ``Job failed``) for diagnosis.
    text = re.sub(
        r"(?i)(token|secret|password|passwd|authorization|bearer|api[_-]?key|credential|signature)[^\s]*",
        r"\1=<redacted>",
        text,
    )
    text = re.sub(r"[^A-Za-z0-9_@%+.,:;/=()\- ]", "?", text)
    return text[:limit]


def _systemd_failure_context(unit: str) -> str:
    """Return a bounded, non-secret status summary for a failed start."""
    parts: list[str] = []

    def ordered() -> str:
        # ``systemctl status`` commonly exits 3 for a failed unit.  Put its
        # Process/ExecStartPre lines before the generic ``show`` summary so the
        # outer fail-closed 240-character message retains the useful cause.
        status_parts = [p for p in parts if p.startswith("status=")]
        failed_status = [
            p for p in status_parts
            if not re.search(r"(?i)\bstatus=0/(?:success|ok)\b", p)
        ]
        successful_status = [p for p in status_parts if p not in failed_status]
        ranked = failed_status + successful_status
        ranked += [p for p in parts if not p.startswith("status=")]
        return "|".join(ranked)[:640]

    try:
        status = subprocess.run(
            [
                "/usr/bin/systemctl", "show", unit,
                "--property=ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,StatusText,ExecConditionResult",
                "--no-pager",
            ], capture_output=True, text=True, timeout=10,
        )
        if status.returncode == 0:
            summary = _sanitize_failure_text(status.stdout, 320)
            if summary and summary != "[redacted]":
                parts.append("show=" + summary)
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        status = subprocess.run(
            ["/usr/bin/systemctl", "status", unit, "--no-pager", "--full"],
            capture_output=True, text=True, timeout=10,
        )
        # A non-zero status code is expected for a failed unit; the stdout
        # summary is still the authoritative diagnostic we need.
        for raw in status.stdout.splitlines():
            raw_flat = " ".join(raw.split())
            pre_match = re.search(
                r"(?i)execstartpre=(.*?)(?:\s+\(code=([^,)]*),\s*status=([^)]*)\))",
                raw_flat,
            )
            if pre_match:
                executable = pre_match.group(1).strip().split(None, 1)[0]
                executable = executable.rsplit("/", 1)[-1].lstrip("+")
                code = _sanitize_failure_text(pre_match.group(2), 40)
                result = _sanitize_failure_text(pre_match.group(3), 80)
                line = "ExecStartPre code=" + code + " status=" + result + " cmd=" + executable[:80]
            else:
                line = _sanitize_failure_text(raw, 360)
            if "execstartpre=" in line.lower():
                match = re.search(
                    r"(?i)execstartpre=(.*?)(?:\s+\(code=([^,)]*),\s*status=([^)]*)\))",
                    line,
                )
                if match:
                    executable = match.group(1).strip().split(None, 1)[0]
                    executable = executable.rsplit("/", 1)[-1].lstrip("+")
                    line = (
                        "ExecStartPre"
                        + " code=" + match.group(2).strip()
                        + " status=" + match.group(3).strip()
                        + " cmd=" + executable[:80]
                    )
            if line and line != "[redacted]" and re.search(
                r"(?i)(?:process:|execstartpre|code=|status=|failed|error|not found|permission)",
                line,
            ):
                parts.append("status=" + line)
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        journal = subprocess.run(
            ["/usr/bin/journalctl", "-u", unit, "-n", "8", "--no-pager", "-o", "cat"],
            capture_output=True, text=True, timeout=10,
        )
        if journal.returncode == 0:
            # Only include lines that are likely to identify a failed preflight
            # or process exit.  Credential-bearing lines are discarded above.
            for raw in journal.stdout.splitlines():
                line = _sanitize_failure_text(raw, 180)
                if line and line != "[redacted]" and re.search(
                    r"(?i)(?:error|failed|failure|cannot|denied|not found|missing|invalid|exit|preflight|readiness|permission|result)",
                    line,
                ):
                    parts.append("journal=" + line)
            if parts:
                return ordered()
    except (OSError, subprocess.SubprocessError):
        pass
    return ordered()


def run(*argv: str, timeout: int = 60, check: bool = True, input_text: str | None = None) -> str:
    p = subprocess.run(argv, input=input_text, capture_output=True, text=True, timeout=timeout)
    if check and p.returncode:
        command = argv[0].split("/")[-1]
        if command == "systemctl":
            command += " " + " ".join(argv[1:4])
        detail = _sanitize_failure_text(p.stderr)
        if command.startswith("systemctl start") and len(argv) >= 3:
            context = _systemd_failure_context(argv[2])
            if context:
                detail = "|".join(part for part in (context, detail) if part)
        suffix = ":" + detail[:640] if detail else ""
        raise ContractError("COMMAND_FAILED:" + command[:240] + suffix)
    return p.stdout.strip()


def read_regular(path: Path, max_bytes: int = 1_000_000, require_root: bool = False) -> bytes:
    require(path.is_file() and not path.is_symlink(), "REGULAR_FILE_REQUIRED:" + str(path))
    st = path.stat()
    require(stat.S_ISREG(st.st_mode) and st.st_size <= max_bytes and not (st.st_mode & 0o022),
            "UNSAFE_FILE:" + str(path))
    if require_root:
        require(st.st_uid == 0, "ROOT_OWNER_REQUIRED:" + str(path))
    return path.read_bytes()


def validate_hold_metadata(uid: int, mode: int) -> None:
    # The shared runtime HOLD is intentionally readable by the deploy-owned
    # Runner.  Match the existing order-enable contract while requiring the
    # private 0600 mode and rejecting every other owner.
    require(uid in (0, 1000) and mode == 0o600, "GLOBAL_HOLD_METADATA_INVALID")


def read_json(path: Path) -> dict:
    try:
        value = json.loads(read_regular(path).decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ContractError("JSON_INVALID:" + str(path)) from exc
    require(isinstance(value, dict), "JSON_OBJECT_REQUIRED:" + str(path))
    return value


def unit_property(unit: str, key: str) -> str:
    return run("/usr/bin/systemctl", "show", unit, "--property=" + key, "--value", timeout=20)


def active(unit: str) -> bool:
    return unit_property(unit, "ActiveState") == "active"


TERMINAL_OLD_ACTIVE_STATES = frozenset(("inactive", "failed"))
TRANSITIONAL_OLD_ACTIVE_STATES = frozenset(("activating", "deactivating", "reloading"))


def unit_runtime_state(unit: str) -> tuple[str, str]:
    return unit_property(unit, "ActiveState"), unit_property(unit, "SubState")


def _runner_state_kind(state: tuple[str, str]) -> str:
    active_state, sub_state = state
    if active_state == "active":
        return "active"
    if active_state in TERMINAL_OLD_ACTIVE_STATES:
        return "inactive"
    if active_state in TRANSITIONAL_OLD_ACTIVE_STATES or sub_state == "auto-restart":
        return "transitional"
    return "unknown"


def old_runner_runtime_mode(v52_state: tuple[str, str], q102_state: tuple[str, str]) -> str:
    """Classify old-generation systemd states without treating a restart loop as stopped.

    A single active old Runner paired with the other exact old unit in a known
    transitional state is a controlled quiesce baseline: the cutover may stop
    both exact old units, but it must never start the candidate while either
    old unit remains active.  Every other asymmetric or unknown state fails
    closed.
    """
    kinds = (_runner_state_kind(v52_state), _runner_state_kind(q102_state))
    if kinds == ("active", "active"):
        return "active"
    if kinds == ("inactive", "inactive"):
        return "inactive"
    if set(kinds) == {"active", "transitional"}:
        return "quiesce"
    if "active" in kinds and "inactive" in kinds:
        raise ContractError("OLD_RUNNERS_PARTIAL_ACTIVE")
    raise ContractError("OLD_RUNNERS_TRANSITIONAL_STATE")


def old_runner_mode(v52_active: bool, q102_active: bool) -> str:
    """Classify the pre-cutover generation without assuming it is running.

    A safety repair may be needed precisely because both old instances are
    already stopped. Treat that symmetric, flat state as a valid baseline,
    but fail closed on a partial stop so that we never start a new generation
    while one old instance is still serving.
    """
    require(v52_active == q102_active, "OLD_RUNNERS_PARTIAL_ACTIVE")
    return "active" if v52_active else "inactive"


def unit_release_matches(unit: str, expected: str) -> None:
    pid = int(unit_property(unit, "MainPID") or "0")
    require(pid > 100, "RUNNER_PID_INVALID:" + unit)
    cwd = os.path.realpath(f"/proc/{pid}/cwd")
    require(cwd == str(BASE / expected), "RUNNER_CWD_MISMATCH:" + unit)


def validate_old_quiesce_unit(unit: str, expected: str, state: tuple[str, str]) -> None:
    require(unit_property(unit, "LoadState") == "loaded", "OLD_UNIT_NOT_LOADED:" + expected)
    kind = _runner_state_kind(state)
    require(kind in ("active", "transitional"), "OLD_RUNNER_TRANSITIONAL_STATE:" + unit)
    pid = int(unit_property(unit, "MainPID") or "0")
    if pid > 100:
        unit_release_matches(unit, expected)
    else:
        require(pid == 0, "OLD_RUNNER_TRANSITION_PID_INVALID:" + unit)


def validate_target_units(require_monitor: bool = False) -> None:
    """Use the installed template units; never fabricate a systemd unit file."""
    for old, new, expected in (
        (V52_UNIT_OLD, V52_UNIT_NEW, "V52"),
        (Q102_UNIT_OLD, Q102_UNIT_NEW, "Q102"),
    ):
        # The target instance must resolve from the reviewed template/drop-ins.
        require(unit_property(new, "LoadState") == "loaded", "TARGET_UNIT_NOT_LOADED:" + expected)
        fragment = unit_property(new, "FragmentPath")
        require(fragment and not Path(fragment).is_symlink(), "TARGET_UNIT_FRAGMENT_INVALID:" + expected)
        text = run("/usr/bin/systemctl", "cat", new, timeout=30)
        require("[Service]" in text, "TARGET_UNIT_SERVICE_SECTION_MISSING:" + expected)
        working = unit_property(new, "WorkingDirectory")
        exec_start = unit_property(new, "ExecStart")
        effective = "\n".join((text, working, exec_start))
        require(str(BASE / TARGET) in effective or "%i" in effective,
                "TARGET_UNIT_RELEASE_NOT_BOUND:" + expected)
        require(V52_OLD not in effective and Q102_OLD not in effective,
                "TARGET_UNIT_OLD_SHA_REMAINS:" + expected)
        if require_monitor:
            require("DISDEX_MONITOR_NEW_ORDERS_ALLOWED=false" in text,
                    "TARGET_MONITOR_ORDER_FLAG_MISSING:" + expected)
            require("ExecStartPre=\n" in text and "ExecStart=\n" in text,
                    "TARGET_MONITOR_EXEC_RESET_MISSING:" + expected)
            if expected == "V52":
                require("--monitor-only-daemon" in text, "TARGET_V52_MONITOR_COMMAND_MISSING")
            else:
                require("scripts/disdex-quality102-causal-v1-monitor.ts --daemon" in text,
                        "TARGET_Q102_MONITOR_COMMAND_MISSING")
        require(not active(new), "TARGET_RUNNER_ALREADY_ACTIVE:" + expected)


def hold_snapshot() -> tuple[bytes, dict, str]:
    raw = read_regular(HOLD, 32_768)
    st = HOLD.stat()
    validate_hold_metadata(st.st_uid, stat.S_IMODE(st.st_mode))
    digest = hashlib.sha256(raw).hexdigest()
    require(digest == HOLD_DIGEST, "GLOBAL_HOLD_DIGEST_MISMATCH")
    value = json.loads(raw.decode("utf-8"))
    require(
        value.get("active") is True and value.get("strategyId") == "STABLE4_H48_CUTOVER"
        and value.get("action") == "HOLD_PROTECTED" and value.get("scope") == "GLOBAL"
        and value.get("operator") == "disdex-stable4-formal-owner-hold"
        and str(value.get("reason") or "").startswith("STABLE4_RESEARCH_ROLLOUT:")
        and value.get("recoverable") is False,
        "GLOBAL_HOLD_NOT_PROTECTED",
    )
    return raw, value, digest


def normalize_inventory(value: dict) -> dict:
    positions = []
    raw_positions = value.get("positions")
    raw_orders = value.get("openOrders")
    require(isinstance(raw_positions, list) and isinstance(raw_orders, list), "SIGNED_GET_ARRAYS_INVALID")
    for row in raw_positions:
        require(isinstance(row, dict), "POSITION_NOT_OBJECT")
        amount = float(row.get("positionAmt") or 0)
        if abs(amount) > 1e-15:
            positions.append({k: str(row.get(k) or "") for k in ("symbol", "positionAmt", "positionSide", "entryPrice")})
    orders = []
    for row in raw_orders:
        require(isinstance(row, dict), "ORDER_NOT_OBJECT")
        orders.append({k: row.get(k) for k in (
            "symbol", "orderId", "clientOrderId", "status", "side", "positionSide", "type",
            "reduceOnly", "closePosition", "origQty", "executedQty", "stopPrice")})
    positions.sort(key=lambda x: (x["symbol"], x["positionSide"], x["positionAmt"]))
    orders.sort(key=lambda x: (x["symbol"], str(x["orderId"]), str(x["clientOrderId"])))
    require(not positions and not orders, "VENUE_NOT_FLAT_OR_HAS_OPEN_ORDERS")
    return {"positions": positions, "openOrders": orders}


def signed_get() -> tuple[str, dict, str]:
    release = CURRENT.resolve()
    require(release.is_dir(), "CURRENT_RELEASE_MISSING")
    command = (
        "set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env /etc/disdex/disdex-v12-v4.env; do . \"$f\"; done; "
        "set +a; exec /usr/bin/node " + str(release / "node_modules/tsx/dist/cli.mjs") +
        " scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    p = subprocess.run(["/bin/bash", "-c", command], cwd=release, capture_output=True, text=True, timeout=65)
    require(p.returncode == 0, "SIGNED_ASTER_GET_FAILED")
    rows = [line for line in p.stdout.splitlines() if line.startswith("{")]
    require(rows, "SIGNED_ASTER_GET_EMPTY")
    value = json.loads(rows[-1])
    require(value.get("status") == "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS", "SIGNED_ASTER_GET_NOT_PASS")
    for key in ("ordersSent", "cancelsSent", "positionChangesSent"):
        require(value.get(key) == 0, "SIGNED_GET_MUTATION:" + key)
    inventory = normalize_inventory(value)
    stamp = str(value.get("observedAt") or value.get("venueTime") or "")
    require(bool(stamp), "SIGNED_GET_TIMESTAMP_MISSING")
    return stamp, inventory, inventory_digest(inventory)


def validate_shared_files() -> None:
    _raw, _hold, _digest = hold_snapshot()
    risk = read_json(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is False, "SHARED_RISK_NOT_HEALTHY")
    require(abs(float(risk.get("maximumLossPct")) - 7.5) < 1e-9, "SHARED_RISK_LIMIT_MISMATCH")
    risk_updated = risk.get("updatedAt")
    now = int(time.time() * 1000)
    require(type(risk_updated) in (int, float) and -1000 <= now - float(risk_updated) <= 15 * 60_000,
            "SHARED_RISK_STALE")
    margin = read_json(MARGIN)
    if margin.get("stage") != "HEALTHY":
        print("MARGIN_GUARD_DIAGNOSTIC=" + margin_guard_diagnostic(margin), file=sys.stderr)
        print("MARGIN_GUARD_SERVICE=" + margin_guard_service_diagnostic(), file=sys.stderr)
    require(margin.get("stage") == "HEALTHY", "MARGIN_GUARD_NOT_HEALTHY:" + str(margin.get("stage")))
    checked = margin.get("checkedAt")
    require(type(checked) in (int, float) and -1000 <= now - float(checked) <= 15 * 60_000,
            "MARGIN_GUARD_STALE")
    pending = read_json(PENDING)
    require(isinstance(pending.get("entries"), list)
            and not any(str(row.get("status", "")).upper() != "RELEASED" for row in pending["entries"]),
            "PENDING_EXPOSURE_ACTIVE")


def validate_baseline() -> tuple[bytes, bytes, bytes, dict, dict, str, str]:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    v52_state = unit_runtime_state(V52_UNIT_OLD)
    q102_state = unit_runtime_state(Q102_UNIT_OLD)
    old_mode = old_runner_runtime_mode(v52_state, q102_state)
    if old_mode == "active":
        unit_release_matches(V52_UNIT_OLD, V52_OLD)
        unit_release_matches(Q102_UNIT_OLD, Q102_OLD)
    elif old_mode == "quiesce":
        validate_old_quiesce_unit(V52_UNIT_OLD, V52_OLD, v52_state)
        validate_old_quiesce_unit(Q102_UNIT_OLD, Q102_OLD, q102_state)
    else:
        # The stopped baseline is intentional for a safety repair. Still
        # require both reviewed instances to resolve from systemd so a typo or
        # missing unit cannot be mistaken for a recoverable stop.
        require(unit_property(V52_UNIT_OLD, "LoadState") == "loaded", "OLD_UNIT_NOT_LOADED:V52")
        require(unit_property(Q102_UNIT_OLD, "LoadState") == "loaded", "OLD_UNIT_NOT_LOADED:Q102")
    validate_target_units()
    require(not active(V52_UNIT_NEW) and not active(Q102_UNIT_NEW), "TARGET_RUNNER_ALREADY_ACTIVE")
    require((CURRENT / ".disdex-release-sha").read_text().strip() != TARGET, "CURRENT_RELEASE_CANDIDATE_UNEXPECTED")
    hold_raw, _hold, hold_digest = hold_snapshot()
    pins_raw = read_regular(PINS, 131_072, require_root=True)
    plan_raw = read_regular(CURRENT_PLAN, 131_072, require_root=True)
    pins = json.loads(pins_raw.decode("utf-8")); plan = json.loads(plan_raw.decode("utf-8"))
    require(pins.get("runners", {}).get("V52", {}).get("sha") == V52_OLD, "V52_BASELINE_PIN_MISMATCH")
    require(pins.get("runners", {}).get("QUALITY102_CAUSAL_V1", {}).get("sha") == Q102_OLD,
            "Q102_BASELINE_PIN_MISMATCH")
    require(plan.get("ordersEnabled") is False, "CURRENT_PLAN_ORDERS_NOT_DISABLED")
    state = read_json(Q102_STATE)
    require(Q102_STATE.stat().st_uid == 0, "Q102_STATE_NOT_ROOT_OWNED")
    require(state.get("runtimeCommitSha") == Q102_OLD and not state.get("position") and not state.get("pending"),
            "Q102_BASELINE_NOT_FLAT")
    validate_shared_files()
    observations = [signed_get() for _ in range(3)]
    require(len({x[0] for x in observations}) == 3, "SIGNED_GET_TIMESTAMPS_NOT_UNIQUE")
    require(len({x[2] for x in observations}) == 1, "VENUE_INVENTORY_CHANGED_PRECUTOVER")
    return pins_raw, plan_raw, hold_raw, pins, plan, observations[-1][2], old_mode


def file_meta(path: Path) -> tuple[int, int, int]:
    st = path.stat()
    return st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode)


def write_atomic(path: Path, data: bytes, meta: tuple[int, int, int] | None = None,
                 mode: int | None = None) -> None:
    fd, name = tempfile.mkstemp(dir=str(path.parent), prefix=".stable4-safety-")
    try:
        with os.fdopen(fd, "wb") as fh:
            os.fchmod(fh.fileno(), mode if mode is not None else (meta[2] if meta else 0o600))
            fh.write(data); fh.flush(); os.fsync(fh.fileno())
        uid, gid = (meta[0], meta[1]) if meta else (0, 0)
        os.chown(name, uid, gid)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


MONITOR_DROPIN_ROOT = Path("/etc/systemd/system")


def monitor_dropin_paths(target: str = TARGET) -> dict[str, Path]:
    require(SHA_RE.fullmatch(target) is not None, "MONITOR_DROPIN_TARGET_INVALID")
    return {
        "V52": MONITOR_DROPIN_ROOT / f"disdex-v52-aster-only@{target}.service.d" / "95-stable4-monitor-only.conf",
        "Q102": MONITOR_DROPIN_ROOT / f"disdex-quality102-causal-v1@{target}.service.d" / "95-stable4-monitor-only.conf",
    }


def monitor_dropin_text(runner: str) -> str:
    """Return an instance-scoped systemd override for a read-only monitor."""
    if runner == "V52":
        return (
            "[Service]\n"
            "Environment=DISDEX_MONITOR_NEW_ORDERS_ALLOWED=false\n"
            "Environment=DISDEX_RELEASE_SHA=%i\n"
            "Environment=DISDEX_RUNTIME_COMMIT_SHA=%i\n"
            "Environment=DISDEX_RUNTIME_SHA=%i\n"
            "Environment=DISDEX_RELEASE_ROOT=/home/deploy/disdex-trading/releases/%i\n"
            "Environment=DISDEX_V52_MONITOR_ONLY=true\n"
            "Environment=DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=false\n"
            "Environment=DISDEX_V52_MONITOR_SERVICE_UNIT=disdex-v52-aster-only@%i.service\n"
            "Environment=DISDEX_V52_MONITOR_HEALTH_PATH=/var/lib/disdex/runner-health/heartbeats/v52.json\n"
            "Environment=DISDEX_V52_MONITOR_TICK_PATH=/var/lib/disdex/runner-health/ticks/v52.json\n"
            "ExecStartPre=\n"
            "ExecStartPre=/usr/bin/test -f /home/deploy/disdex-trading/releases/%i/.disdex-release-sha\n"
            "ExecStartPre=/usr/bin/grep -Fxq %i /home/deploy/disdex-trading/releases/%i/.disdex-release-sha\n"
            "ExecStartPre=/usr/bin/test -x /home/deploy/disdex-trading/releases/%i/.venv2/bin/python\n"
            "ExecStartPre=/usr/bin/test -d /var/lib/disdex/runner-health/heartbeats\n"
            "ExecStartPre=/usr/bin/test -d /var/lib/disdex/runner-health/ticks\n"
            "ExecStart=\n"
            "ExecStart=/bin/sh -ec 'export DISDEX_RELEASE_SHA=%i DISDEX_RUNTIME_COMMIT_SHA=%i DISDEX_RUNTIME_SHA=%i DISDEX_RELEASE_ROOT=/home/deploy/disdex-trading/releases/%i DISDEX_V52_MONITOR_ONLY=true DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=false DISDEX_V52_MONITOR_SERVICE_UNIT=disdex-v52-aster-only@%i.service DISDEX_V52_MONITOR_HEALTH_PATH=/var/lib/disdex/runner-health/heartbeats/v52.json DISDEX_V52_MONITOR_TICK_PATH=/var/lib/disdex/runner-health/ticks/v52.json; exec /home/deploy/disdex-trading/releases/%i/.venv2/bin/python scripts/disdex_v52_aster_only_live_engine.py --mode live --daemon --monitor-only-daemon'\n"
            "ReadOnlyPaths=\n"
            "ReadOnlyPaths=/home/deploy/disdex-trading/releases /etc/disdex /var/lib/disdex/shared /var/lib/disdex/v52-monitor\n"
            "ReadWritePaths=\n"
            "ReadWritePaths=/var/lib/disdex/runner-health/heartbeats /var/lib/disdex/runner-health/ticks\n"
        )
    if runner == "Q102":
        return (
            "[Service]\n"
            "Environment=DISDEX_MONITOR_NEW_ORDERS_ALLOWED=false\n"
            "Environment=DISDEX_RELEASE_SHA=%i\n"
            "Environment=DISDEX_RUNTIME_COMMIT_SHA=%i\n"
            "Environment=DISDEX_RELEASE_ROOT=/home/deploy/disdex-trading/releases/%i\n"
            "Environment=QUALITY102_CAUSAL_V1_MODE=LIVE\n"
            "Environment=QUALITY102_CAUSAL_V1_MONITOR_ONLY=true\n"
            "Environment=QUALITY102_CAUSAL_V1_ENABLED=false\n"
            "Environment=QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED=false\n"
            "Environment=QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false\n"
            "Environment=QUALITY102_CAUSAL_V1_OPERATOR_ARMED=false\n"
            "Environment=QUALITY102_LIVE_SELECTOR_PARITY=false\n"
            "Environment=QUALITY102_LIVE_ENABLED=false\n"
            "Environment=QUALITY102_CAUSAL_V1_LIVE_ACK=%i\n"
            "Environment=QUALITY102_CAUSAL_V1_PREFLIGHT_HISTORY_CHECK=false\n"
            "Environment=QUALITY102_CAUSAL_V1_MONITOR_SERVICE_UNIT=disdex-quality102-causal-v1@%i.service\n"
            "Environment=QUALITY102_CAUSAL_V1_MONITOR_HEALTH_PATH=/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json\n"
            "Environment=QUALITY102_CAUSAL_V1_MONITOR_TICK_PATH=/var/lib/disdex/runner-health/ticks/quality102-causal-v1.json\n"
            "ExecStartPre=\n"
            "ExecStartPre=/usr/bin/test -f /home/deploy/disdex-trading/releases/%i/.disdex-release-sha\n"
            "ExecStartPre=/usr/bin/grep -Fxq %i /home/deploy/disdex-trading/releases/%i/.disdex-release-sha\n"
            "ExecStartPre=/usr/bin/test -x /home/deploy/disdex-trading/releases/%i/node_modules/.bin/tsx\n"
            "ExecStartPre=/usr/bin/test -f /home/deploy/disdex-trading/releases/%i/scripts/disdex-quality102-causal-v1-monitor.ts\n"
            "ExecStartPre=/usr/bin/test -d /var/lib/disdex/runner-health/heartbeats\n"
            "ExecStartPre=/usr/bin/test -d /var/lib/disdex/runner-health/ticks\n"
            "ExecStart=\n"
            "ExecStart=/home/deploy/disdex-trading/releases/%i/node_modules/.bin/tsx scripts/disdex-quality102-causal-v1-monitor.ts --daemon\n"
            "ReadOnlyPaths=\n"
            "ReadOnlyPaths=/home/deploy/disdex-trading/releases /etc/disdex /var/lib/disdex/quality102-causal-v1 /var/lib/disdex/shared\n"
            "ReadWritePaths=\n"
            "ReadWritePaths=/var/lib/disdex/runner-health/heartbeats /var/lib/disdex/runner-health/ticks\n"
        )
    raise ContractError("MONITOR_DROPIN_RUNNER_INVALID:" + runner)


def validate_monitor_heartbeat(value: dict, expected_sha: str, expected_unit: str, runner: str) -> bool:
    """Validate a monitor record before counting it as a healthy cycle."""
    require(isinstance(value, dict), "MONITOR_HEARTBEAT_OBJECT_REQUIRED")
    expected_runner = "V52_MONITOR" if runner == "V52" else "QUALITY102_CAUSAL_V1"
    allowed_schemas = {"disdex-runner-tick/v1"}
    if runner == "V52":
        allowed_schemas.add("disdex-v52-monitor-heartbeat/v1")
    require(value.get("schema") in allowed_schemas, "MONITOR_HEARTBEAT_SCHEMA_INVALID")
    require(value.get("runnerId") == expected_runner, "MONITOR_HEARTBEAT_RUNNER_INVALID")
    require(value.get("runtimeSha") == expected_sha and value.get("expectedSha") == expected_sha,
            "MONITOR_HEARTBEAT_SHA_MISMATCH")
    require(value.get("serviceUnit") == expected_unit, "MONITOR_HEARTBEAT_UNIT_MISMATCH")
    require(value.get("status") == "observing", "MONITOR_HEARTBEAT_STATUS_INVALID")
    require(value.get("mode") == "MONITOR_ONLY", "MONITOR_HEARTBEAT_MODE_INVALID")
    require(value.get("newOrdersAllowed") is False, "MONITOR_HEARTBEAT_ORDER_AUTHORITY_INVALID")
    require(value.get("permissionEvaluation") == "MONITOR_ONLY_NO_ORDER_PATH",
            "MONITOR_HEARTBEAT_PERMISSION_INVALID")
    for key in ("ordersSent", "cancelsSent", "positionChangesSent"):
        require(value.get(key) == 0, "MONITOR_HEARTBEAT_MUTATION_NONZERO:" + key)
    require(value.get("stateChanged") is False, "MONITOR_HEARTBEAT_STATE_CHANGED")
    require(timestamp_ms(value.get("updatedAt") or value.get("observedAt")) > 0,
            "MONITOR_HEARTBEAT_TIMESTAMP_INVALID")
    return True


def snapshot_monitor_dropins(target: str = TARGET) -> dict[Path, tuple[bool, bytes | None, tuple[int, int, int] | None]]:
    snapshot: dict[Path, tuple[bool, bytes | None, tuple[int, int, int] | None]] = {}
    for path in monitor_dropin_paths(target).values():
        if path.is_symlink():
            raise ContractError("MONITOR_DROPIN_SYMLINK:" + str(path))
        if path.exists():
            require(path.is_file(), "MONITOR_DROPIN_NOT_REGULAR:" + str(path))
            snapshot[path] = (True, path.read_bytes(), file_meta(path))
        else:
            snapshot[path] = (False, None, None)
    return snapshot


def install_monitor_dropins(
    snapshot: dict[Path, tuple[bool, bytes | None, tuple[int, int, int] | None]],
    target: str = TARGET,
) -> list[Path]:
    created_dirs: list[Path] = []
    for runner, path in monitor_dropin_paths(target).items():
        if path.parent.is_symlink():
            raise ContractError("MONITOR_DROPIN_PARENT_SYMLINK:" + str(path.parent))
        if not path.parent.exists():
            path.parent.mkdir(mode=0o755, parents=True)
            os.chown(path.parent, 0, 0)
            os.chmod(path.parent, 0o755)
            created_dirs.append(path.parent)
        expected = monitor_dropin_text(runner).encode("utf-8")
        existed, previous, _meta = snapshot[path]
        if existed and previous != expected:
            raise ContractError("MONITOR_DROPIN_UNEXPECTED_EXISTING:" + str(path))
        write_atomic(path, expected, (0, 0, 0o644))
    return created_dirs


def restore_monitor_dropins(
    snapshot: dict[Path, tuple[bool, bytes | None, tuple[int, int, int] | None]],
    created_dirs: list[Path] | None = None,
) -> None:
    for path, (existed, previous, meta) in snapshot.items():
        if existed:
            require(previous is not None and meta is not None, "MONITOR_DROPIN_SNAPSHOT_INVALID")
            write_atomic(path, previous, meta)
        elif path.exists() or path.is_symlink():
            require(not path.is_symlink(), "MONITOR_DROPIN_ROLLBACK_SYMLINK")
            path.unlink()
    for directory in reversed(created_dirs or []):
        try:
            directory.rmdir()
        except OSError:
            pass


def target_pins(raw: bytes) -> bytes:
    value = json.loads(raw.decode("utf-8"))
    for key, prefix, old in (("V52", "disdex-v52-aster-only", V52_OLD),
                             ("QUALITY102_CAUSAL_V1", "disdex-quality102-causal-v1", Q102_OLD)):
        row = value["runners"][key]
        require(row.get("sha") == old, "PIN_CHANGED_BEFORE_CUTOVER:" + key)
        row["sha"] = TARGET; row["serviceUnit"] = f"{prefix}@{TARGET}.service"; row["releaseRoot"] = str(BASE / TARGET)
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def target_plan(raw: bytes) -> bytes:
    value = json.loads(raw.decode("utf-8"))
    require(value.get("ordersEnabled") is False, "PLAN_ORDERS_CHANGED")
    for key in ("V52", "QUALITY102_CAUSAL_V1"):
        require(value.get("runners", {}).get(key) in (V52_OLD, Q102_OLD), "PLAN_BASELINE_INVALID:" + key)
        value["runners"][key] = TARGET
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def stage_candidate(tar_path: Path, manifest_path: Path) -> None:
    release = BASE / TARGET
    require(not release.exists() and not release.is_symlink(), "TARGET_RELEASE_ALREADY_EXISTS")
    stage = BASE / ("." + TARGET + ".stage")
    require(not stage.exists() and not stage.is_symlink(), "TARGET_STAGE_ALREADY_EXISTS")
    require(tar_path.is_file() and not tar_path.is_symlink(), "CANDIDATE_ARCHIVE_INVALID")
    require(manifest_path.is_file() and not manifest_path.is_symlink(), "CANDIDATE_MANIFEST_INVALID")
    listing = run("/usr/bin/tar", "-tzf", str(tar_path), timeout=120)
    for name in listing.splitlines():
        require(name and not name.startswith("/") and ".." not in Path(name).parts,
                "CANDIDATE_ARCHIVE_PATH_INVALID")
    stage.mkdir(mode=0o755)
    try:
        run("/usr/bin/tar", "--extract", "--gzip", "--file", str(tar_path),
            "--directory", str(stage), "--no-same-owner", "--no-same-permissions", timeout=180)
        # The repository archive must not smuggle executable symlinks into the
        # immutable release. Dependency links are created below and are the only
        # links allowed in this transaction.
        for link in stage.rglob("*"):
            require(not link.is_symlink(), "CANDIDATE_ARCHIVE_SYMLINK_FORBIDDEN")
        marker = stage / ".disdex-release-sha"; marker.write_text(TARGET + "\n", encoding="ascii")
        current = CURRENT.resolve()
        for dep in ("node_modules", ".venv2"):
            source = current / dep
            require(source.exists(), "CURRENT_DEPENDENCY_MISSING:" + dep)
            (stage / dep).symlink_to(source, target_is_directory=True)
        manifest = read_json(manifest_path)
        require(manifest.get("targetSha") == TARGET, "CANDIDATE_MANIFEST_TARGET_INVALID")
        for rel, digest in (manifest.get("files") or {}).items():
            rel_path = Path(rel)
            require(not rel_path.is_absolute() and ".." not in rel_path.parts, "CANDIDATE_MANIFEST_PATH_INVALID")
            path = stage / rel
            require(path.is_file() and not path.is_symlink()
                    and isinstance(digest, str) and hashlib.sha256(path.read_bytes()).hexdigest() == digest,
                    "CANDIDATE_SOURCE_HASH_MISMATCH:" + rel)
        # Archive extraction runs as root. Make regular files non-writable by
        # group/other without following any future dependency symlink.
        for path in stage.rglob("*"):
            if path.is_file() and not path.is_symlink():
                os.chmod(path, stat.S_IMODE(path.stat().st_mode) & ~0o022)
        os.replace(stage, release)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def poll_cycles(previous: dict[str, tuple[int, str]], timeout: int = 180) -> dict[str, tuple[int, str]]:
    seen = {name: 0 for name in HEARTBEATS}
    last = dict(previous)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline and min(seen.values()) < 3:
        for name, path in HEARTBEATS.items():
            if not path.is_file() or path.is_symlink():
                continue
            raw = path.read_bytes(); digest = hashlib.sha256(raw).hexdigest()
            value = json.loads(raw.decode("utf-8"))
            expected_unit, expected_runner = (
                (V52_UNIT_NEW, "V52") if name == "V52" else (Q102_UNIT_NEW, "Q102")
            )
            validate_monitor_heartbeat(value, TARGET, expected_unit, expected_runner)
            stamp = str(value.get("updatedAt") or value.get("observedAt") or value.get("timestamp") or digest)
            current = (path.stat().st_mtime_ns, stamp)
            if current != last[name]:
                seen[name] += 1; last[name] = current
        time.sleep(3)
    require(min(seen.values()) >= 3, "THREE_HEARTBEAT_CYCLES_NOT_OBSERVED")
    return last


def timestamp_ms(value: object) -> int:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = int(value)
        return number * 1000 if number < 10**12 else number
    if isinstance(value, str):
        try:
            from datetime import datetime
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
        except (ValueError, TypeError, OverflowError):
            return 0
    return 0


def wait_stable(unit: str, expected: str, timeout: int = 100) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if active(unit):
            pid = int(unit_property(unit, "MainPID") or "0")
            if pid > 100 and os.path.realpath(f"/proc/{pid}/cwd") == str(BASE / expected):
                restarts = unit_property(unit, "NRestarts")
                time.sleep(5)
                if active(unit) and unit_property(unit, "MainPID") == str(pid):
                    require(unit_property(unit, "NRestarts") == restarts, "TARGET_RESTARTED_DURING_STABILIZE")
                    return str(pid)
        time.sleep(2)
    # Keep the failure fail-closed, but retain a bounded, redacted systemd
    # diagnostic so a Root rollback does not erase the only evidence of why
    # the monitor process failed to remain healthy.
    context = _systemd_failure_context(unit)
    suffix = ("|" + context[:640]) if context else ""
    raise ContractError("TARGET_RUNNER_NOT_STABLE:" + unit + suffix)


def execute(tar_path: Path, manifest_path: Path, approval_token: str,
            public_key: Path, nonce_dir: Path, approval_id: str, run_id: str) -> None:
    require(re.fullmatch(r"[0-9a-fA-F-]{36}", approval_id) is not None, "APPROVAL_ID_INVALID")
    require(re.fullmatch(r"[0-9]{1,20}", run_id) is not None, "RUN_ID_INVALID")
    require(approval_token and len(approval_token) <= 16_384, "APPROVAL_TOKEN_MISSING")
    require(public_key.is_file() and not public_key.is_symlink(), "OWNER_PUBLIC_KEY_MISSING")
    verify_owner_token(approval_token, public_key, REPO, TARGET, SCOPE, OPERATOR, PLAN_SHA256,
                       nonce_dir=str(nonce_dir), route=ROUTE, deployment_target=DEPLOYMENT_TARGET,
                       operator_target="DD1296_FINAL_ALLIN_10BPS", orders_enabled=False)
    baseline_pins, baseline_plan, baseline_hold, _pins, _plan, baseline_digest, old_mode = validate_baseline()
    baseline_state = read_regular(Q102_STATE, require_root=True)
    baseline_v52_pin = read_regular(V52_PIN, require_root=True)
    metadata = {p: file_meta(p) for p in (Q102_STATE, V52_PIN, PINS, CURRENT_PLAN)}
    monitor_dropin_snapshot = snapshot_monitor_dropins()
    monitor_dropin_created_dirs: list[Path] = []
    old_v52_enabled = run("/usr/bin/systemctl", "is-enabled", V52_UNIT_OLD, check=False) == "enabled"
    old_q102_enabled = run("/usr/bin/systemctl", "is-enabled", Q102_UNIT_OLD, check=False) == "enabled"
    try:
        stage_candidate(tar_path, manifest_path)
        monitor_dropin_created_dirs = install_monitor_dropins(monitor_dropin_snapshot)
        run("/usr/bin/systemctl", "daemon-reload", timeout=30)
        validate_target_units(require_monitor=True)
        # Recheck everything immediately before stopping either old runner.
        now_hold, _value, now_digest = hold_snapshot()
        require(now_hold == baseline_hold and now_digest == HOLD_DIGEST, "GLOBAL_HOLD_CHANGED_PRECUTOVER")
        _stamp, _inventory, digest = signed_get()
        require(digest == baseline_digest, "VENUE_CHANGED_PRECUTOVER")
        require(old_runner_runtime_mode(unit_runtime_state(V52_UNIT_OLD), unit_runtime_state(Q102_UNIT_OLD)) == old_mode,
                "OLD_RUNNER_CHANGED_PRECUTOVER")
        if old_mode in ("active", "quiesce"):
            run("/usr/bin/systemctl", "stop", Q102_UNIT_OLD, timeout=90)
            run("/usr/bin/systemctl", "stop", V52_UNIT_OLD, timeout=90)
        for unit in (V52_UNIT_OLD, Q102_UNIT_OLD):
            state = unit_runtime_state(unit)
            require(state[0] in TERMINAL_OLD_ACTIVE_STATES, "OLD_RUNNER_NOT_TERMINAL:" + unit)
            require(int(unit_property(unit, "MainPID") or "0") == 0, "OLD_RUNNER_PID_REMAINS:" + unit)
        stopped_state = read_json(Q102_STATE)
        require(stopped_state.get("runtimeCommitSha") == Q102_OLD
                and not stopped_state.get("position") and not stopped_state.get("pending"),
                "Q102_STATE_NOT_FLAT_AFTER_STOP")
        state = dict(stopped_state); state["runtimeCommitSha"] = TARGET
        write_atomic(Q102_STATE, (json.dumps(state, separators=(",", ":")) + "\n").encode(), metadata[Q102_STATE])
        pin_text = baseline_v52_pin.decode("utf-8")
        pin_text = pin_text.replace("DISDEX_V52_RUNTIME_SHA=" + V52_OLD, "DISDEX_V52_RUNTIME_SHA=" + TARGET)
        pin_text = pin_text.replace("DISDEX_V52_RUNTIME_ROOT=" + str(BASE / V52_OLD), "DISDEX_V52_RUNTIME_ROOT=" + str(BASE / TARGET))
        require(V52_OLD not in pin_text, "V52_PIN_REPLACE_FAILED")
        write_atomic(V52_PIN, pin_text.encode(), metadata[V52_PIN])
        write_atomic(PINS, target_pins(baseline_pins), metadata[PINS])
        write_atomic(CURRENT_PLAN, target_plan(baseline_plan), metadata[CURRENT_PLAN])
        run("/usr/bin/systemctl", "daemon-reload", timeout=30)
        validate_target_units(require_monitor=True)
        run("/usr/bin/systemctl", "start", Q102_UNIT_NEW, timeout=100)
        run("/usr/bin/systemctl", "start", V52_UNIT_NEW, timeout=100)
        qpid = wait_stable(Q102_UNIT_NEW, TARGET)
        vpid = wait_stable(V52_UNIT_NEW, TARGET)
        require(not active(Q102_UNIT_OLD) and not active(V52_UNIT_OLD), "DUAL_RUNNER_ACTIVE")
        pids = {"Q102": qpid, "V52": vpid}
        cycles_before = {}
        for name, path in HEARTBEATS.items():
            raw = read_regular(path, 128_000); value = json.loads(raw.decode("utf-8"))
            cycles_before[name] = (path.stat().st_mtime_ns, str(value.get("updatedAt") or value.get("observedAt") or value.get("timestamp") or ""))
        restarts_before = {u: unit_property(u, "NRestarts") for u in (Q102_UNIT_NEW, V52_UNIT_NEW)}
        cycle_state = poll_cycles(cycles_before)
        time.sleep(10)
        require(all(active(u) for u in (Q102_UNIT_NEW, V52_UNIT_NEW)), "TARGET_RUNNER_LOST_ACTIVE")
        require(all(unit_property(u, "NRestarts") == restarts_before[u] for u in restarts_before), "TARGET_RESTART_COUNT_CHANGED")
        state_after = read_json(Q102_STATE)
        require(state_after.get("runtimeCommitSha") == TARGET, "Q102_FRESHNESS_SHA_MISMATCH")
        q102_observed = timestamp_ms(cycle_state["Q102"][1])
        require(q102_observed > 0 and abs(int(time.time() * 1000) - q102_observed) < 10 * 60_000,
                "Q102_MONITOR_HEARTBEAT_STALE")
        final_reads = [signed_get() for _ in range(3)]
        require(len({x[0] for x in final_reads}) == 3, "POST_SIGNED_GET_TIMESTAMPS_NOT_UNIQUE")
        require(all(x[2] == baseline_digest for x in final_reads), "VENUE_INVENTORY_CHANGED_POSTCUTOVER")
        after_hold, _after_value, after_digest = hold_snapshot()
        require(after_hold == baseline_hold and after_digest == HOLD_DIGEST, "GLOBAL_HOLD_MUTATED")
        if old_q102_enabled: run("/usr/bin/systemctl", "disable", Q102_UNIT_OLD, check=False)
        if old_v52_enabled: run("/usr/bin/systemctl", "disable", V52_UNIT_OLD, check=False)
        if old_q102_enabled: run("/usr/bin/systemctl", "enable", Q102_UNIT_NEW, check=False)
        if old_v52_enabled: run("/usr/bin/systemctl", "enable", V52_UNIT_NEW, check=False)
        print(json.dumps({"status": "STABLE4_SAFETY_REPAIR_CUTOVER_PASS", "targetSha": TARGET,
                          "previousV52": V52_OLD, "previousQ102": Q102_OLD,
                          "signedGetsBefore": 3, "signedGetsAfter": 3, "heartbeatCycles": 3,
                          "globalHoldDigest": after_digest, "ordersEnabled": False,
                          "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
                          "oldGenerationActive": False, "pids": pids}, sort_keys=True))
    except Exception as exc:
        # Never attempt rollback without a fresh, unchanged venue snapshot.
        try:
            _stamp, _inventory, digest = signed_get()
            require(digest == baseline_digest, "ROLLBACK_VENUE_CHANGED_MANUAL_REVIEW")
            if active(V52_UNIT_NEW): run("/usr/bin/systemctl", "stop", V52_UNIT_NEW, timeout=90)
            if active(Q102_UNIT_NEW): run("/usr/bin/systemctl", "stop", Q102_UNIT_NEW, timeout=90)
            write_atomic(Q102_STATE, baseline_state, metadata[Q102_STATE])
            write_atomic(V52_PIN, baseline_v52_pin, metadata[V52_PIN])
            write_atomic(PINS, baseline_pins, metadata[PINS])
            write_atomic(CURRENT_PLAN, baseline_plan, metadata[CURRENT_PLAN])
            restore_monitor_dropins(monitor_dropin_snapshot, monitor_dropin_created_dirs)
            run("/usr/bin/systemctl", "daemon-reload", timeout=30)
            if old_q102_enabled: run("/usr/bin/systemctl", "enable", Q102_UNIT_OLD, check=False)
            if old_v52_enabled: run("/usr/bin/systemctl", "enable", V52_UNIT_OLD, check=False)
            if old_mode == "active":
                run("/usr/bin/systemctl", "start", Q102_UNIT_OLD, timeout=100)
                run("/usr/bin/systemctl", "start", V52_UNIT_OLD, timeout=100)
                wait_stable(Q102_UNIT_OLD, Q102_OLD, timeout=100)
                wait_stable(V52_UNIT_OLD, V52_OLD, timeout=100)
                require(active(Q102_UNIT_OLD) and active(V52_UNIT_OLD), "ROLLBACK_OLD_RUNNERS_NOT_ACTIVE")
            else:
                for unit in (Q102_UNIT_OLD, V52_UNIT_OLD):
                    state = unit_runtime_state(unit)
                    require(state[0] in TERMINAL_OLD_ACTIVE_STATES,
                            "ROLLBACK_OLD_RUNNER_NOT_TERMINAL:" + unit)
                    require(int(unit_property(unit, "MainPID") or "0") == 0,
                            "ROLLBACK_OLD_RUNNER_PID_REMAINS:" + unit)
            _r, _v, rollback_hold_digest = hold_snapshot()
            require(rollback_hold_digest == HOLD_DIGEST, "ROLLBACK_HOLD_CHANGED")
            release = BASE / TARGET
            if release.is_dir() and not release.is_symlink():
                require((release / ".disdex-release-sha").read_text().strip() == TARGET, "ROLLBACK_RELEASE_MARKER_INVALID")
                shutil.rmtree(release)
            print("ROLLBACK=SUCCESS", file=sys.stderr)
        except Exception as rollback_error:
            print("ROLLBACK=MANUAL_REVIEW_REQUIRED:" + type(rollback_error).__name__, file=sys.stderr)
        raise ContractError(cutover_blocked_reason(exc)) from exc


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--preflight-readonly", action="store_true")
    group.add_argument("--execute-approved", action="store_true")
    parser.add_argument("--tar", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--approval-id", required=True)
    parser.add_argument("--public-key", type=Path, default=DEFAULT_PUBLIC_KEY)
    parser.add_argument("--nonce-dir", type=Path, default=DEFAULT_NONCE_DIR)
    args = parser.parse_args()
    try:
        require(os.geteuid() == 0, "ROOT_REQUIRED")
        require(re.fullmatch(r"[0-9]{1,20}", args.run_id or "") is not None, "RUN_ID_INVALID")
        require(args.approval_id and re.fullmatch(r"[0-9a-fA-F-]{36}", args.approval_id), "APPROVAL_ID_INVALID")
        plan_bytes = read_regular(args.plan, 131_072)
        plan = json.loads(plan_bytes.decode("utf-8")); validate_plan(plan)
        require(hashlib.sha256(plan_bytes).hexdigest() == PLAN_SHA256, "PLAN_SHA256_MISMATCH")
        token = sys.stdin.read(16_385).strip()
        require(token and args.public_key.is_file() and not args.public_key.is_symlink(),
                "OWNER_TOKEN_INPUT_REQUIRED")
        if args.preflight_readonly:
            verify_owner_token(token, args.public_key, REPO, TARGET, SCOPE, OPERATOR, PLAN_SHA256,
                               route=ROUTE, deployment_target=DEPLOYMENT_TARGET,
                               operator_target="DD1296_FINAL_ALLIN_10BPS", orders_enabled=False)
            _pins, _plan, _hold, _p, _cp, digest, old_mode = validate_baseline()
            print(json.dumps({"status": "STABLE4_SAFETY_REPAIR_PREFLIGHT_PASS", "signedGets": 3,
                              "inventoryDigest": digest, "globalHoldDigest": HOLD_DIGEST,
                              "oldRunnerMode": old_mode, "ordersEnabled": False, "ordersSent": 0, "cancelsSent": 0,
                              "positionChangesSent": 0}, sort_keys=True))
        else:
            require(args.tar is not None and args.manifest is not None, "CANDIDATE_ARCHIVE_REQUIRED")
            execute(args.tar, args.manifest, token, args.public_key, args.nonce_dir,
                    args.approval_id, args.run_id)
        return 0
    except Exception as exc:
        print("STABLE4_SAFETY_REPAIR_BLOCKED:" + type(exc).__name__ + ":" + str(exc)[:240], file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())



