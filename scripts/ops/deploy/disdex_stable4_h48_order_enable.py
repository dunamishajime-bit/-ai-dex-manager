#!/usr/bin/env python3
"""Fail-closed HYPE-only STABLE4 H48 order-enable gate."""
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
from typing import Callable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from disdex_owner_approval import verify

REPO = "dunamishajime-bit/-ai-dex-manager"
DEPLOYMENT_TARGET = "professional-dismanager.net"
OPERATOR_TARGET = "DD1296_FINAL_ALLIN_10BPS"
SOURCE = "e0e4f1d8f22b62e9410188ef6e590a20e31f760f"
PLAN = "82d9eb3f4ff4c9787f59c1843a69249e66df6d95696e426b4ee984719ad152ce"
OPERATION = "HYPE_STABLE4_H48_TIME_ONLY_LIVE"
SCOPE = "HYPE_TREND_LONG"
POLICY = "H48_TIME_ONLY"
RUNNER = "HYPE_TREND_LONG"
PERMIT_OPERATOR = "disdex-stable4-h48-order-enable"
HOLD_OPERATOR = "disdex-stable4-formal-owner-hold"
HOLD_STRATEGY = "STABLE4_H48_CUTOVER"
HOLD_REASON = "STABLE4_RESEARCH_ROLLOUT:" + SOURCE
ACK = "I_ACK_REAL_MONEY_LIVE_ACTIVATION"

RELEASES = Path("/home/deploy/disdex-trading/releases")
RELEASE = RELEASES / SOURCE
HYPE_SOURCE = RELEASE / "lib/hype-zec-long-runner.ts"
BASE_SOURCE_SHA256 = "797b9356f8f788411a6c29f8c36939927b03d476c28e09ee16cfa37ae5e4f53a"
KILL = Path("/var/lib/disdex/shared/kill-switch.json")
APPROVAL_STORE = Path("/home/deploy/disdex-ui/shared/data/deploy-approvals.json")
PUBLIC_KEY = Path("/var/lib/disdex/unified-deploy/owner-approval-public.pem")
EXECUTION_LOCK = Path("/var/lib/disdex/unified-deploy/deployment-execution.lock")
CERT = Path("/etc/disdex/stable4/h48-time-only") / (SOURCE + ".json")
CERT_AUDIT = Path("/var/lib/disdex/unified-deploy/h48-owner-policy-issuance") / (SOURCE + ".json")
HYPE_STATE = Path("/var/lib/disdex/hype-zec-long/runner.json")
HYPE_TICK = Path("/var/lib/disdex/runner-health/ticks/hype-trend-long.json")
HYPE_UNIT = f"disdex-hype-long@{SOURCE}.service"
HYPE_ACTIVATION = Path("/var/lib/disdex/shared/operator-activation") / ("hype-" + SOURCE + ".json")
RISK = Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
GLOBAL_ACTIVATION = Path("/var/lib/disdex/shared/operator-activation/current.json")

OVERLAY_DIR = Path("/var/lib/disdex/hype-zec-long/runtime-overlays/h48-order-enable-v1")
OVERLAY_SOURCE = OVERLAY_DIR / "hype-zec-long-runner.ts"
OVERLAY_MODULE = OVERLAY_DIR / "hype-h48-order-permit.ts"
DROPIN_DIR = Path("/etc/systemd/system") / (HYPE_UNIT + ".d")
DROPIN = DROPIN_DIR / "zzzzzzzzzz-h48-order-enable.conf"
ENV_FILE = Path("/etc/disdex/stable4/h48-time-only") / (SOURCE + ".order-enable.env")
PERMIT = Path("/etc/disdex/stable4/h48-time-only") / (SOURCE + ".order-enable.json")
RECEIPT_DIR = Path("/var/lib/disdex/unified-deploy/receipts")
RECEIPT = RECEIPT_DIR / ("hype-h48-order-enable-" + SOURCE + ".json")
MODULE_PATH_IN_RUNTIME = str(OVERLAY_MODULE)

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

def require(ok: object, reason: str) -> None:
    if not ok:
        raise ValueError(reason)

def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()

def canonical(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False) + "\n").encode("ascii")

def chown_root_if_privileged(path: str) -> None:
    if os.name == "nt":
        return
    try:
        os.chown(path, 0, 0)
    except PermissionError:
        require(os.geteuid() != 0, "ROOT_CHOWN_FAILED")

