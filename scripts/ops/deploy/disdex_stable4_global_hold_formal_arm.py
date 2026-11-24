"""Owner-signed GLOBAL HOLD_PROTECTED re-arm for STABLE4 cutover.

This is NOT a generic Kill Switch setter or clearer. It only turns the
already recovered, inactive GLOBAL/HOLD_PROTECTED state into a new rollout
protected HOLD, after the exact H48 grant has been redeemed and the matching
root-owned immutable certificate has been issued. No orders or unit changes.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

import disdex_stable4_h48_formal_issue as owner

KILL = Path("/var/lib/disdex/shared/kill-switch.json")
PINS = Path("/etc/disdex/runner-pins.json")
HOLD_DIR = Path("/etc/disdex/stable4/holds")
HOLD_RECEIPT = HOLD_DIR / (owner.SOURCE + ".json")
REASON = "STABLE4_RESEARCH_ROLLOUT:" + owner.SOURCE
OPERATOR = "disdex-stable4-formal-owner-hold"
STRATEGY = "STABLE4_H48_CUTOVER"
MAX_HOLD_GRACE_MS = 10 * 60 * 1000


def require(value, code):
    owner.require(value, "HOLD_" + code)


def utc_timestamp(now_ms):
    return datetime.fromtimestamp(now_ms / 1000, timezone.utc).isoformat(timespec="milliseconds")


def validate_kill_before(value):
    require(isinstance(value, dict), "KILL_NOT_OBJECT")
    require(value.get("active") is False, "KILL_NOT_RECOVERED_INACTIVE")
    require(value.get("action") == "HOLD_PROTECTED", "KILL_ACTION_CHANGED")
    require(value.get("scope") == "GLOBAL", "KILL_SCOPE_CHANGED")
    require(isinstance(value.get("reason"), str) and value["reason"] != "", "KILL_PREVIOUS_REASON_UNKNOWN")
    return value


def validate_existing_active_hold(value):
    """Accept only the already-active canonical STABLE4 protection hold.

    A monitor rollout may have left the exact GLOBAL HOLD_PROTECTED active.
    In that state there is nothing safe to re-arm: clearing or rewriting the
    shared kill switch would weaken protection. The formal H48 step may only
    bind a new non-order receipt to the unchanged bytes.
    """
    require(isinstance(value, dict), "KILL_NOT_OBJECT")
    require(value.get("active") is True, "KILL_NOT_ACTIVE")
    require(value.get("action") == "HOLD_PROTECTED", "KILL_ACTION_CHANGED")
    require(value.get("scope") == "GLOBAL", "KILL_SCOPE_CHANGED")
    require(value.get("operator") == OPERATOR, "KILL_OWNER_CHANGED")
    require(value.get("strategyId") == STRATEGY, "KILL_STRATEGY_CHANGED")
    require(value.get("recoverable") is False, "KILL_RECOVERABLE_CHANGED")
    require(value.get("reason") == REASON, "KILL_REASON_CHANGED")
    return value


def protected_hold(value, now_ms):
    validate_kill_before(value)
    require(type(now_ms) is int and now_ms > 0, "CLOCK_INVALID")
    stamp = datetime.fromtimestamp(now_ms / 1000, timezone.utc)
    return {
        "active": True, "action": "HOLD_PROTECTED", "scope": "GLOBAL",
        "operator": OPERATOR, "strategyId": STRATEGY, "recoverable": False,
        "reason": REASON, "previousReason": value["reason"],
        "activatedAt": stamp.isoformat(timespec="milliseconds"),
        "graceStartedAt": stamp.isoformat(timespec="milliseconds"),
        "graceDeadlineAt": (stamp + timedelta(milliseconds=MAX_HOLD_GRACE_MS)).isoformat(timespec="milliseconds"),
    }


def validate_root_receipt(approval_id, run_id, *, now_ms):
    owner.trusted_dir(owner.ROOT, mode=0o700)
    owner.trusted_dir(owner.AUDIT_DIR, mode=0o700)
    owner.regular(owner.CERT, owner=0, no_write=True)
    certificate_bytes = owner.CERT.read_bytes()
    cert = json.loads(certificate_bytes)
    owner.validate_pinned_policy(cert, now_ms)
    receipt_paths = (
        owner.AUDIT_DIR / (owner.SOURCE + ".json"),
        owner.AUDIT_DIR / (owner.SOURCE + "." + run_id + ".json"),
    )
    certificate_digest = hashlib.sha256(certificate_bytes).hexdigest()
    for receipt_path in receipt_paths:
        if receipt_path.is_symlink():
            raise ValueError("ROOT_RECEIPT_SYMLINK_FORBIDDEN")
        if not receipt_path.exists():
            continue
        owner.regular(receipt_path, owner=0, no_write=True)
        receipt_raw = receipt_path.read_bytes()
        try:
            receipt = json.loads(receipt_raw)
        except Exception:
            continue
        if owner.canonical(receipt) != receipt_raw:
            continue
        if (
            receipt.get("schema") == "disdex-stable4-h48-hp-approved-issuance/v1"
            and receipt.get("approvalId") == approval_id
            and receipt.get("runId") == run_id
            and receipt.get("sourceSha") == owner.SOURCE
            and receipt.get("planSha256") == owner.PLAN
            and receipt.get("certificateSha256") == certificate_digest
            and receipt.get("policy") == "H48_TIME_ONLY"
            and all(receipt.get(k) == 0 for k in
                    ("ordersSent", "cancelsSent", "positionChangesSent"))
        ):
            return receipt
    raise ValueError("ROOT_CERTIFICATE_PROVENANCE_MISMATCH")


def get_v4_pin():
    owner.regular(PINS, owner=0)
    manifest = json.loads(PINS.read_bytes())
    require(manifest.get("schema") == "disdex-runner-pin-manifest/v1"
            and manifest.get("target") == "professional-dismanager.net"
            and isinstance(manifest.get("runners"), dict), "PINS_MANIFEST_INVALID")
    v4 = manifest["runners"].get("V12_V4")
    sha = v4.get("sha") if isinstance(v4, dict) else None
    require(isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40}", sha), "V4_PIN_INVALID")
    return sha


def protected_hold_receipt(now_ms, v4_sha, after_bytes):
    require(isinstance(v4_sha, str) and re.fullmatch(r"[0-9a-f]{40}", v4_sha), "V4_SOURCE_INVALID")
    require(type(now_ms) is int and now_ms > 0, "CLOCK_INVALID")
    return {
        "schema": "disdex-stable4-protected-hold-owner/v1",
        "planSha256": owner.PLAN,
        "approvedSha": owner.SOURCE,
        "v4Sha": v4_sha,
        "killSwitchPath": str(KILL),
        "killSwitchSha256": hashlib.sha256(after_bytes).hexdigest(),
        "reason": REASON,
        "issuedAt": now_ms,
        "expiresAt": now_ms + 50 * 60000,
        "scope": "HYPE_TREND_LONG",
        "authorizesOrders": False,
    }


def guarded_arm(approval_id, run_id, token):
    import fcntl
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    owner.validate_token(token, now_s=int(time.time()))
    receipt = validate_root_receipt(approval_id, run_id, now_ms=time.time_ns() // 1000000)
    owner.regular(KILL, owner=1000)
    require(stat.S_IMODE(KILL.stat().st_mode) == 0o600, "KILL_MODE_INVALID")
    lock_fd = os.open(owner.ROOT / "deployment-execution.lock", os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        rows = json.loads(owner.STORE.read_bytes())
        owner.approved_record(rows, approval_id=approval_id, run_id=run_id, now_ms=time.time_ns() // 1000000)
        validate_root_receipt(approval_id, run_id, now_ms=time.time_ns() // 1000000)
        before = KILL.read_bytes()
        old = json.loads(before)
        v4_sha = get_v4_pin()
        require(not HOLD_RECEIPT.exists() and not HOLD_RECEIPT.is_symlink(), "HOLD_ALREADY_PREPARED")
        now_ms = time.time_ns() // 1000000
        if old.get("active") is True:
            # The canonical protection is already active. Preserve its bytes
            # exactly and issue only the candidate-bound non-order receipt.
            validate_existing_active_hold(old)
            hold_receipt = protected_hold_receipt(now_ms, v4_sha, before)
            owner.ensure_directory(HOLD_DIR, 0o755)
            owner.install_exact_file(HOLD_RECEIPT, owner.canonical(hold_receipt), 0o444)
            require(KILL.read_bytes() == before, "KILL_CHANGED_DURING_RECEIPT")
            return {
                "status": "STABLE4_GLOBAL_HOLD_PROTECTED_ARMED_OWNER_BOUND",
                "sourceSha": owner.SOURCE, "v4Sha": v4_sha,
                "killSwitchSha256": hold_receipt["killSwitchSha256"],
                "receiptSha256": hashlib.sha256(owner.canonical(hold_receipt)).hexdigest(),
                "expiresAt": hold_receipt["expiresAt"], "authorizesOrders": False,
                "alreadyProtected": True,
                "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
            }
        validate_kill_before(old)
        new_bytes = owner.canonical(protected_hold(old, now_ms))
        hold_receipt = protected_hold_receipt(now_ms, v4_sha, new_bytes)
        owner.ensure_directory(HOLD_DIR, 0o755)
        # Write an immutable, SHA-bound non-order receipt before changing shared
        # state; any incomplete step leaves a safe, non-reusable failure record.
        owner.install_exact_file(HOLD_RECEIPT, owner.canonical(hold_receipt), 0o444)
        old_stat = owner.regular(KILL, owner=1000)
        require(KILL.read_bytes() == before, "KILL_CHANGED_BEFORE_COMMIT")
        new_path = KILL.parent / (".stable4-hold-" + owner.SOURCE + ".tmp")
        require(not new_path.exists() and not new_path.is_symlink(), "KILL_STAGING_COLLISION")
        fd = os.open(new_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            os.fchown(fd, old_stat.st_uid, old_stat.st_gid)
            os.fchmod(fd, stat.S_IMODE(old_stat.st_mode))
            os.write(fd, new_bytes)
            os.fsync(fd)
        finally:
            os.close(fd)
        require(KILL.read_bytes() == before, "KILL_CHANGED_DURING_STAGING")
        os.replace(new_path, KILL)
        require(KILL.read_bytes() == new_bytes and KILL.stat().st_uid == old_stat.st_uid,
                "KILL_POST_COMMIT_MISMATCH")
        return {
            "status": "STABLE4_GLOBAL_HOLD_PROTECTED_ARMED_OWNER_BOUND",
            "sourceSha": owner.SOURCE, "v4Sha": v4_sha,
            "killSwitchSha256": hold_receipt["killSwitchSha256"],
            "receiptSha256": hashlib.sha256(owner.canonical(hold_receipt)).hexdigest(),
            "expiresAt": hold_receipt["expiresAt"], "authorizesOrders": False,
            "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
        }
    finally:
        os.close(lock_fd)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--preflight-readonly", action="store_true")
    p.add_argument("--arm", action="store_true")
    p.add_argument("--approval-id", required=True)
    p.add_argument("--run-id", required=True)
    args = p.parse_args()
    require(args.preflight_readonly != args.arm, "MODE_REQUIRED")
    now_ms = time.time_ns() // 1000000
    if args.preflight_readonly:
        validate_root_receipt(args.approval_id, args.run_id, now_ms=now_ms)
        current = json.loads(KILL.read_bytes())
        if current.get("active") is True:
            validate_existing_active_hold(current)
        else:
            validate_kill_before(current)
        result = {"status": "STABLE4_GLOBAL_HOLD_PREFLIGHT_ONLY_NOT_ARMED",
                  "sourceSha": owner.SOURCE, "authorizesOrders": False}
    else:
        result = guarded_arm(args.approval_id, args.run_id, sys.stdin.read(16385).strip())
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"status": "STABLE4_GLOBAL_HOLD_OWNER_ARM_FAIL_CLOSED",
                          "reason": str(e)[:180], "ordersSent": 0, "cancelsSent": 0,
                          "positionChangesSent": 0}), file=sys.stderr)
        sys.exit(2)

