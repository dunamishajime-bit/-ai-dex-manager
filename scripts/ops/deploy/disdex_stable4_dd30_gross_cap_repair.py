#!/usr/bin/env python3
"""Fail-closed Root repair for the STABLE4 DD30 gross-cap environment.

This helper is deliberately narrower than the LIVE order-enable executor.  It
only repairs the immutable systemd environment used by the seven monitor-only
candidate units.  It never creates an order permit, clears GLOBAL HOLD,
changes a STOP, changes a position, or sends an exchange mutation.  The
existing read-only preflight is imported from the same staged directory by the
official workflow so every safety read uses the certified gate implementation.
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
import sys
import time
from typing import Any

import preflight as gate


SOURCE_SHA = "08f4a0d77d85808d897d6d4d985b950af0d76bab"
PLAN_SHA256 = "0faddfdb33ee885ffba4538a672d7719cf5a0652e1cb5082ef8ef47b7a8a02e4"
DROPIN_NAME = "zzzz-stable4-dd30-gross-cap.conf"
BACKUP_ROOT = Path("/var/backups/disdex/stable4-dd30-gross-cap")

# Generic keys are the ones checked by the signed preflight.  The strategy
# keys are included because the legacy engines read their own names and would
# otherwise continue to use the historical 4.0/4.25/1.5 defaults.
CAP_OVERRIDES: dict[str, str] = {
    "CRYPTO_GROSS_CAP": "3.0",
    "STOCK_GROSS_CAP": "1.5",
    "TOTAL_GROSS_CAP": "3.5",
    "DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT": "7.5",
    "V12_BASE_GROSS_CAP": "2.0",
    "V12_DYNAMIC_GROSS_CAP": "2.0",
    "V12_GROSS_CAP": "2.0",
    "PENGU_GROSS_CAP": "1.0",
    "PENGU_DUAL_LS_V2_MAX_GROSS": "1.0",
    "QUALITY102_CAUSAL_V1_MAX_GROSS": "3.0",
    "DISDEX_V52_CRYPTO_GROSS_CAP": "3.0",
    "DISDEX_V52_STOCK_GROSS_CAP": "1.5",
    "DISDEX_V52_V11_GROSS_CAP": "1.5",
    "DISDEX_V52_V50_GROSS_CAP": "1.5",
    "DISDEX_V52_PORTFOLIO_GROSS_CAP": "3.5",
    "DISDEX_HYPE_ZEC_MAX_GROSS": "1.0",
    "HYPE_LONG_MAX_GROSS": "1.0",
}

TRUE_VALUE_RE = re.compile(r"(?i)(?:^|[\s'\"=])([A-Z0-9_]*?(?:ORDERS_ENABLED|LIVE_TRADING_ENABLED|LIVE_EXECUTION_ENABLED|OPERATOR_ARMED|PRODUCTION_CONFIG_LIVE_ENABLED|DISDEX_MONITOR_NEW_ORDERS_ALLOWED))=(true|1|yes)(?:$|[\s'\"])")


def require(ok: bool, reason: str) -> None:
    if not ok:
        raise gate.GateError(reason)


def safe_text(value: object) -> str:
    return gate.safe_text(value)


def render_dropin(overrides: dict[str, str] = CAP_OVERRIDES) -> str:
    """Return a deterministic, systemd-safe Environment override drop-in."""
    lines = ["# STABLE4 DD30 cap repair; orders remain monitor-only", "[Service]"]
    for key in sorted(overrides):
        value = str(overrides[key])
        require(re.fullmatch(r"[A-Z0-9_]+", key) is not None, "CAP_KEY_INVALID:" + key)
        require(re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", value) is not None, "CAP_VALUE_INVALID:" + key)
        lines.append(f'Environment="{key}={value}"')
    return "\n".join(lines) + "\n"


def monitor_order_flags(text: str) -> list[str]:
    """List effective order-enabling flags found in systemd properties."""
    found: list[str] = []
    for match in TRUE_VALUE_RE.finditer(text):
        flag = match.group(1)
        if flag not in found:
            found.append(flag)
    return found


def assert_monitor_only(unit: str) -> None:
    env = gate.systemd_value(unit, "Environment")
    start = gate.systemd_value(unit, "ExecStart")
    combined = env + " " + start
    found = monitor_order_flags(combined)
    # QUALITY102 has a separate live selector flag; FET deliberately uses a
    # shadow-runner entry point whose historical LIVE_ENABLED marker means the
    # strategy is loaded, not that exchange execution is armed.  The actual
    # execution/permit flags above remain fail-closed.
    if re.search(r"(?i)(?:^|[\s'\"=])QUALITY102_LIVE_ENABLED=(true|1|yes)(?:$|[\s'\"])", combined):
        found.append("QUALITY102_LIVE_ENABLED")
    if "disdex-fet-brk48-shadow-runner.ts" not in combined and "FET_BRK48" in unit:
        found.append("FET_SHADOW_ENTRYPOINT_MISSING")
    require(not found, "ORDER_ENABLE_FLAG_PRESENT:" + unit + ":" + ",".join(found))


def cap_snapshot(source: str) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for runner in gate.RUNNERS:
        unit = gate.unit_for(runner, source)
        try:
            values = gate.effective_caps(unit)
        except Exception as exc:  # report a bounded diagnostic; do not weaken the gate
            rows[runner] = {"status": "MISSING_OR_INVALID", "reason": safe_text(exc)}
            continue
        expected = gate.EXPECTED_CAPS
        mismatches = {
            key: {"actual": values.get(key), "expected": value}
            for key, value in expected.items()
            if values.get(key) != value
        }
        rows[runner] = {"status": "PASS" if not mismatches else "MISMATCH", "values": values, "mismatches": mismatches}
    return rows


def base_snapshot(source: str, plan_path: Path, plan_sha: str) -> dict[str, Any]:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    gate.load_plan(plan_path, plan_sha)
    require(source == SOURCE_SHA, "SOURCE_NOT_APPROVED_CANDIDATE")
    release = gate.BASE / source
    marker = release / ".disdex-release-sha"
    require(marker.is_file() and marker.read_text(encoding="utf-8").strip() == source, "RELEASE_MARKER_INVALID")
    gate.validate_pins(source)
    units = gate.validate_units(source)
    hold, hold_raw, hold_digest = gate.validate_hold()
    gate.validate_shared()
    for runner in gate.RUNNERS:
        assert_monitor_only(gate.unit_for(runner, source))
    reads = [gate.signed_get(source) for _ in range(3)]
    require(len({row[0] for row in reads}) == 3, "SIGNED_GET_TIMESTAMPS_NOT_UNIQUE")
    return {
        "units": units,
        "hold": hold,
        "holdRaw": hold_raw,
        "holdDigest": hold_digest,
        "reads": reads,
    }


def _safe_parent(path: Path) -> None:
    require(path.is_dir() and not path.is_symlink(), "DROPIN_PARENT_INVALID:" + str(path))
    st = path.stat()
    require(st.st_uid == 0 and (st.st_mode & 0o022) == 0, "DROPIN_PARENT_METADATA_INVALID:" + str(path))


def dropin_path(unit: str) -> Path:
    parent = Path("/etc/systemd/system") / (unit + ".d")
    _safe_parent(parent)
    path = parent / DROPIN_NAME
    require(not path.is_symlink(), "DROPIN_SYMLINK_FORBIDDEN:" + str(path))
    if path.exists():
        st = path.stat()
        require(st.st_uid == 0 and (st.st_mode & 0o022) == 0, "DROPIN_METADATA_INVALID:" + str(path))
    return path


def write_atomic(path: Path, data: bytes) -> None:
    require(not path.is_symlink(), "WRITE_SYMLINK_FORBIDDEN:" + str(path))
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        with open(tmp, "xb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chown(tmp, 0, 0)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def snapshot_dropins(source: str, run_id: str) -> dict[str, bytes | None]:
    require(re.fullmatch(r"[0-9A-Za-z_.-]{1,100}", run_id) is not None, "RUN_ID_INVALID")
    backup = BACKUP_ROOT / run_id
    if backup.exists():
        require(backup.is_dir() and not backup.is_symlink(), "BACKUP_DIR_INVALID")
    else:
        backup.mkdir(mode=0o700, parents=True)
        os.chown(backup, 0, 0)
        os.chmod(backup, 0o700)
    result: dict[str, bytes | None] = {}
    for runner in gate.RUNNERS:
        unit = gate.unit_for(runner, source)
        path = dropin_path(unit)
        data = path.read_bytes() if path.exists() else None
        result[unit] = data
        if data is not None:
            backup_file = backup / (unit + ".conf")
            write_atomic(backup_file, data)
    metadata = {"sourceSha": source, "units": sorted(result), "dropinName": DROPIN_NAME}
    write_atomic(backup / "manifest.json", json.dumps(metadata, sort_keys=True).encode("utf-8"))
    return result


def restore_dropins(source: str, snapshot: dict[str, bytes | None]) -> None:
    for runner in gate.RUNNERS:
        unit = gate.unit_for(runner, source)
        path = dropin_path(unit)
        old = snapshot.get(unit)
        if old is None:
            if path.exists():
                path.unlink()
        else:
            write_atomic(path, old)


def restart_all(source: str) -> None:
    gate.run("systemctl", "daemon-reload", timeout=30)
    for runner in gate.RUNNERS:
        gate.run("systemctl", "restart", gate.unit_for(runner, source), timeout=120)


def post_validate(source: str, before: dict[str, Any], plan_path: Path, plan_sha: str) -> dict[str, Any]:
    gate.validate_units(source)
    caps = gate.validate_caps(source)
    for runner in gate.RUNNERS:
        assert_monitor_only(gate.unit_for(runner, source))
    _, hold_raw, hold_digest = gate.validate_hold()
    require(hold_raw == before["holdRaw"] and hold_digest == before["holdDigest"], "GLOBAL_HOLD_CHANGED")
    gate.validate_shared()
    reads = [gate.signed_get(source) for _ in range(3)]
    require(len({row[0] for row in reads}) == 3, "POST_SIGNED_GET_TIMESTAMPS_NOT_UNIQUE")
    # Re-run plan/hash binding after the write; this catches an accidental plan
    # replacement while the service units were being restarted.
    gate.load_plan(plan_path, plan_sha)
    return {
        "status": "STABLE4_DD30_GROSS_CAP_REPAIR_PASS",
        "sourceSha": source,
        "planSha256": plan_sha,
        "effectiveGrossCaps": caps,
        "globalHoldDigest": hold_digest,
        "signedGets": 3,
        "ordersEnabled": False,
        "ordersSent": 0,
        "cancelsSent": 0,
        "positionChangesSent": 0,
    }


def require_stable4_dd30_gross_repair_consistency() -> None:
    """Prevent re-applying the stale 3/1.5/3.5 Gross override.

    Confirm the original approved monitor DD30 portfolio limits, plus the
    integrated HYPE Long sleeve limit.  Until the Root repair, live plan and
    V52 strategy-specific caps are reconciled, fail closed before any
    filesystem write or systemd restart.
    """
    expected = {
        "CRYPTO_GROSS_CAP": "3.0",
        "STOCK_GROSS_CAP": "4.0",
        "TOTAL_GROSS_CAP": "4.25",
        "DISDEX_V52_STOCK_GROSS_CAP": "4.0",
        "DISDEX_V52_PORTFOLIO_GROSS_CAP": "4.25",
        "HYPE_LONG_MAX_GROSS": "1.5",
    }
    for key, value in expected.items():
        require(CAP_OVERRIDES.get(key) == value, "STABLE4_DD30_GROSS_REPAIR_SOURCE_MISMATCH:" + key)


def execute(source: str, plan_path: Path, plan_sha: str, run_id: str) -> dict[str, Any]:
    require_stable4_dd30_gross_repair_consistency()
    before = base_snapshot(source, plan_path, plan_sha)
    snapshot = snapshot_dropins(source, run_id)
    try:
        data = render_dropin().encode("utf-8")
        for runner in gate.RUNNERS:
            write_atomic(dropin_path(gate.unit_for(runner, source)), data)
        restart_all(source)
        return post_validate(source, before, plan_path, plan_sha)
    except Exception as exc:
        rollback_error: Exception | None = None
        try:
            restore_dropins(source, snapshot)
            restart_all(source)
        except Exception as rollback_exc:  # preserve fail-closed evidence
            rollback_error = rollback_exc
        if rollback_error is not None:
            raise gate.GateError("REPAIR_FAILED_ROLLBACK_FAILED:" + safe_text(rollback_error)) from exc
        raise gate.GateError("REPAIR_FAILED_ROLLED_BACK:" + safe_text(exc)) from exc


def preflight_report(source: str, plan_path: Path, plan_sha: str) -> dict[str, Any]:
    before = base_snapshot(source, plan_path, plan_sha)
    return {
        "status": "STABLE4_DD30_GROSS_CAP_REPAIR_PREFLIGHT_PASS",
        "sourceSha": source,
        "planSha256": plan_sha,
        "capSnapshot": cap_snapshot(source),
        "globalHoldDigest": before["holdDigest"],
        "signedGets": 3,
        "ordersEnabled": False,
        "ordersSent": 0,
        "cancelsSent": 0,
        "positionChangesSent": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--plan-sha256", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight-readonly", action="store_true")
    mode.add_argument("--execute-approved", action="store_true")
    parser.add_argument("--run-id", default="manual")
    args = parser.parse_args()
    try:
        if args.preflight_readonly:
            result = preflight_report(args.source_sha, args.plan, args.plan_sha256)
        else:
            result = execute(args.source_sha, args.plan, args.plan_sha256, args.run_id)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as exc:
        print(json.dumps({
            "status": "STABLE4_DD30_GROSS_CAP_REPAIR_BLOCKED",
            "reason": safe_text(exc),
            "ordersEnabled": False,
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
        }, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