def read_json(path: Path) -> tuple[dict, bytes]:
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

def validate_approval_record(row: object, *, approval_id: str, run_id: str, now_ms: int) -> dict:
    require(isinstance(row, dict), "APPROVAL_RECORD_INVALID")
    require(UUID_RE.fullmatch(approval_id) is not None and row.get("id") == approval_id, "APPROVAL_ID_MISMATCH")
    for key, value in (
        ("operation", OPERATION), ("scope", SCOPE), ("targetSha", SOURCE),
        ("planSha256", PLAN), ("requestActor", "dunamishajime-bit"),
        ("ordersEnabled", True), ("status", "REDEEMED"), ("redeemedByRunId", run_id),
    ):
        require(row.get(key) == value, "APPROVAL_" + key.upper() + "_MISMATCH")
    require(re.fullmatch(r"[0-9]{1,20}", run_id) is not None, "RUN_ID_INVALID")
    created, approved, redeemed, expires = (row.get(k) for k in ("createdAt", "approvedAt", "redeemedAt", "requestExpiresAt"))
    require(all(type(x) is int and x > 0 for x in (created, approved, redeemed, expires, now_ms)), "APPROVAL_TIMELINE_INVALID")
    require(created <= approved <= redeemed <= now_ms + 30_000 and approved <= expires, "APPROVAL_TIMELINE_INVALID")
    return row

def validate_global_hold(value: object, raw: bytes, *, now_ms: int) -> str:
    require(isinstance(value, dict), "GLOBAL_HOLD_NOT_OBJECT")
    require(value.get("active") is True, "GLOBAL_HOLD_NOT_ACTIVE")
    require(value.get("action") == "HOLD_PROTECTED", "GLOBAL_HOLD_ACTION_INVALID")
    require(value.get("scope") == "GLOBAL", "GLOBAL_HOLD_SCOPE_INVALID")
    require(value.get("operator") == HOLD_OPERATOR and value.get("strategyId") == HOLD_STRATEGY,
            "GLOBAL_HOLD_OWNER_INVALID")
    require(value.get("reason") == HOLD_REASON, "GLOBAL_HOLD_REASON_INVALID")
    require(type(now_ms) is int and now_ms > 0, "CLOCK_INVALID")
    return sha256(raw)

def build_hype_permit(*, approval_record: dict, kill_switch: dict, kill_switch_sha256: str,
                      certificate_sha256: str, nonce_sha256: str, issued_at: int,
                      expires_at: int) -> dict:
    require(SHA256_RE.fullmatch(kill_switch_sha256) is not None, "KILL_DIGEST_INVALID")
    require(SHA256_RE.fullmatch(certificate_sha256) is not None, "CERT_DIGEST_INVALID")
    require(SHA256_RE.fullmatch(nonce_sha256) is not None, "NONCE_DIGEST_INVALID")
    validate_global_hold(kill_switch, canonical(kill_switch), now_ms=issued_at)
    require(type(issued_at) is int and type(expires_at) is int and issued_at > 0 and expires_at > issued_at,
            "PERMIT_TIME_INVALID")
    require(expires_at - issued_at <= 30 * 86_400_000, "PERMIT_LIFETIME_TOO_LONG")
    return {
        "schema": "disdex-stable4-h48-hype-order-permit/v1",
        "approvedSha": SOURCE, "planSha256": PLAN, "deploymentTarget": DEPLOYMENT_TARGET,
        "operation": OPERATION, "scope": SCOPE, "runner": RUNNER, "policy": POLICY,
        "ordersEnabled": True, "killSwitchPath": str(KILL), "killSwitchSha256": kill_switch_sha256,
        "certificateSha256": certificate_sha256, "approvalId": approval_record["id"],
        "approvalNonceSha256": nonce_sha256,
        "issuedAt": issued_at, "expiresAt": expires_at, "operator": PERMIT_OPERATOR,
        "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
    }

