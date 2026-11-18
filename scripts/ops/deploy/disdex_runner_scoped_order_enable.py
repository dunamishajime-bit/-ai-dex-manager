#!/usr/bin/env python3
"""Fail-closed Runner-scoped order-enable transaction.

This helper is deliberately separate from the existing HYPE H48 path.  It
creates a permit for exactly one Runner/SHA/plan/scope while the canonical
GLOBAL HOLD remains active.  The module is also usable as a pure validation
library by the non-production regression tests; all filesystem and systemd
mutations are kept behind the explicit ``--execute`` mode.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any, Callable


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

REPO = "dunamishajime-bit/-ai-dex-manager"
DEPLOYMENT_TARGET = "professional-dismanager.net"
OWNER = "dunamishajime-bit"
PERMIT_SCHEMA = "disdex-runner-scoped-order-permit/v1"
PERMIT_POLICY = "STABLE4_SCOPED_HOLD_BYPASS"
PERMIT_OPERATOR = "disdex-runner-scoped-order-enable"
HOLD_OPERATOR = "disdex-stable4-formal-owner-hold"
HOLD_STRATEGY = "STABLE4_H48_CUTOVER"
HOLD_REASON = "STABLE4_RESEARCH_ROLLOUT:e0e4f1d8f22b62e9410188ef6e590a20e31f760f"
HOLD_PATH = Path("/var/lib/disdex/shared/kill-switch.json")
PERMIT_ROOT = Path("/etc/disdex/runner-order-enable")
RELEASE_ROOT = Path("/home/deploy/disdex-trading/releases")
COMMON_MODULE = "lib/disdex-shared-kill-switch.ts"
RUNNER_PERMIT_MODULE_NAME = "runner-order-permit.ts"
OVERLAY_ROOT = Path("/var/lib/disdex/runner-order-enable")
EXECUTION_LOCK = Path("/var/lib/disdex/unified-deploy/deployment-execution.lock")
RECEIPT_ROOT = Path("/var/lib/disdex/unified-deploy/receipts")
ACK = "I_ACK_REAL_MONEY_LIVE_ACTIVATION"

# These are the immutable Runner pins audited immediately before this
# implementation.  A new release must update this map and its Owner-approved
# plan hash; arbitrary SHA/plan combinations are rejected by preflight.
PINNED_SOURCE_BY_RUNNER = {
    "V12_V4": "e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",
    "PENGU_V8": "1657e173d250ad58f53e62f7bb0a3428fb405496",
    "QUALITY102_CAUSAL_V1": "ef1ab178e26a7bf5bddb6473467765edba242e1d",
    "V52": "8495daf24e53a6cf0dd5e38f022008fa8f78c688",
    "FET_BRK48_RESIDUAL": "7688ed7c93a1918d8b44837339b7da5584a868f5",
    "IDLE_PRIORITY_SHORT": "7688ed7c93a1918d8b44837339b7da5584a868f5",
}
PINNED_PLAN_BY_RUNNER = {
    "V12_V4": "9fc3cc72c9520a758f1b700ed648f0e1e11a54eb92c514b08992f22605d9e515",
    "PENGU_V8": "8928520a2391d8190c2cdda8b6e3e36959a452ed151d36a820a2ce3f8ec01568",
    "QUALITY102_CAUSAL_V1": "01110a52b9ab740652cca48354e246edf71759916df476797b8e9753221ae4b6",
    "V52": "a43d6e47acdc862953801a89e396f8819eeb9a580cc2aaadc901d926c23d011c",
    "FET_BRK48_RESIDUAL": "12272418221383c53382b98bcefdda7eaba20f2655e9489eebbbdd73713c4717",
    "IDLE_PRIORITY_SHORT": "ed6e7da737480349a6454868ed78bcbc4db5f3990a6f4cc2bbb6e111cc3346db",
}

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
RUN_ID_RE = re.compile(r"^[0-9]{1,20}$")

# HYPE intentionally does not appear here.  Its H48 certificate/permit path is
# independently reviewed and must remain the only exception to this contract.
RUNNER_SPECS: dict[str, dict[str, str]] = {
    "V12_V4": {
        "scope": "V12_V4",
        "operation": "V12_V4_SCOPED_ORDER_ENABLE",
        "unit_template": "disdex-v12-v4@{sha}.service",
    },
    "PENGU_V8": {
        "scope": "PENGU_V8",
        "operation": "PENGU_V8_SCOPED_ORDER_ENABLE",
        "unit_template": "disdex-pengu-dual-ls-v2@{sha}.service",
    },
    "QUALITY102_CAUSAL_V1": {
        "scope": "QUALITY102_CAUSAL_V1",
        "operation": "QUALITY102_CAUSAL_V1_SCOPED_ORDER_ENABLE",
        "unit_template": "disdex-quality102-causal-v1@{sha}.service",
    },
    "V52": {
        "scope": "V52",
        "operation": "V52_SCOPED_ORDER_ENABLE",
        "unit_template": "disdex-v52-aster-only@{sha}.service",
    },
    "FET_BRK48_RESIDUAL": {
        "scope": "FET_BRK48_RESIDUAL",
        "operation": "FET_BRK48_RESIDUAL_SCOPED_ORDER_ENABLE",
        "unit_template": "disdex-fet-brk48@{sha}.service",
    },
    "IDLE_PRIORITY_SHORT": {
        "scope": "IDLE_PRIORITY_SHORT",
        "operation": "IDLE_PRIORITY_SHORT_SCOPED_ORDER_ENABLE",
        "unit_template": "disdex-idle-priority-short@{sha}.service",
    },
}


def require(ok: object, reason: str) -> None:
    if not ok:
        raise ValueError(reason)


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical(value: object) -> bytes:
    # The permit validator hashes the exact bytes read from disk.  A trailing
    # newline is intentionally not added so the test and runtime digest rules
    # are identical to the TypeScript consumer.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")


def _runner_spec(runner: str) -> dict[str, str]:
    require(runner in RUNNER_SPECS, "RUNNER_NOT_SUPPORTED")
    return RUNNER_SPECS[runner]


def validate_global_hold(value: object, *, source_sha: str, now_ms: int) -> None:
    require(isinstance(value, dict), "GLOBAL_HOLD_NOT_OBJECT")
    require(value.get("active") is True, "GLOBAL_HOLD_NOT_ACTIVE")
    require(value.get("action") == "HOLD_PROTECTED", "GLOBAL_HOLD_ACTION_INVALID")
    require(value.get("scope") == "GLOBAL", "GLOBAL_HOLD_SCOPE_INVALID")
    require(value.get("operator") == HOLD_OPERATOR and value.get("strategyId") == HOLD_STRATEGY,
            "GLOBAL_HOLD_OWNER_INVALID")
    require(value.get("reason") == HOLD_REASON,
            "GLOBAL_HOLD_REASON_INVALID")
    require(type(now_ms) is int and now_ms > 0, "CLOCK_INVALID")


def validate_approval_record(
    row: object,
    *,
    runner: str,
    source_sha: str,
    plan_sha256: str,
    scope: str,
    operation: str,
    approval_id: str,
    run_id: str,
    now_ms: int,
) -> dict[str, Any]:
    """Validate one exact, already-redeemed Owner approval.

    No broad ``ALL_RUNNERS`` approval is accepted here.  The redemption run id
    is part of the binding so a token from another workflow run cannot be
    replayed for a different Runner.
    """
    spec = _runner_spec(runner)
    require(SHA_RE.fullmatch(source_sha) is not None, "SOURCE_SHA_INVALID")
    require(SHA256_RE.fullmatch(plan_sha256) is not None, "PLAN_SHA256_INVALID")
    require(scope == spec["scope"] and operation == spec["operation"], "RUNNER_SCOPE_OPERATION_INVALID")
    require(UUID_RE.fullmatch(approval_id) is not None, "APPROVAL_ID_INVALID")
    require(RUN_ID_RE.fullmatch(run_id) is not None, "RUN_ID_INVALID")
    require(isinstance(row, dict), "APPROVAL_RECORD_INVALID")
    require(row.get("id") == approval_id, "APPROVAL_ID_MISMATCH")
    for key, expected in (
        ("operation", operation),
        ("scope", scope),
        ("targetSha", source_sha),
        ("planSha256", plan_sha256),
        ("requestActor", OWNER),
        ("ordersEnabled", True),
        ("status", "REDEEMED"),
        ("redeemedByRunId", run_id),
    ):
        require(row.get(key) == expected, "APPROVAL_" + key.upper() + "_MISMATCH")
    created, approved, redeemed, expires = (row.get(k) for k in ("createdAt", "approvedAt", "redeemedAt", "requestExpiresAt"))
    require(all(type(x) is int and x > 0 for x in (created, approved, redeemed, now_ms)),
            "APPROVAL_TIMELINE_INVALID")
    require(created <= approved <= redeemed <= now_ms + 30_000, "APPROVAL_TIMELINE_INVALID")
    require(type(expires) is int and approved <= expires, "APPROVAL_TIMELINE_INVALID")
    return row


def build_runner_permit(
    *,
    approval_record: dict[str, Any],
    runner: str,
    source_sha: str,
    plan_sha256: str,
    scope: str,
    operation: str,
    kill_switch: dict[str, Any],
    kill_switch_sha256: str,
    nonce_sha256: str,
    issued_at: int,
    expires_at: int,
) -> dict[str, Any]:
    spec = _runner_spec(runner)
    require(SHA_RE.fullmatch(source_sha) is not None, "SOURCE_SHA_INVALID")
    require(SHA256_RE.fullmatch(plan_sha256) is not None, "PLAN_SHA256_INVALID")
    require(SHA256_RE.fullmatch(kill_switch_sha256) is not None, "KILL_DIGEST_INVALID")
    require(SHA256_RE.fullmatch(nonce_sha256) is not None, "NONCE_DIGEST_INVALID")
    require(scope == spec["scope"] and operation == spec["operation"], "RUNNER_SCOPE_OPERATION_INVALID")
    require(approval_record.get("id") and UUID_RE.fullmatch(str(approval_record["id"])), "APPROVAL_ID_INVALID")
    require(approval_record.get("ordersEnabled") is True, "APPROVAL_ORDERS_DISABLED")
    validate_global_hold(kill_switch, source_sha=source_sha, now_ms=issued_at)
    require(type(issued_at) is int and type(expires_at) is int and issued_at > 0 and expires_at > issued_at,
            "PERMIT_TIME_INVALID")
    require(expires_at - issued_at <= 30 * 86_400_000, "PERMIT_LIFETIME_TOO_LONG")
    return {
        "schema": PERMIT_SCHEMA,
        "approvedSha": source_sha,
        "planSha256": plan_sha256,
        "deploymentTarget": DEPLOYMENT_TARGET,
        "operation": operation,
        "scope": scope,
        "runner": runner,
        "policy": PERMIT_POLICY,
        "ordersEnabled": True,
        "killSwitchPath": str(HOLD_PATH),
        "killSwitchSha256": kill_switch_sha256,
        "approvalId": approval_record["id"],
        "approvalNonceSha256": nonce_sha256,
        "issuedAt": issued_at,
        "expiresAt": expires_at,
        "operator": PERMIT_OPERATOR,
        "ordersSent": 0,
        "cancelsSent": 0,
        "positionChangesSent": 0,
    }


def validate_runner_permit(
    value: object,
    *,
    runner: str,
    source_sha: str,
    plan_sha256: str,
    scope: str,
    operation: str,
    approval_id: str,
    kill_switch: dict[str, Any],
    kill_switch_sha256: str,
    now_ms: int,
) -> dict[str, Any]:
    spec = _runner_spec(runner)
    require(isinstance(value, dict), "PERMIT_NOT_OBJECT")
    fields = {
        "schema", "approvedSha", "planSha256", "deploymentTarget", "operation", "scope", "runner", "policy",
        "ordersEnabled", "killSwitchPath", "killSwitchSha256", "approvalId", "approvalNonceSha256",
        "issuedAt", "expiresAt", "operator", "ordersSent", "cancelsSent", "positionChangesSent",
    }
    require(set(value) == fields, "PERMIT_FIELDS_INVALID")
    require(value.get("schema") == PERMIT_SCHEMA and value.get("approvedSha") == source_sha,
            "PERMIT_SOURCE_INVALID")
    require(value.get("planSha256") == plan_sha256 and value.get("deploymentTarget") == DEPLOYMENT_TARGET,
            "PERMIT_PLAN_INVALID")
    require(value.get("runner") == runner and value.get("scope") == scope == spec["scope"],
            "PERMIT_SCOPE_INVALID")
    require(value.get("operation") == operation == spec["operation"], "PERMIT_OPERATION_INVALID")
    require(value.get("policy") == PERMIT_POLICY and value.get("ordersEnabled") is True
            and value.get("operator") == PERMIT_OPERATOR, "PERMIT_POLICY_INVALID")
    require(value.get("killSwitchPath") == str(HOLD_PATH) and value.get("killSwitchSha256") == kill_switch_sha256
            and SHA256_RE.fullmatch(str(kill_switch_sha256)), "PERMIT_KILL_BINDING_INVALID")
    require(value.get("approvalId") == approval_id and UUID_RE.fullmatch(str(approval_id)),
            "PERMIT_APPROVAL_BINDING_INVALID")
    require(SHA256_RE.fullmatch(str(value.get("approvalNonceSha256"))), "PERMIT_NONCE_INVALID")
    issued, expires = value.get("issuedAt"), value.get("expiresAt")
    require(type(issued) is int and type(expires) is int and type(now_ms) is int and issued > 0
            and issued <= now_ms < expires, "PERMIT_TIME_INVALID")
    require(expires - issued <= 30 * 86_400_000, "PERMIT_LIFETIME_INVALID")
    require(value.get("ordersSent") == value.get("cancelsSent") == value.get("positionChangesSent") == 0,
            "PERMIT_MUTATION_COUNTER")
    validate_global_hold(kill_switch, source_sha=source_sha, now_ms=now_ms)
    return value


def build_common_kill_switch_overlay(base: bytes, *, runner: str, permit_module_path: str) -> bytes:
    """Build a runner-only overlay for the common kill-switch module.

    The function patches only the entry assertion.  When the canonical GLOBAL
    HOLD is active, a valid permit for the exact runtime Runner may pass; every
    other Runner still receives the original ``SHARED_KILL_SWITCH_ACTIVE``
    failure.  The HYPE module is intentionally rejected because HYPE has a
    separate H48 certificate contract.
    """
    spec = _runner_spec(runner)
    require(runner != "HYPE_TREND_LONG", "HYPE_MUST_USE_H48_GATE")
    require(permit_module_path and not any(ch in permit_module_path for ch in ("\r", "\n", '"')),
            "PERMIT_MODULE_PATH_INVALID")
    text = base.decode("utf-8")
    if "hasValidRunnerOrderPermit" not in text:
        import_anchor = re.search(r"^import [^\n]*;\r?\n", text, flags=re.MULTILINE)
        import_line = f'import {{ hasValidRunnerOrderPermit }} from "{permit_module_path}";\n'
        if import_anchor:
            end = import_anchor.end()
            text = text[:end] + import_line + text[end:]
        else:
            text = import_line + text

    anchor = "export async function assertSharedKillSwitchAllowsNewEntry"
    start = text.find(anchor)
    require(start >= 0, "KILL_SWITCH_FUNCTION_NOT_FOUND")
    brace = text.find("{", start)
    require(brace >= 0, "KILL_SWITCH_FUNCTION_OPEN_NOT_FOUND")
    end = _matching_brace(text, brace)
    old_function = text[start:end + 1]
    has_options = "options:" in old_function or "SharedKillSwitchConsumer" in old_function
    signature = (
        "export async function assertSharedKillSwitchAllowsNewEntry(env: NodeJS.ProcessEnv = process.env, "
        "options: { consumer?: SharedKillSwitchConsumer } = {} )"
        if has_options else
        "export async function assertSharedKillSwitchAllowsNewEntry(env: NodeJS.ProcessEnv = process.env)"
    )
    scoped_v52 = (
        '  const scopedV52Hold = options.consumer === "V4_CRYPTO" && isV52ReferenceOnlyHold(state);\n'
        if has_options else ""
    )
    allow_expression = "!scopedV52Hold && !scopedPermit" if has_options else "!scopedPermit"
    replacement = (
        f"{signature} {{\n"
        "  const state = await readSharedKillSwitch(env);\n"
        f"  const scopedPermit = state.active && await hasValidRunnerOrderPermit({{\n"
        f'    runtimeSha: env.DISDEX_RUNNER_ORDER_SOURCE_SHA || "",\n'
        f'    runner: "{runner}",\n'
        f'    scope: "{spec["scope"]}",\n'
        f'    operation: "{spec["operation"]}",\n'
        '    planSha256: env.DISDEX_RUNNER_ORDER_PLAN_SHA256 || "",\n'
        '    approvalId: env.DISDEX_RUNNER_ORDER_APPROVAL_ID || "",\n'
        '    permitPath: env.DISDEX_RUNNER_ORDER_PERMIT_PATH || "",\n'
        '    killSwitchPath: state.sourcePath || "/var/lib/disdex/shared/kill-switch.json",\n'
        "    now: Date.now(),\n"
        "  });\n"
        f"{scoped_v52}"
        f'  if (state.active && {allow_expression}) throw new Error(`SHARED_KILL_SWITCH_ACTIVE:${{state.reason || "UNSPECIFIED"}}`);\n'
        "  return state;\n"
        "}"
    )
    return (text[:start] + replacement + text[end + 1:]).encode("utf-8")


def _matching_brace(text: str, opening: int) -> int:
    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False
    i = opening
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if line_comment:
            if ch == "\n":
                line_comment = False
            i += 1
            continue
        if block_comment:
            if ch == "*" and nxt == "/":
                block_comment = False
                i += 2
                continue
            i += 1
            continue
        if quote:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch == "/" and nxt == "/":
            line_comment = True
            i += 2
            continue
        if ch == "/" and nxt == "*":
            block_comment = True
            i += 2
            continue
        if ch in ('"', "'", "`"):
            quote = ch
            i += 1
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError("KILL_SWITCH_FUNCTION_UNBALANCED")


def permit_path(runner: str, source_sha: str) -> Path:
    _runner_spec(runner)
    require(SHA_RE.fullmatch(source_sha) is not None, "SOURCE_SHA_INVALID")
    return PERMIT_ROOT / runner / (source_sha + ".order-enable.json")


def overlay_dir(runner: str, source_sha: str) -> Path:
    _runner_spec(runner)
    require(SHA_RE.fullmatch(source_sha) is not None, "SOURCE_SHA_INVALID")
    return OVERLAY_ROOT / runner / source_sha


def build_env(*, runner: str, source_sha: str, plan_sha256: str, approval_id: str, permit: Path) -> bytes:
    _runner_spec(runner)
    require(SHA_RE.fullmatch(source_sha) is not None and SHA256_RE.fullmatch(plan_sha256), "ENV_IDENTITY_INVALID")
    require(UUID_RE.fullmatch(approval_id) is not None, "APPROVAL_ID_INVALID")
    return (
        f"DISDEX_RUNNER_ORDER_SOURCE_SHA={source_sha}\n"
        f"DISDEX_RUNNER_ORDER_PLAN_SHA256={plan_sha256}\n"
        f"DISDEX_RUNNER_ORDER_APPROVAL_ID={approval_id}\n"
        f"DISDEX_RUNNER_ORDER_PERMIT_PATH={permit}\n"
    ).encode("ascii")


def build_dropin(*, unit: str, overlay_source: Path, base_target: Path, env_file: Path) -> bytes:
    require(unit.endswith(".service"), "UNIT_INVALID")
    return (
        "[Service]\n"
        "# Runner-scoped permit overlay; canonical GLOBAL HOLD remains active.\n"
        f"BindReadOnlyPaths={overlay_source}:{base_target}\n"
        f"EnvironmentFile={env_file}\n"
    ).encode("utf-8")


def read_json(path: Path) -> tuple[dict[str, Any], bytes]:
    st = path.lstat()
    require(stat.S_ISREG(st.st_mode) and not path.is_symlink() and st.st_size <= 2_000_000,
            "JSON_FILE_INVALID:" + str(path))
    raw = path.read_bytes()
    value = json.loads(raw)
    require(isinstance(value, dict), "JSON_OBJECT_REQUIRED:" + str(path))
    return value, raw


def root_immutable(path: Path, *, mode: int | None = None) -> os.stat_result:
    st = path.lstat()
    require(stat.S_ISREG(st.st_mode) and not path.is_symlink(), "ROOT_FILE_INVALID:" + str(path))
    require(st.st_uid == 0 and st.st_gid == 0 and (st.st_mode & 0o222) == 0,
            "ROOT_FILE_NOT_IMMUTABLE:" + str(path))
    if mode is not None:
        require(stat.S_IMODE(st.st_mode) == mode, "ROOT_FILE_MODE_INVALID:" + str(path))
    return st


def trusted_dir(path: Path, mode: int | None = None) -> None:
    st = path.lstat()
    require(stat.S_ISDIR(st.st_mode) and not path.is_symlink() and st.st_uid == 0 and st.st_gid == 0,
            "ROOT_DIR_INVALID:" + str(path))
    require((st.st_mode & 0o022) == 0, "ROOT_DIR_WRITABLE:" + str(path))
    if mode is not None:
        require(stat.S_IMODE(st.st_mode) == mode, "ROOT_DIR_MODE_INVALID:" + str(path))


def install_exact(path: Path, raw: bytes, mode: int = 0o444) -> None:
    require(not path.exists() and not path.is_symlink(), "TARGET_ALREADY_EXISTS:" + str(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode)
    try:
        if os.name != "nt":
            try:
                os.fchown(fd, 0, 0)
            except PermissionError:
                require(os.geteuid() != 0, "ROOT_FCHOWN_FAILED")
        os.fchmod(fd, mode)
        os.write(fd, raw)
        os.fsync(fd)
    finally:
        os.close(fd)
    root_immutable(path, mode=mode)
    require(path.read_bytes() == raw, "INSTALLED_FILE_MISMATCH:" + str(path))


def systemctl(*args: str) -> str:
    result = subprocess.run(["systemctl", *args], capture_output=True, text=True, timeout=40)
    require(result.returncode == 0, "SYSTEMD_FAILED:" + ":".join(args) + ":" + result.stderr[-160:])
    return result.stdout


def _service_property(unit: str, name: str) -> str:
    return systemctl("show", unit, "--property=" + name, "--value").strip()


def _safe_flat_get(release: Path) -> dict[str, Any]:
    """Run the existing signed read-only account diagnostic.

    This is only called by the root preflight/execute path.  The command is
    intentionally the repository's read-only diagnostic and rejects any
    non-zero mutation counters or non-empty venue state.
    """
    command = (
        "set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env /etc/disdex/disdex-v12-v4.env; do . \"$f\"; done; set +a; "
        f"exec /usr/bin/node {release}/node_modules/tsx/dist/cli.mjs "
        "scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    result = subprocess.run(["/bin/bash", "-c", command], cwd=str(release), capture_output=True, text=True, timeout=55)
    require(result.returncode == 0, "ASTER_SIGNED_GET_FAILED")
    rows = [line for line in result.stdout.splitlines() if line.startswith("{")]
    require(rows, "ASTER_SIGNED_GET_EMPTY")
    value = json.loads(rows[-1])
    require(value.get("status") == "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS", "ASTER_SIGNED_GET_NOT_PASS")
    require(all(value.get(k) == 0 for k in ("ordersSent", "cancelsSent", "positionChangesSent")),
            "DIAGNOSTIC_NOT_READ_ONLY")
    positions, orders = value.get("positions") or [], value.get("openOrders") or []
    require(isinstance(positions, list) and isinstance(orders, list), "ASTER_SIGNED_GET_SHAPE_INVALID")
    require(not positions and not orders, "SCOPED_ORDER_ENABLE_REQUIRES_FLAT_ACCOUNT")
    return {"observedAt": value.get("observedAt"), "positions": len(positions), "orders": len(orders)}


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


def _read_hold() -> tuple[dict[str, Any], bytes, str]:
    value, raw = read_json(HOLD_PATH)
    validate_global_hold(value, source_sha=str(value.get("reason", "")).split(":", 1)[-1], now_ms=_now_ms())
    st = HOLD_PATH.stat()
    require(st.st_uid in (0, 1000) and stat.S_IMODE(st.st_mode) == 0o600, "GLOBAL_HOLD_METADATA_INVALID")
    return value, raw, sha256(raw)


def _wait_service_stable(unit: str, previous_pid: int, timeout: int = 90) -> int:
    deadline = time.monotonic() + timeout
    last_pid = 0
    stable_since: float | None = None
    while time.monotonic() < deadline:
        try:
            state = _service_property(unit, "ActiveState")
            sub = _service_property(unit, "SubState")
            pid = int(_service_property(unit, "MainPID") or "0")
        except Exception:
            time.sleep(2)
            continue
        if state == "active" and sub == "running" and pid > 100 and pid != previous_pid:
            if pid != last_pid:
                last_pid, stable_since = pid, time.monotonic()
            if stable_since is not None and time.monotonic() - stable_since >= 20:
                return pid
        else:
            stable_since = None
        time.sleep(2)
    raise RuntimeError("RUNNER_RESTART_NOT_STABLE")


def _read_approval_store(path: Path, approval_id: str, *, runner: str,
                         source_sha: str, plan_sha256: str, scope: str,
                         operation: str, run_id: str, now_ms: int) -> dict[str, Any]:
    st = path.lstat()
    require(stat.S_ISREG(st.st_mode) and not path.is_symlink() and st.st_size <= 4_000_000,
            "APPROVAL_STORE_INVALID")
    rows = json.loads(path.read_bytes())
    require(isinstance(rows, list) and len(rows) <= 10_000, "APPROVAL_STORE_INVALID")
    st = path.stat()
    require(st.st_uid in (0, 1000) and (st.st_mode & 0o022) == 0, "APPROVAL_STORE_UNTRUSTED")
    matches = [row for row in rows if isinstance(row, dict) and row.get("id") == approval_id]
    require(len(matches) == 1, "APPROVAL_NOT_UNIQUE")
    return validate_approval_record(
        matches[0], runner=runner, source_sha=source_sha, plan_sha256=plan_sha256,
        scope=scope, operation=operation, approval_id=approval_id, run_id=run_id,
        now_ms=now_ms,
    )


def _read_hold_for_source(source_sha: str) -> tuple[dict[str, Any], bytes, str]:
    value, raw = read_json(HOLD_PATH)
    validate_global_hold(value, source_sha=source_sha, now_ms=_now_ms())
    st = HOLD_PATH.stat()
    require(st.st_uid in (0, 1000) and stat.S_IMODE(st.st_mode) == 0o600,
            "GLOBAL_HOLD_METADATA_INVALID")
    return value, raw, sha256(raw)


def _parse_simple_env(path: Path) -> dict[str, str]:
    require(path.is_file() and not path.is_symlink(), "ENV_FILE_INVALID:" + str(path))
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _validate_shared_safety() -> None:
    now_ms = _now_ms()
    risk, _ = read_json(Path("/var/lib/disdex/shared/crypto-daily-risk.json"))
    require(risk.get("sourceComplete") is True and risk.get("tripped") is not True,
            "SHARED_RISK_NOT_HEALTHY")
    updated = risk.get("updatedAt")
    require(type(updated) in (int, float) and -1_000 <= now_ms - updated <= 15 * 60_000,
            "SHARED_RISK_STALE")
    limits = [risk.get(key) for key in ("maximumLossPct", "dailyLossLimit", "maxDailyLossPct", "dailyLossLimitPct")
              if risk.get(key) is not None]
    require(limits and all(abs(float(v) - 0.075) < 1e-9 or abs(float(v) - 7.5) < 1e-9 for v in limits),
            "SHARED_RISK_LIMIT_INVALID")

    margin, _ = read_json(Path("/var/lib/disdex/shared/margin-risk/guard-live.json"))
    require(margin.get("stage") == "HEALTHY" and margin.get("ordersAllowed") is True,
            "MARGIN_GUARD_NOT_HEALTHY")
    checked = margin.get("checkedAt")
    require(type(checked) in (int, float) and -1_000 <= now_ms - checked <= 15 * 60_000,
            "MARGIN_GUARD_STALE")

    pending, _ = read_json(Path("/var/lib/disdex/shared/pending-exposure.json"))
    entries = pending.get("entries")
    require(isinstance(entries, list) and all(isinstance(row, dict) for row in entries),
            "PENDING_EXPOSURE_INVALID")
    require(not any(str(row.get("status", "")).upper() != "RELEASED" for row in entries),
            "PENDING_EXPOSURE_ACTIVE")


def _validate_candidate_source(source_sha: str) -> bytes:
    release = RELEASE_ROOT / source_sha
    marker = release / ".disdex-release-sha"
    root_immutable(marker)
    require(marker.read_text(encoding="utf-8").strip() == source_sha, "RELEASE_MARKER_INVALID")
    source = release / COMMON_MODULE
    st = source.lstat()
    require(stat.S_ISREG(st.st_mode) and not source.is_symlink() and (st.st_mode & 0o222) == 0,
            "COMMON_MODULE_NOT_IMMUTABLE")
    raw = source.read_bytes()
    require(len(raw) <= 2_000_000, "COMMON_MODULE_TOO_LARGE")
    return raw


def normalize_common_module_permissions(path: str | Path) -> None:
    """Remove write bits without changing the candidate module bytes.

    Release provisioning historically left this shared module at 0644 even
    though the release directory and marker were root-owned.  The formal Root
    path may normalize that metadata only after checking the caller supplied
    the exact pinned release; the content is never rewritten here.
    """
    target = Path(path)
    st = target.lstat()
    require(stat.S_ISREG(st.st_mode) and not target.is_symlink(),
            "COMMON_MODULE_NOT_REGULAR")
    if st.st_mode & 0o222:
        os.chmod(target, stat.S_IMODE(st.st_mode) & ~0o222)
    root_immutable(target)


def _normalize_candidate_source(source_sha: str, runner: str) -> dict[str, Any]:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require(PINNED_SOURCE_BY_RUNNER.get(runner) == source_sha,
            "RUNNER_SOURCE_NOT_AUDITED_PIN")
    release = RELEASE_ROOT / source_sha
    marker = release / ".disdex-release-sha"
    root_immutable(marker)
    require(marker.read_text(encoding="utf-8").strip() == source_sha,
            "RELEASE_MARKER_INVALID")
    trusted_dir(release)
    source = release / COMMON_MODULE
    st = source.lstat()
    require(stat.S_ISREG(st.st_mode) and not source.is_symlink()
            and st.st_uid == 0 and st.st_gid == 0,
            "COMMON_MODULE_OWNER_INVALID")
    before = sha256(source.read_bytes())
    normalize_common_module_permissions(source)
    after = sha256(source.read_bytes())
    require(before == after, "COMMON_MODULE_CONTENT_CHANGED")
    return {
        "status": "COMMON_MODULE_IMMUTABLE_NORMALIZED",
        "runner": runner,
        "sourceSha": source_sha,
        "commonModule": str(source),
        "commonModuleSha256": after,
        "ordersSent": 0,
        "cancelsSent": 0,
        "positionChangesSent": 0,
    }


def _validate_service_before(unit: str, release: Path) -> int:
    require(_service_property(unit, "ActiveState") == "active"
            and _service_property(unit, "SubState") == "running", "RUNNER_UNIT_NOT_ACTIVE")
    pid = int(_service_property(unit, "MainPID") or "0")
    require(pid > 100, "RUNNER_PID_INVALID")
    require(os.path.realpath(release) == _service_property(unit, "WorkingDirectory"),
            "RUNNER_WORKDIR_INVALID")
    return pid


def _validate_common_wiring(unit: str, runner: str) -> None:
    # The candidate overlay is the only allowed order-enable exception.  The
    # pre-existing broad activation files may remain for legacy diagnostics,
    # but the common kill-switch gate must not be bypassed or disabled.
    pre = systemctl("show", unit, "--property=ExecStartPre", "--value")
    require("disdex-live-operator-activation-gate" in pre or "activation" in pre.lower(),
            "RUNNER_ACTIVATION_GATE_MISSING:" + runner)
    require("--no-kill-switch" not in pre and "KILL_SWITCH_CLEAR" not in pre,
            "RUNNER_KILL_SWITCH_BYPASS_DETECTED")


def _permit_locations(runner: str, source_sha: str) -> dict[str, Path]:
    unit = _runner_spec(runner)["unit_template"].format(sha=source_sha)
    overlay = overlay_dir(runner, source_sha)
    permit = permit_path(runner, source_sha)
    return {
        "release": RELEASE_ROOT / source_sha,
        "unit": Path(unit),
        "common": RELEASE_ROOT / source_sha / COMMON_MODULE,
        "overlay_dir": overlay,
        "overlay_source": overlay / Path(COMMON_MODULE).name,
        "permit_module": overlay / RUNNER_PERMIT_MODULE_NAME,
        "permit": permit,
        "env": PERMIT_ROOT / runner / (source_sha + ".env"),
        "dropin_dir": Path("/etc/systemd/system") / (unit + ".d"),
        "dropin": Path("/etc/systemd/system") / (unit + ".d") / "zzzzzzzzzz-runner-scoped-order-enable.conf",
        "receipt": RECEIPT_ROOT / ("runner-order-enable-" + runner + "-" + source_sha + ".json"),
    }


def _preflight(*, approval_id: str, run_id: str, token: str, runner: str,
               source_sha: str, plan_sha256: str, scope: str, operation: str,
               permit_module_path: Path) -> dict[str, Any]:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    spec = _runner_spec(runner)
    require(scope == spec["scope"] and operation == spec["operation"], "RUNNER_SCOPE_OPERATION_INVALID")
    require(PINNED_SOURCE_BY_RUNNER.get(runner) == source_sha, "RUNNER_SOURCE_NOT_AUDITED_PIN")
    require(PINNED_PLAN_BY_RUNNER.get(runner) == plan_sha256, "RUNNER_PLAN_NOT_AUDITED_PIN")
    now_ms = _now_ms()
    locations = _permit_locations(runner, source_sha)
    unit = spec["unit_template"].format(sha=source_sha)
    release_raw = _validate_candidate_source(source_sha)
    root_immutable(permit_module_path)
    # The token is checked cryptographically before any file is installed.  A
    # nonce is never logged; only its digest is retained in the permit.
    public_key = Path("/var/lib/disdex/unified-deploy/owner-approval-public.pem")
    if not public_key.exists():
        public_key = Path("/var/lib/disdex/owner-approval-public.pem")
    root_immutable(public_key)
    from disdex_owner_approval import verify
    payload = verify(
        token, public_key, REPO, source_sha, scope, OWNER, plan_sha256,
        now=now_ms // 1000, nonce_dir=None, route="GITHUB_ACTIONS",
        deployment_target=DEPLOYMENT_TARGET, operator_target="DD1296_FINAL_ALLIN_10BPS",
        orders_enabled=True,
    )
    approval_store = Path("/home/deploy/disdex-ui/shared/data/deploy-approvals.json")
    approval = _read_approval_store(
        approval_store, approval_id, runner=runner, source_sha=source_sha,
        plan_sha256=plan_sha256, scope=scope, operation=operation,
        run_id=run_id, now_ms=now_ms,
    )
    hold, hold_raw, hold_digest = _read_hold_for_source(source_sha)
    pid = _validate_service_before(unit, locations["release"])
    _validate_common_wiring(unit, runner)
    _validate_shared_safety()
    venue = _safe_flat_get(locations["release"])
    for key in ("overlay_source", "permit_module", "env", "dropin", "permit", "receipt"):
        path = locations[key]
        require(not path.exists() and not path.is_symlink(), "ORDER_ENABLE_ALREADY_INSTALLED:" + str(path))
    # There must not be a second permit for the same runner.  Permits for other
    # runners are intentionally independent and are never touched.
    runner_dir = PERMIT_ROOT / runner
    if runner_dir.exists():
        for existing in runner_dir.glob("*.order-enable.json"):
            require(existing == locations["permit"], "RUNNER_PERMIT_ALREADY_PRESENT")
    return {
        "locations": locations,
        "unit": unit,
        "runner": runner,
        "sourceSha": source_sha,
        "planSha256": plan_sha256,
        "approval": approval,
        "tokenPayload": payload,
        "releaseRaw": release_raw,
        "permitModule": permit_module_path.read_bytes(),
        "hold": hold,
        "holdRaw": hold_raw,
        "killSwitchSha256": hold_digest,
        "pid": pid,
        "venue": venue,
        "tokenNonceSha256": sha256(str(payload["nonce"]).encode("ascii")),
        "nowMs": now_ms,
    }


def _remove_exact(path: Path) -> None:
    if not (path.exists() or path.is_symlink()):
        return
    st = path.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and not path.is_symlink(),
            "ROLLBACK_TARGET_UNTRUSTED:" + str(path))
    path.unlink()


def _namespace_hash(pid: int, target: Path) -> str:
    result = subprocess.run(
        ["nsenter", "-t", str(pid), "-m", "--", "sha256sum", str(target)],
        capture_output=True, text=True, timeout=20,
    )
    require(result.returncode == 0 and result.stdout.split(), "RUNNER_OVERLAY_HASH_FAILED")
    return result.stdout.split()[0]


def _execute(*, approval_id: str, run_id: str, token: str, runner: str,
             source_sha: str, plan_sha256: str, scope: str, operation: str,
             permit_module_path: Path) -> dict[str, Any]:
    import fcntl

    first = _preflight(
        approval_id=approval_id, run_id=run_id, token=token, runner=runner,
        source_sha=source_sha, plan_sha256=plan_sha256, scope=scope,
        operation=operation, permit_module_path=permit_module_path,
    )
    lock_fd = os.open(EXECUTION_LOCK, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    locations = first["locations"]
    installed: list[Path] = []
    previous_pid = int(first["pid"])
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        second = _preflight(
            approval_id=approval_id, run_id=run_id, token=token, runner=runner,
            source_sha=source_sha, plan_sha256=plan_sha256, scope=scope,
            operation=operation, permit_module_path=permit_module_path,
        )
        now_ms = _now_ms()
        permit = build_runner_permit(
            approval_record=second["approval"], runner=runner, source_sha=source_sha,
            plan_sha256=plan_sha256, scope=scope, operation=operation,
            kill_switch=second["hold"], kill_switch_sha256=second["killSwitchSha256"],
            nonce_sha256=second["tokenNonceSha256"], issued_at=now_ms,
            expires_at=now_ms + 30 * 86_400_000,
        )
        overlay = build_common_kill_switch_overlay(
            second["releaseRaw"], runner=runner,
            permit_module_path=str(locations["permit_module"]),
        )
        module = second["permitModule"]
        env = build_env(
            runner=runner, source_sha=source_sha, plan_sha256=plan_sha256,
            approval_id=approval_id, permit=locations["permit"],
        )
        dropin = build_dropin(
            unit=second["unit"], overlay_source=locations["overlay_source"],
            base_target=locations["common"], env_file=locations["env"],
        )
        for directory in (locations["overlay_dir"], locations["dropin_dir"],
                          locations["receipt"].parent):
            if directory.exists():
                trusted_dir(directory)
            else:
                directory.mkdir(parents=True, exist_ok=False)
                os.chown(directory, 0, 0)
                os.chmod(directory, 0o755)
        install_exact(locations["overlay_source"], overlay); installed.append(locations["overlay_source"])
        install_exact(locations["permit_module"], module); installed.append(locations["permit_module"])
        install_exact(locations["env"], env); installed.append(locations["env"])
        install_exact(locations["dropin"], dropin); installed.append(locations["dropin"])
        install_exact(locations["permit"], canonical(permit)); installed.append(locations["permit"])
        systemctl("daemon-reload")
        systemctl("restart", second["unit"])
        pid = _wait_service_stable(second["unit"], previous_pid)
        require(_namespace_hash(pid, locations["overlay_source"]) == sha256(overlay),
                "RUNNER_OVERLAY_NOT_ACTIVE")
        hold_after, hold_raw_after, hold_digest_after = _read_hold_for_source(source_sha)
        validate_runner_permit(
            json.loads(locations["permit"].read_bytes()), runner=runner,
            source_sha=source_sha, plan_sha256=plan_sha256, scope=scope,
            operation=operation, approval_id=approval_id, kill_switch=hold_after,
            kill_switch_sha256=hold_digest_after, now_ms=_now_ms(),
        )
        require(hold_raw_after == second["holdRaw"] and hold_digest_after == second["killSwitchSha256"],
                "GLOBAL_HOLD_CHANGED_DURING_ENABLE")
        receipt = {
            "schema": "disdex-runner-scoped-order-enable/v1",
            "runner": runner, "scope": scope, "operation": operation,
            "approvedSha": source_sha, "planSha256": plan_sha256,
            "approvalId": approval_id, "killSwitchSha256": second["killSwitchSha256"],
            "permitSha256": sha256(canonical(permit)), "overlaySha256": sha256(overlay),
            "moduleSha256": sha256(module), "environmentSha256": sha256(env),
            "dropinSha256": sha256(dropin), "pid": pid, "venueRead": second["venue"],
            "status": "RUNNER_SCOPED_ORDER_ENABLE_INSTALLED_GLOBAL_HOLD_REMAINS_ACTIVE",
            "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
            "issuedAt": now_ms,
        }
        install_exact(locations["receipt"], canonical(receipt)); installed.append(locations["receipt"])
        return receipt
    except Exception:
        # Remove only artifacts created by this transaction.  If the restart
        # happened, restore the target unit without touching the GLOBAL HOLD or
        # any other Runner's files.
        try:
            if locations["dropin"].exists():
                _remove_exact(locations["dropin"])
                systemctl("daemon-reload")
                systemctl("restart", first["unit"])
                _wait_service_stable(first["unit"], previous_pid, timeout=75)
        except Exception:
            pass
        for path in reversed(installed):
            try:
                _remove_exact(path)
            except Exception:
                pass
        for directory in (locations["overlay_dir"], locations["dropin_dir"]):
            try:
                if directory.exists() and not any(directory.iterdir()):
                    directory.rmdir()
            except Exception:
                pass
        raise
    finally:
        os.close(lock_fd)


def _rollback(*, runner: str, source_sha: str) -> dict[str, Any]:
    import fcntl

    require(os.geteuid() == 0, "ROOT_REQUIRED")
    locations = _permit_locations(runner, source_sha)
    receipt = locations["receipt"]
    root_immutable(receipt, mode=0o444)
    value, _ = read_json(receipt)
    require(value.get("status") == "RUNNER_SCOPED_ORDER_ENABLE_INSTALLED_GLOBAL_HOLD_REMAINS_ACTIVE",
            "ORDER_ENABLE_RECEIPT_INVALID")
    _, hold_raw, hold_digest = _read_hold_for_source(source_sha)
    require(hold_digest == value.get("killSwitchSha256"), "GLOBAL_HOLD_CHANGED_ROLLBACK_REQUIRES_REVIEW")
    lock_fd = os.open(EXECUTION_LOCK, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old_pid = int(_service_property(value.get("unit") or _runner_spec(runner)["unit_template"].format(sha=source_sha), "MainPID") or "0")
        _remove_exact(locations["dropin"])
        systemctl("daemon-reload")
        systemctl("restart", _runner_spec(runner)["unit_template"].format(sha=source_sha))
        _wait_service_stable(_runner_spec(runner)["unit_template"].format(sha=source_sha), old_pid)
        for key in ("permit", "env", "overlay_source", "permit_module", "receipt"):
            _remove_exact(locations[key])
        for directory in (locations["overlay_dir"], locations["dropin_dir"]):
            try:
                if directory.exists() and not any(directory.iterdir()):
                    directory.rmdir()
            except Exception:
                pass
        return {"status": "RUNNER_SCOPED_ORDER_ENABLE_ROLLED_BACK_GLOBAL_HOLD_UNCHANGED",
                "runner": runner, "holdSha256": sha256(hold_raw),
                "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}
    finally:
        os.close(lock_fd)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runner", choices=sorted(RUNNER_SPECS))
    parser.add_argument("--source-sha")
    parser.add_argument("--plan-sha256")
    parser.add_argument("--scope")
    parser.add_argument("--operation")
    parser.add_argument("--approval-id")
    parser.add_argument("--run-id")
    parser.add_argument("--permit-module", default=str(SCRIPT_DIR / "runner-order-permit.ts"))
    parser.add_argument("--read-approval-stdin", action="store_true")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight-readonly", action="store_true")
    mode.add_argument("--execute", action="store_true")
    mode.add_argument("--rollback", action="store_true")
    mode.add_argument("--normalize-source", action="store_true")
    args = parser.parse_args()
    try:
        if args.normalize_source:
            require(args.runner and args.source_sha, "NORMALIZE_IDENTITY_REQUIRED")
            result = _normalize_candidate_source(args.source_sha, args.runner)
        elif args.rollback:
            require(args.runner and args.source_sha, "ROLLBACK_IDENTITY_REQUIRED")
            result = _rollback(runner=args.runner, source_sha=args.source_sha)
        else:
            require(all((args.runner, args.source_sha, args.plan_sha256, args.scope,
                         args.operation, args.approval_id, args.run_id)),
                    "APPROVAL_INPUT_REQUIRED")
            require(args.read_approval_stdin, "APPROVAL_INPUT_REQUIRED")
            token = sys.stdin.read(16_385).strip()
            require(token and len(token) <= 16_384, "APPROVAL_TOKEN_INVALID")
            kwargs = {
                "approval_id": args.approval_id, "run_id": args.run_id,
                "token": token, "runner": args.runner, "source_sha": args.source_sha,
                "plan_sha256": args.plan_sha256, "scope": args.scope,
                "operation": args.operation, "permit_module_path": Path(args.permit_module),
            }
            if args.execute:
                result = _execute(**kwargs)
            else:
                _preflight(**kwargs)
                result = {
                    "status": "RUNNER_SCOPED_ORDER_ENABLE_PREFLIGHT_PASS_NOT_LIVE",
                    "runner": args.runner, "scope": args.scope,
                    "operation": args.operation, "approvedSha": args.source_sha,
                    "ordersEnabled": False, "ordersSent": 0,
                    "cancelsSent": 0, "positionChangesSent": 0,
                }
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({
            "status": "RUNNER_SCOPED_ORDER_ENABLE_FAIL_CLOSED",
            "reason": str(error)[:240],
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
        }, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
