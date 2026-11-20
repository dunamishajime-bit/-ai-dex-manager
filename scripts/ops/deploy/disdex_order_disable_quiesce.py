#!/usr/bin/env python3
"""Owner-approved metadata-only order-disable quiesce.

This helper is deliberately narrower than a deployment: it changes only the
Root-owned unified deployment plan's ``ordersEnabled`` boolean from true to
false.  It never starts or stops a service, touches Runner pins, edits STOPs or
the GLOBAL HOLD, or calls an exchange mutation endpoint.  Signed venue GETs
and a compare-and-swap write protect the transition; any post-write failure
restores the exact original bytes and file metadata.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
from typing import Callable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from disdex_owner_approval import verify as verify_owner_token


CURRENT_PLAN = Path("/var/lib/disdex/unified-deploy/current-plan.json")
HOLD = Path("/var/lib/disdex/shared/kill-switch.json")
CURRENT_RELEASE = Path("/home/deploy/disdex-trading/current")
DEFAULT_PUBLIC_KEY = Path("/var/lib/disdex/unified-deploy/owner-approval-public.pem")
DEFAULT_NONCE_DIR = Path("/var/lib/disdex/unified-deploy/nonces")
BACKUP_ROOT = Path("/var/backups/disdex-order-disable-quiesce")

REPO = "dunamishajime-bit/-ai-dex-manager"
TARGET = "b8d681f048b087f07e0dcfb743cc14ec3a796b27"
PLAN_SHA256 = "542b30ea87fa0e6ea9d27dd63fecc00181e95d4040a544aa9004fed579f4d68f"
SCOPE = "FULL_PROJECT"
OPERATION = "ALL_RUNNERS_MONITOR_REFRESH"
OWNER = "dunamishajime-bit"
DEPLOYMENT_TARGET = "professional-dismanager.net"
OPERATOR_TARGET = "DD1296_FINAL_ALLIN_10BPS"
ROUTE = "GITHUB_ACTIONS"
HOLD_DIGEST = "928a1c83b08c6445211639631ed69ccf7ea935741cb21786c41fc63e294322cf"
BASE_CURRENT_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"


class ContractError(RuntimeError):
    pass


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise ContractError(reason)


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def read_regular(path: Path, max_bytes: int = 2_000_000) -> bytes:
    require(path.is_file() and not path.is_symlink(), "REGULAR_FILE_REQUIRED:" + str(path))
    st = path.stat()
    require(stat.S_ISREG(st.st_mode) and st.st_size <= max_bytes, "UNSAFE_FILE:" + str(path))
    if os.name != "nt":
        require(not (st.st_mode & 0o022), "UNSAFE_FILE:" + str(path))
    return path.read_bytes()


def file_meta(path: Path) -> tuple[int, int, int]:
    st = path.stat()
    return st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode)


def parse_object(raw: bytes, label: str) -> dict:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError(label + "_JSON_INVALID") from exc
    require(isinstance(value, dict), label + "_OBJECT_REQUIRED")
    return value


def build_quiesced_plan(raw: bytes) -> bytes:
    """Return a canonical plan with only ``ordersEnabled`` changed to false."""
    value = parse_object(raw, "CURRENT_PLAN")
    require(value.get("ordersEnabled") is True, "CURRENT_PLAN_ALREADY_DISABLED")
    value["ordersEnabled"] = False
    return canonical(value) + b"\n"


def validate_hold(raw: bytes, expected_digest: str = HOLD_DIGEST) -> dict:
    require(sha256(raw) == expected_digest, "GLOBAL_HOLD_DIGEST_MISMATCH")
    value = parse_object(raw, "GLOBAL_HOLD")
    require(
        value.get("active") is True
        and value.get("action") == "HOLD_PROTECTED"
        and value.get("scope") == "GLOBAL"
        and value.get("operator") == "disdex-stable4-formal-owner-hold"
        and value.get("recoverable") is False,
        "GLOBAL_HOLD_NOT_PROTECTED",
    )
    return value


def _flat_inventory(read: dict) -> bool:
    positions = read.get("positions")
    orders = read.get("openOrders")
    if not isinstance(positions, list) or not isinstance(orders, list):
        return False
    # The existing signed diagnostic already normalizes zero quantities.  Keep
    # a defensive numeric check here so an unnormalized nonzero row cannot pass.
    for row in positions:
        if not isinstance(row, dict):
            return False
        if "positionAmt" not in row:
            return False
        try:
            if abs(float(row.get("positionAmt"))) > 1e-15:
                return False
        except (TypeError, ValueError):
            return False
    return not orders


def validate_quiesce_evidence(
    plan_raw: bytes,
    hold_raw: bytes,
    expected_hold_digest: str,
    signed_reads: list[dict],
) -> dict:
    plan = parse_object(plan_raw, "CURRENT_PLAN")
    require(plan.get("schema") == "disdex-unified-deployment-plan/v2",
            "CURRENT_PLAN_SCHEMA_INVALID")
    require(plan.get("deploymentTarget") == DEPLOYMENT_TARGET,
            "CURRENT_PLAN_TARGET_INVALID")
    require(plan.get("operatorTarget") == OPERATOR_TARGET,
            "CURRENT_PLAN_OPERATOR_TARGET_INVALID")
    require(plan.get("ordersEnabled") is True, "CURRENT_PLAN_NOT_ORDER_ENABLED")
    validate_hold(hold_raw, expected_hold_digest)
    require(len(signed_reads) == 3, "SIGNED_GET_COUNT_INVALID")
    for read in signed_reads:
        require(isinstance(read, dict) and _flat_inventory(read), "VENUE_NOT_FLAT")
        for key in ("ordersSent", "cancelsSent", "positionChangesSent"):
            if key in read:
                require(read.get(key) == 0, "SIGNED_GET_MUTATION:" + key)
    return {
        "ordersEnabledBefore": True,
        "ordersEnabledAfter": False,
        "signedGets": len(signed_reads),
        "ordersSent": 0,
        "cancelsSent": 0,
        "positionChangesSent": 0,
    }


def _atomic_write(path: Path, raw: bytes, metadata: tuple[int, int, int]) -> None:
    uid, gid, mode = metadata
    fd, name = tempfile.mkstemp(dir=str(path.parent), prefix=".disdex-order-disable-")
    try:
        with os.fdopen(fd, "wb") as handle:
            if os.name != "nt":
                os.fchmod(handle.fileno(), mode)
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        if hasattr(os, "chown"):
            os.chown(name, uid, gid)
        os.replace(name, path)
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            # Some non-Linux test filesystems do not allow directory fsync; the
            # file itself is still fully fsynced before replacement.
            pass
    finally:
        if os.path.exists(name):
            os.unlink(name)


def quiesce_plan_file(
    path: Path,
    expected_digest: str,
    postcondition: Callable[[bytes], None] | None = None,
    backup_path: Path | None = None,
) -> bytes:
    """CAS-write the disabled plan and restore exact bytes on any failure."""
    original = read_regular(path)
    require(sha256(original) == expected_digest, "CURRENT_PLAN_CAS_MISMATCH")
    metadata = file_meta(path)
    changed = build_quiesced_plan(original)
    if backup_path is not None:
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write(backup_path, original, (0, 0, 0o600))
    try:
        _atomic_write(path, changed, metadata)
        observed = read_regular(path)
        require(observed == changed, "CURRENT_PLAN_POSTWRITE_MISMATCH")
        require(parse_object(observed, "CURRENT_PLAN").get("ordersEnabled") is False,
                "CURRENT_PLAN_POSTWRITE_NOT_DISABLED")
        if postcondition is not None:
            postcondition(observed)
        return observed
    except Exception:
        current = read_regular(path)
        current_digest = sha256(current)
        if current_digest == sha256(changed):
            _atomic_write(path, original, metadata)
            require(read_regular(path) == original, "CURRENT_PLAN_ROLLBACK_VERIFY_FAILED")
        elif current_digest != expected_digest:
            raise ContractError("CURRENT_PLAN_ROLLBACK_CAS_CONFLICT") from None
        raise


def signed_get() -> dict:
    """Run the existing signed Aster account diagnostic; GET-only by contract."""
    release = CURRENT_RELEASE.resolve()
    require(release.is_dir(), "CURRENT_RELEASE_MISSING")
    command = (
        "set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env /etc/disdex/disdex-v12-v4.env; "
        "do . \"$f\"; done; set +a; exec /usr/bin/node "
        + str(release / "node_modules/tsx/dist/cli.mjs")
        + " scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    result = subprocess.run(["/bin/bash", "-c", command], cwd=release,
                            capture_output=True, text=True, timeout=65)
    require(result.returncode == 0, "SIGNED_ASTER_GET_FAILED")
    rows = [line for line in result.stdout.splitlines() if line.startswith("{")]
    require(rows, "SIGNED_ASTER_GET_EMPTY")
    value = parse_object(rows[-1].encode("utf-8"), "SIGNED_ASTER_GET")
    require(value.get("status") == "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
            "SIGNED_ASTER_GET_NOT_PASS")
    for key in ("ordersSent", "cancelsSent", "positionChangesSent"):
        require(value.get(key) == 0, "SIGNED_GET_MUTATION:" + key)
    return {
        "positions": value.get("positions"),
        "openOrders": value.get("openOrders"),
        "ordersSent": 0,
        "cancelsSent": 0,
        "positionChangesSent": 0,
        "observedAt": value.get("observedAt") or value.get("venueTime"),
    }


def _reads(getter: Callable[[], dict]) -> list[dict]:
    return [getter() for _ in range(3)]


def validate_baseline_paths(current_plan: Path, hold: Path) -> tuple[bytes, bytes]:
    plan_stat = current_plan.stat()
    require(plan_stat.st_uid == 0, "CURRENT_PLAN_NOT_ROOT_OWNED")
    hold_stat = hold.stat()
    require(hold_stat.st_uid in (0, 1000) and stat.S_IMODE(hold_stat.st_mode) == 0o600,
            "GLOBAL_HOLD_METADATA_INVALID")
    plan_raw = read_regular(current_plan)
    hold_raw = read_regular(hold)
    plan_value = parse_object(plan_raw, "CURRENT_PLAN")
    require(plan_value.get("sourceSha") == BASE_CURRENT_SHA,
            "CURRENT_PLAN_SOURCE_MISMATCH")
    require(CURRENT_RELEASE.resolve().name == BASE_CURRENT_SHA,
            "CURRENT_RELEASE_SOURCE_MISMATCH")
    return plan_raw, hold_raw


def perform_quiesce(
    current_plan: Path = CURRENT_PLAN,
    hold: Path = HOLD,
    hold_digest: str = HOLD_DIGEST,
    getter: Callable[[], dict] = signed_get,
    backup_path: Path | None = None,
) -> dict:
    before_plan, before_hold = validate_baseline_paths(current_plan, hold)
    evidence_before = _reads(getter)
    result = validate_quiesce_evidence(before_plan, before_hold, hold_digest, evidence_before)

    def postcondition(_changed: bytes) -> None:
        after_hold = read_regular(hold)
        require(after_hold == before_hold and sha256(after_hold) == hold_digest,
                "GLOBAL_HOLD_CHANGED_DURING_QUIESCE")
        evidence_after = _reads(getter)
        after_plan = read_regular(current_plan)
        require(parse_object(after_plan, "CURRENT_PLAN").get("ordersEnabled") is False,
                "CURRENT_PLAN_POSTWRITE_NOT_DISABLED")
        require(all(_flat_inventory(item) for item in evidence_after), "VENUE_NOT_FLAT_AFTER_QUIESCE")

    quiesce_plan_file(current_plan, sha256(before_plan), postcondition=postcondition,
                      backup_path=backup_path)
    result.update(status="ORDER_DISABLE_QUIESCE_PASS", currentPlanSha256=sha256(read_regular(current_plan)))
    return result


def _verify_token(token: str, public_key: Path, target: str, plan_sha: str,
                  nonce_dir: Path | None = None) -> None:
    verify_owner_token(
        token, public_key, REPO, target, SCOPE, OWNER, plan_sha,
        nonce_dir=str(nonce_dir) if nonce_dir is not None else None,
        route=ROUTE, deployment_target=DEPLOYMENT_TARGET,
        operator_target=OPERATOR_TARGET, orders_enabled=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight-readonly", action="store_true")
    mode.add_argument("--execute-approved", action="store_true")
    parser.add_argument("--target-sha", default=TARGET)
    parser.add_argument("--plan-sha256", default=PLAN_SHA256)
    parser.add_argument("--approval-id", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--public-key", type=Path, default=DEFAULT_PUBLIC_KEY)
    parser.add_argument("--nonce-dir", type=Path, default=DEFAULT_NONCE_DIR)
    parser.add_argument("--current-plan", type=Path, default=CURRENT_PLAN)
    parser.add_argument("--hold", type=Path, default=HOLD)
    parser.add_argument("--hold-digest", default=HOLD_DIGEST)
    args = parser.parse_args()
    try:
        require(args.target_sha == TARGET and args.plan_sha256 == PLAN_SHA256,
                "QUIESCE_TARGET_NOT_PINNED")
        require(args.run_id.isdecimal() and len(args.run_id) <= 20, "RUN_ID_INVALID")
        require(args.approval_id and args.public_key.is_file() and not args.public_key.is_symlink(),
                "APPROVAL_INPUT_INVALID")
        token = sys.stdin.read(16_385).strip()
        require(token and len(token) <= 16_384, "OWNER_TOKEN_INPUT_REQUIRED")
        _verify_token(token, args.public_key, args.target_sha, args.plan_sha256,
                      None if args.preflight_readonly else args.nonce_dir)
        before, hold = validate_baseline_paths(args.current_plan, args.hold)
        evidence = _reads(signed_get)
        result = validate_quiesce_evidence(before, hold, args.hold_digest, evidence)
        if args.preflight_readonly:
            result.update(status="ORDER_DISABLE_QUIESCE_PREFLIGHT_PASS",
                          currentPlanSha256=sha256(before))
        else:
            backup = BACKUP_ROOT / args.run_id / "current-plan.before.json"
            result = perform_quiesce(args.current_plan, args.hold, args.hold_digest,
                                     signed_get, backup)
            result["approvalId"] = args.approval_id
            result["runId"] = args.run_id
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({
            "status": "ORDER_DISABLE_QUIESCE_BLOCKED",
            "reason": str(error)[:240],
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
        }, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