def validate_permit(value: object, *, now_ms: int, kill_switch: dict,
                    kill_switch_sha256: str, certificate_sha256: str) -> dict:
    require(isinstance(value, dict), "PERMIT_NOT_OBJECT")
    fields = {
        "schema", "approvedSha", "planSha256", "deploymentTarget", "operation", "scope", "runner", "policy",
        "ordersEnabled", "killSwitchPath", "killSwitchSha256", "certificateSha256", "approvalId",
        "approvalNonceSha256", "issuedAt", "expiresAt", "operator", "ordersSent", "cancelsSent", "positionChangesSent",
    }
    require(set(value) == fields, "PERMIT_FIELDS_INVALID")
    require(value.get("schema") == "disdex-stable4-h48-hype-order-permit/v1" and value.get("approvedSha") == SOURCE,
            "PERMIT_SOURCE_INVALID")
    require(value.get("planSha256") == PLAN and value.get("deploymentTarget") == DEPLOYMENT_TARGET,
            "PERMIT_PLAN_INVALID")
    require(value.get("operation") == OPERATION and value.get("scope") == SCOPE and value.get("runner") == RUNNER,
            "PERMIT_SCOPE_INVALID")
    require(value.get("policy") == POLICY and value.get("ordersEnabled") is True and value.get("operator") == PERMIT_OPERATOR,
            "PERMIT_POLICY_INVALID")
    require(value.get("killSwitchPath") == str(KILL) and value.get("killSwitchSha256") == kill_switch_sha256,
            "PERMIT_KILL_BINDING_INVALID")
    require(value.get("certificateSha256") == certificate_sha256 and SHA256_RE.fullmatch(str(certificate_sha256)),
            "PERMIT_CERT_BINDING_INVALID")
    require(UUID_RE.fullmatch(str(value.get("approvalId"))) is not None and SHA256_RE.fullmatch(str(value.get("approvalNonceSha256"))),
            "PERMIT_APPROVAL_BINDING_INVALID")
    issued, expires = value.get("issuedAt"), value.get("expiresAt")
    require(type(issued) is int and type(expires) is int and issued > 0 and issued <= now_ms < expires,
            "PERMIT_TIME_INVALID")
    require(expires - issued <= 30 * 86_400_000, "PERMIT_LIFETIME_INVALID")
    require(value.get("ordersSent") == value.get("cancelsSent") == value.get("positionChangesSent") == 0,
            "PERMIT_MUTATION_COUNTER")
    validate_global_hold(kill_switch, canonical(kill_switch), now_ms=now_ms)
    return value

def build_hype_source_overlay(base: bytes, module_path: str = MODULE_PATH_IN_RUNTIME) -> bytes:
    require(sha256(base) == BASE_SOURCE_SHA256, "HYPE_BASELINE_SOURCE_HASH_CHANGED")
    text = base.decode("utf-8")
    newline = "\r\n" if "\r\n" in text else "\n"
    old_import = 'import { readSharedKillSwitch } from "./disdex-shared-kill-switch";'
    new_import = old_import + newline + f'import {{ hasValidHypeH48OrderPermit }} from "{module_path}";'
    require(text.count(old_import) == 1, "HYPE_IMPORT_PATCH_ANCHOR_NOT_UNIQUE")
    old_block = newline.join((
        "    if (!kill.active) return;",
        '    const reason = "HYPE_ZEC_SHARED_KILL_SWITCH_ACTIVE";',
    ))
    new_block = newline.join((
        "    if (!kill.active) return;",
        '    const scopedHypePermit = this.dependencies.runtime.mode === "LIVE"',
        '      && this.dependencies.runtime.signalMode === "STABLE4"',
        '      && this.dependencies.runtime.stable4Mode === "LIVE"',
        '      && signal.strategy === "HYPE_LONG"',
        '      && signal.symbol === "HYPEUSDT"',
        '      && await hasValidHypeH48OrderPermit({',
        '        runtimeSha: this.dependencies.runtime.runtimeSha,',
        '        planSha256: process.env.DISDEX_STABLE4_H48_PLAN_SHA256 || "",',
        '        certificateSha256: process.env.DISDEX_STABLE4_H48_CERTIFICATE_SHA256 || "",',
        '        approvalId: process.env.DISDEX_STABLE4_H48_APPROVAL_ID || "",',
        '      });',
        '    if (scopedHypePermit) return;',
        '    const reason = "HYPE_ZEC_SHARED_KILL_SWITCH_ACTIVE";',
    ))
    require(text.count(old_block) == 1, "HYPE_ENTRY_PATCH_ANCHOR_NOT_UNIQUE")
    text = text.replace(old_import, new_import, 1).replace(old_block, new_block, 1)
    require(text.count("hasValidHypeH48OrderPermit") == 2 and text.count("hasValidHypeH48OrderPermit({") == 1,
            "HYPE_PERMIT_CALL_COUNT_INVALID")
    require(text.count(new_block) == 1, "HYPE_ENTRY_PATCH_RESULT_INVALID")
    return text.encode("utf-8")

def build_env(approval_id: str, certificate_sha256: str) -> bytes:
    require(UUID_RE.fullmatch(approval_id) is not None, "APPROVAL_ID_INVALID")
    require(SHA256_RE.fullmatch(certificate_sha256) is not None, "CERT_DIGEST_INVALID")
    return (f"DISDEX_STABLE4_H48_PLAN_SHA256={PLAN}\n"
            f"DISDEX_STABLE4_H48_CERTIFICATE_SHA256={certificate_sha256}\n"
            f"DISDEX_STABLE4_H48_APPROVAL_ID={approval_id}\n").encode("ascii")

def build_dropin() -> bytes:
    return ("[Service]\n"
            "# HYPE-only STABLE4 H48 scoped permit; canonical GLOBAL HOLD stays active.\n"
            f"BindReadOnlyPaths={OVERLAY_SOURCE}:{HYPE_SOURCE}\n"
            f"EnvironmentFile={ENV_FILE}\n").encode("utf-8")

def publish_permit_transaction(target: Path, raw: bytes, post_validate: Callable[[], None] | None = None) -> None:
    existed = target.exists() or target.is_symlink()
    previous = target.read_bytes() if existed and target.is_file() else None
    previous_mode = stat.S_IMODE(target.stat().st_mode) if existed and target.is_file() else None
    require(not target.is_symlink(), "PERMIT_TARGET_SYMLINK")
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_name = None
    try:
        fd, temp_name = tempfile.mkstemp(prefix="." + target.name + ".", dir=str(target.parent))
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw); handle.flush(); os.fsync(handle.fileno())
        chown_root_if_privileged(temp_name)
        os.chmod(temp_name, 0o444)
        os.replace(temp_name, target); temp_name = None
        if post_validate:
            post_validate()
    except Exception:
        if temp_name:
            try: os.unlink(temp_name)
            except FileNotFoundError: pass
        if existed and previous is not None:
            fd, rollback = tempfile.mkstemp(prefix="." + target.name + ".rollback.", dir=str(target.parent))
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(previous); handle.flush(); os.fsync(handle.fileno())
                chown_root_if_privileged(rollback)
                os.chmod(rollback, 0o444)
                if os.name == "nt": os.chmod(target, 0o666)
                os.replace(rollback, target)
                if previous_mode is not None:
                    os.chmod(target, previous_mode)
            finally:
                try: os.unlink(rollback)
                except FileNotFoundError: pass
        else:
            try: target.unlink()
            except FileNotFoundError: pass
        raise

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
        os.fchmod(fd, mode); os.write(fd, raw); os.fsync(fd)
    finally:
        os.close(fd)
    root_immutable(path, mode=mode)
    require(path.read_bytes() == raw, "INSTALLED_FILE_MISMATCH:" + str(path))

def remove_exact(path: Path) -> None:
    if path.exists() or path.is_symlink():
        st = path.lstat()
        require(st.st_uid == 0 and not path.is_symlink(), "ROLLBACK_TARGET_UNTRUSTED:" + str(path))
        path.unlink()

def systemctl(*args: str) -> str:
    result = subprocess.run(["systemctl", *args], capture_output=True, text=True, timeout=40)
    require(result.returncode == 0, "SYSTEMD_FAILED:" + ":".join(args) + ":" + result.stderr[-160:])
    return result.stdout

def service_property(name: str) -> str:
    return systemctl("show", HYPE_UNIT, "--property=" + name, "--value").strip()

def read_approval(approval_id: str, run_id: str, now_ms: int) -> dict:
    st = APPROVAL_STORE.lstat()
    require(stat.S_ISREG(st.st_mode) and not APPROVAL_STORE.is_symlink() and st.st_size <= 4_000_000,
            "APPROVAL_STORE_INVALID")
    rows = json.loads(APPROVAL_STORE.read_bytes())
    require(isinstance(rows, list) and len(rows) <= 10000, "APPROVAL_STORE_INVALID")
    st = APPROVAL_STORE.stat()
    require(st.st_uid == 1000 and (st.st_mode & 0o022) == 0, "APPROVAL_STORE_UNTRUSTED")
    matches = [row for row in rows if isinstance(row, dict) and row.get("id") == approval_id]
    require(len(matches) == 1, "APPROVAL_NOT_UNIQUE")
    return validate_approval_record(matches[0], approval_id=approval_id, run_id=run_id, now_ms=now_ms)

def read_hold() -> tuple[dict, bytes, str]:
    value, raw = read_json(KILL)
    digest = validate_global_hold(value, raw, now_ms=time.time_ns() // 1_000_000)
    st = KILL.stat()
    require(st.st_uid == 1000 and stat.S_IMODE(st.st_mode) == 0o600, "GLOBAL_HOLD_METADATA_INVALID")
    return value, raw, digest

def validate_certificate() -> str:
    root_immutable(CERT, mode=0o444)
    cert, raw = read_json(CERT)
    require(cert.get("schema") == "disdex-stable4-h48-time-only-policy/v1"
            and cert.get("approvedSha") == SOURCE and cert.get("planSha256") == PLAN
            and cert.get("deploymentTarget") == DEPLOYMENT_TARGET and cert.get("policy") == POLICY
            and cert.get("symbol") == "HYPEUSDT" and cert.get("side") == "LONG"
            and cert.get("holdHours") == 48 and cert.get("residentStopRequired") is False
            and cert.get("residentTakeProfitRequired") is False, "H48_CERTIFICATE_IDENTITY_INVALID")
    require(type(cert.get("expiresAt")) is int and cert["expiresAt"] > time.time_ns() // 1_000_000,
            "H48_CERTIFICATE_EXPIRED")
    root_immutable(CERT_AUDIT, mode=0o444)
    audit, _ = read_json(CERT_AUDIT)
    require(audit.get("sourceSha") == SOURCE and audit.get("planSha256") == PLAN
            and audit.get("certificateSha256") == sha256(raw)
            and all(audit.get(k) == 0 for k in ("ordersSent", "cancelsSent", "positionChangesSent")),
            "H48_CERTIFICATE_AUDIT_INVALID")
    return sha256(raw)

def validate_activation() -> None:
    st = HYPE_ACTIVATION.lstat()
    require(stat.S_ISREG(st.st_mode) and not HYPE_ACTIVATION.is_symlink() and st.st_uid == 0
            and stat.S_IMODE(st.st_mode) == 0o600, "HYPE_ACTIVATION_METADATA_INVALID")
    value, _ = read_json(HYPE_ACTIVATION)
    require(value.get("schema") == "disdex-live-operator-activation/v1"
            and value.get("approvedSha") == SOURCE and value.get("ordersEnabled") is True
            and value.get("approvedRunners") == [RUNNER]
            and value.get("scope") == SCOPE and value.get("planSha256") == PLAN
            and value.get("operatorAcknowledgement") == ACK, "HYPE_ACTIVATION_NOT_SCOPED")

def validate_service_before() -> int:
    require(service_property("ActiveState") == "active" and service_property("SubState") == "running",
            "HYPE_UNIT_NOT_ACTIVE")
    pid = int(service_property("MainPID") or "0")
    require(pid > 100, "HYPE_PID_INVALID")
    require(os.path.realpath(RELEASE) == service_property("WorkingDirectory"), "HYPE_WORKDIR_INVALID")
    return pid

def validate_candidate_source() -> bytes:
    marker = RELEASE / ".disdex-release-sha"
    root_immutable(marker)
    require(marker.read_text(encoding="utf-8").strip() == SOURCE, "RELEASE_MARKER_INVALID")
    st = HYPE_SOURCE.lstat()
    require(stat.S_ISREG(st.st_mode) and not HYPE_SOURCE.is_symlink() and (st.st_mode & 0o222) == 0,
            "HYPE_SOURCE_NOT_IMMUTABLE")
    raw = HYPE_SOURCE.read_bytes()
    require(sha256(raw) == BASE_SOURCE_SHA256, "HYPE_SOURCE_SHA256_MISMATCH")
    return raw

def validate_runtime_readonly() -> None:
    for path in (HYPE_STATE, HYPE_TICK):
        value, _ = read_json(path)
        require(value.get("runtimeCommitSha") == SOURCE or value.get("runtimeSha") == SOURCE,
                "HYPE_RUNTIME_SHA_MISMATCH:" + str(path))

def validate_shared_safety() -> None:
    now_ms = time.time_ns() // 1_000_000
    risk, _ = read_json(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is not True,
            "SHARED_RISK_NOT_HEALTHY")
    updated = risk.get("updatedAt")
    require(type(updated) in (int, float) and -1_000 <= now_ms - updated <= 15 * 60_000,
            "SHARED_RISK_STALE")
    limits = [risk.get(key) for key in ("maximumLossPct", "dailyLossLimit", "maxDailyLossPct", "dailyLossLimitPct")
              if risk.get(key) is not None]
    require(limits and all(abs(float(value) - 0.075) < 1e-9 or abs(float(value) - 7.5) < 1e-9 for value in limits),
            "SHARED_RISK_LIMIT_INVALID")
    margin, _ = read_json(MARGIN)
    require(margin.get("stage") == "HEALTHY" and margin.get("ordersAllowed") is True, "MARGIN_GUARD_NOT_HEALTHY")
    checked = margin.get("checkedAt")
    require(type(checked) in (int, float) and -1_000 <= now_ms - checked <= 15 * 60_000, "MARGIN_GUARD_STALE")
    pending, _ = read_json(PENDING)
    entries = pending.get("entries")
    require(isinstance(entries, list) and all(isinstance(row, dict) for row in entries)
            and not any(str(row.get("status", "")).upper() != "RELEASED" for row in entries),
            "PENDING_EXPOSURE_ACTIVE")
    st = GLOBAL_ACTIVATION.lstat()
    require(stat.S_ISREG(st.st_mode) and not GLOBAL_ACTIVATION.is_symlink() and st.st_uid == 0
            and stat.S_IMODE(st.st_mode) == 0o600, "GLOBAL_ACTIVATION_METADATA_INVALID")
    global_activation, _ = read_json(GLOBAL_ACTIVATION)
    require(global_activation.get("ordersEnabled") is True and global_activation.get("approvedSha") == "7688ed7c93a1918d8b44837339b7da5584a868f5",
            "GLOBAL_ACTIVATION_UNEXPECTED")

def signed_flat_get() -> dict:
    command = (
        "set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env /etc/disdex/disdex-v12-v4.env; do . \"$f\"; done; set +a; "
        f"exec /usr/bin/node {RELEASE}/node_modules/tsx/dist/cli.mjs "
        "scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    result = subprocess.run(["/bin/bash", "-c", command], cwd=str(RELEASE),
                            capture_output=True, text=True, timeout=55)
    require(result.returncode == 0, "ASTER_SIGNED_GET_FAILED")
    rows = [line for line in result.stdout.splitlines() if line.startswith("{")]
    require(rows, "ASTER_SIGNED_GET_EMPTY")
    value = json.loads(rows[-1])
    require(value.get("status") == "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS", "ASTER_SIGNED_GET_NOT_PASS")
    require(all(value.get(k) == 0 for k in ("ordersSent", "cancelsSent", "positionChangesSent")),
            "DIAGNOSTIC_NOT_READ_ONLY")
    positions = value.get("positions") or []
    orders = value.get("openOrders") or []
    require(isinstance(positions, list) and isinstance(orders, list), "ASTER_SIGNED_GET_SHAPE_INVALID")
    require(not positions and not orders, "HYPE_ORDER_ENABLE_REQUIRES_FLAT_ACCOUNT")
    return {"observedAt": value.get("observedAt"), "positions": len(positions), "orders": len(orders)}

def validate_token(token: str, *, now_s: int) -> dict:
    root_immutable(PUBLIC_KEY)
    require(token and len(token) <= 16_384, "APPROVAL_TOKEN_INVALID")
    return verify(token, PUBLIC_KEY, REPO, SOURCE, SCOPE, "dunamishajime-bit", PLAN,
                  now=now_s, nonce_dir=None, route="GITHUB_ACTIONS",
                  deployment_target=DEPLOYMENT_TARGET, operator_target=OPERATOR_TARGET,
                  orders_enabled=True)

def preflight(*, approval_id: str, run_id: str, token: str, permit_module: Path) -> dict:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    now_ms = time.time_ns() // 1_000_000
    root_immutable(permit_module)
    token_payload = validate_token(token, now_s=now_ms // 1000)
    approval = read_approval(approval_id, run_id, now_ms)
    source = validate_candidate_source()
    cert_digest = validate_certificate()
    hold, hold_raw, hold_digest = read_hold()
    validate_activation()
    pid = validate_service_before()
    validate_runtime_readonly()
    validate_shared_safety()
    venue = signed_flat_get()
    for path in (OVERLAY_SOURCE, OVERLAY_MODULE, DROPIN, ENV_FILE, PERMIT, RECEIPT):
        require(not path.exists() and not path.is_symlink(), "ORDER_ENABLE_ALREADY_INSTALLED:" + str(path))
    other_permits = [path for path in CERT.parent.glob("*.order-enable.json") if path != PERMIT]
    require(not other_permits, "NON_HYPE_ORDER_PERMIT_PRESENT")
    return {"approval": approval, "source": source, "certificateSha256": cert_digest,
            "hold": hold, "holdRaw": hold_raw, "killSwitchSha256": hold_digest,
            "pid": pid, "venue": venue, "tokenNonceSha256": sha256(token_payload["nonce"].encode("ascii")),
            "nowMs": now_ms}

def wait_service_stable(previous_pid: int, timeout: int = 90) -> int:
    deadline = time.monotonic() + timeout
    last = 0
    stable_since = None
    while time.monotonic() < deadline:
        try:
            state = service_property("ActiveState")
            sub = service_property("SubState")
            pid = int(service_property("MainPID") or "0")
        except Exception:
            time.sleep(2)
            continue
        if state == "active" and sub == "running" and pid > 100 and pid != previous_pid:
            if pid != last:
                last, stable_since = pid, time.monotonic()
            if stable_since is not None and time.monotonic() - stable_since >= 20:
                return pid
        else:
            stable_since = None
        time.sleep(2)
    raise RuntimeError("HYPE_RESTART_NOT_STABLE")

def namespace_source_sha(pid: int) -> str:
    result = subprocess.run(["nsenter", "-t", str(pid), "-m", "--", "sha256sum", str(HYPE_SOURCE)],
                            capture_output=True, text=True, timeout=20)
    require(result.returncode == 0 and result.stdout.split(), "HYPE_NAMESPACE_HASH_FAILED")
    return result.stdout.split()[0]

def execute(*, approval_id: str, run_id: str, token: str, permit_module: Path) -> dict:
    import fcntl
    first = preflight(approval_id=approval_id, run_id=run_id, token=token, permit_module=permit_module)
    fd = os.open(EXECUTION_LOCK, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    installed: list[Path] = []
    previous_pid = first["pid"]
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        second = preflight(approval_id=approval_id, run_id=run_id, token=token, permit_module=permit_module)
        now_ms = time.time_ns() // 1_000_000
        certificate = json.loads(CERT.read_bytes())
        permit = build_hype_permit(
            approval_record=second["approval"], kill_switch=second["hold"],
            kill_switch_sha256=second["killSwitchSha256"],
            certificate_sha256=second["certificateSha256"], nonce_sha256=second["tokenNonceSha256"],
            issued_at=now_ms, expires_at=min(now_ms + 30 * 86_400_000, int(certificate["expiresAt"])),
        )
        overlay = build_hype_source_overlay(second["source"], MODULE_PATH_IN_RUNTIME)
        module = permit_module.read_bytes()
        env = build_env(approval_id, second["certificateSha256"])
        dropin = build_dropin()
        for directory in (OVERLAY_DIR, DROPIN_DIR, RECEIPT_DIR):
            if directory.exists():
                trusted_dir(directory)
            else:
                directory.mkdir(parents=True, exist_ok=False)
                os.chown(directory, 0, 0); os.chmod(directory, 0o755)
        install_exact(OVERLAY_SOURCE, overlay); installed.append(OVERLAY_SOURCE)
        install_exact(OVERLAY_MODULE, module); installed.append(OVERLAY_MODULE)
        install_exact(ENV_FILE, env); installed.append(ENV_FILE)
        install_exact(DROPIN, dropin); installed.append(DROPIN)
        publish_permit_transaction(PERMIT, canonical(permit)); installed.append(PERMIT)
        systemctl("daemon-reload")
        systemctl("restart", HYPE_UNIT)
        pid = wait_service_stable(previous_pid)
        require(namespace_source_sha(pid) == sha256(overlay), "HYPE_OVERLAY_NOT_ACTIVE")
        hold_after, hold_raw_after, hold_digest_after = read_hold()
        validate_permit(json.loads(PERMIT.read_bytes()), now_ms=time.time_ns() // 1_000_000,
                        kill_switch=hold_after, kill_switch_sha256=hold_digest_after,
                        certificate_sha256=second["certificateSha256"])
        require(hold_digest_after == second["killSwitchSha256"] and hold_raw_after == second["holdRaw"],
                "GLOBAL_HOLD_CHANGED_DURING_ENABLE")
        receipt = {
            "schema": "disdex-stable4-h48-hype-order-enable/v1", "approvedSha": SOURCE, "planSha256": PLAN,
            "operation": OPERATION, "scope": SCOPE, "policy": POLICY, "approvalId": approval_id,
            "certificateSha256": second["certificateSha256"], "killSwitchSha256": second["killSwitchSha256"],
            "permitSha256": sha256(canonical(permit)), "overlaySha256": sha256(overlay),
            "moduleSha256": sha256(module), "environmentSha256": sha256(env), "dropinSha256": sha256(dropin),
            "pid": pid, "venueRead": second["venue"],
            "status": "HYPE_SCOPED_ORDER_ENABLE_INSTALLED_GLOBAL_HOLD_REMAINS_ACTIVE",
            "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0, "issuedAt": now_ms,
        }
        install_exact(RECEIPT, canonical(receipt)); installed.append(RECEIPT)
        return receipt
    except Exception:
        try:
            remove_exact(DROPIN); systemctl("daemon-reload"); systemctl("restart", HYPE_UNIT)
            wait_service_stable(previous_pid, timeout=75)
        except Exception:
            pass
        for path in reversed(installed):
            try: remove_exact(path)
            except Exception: pass
        try:
            if OVERLAY_DIR.exists() and not any(OVERLAY_DIR.iterdir()): OVERLAY_DIR.rmdir()
        except Exception:
            pass
        raise
    finally:
        os.close(fd)

def rollback() -> dict:
    import fcntl
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require(RECEIPT.exists(), "ORDER_ENABLE_RECEIPT_MISSING")
    root_immutable(RECEIPT, mode=0o444)
    receipt, _ = read_json(RECEIPT)
    require(receipt.get("status") == "HYPE_SCOPED_ORDER_ENABLE_INSTALLED_GLOBAL_HOLD_REMAINS_ACTIVE", "ORDER_ENABLE_RECEIPT_INVALID")
    _, _, digest = read_hold()
    require(digest == receipt.get("killSwitchSha256"), "GLOBAL_HOLD_CHANGED_ROLLBACK_REQUIRES_REVIEW")
    fd = os.open(EXECUTION_LOCK, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old_pid = int(service_property("MainPID") or "0")
        remove_exact(DROPIN); systemctl("daemon-reload"); systemctl("restart", HYPE_UNIT); wait_service_stable(old_pid)
        for path in (PERMIT, ENV_FILE, OVERLAY_SOURCE, OVERLAY_MODULE, RECEIPT): remove_exact(path)
        try:
            if OVERLAY_DIR.exists() and not any(OVERLAY_DIR.iterdir()): OVERLAY_DIR.rmdir()
        except Exception:
            pass
        return {"status": "HYPE_SCOPED_ORDER_ENABLE_ROLLED_BACK_GLOBAL_HOLD_UNCHANGED",
                "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}
    finally:
        os.close(fd)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--approval-id")
    parser.add_argument("--run-id")
    parser.add_argument("--permit-module", default=str(SCRIPT_DIR / "hype-h48-order-permit.ts"))
    parser.add_argument("--read-approval-stdin", action="store_true")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight-readonly", action="store_true")
    mode.add_argument("--execute", action="store_true")
    mode.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    try:
        if args.rollback:
            result = rollback()
        else:
            require(args.approval_id and args.run_id and args.read_approval_stdin, "APPROVAL_INPUT_REQUIRED")
            token = sys.stdin.read(16_385).strip()
            require(token and len(token) <= 16_384, "APPROVAL_TOKEN_INVALID")
            module = Path(args.permit_module)
            if args.execute:
                result = execute(approval_id=args.approval_id, run_id=args.run_id, token=token, permit_module=module)
            else:
                preflight(approval_id=args.approval_id, run_id=args.run_id, token=token, permit_module=module)
                result = {"status": "HYPE_SCOPED_ORDER_ENABLE_PREFLIGHT_PASS_NOT_LIVE", "approvedSha": SOURCE,
                          "scope": SCOPE, "ordersEnabled": False, "ordersSent": 0,
                          "cancelsSent": 0, "positionChangesSent": 0}
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({"status": "HYPE_SCOPED_ORDER_ENABLE_FAIL_CLOSED", "reason": str(error)[:240],
                          "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}, sort_keys=True), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
