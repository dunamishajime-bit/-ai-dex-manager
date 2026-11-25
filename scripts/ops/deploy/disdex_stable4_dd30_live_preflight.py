#!/usr/bin/env python3
"""Read-only STABLE4 DD30 all-runner LIVE gate.

This gate deliberately performs no deployment, permit installation, systemd
restart, Kill Switch edit, STOP edit, order, cancellation, or position change.
It is the mandatory discriminator before any exact-SHA Owner order approval can
be redeemed.  A later executor must use the same plan and re-run every check
under the redeemed token; this module never treats monitor-only approval as
LIVE authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

BASE = Path("/home/deploy/disdex-trading/releases")
PINS = Path("/etc/disdex/runner-pins.json")
HOLD = Path("/var/lib/disdex/shared/kill-switch.json")
RISK = Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
H48_ROOT = Path("/etc/disdex/stable4/h48-time-only")
H48_ISSUANCE = Path("/var/lib/disdex/unified-deploy/h48-owner-policy-issuance")
REPO = "dunamishajime-bit/-ai-dex-manager"
TARGET = "professional-dismanager.net"
RUNNERS = (
    "V12_V4", "PENGU_V8", "QUALITY102_CAUSAL_V1", "V52",
    "FET_BRK48_RESIDUAL", "HYPE_TREND_LONG", "IDLE_PRIORITY_SHORT",
)
PREFIX = {
    "V12_V4": "disdex-v12-v4@",
    "PENGU_V8": "disdex-pengu-dual-ls-v2@",
    "QUALITY102_CAUSAL_V1": "disdex-quality102-causal-v1@",
    "V52": "disdex-v52-aster-only@",
    "FET_BRK48_RESIDUAL": "disdex-fet-brk48@",
    "HYPE_TREND_LONG": "disdex-hype-long@",
    "IDLE_PRIORITY_SHORT": "disdex-idle-priority-short@",
}
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PLAN_RE = re.compile(r"^[0-9a-f]{64}$")
CAP_KEYS = ("CRYPTO_GROSS_CAP", "STOCK_GROSS_CAP", "TOTAL_GROSS_CAP",
            "DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT")
EXPECTED_CAPS = {
    "CRYPTO_GROSS_CAP": 3.0,
    "STOCK_GROSS_CAP": 1.5,
    "TOTAL_GROSS_CAP": 3.5,
    "DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT": 7.5,
}

class GateError(RuntimeError):
    pass

def require(ok: bool, reason: str) -> None:
    if not ok:
        raise GateError(reason)

def safe_text(value: object) -> str:
    text = " ".join(str(value or "").split())
    text = re.sub(r"(?i)(token|secret|password|authorization|bearer|api[_-]?key|credential)[^ ]*", r"\1=<redacted>", text)
    return re.sub(r"[^A-Za-z0-9_@%+.,:;/=()\- ]", "?", text)[:220]

def run(*argv: str, timeout: int = 60) -> str:
    p = subprocess.run(list(argv), capture_output=True, text=True, timeout=timeout)
    require(p.returncode == 0, "COMMAND_FAILED:" + safe_text(" ".join(argv)) + ":" + safe_text(p.stderr))
    return p.stdout.strip()

def regular(path: Path, max_bytes: int = 2_000_000) -> bytes:
    require(path.is_file() and not path.is_symlink(), "FILE_INVALID:" + str(path))
    data = path.read_bytes()
    require(len(data) <= max_bytes, "FILE_TOO_LARGE:" + str(path))
    return data

def json_file(path: Path) -> tuple[dict, bytes]:
    raw = regular(path)
    try:
        value = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise GateError("JSON_INVALID:" + str(path)) from exc
    require(isinstance(value, dict), "JSON_OBJECT_REQUIRED:" + str(path))
    return value, raw

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def load_plan(path: Path, plan_sha: str) -> dict:
    require(PLAN_RE.fullmatch(plan_sha) is not None, "PLAN_SHA_INVALID")
    raw = regular(path, 256_000)
    require(sha256(raw) == plan_sha, "PLAN_SHA_MISMATCH")
    value, _ = json_file(path)
    require(value.get("schema") == "disdex-stable4-dd30-allrunner-live-order-enable-plan/v1", "PLAN_SCHEMA_INVALID")
    require(value.get("repository") == REPO and value.get("deploymentTarget") == TARGET, "PLAN_TARGET_INVALID")
    require(value.get("operation") == "STABLE4_DD30_ALLRUNNERS_LIVE_ORDER_ENABLE"
            and value.get("scope") == "STABLE4_DD30_ALLRUNNERS"
            and value.get("ordersEnabled") is True, "PLAN_PERMISSION_INVALID")
    require(tuple(value.get("runnerSet") or ()) == RUNNERS, "PLAN_RUNNER_SET_INVALID")
    econ = value.get("economics") or {}
    require(econ.get("v4NewEntryDrawdownHoldPct") == 30
            and econ.get("penguDrawdownProtectionPct") == 17
            and econ.get("sharedCryptoDailyLossPct") == 7.5, "PLAN_DD_RISK_INVALID")
    require(econ.get("grossCaps") == {"crypto": 3.0, "stock": 1.5, "total": 3.5, "hype": 1.0}, "PLAN_GROSS_INVALID")
    hold = value.get("globalHold") or {}
    require(hold.get("required") is True and hold.get("active") is True
            and hold.get("action") == "HOLD_PROTECTED" and hold.get("scope") == "GLOBAL"
            and hold.get("mustRemainByteIdentical") is True
            and hold.get("clearGlobalHold") is False, "PLAN_HOLD_INVALID")
    venue = value.get("venuePreflight") or {}
    require(venue.get("signedAsterGets") == 3
            and venue.get("requireFlatPositions") is True
            and venue.get("requireNoOpenOrders") is True
            and all(venue.get(k) == 0 for k in ("ordersSent", "cancelsSent", "positionChangesSent")),
            "PLAN_VENUE_INVALID")
    safety = value.get("safety") or {}
    require(all(safety.get(k) is True for k in (
        "failClosed", "preserveExistingStops", "preserveSharedRiskSingleton",
        "preserveMarginGuard", "noTestOrders", "noManualKillSwitchClear",
        "noRunnerCrossAuthorization", "rollbackOnAnyPostconditionFailure")), "PLAN_SAFETY_INVALID")
    return value

def systemd_value(unit: str, key: str) -> str:
    return run("systemctl", "show", unit, "--property=" + key, "--value", timeout=30)

def unit_for(runner: str, source: str) -> str:
    return PREFIX[runner] + source + ".service"

def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file() or path.is_symlink():
        return values
    for raw in path.read_text(encoding="utf-8", errors="strict").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values

def effective_caps(unit: str) -> dict[str, float]:
    # systemd exposes EnvironmentFiles without secret values.  Only the four
    # allow-listed numeric cap keys are parsed; no credential is logged.
    paths = []
    for token in systemd_value(unit, "EnvironmentFiles").split():
        path = token.split("(", 1)[0]
        if path.startswith("/"):
            paths.append(Path(path))
    merged: dict[str, str] = {}
    for path in paths:
        merged.update(parse_env_file(path))
    explicit = systemd_value(unit, "Environment")
    for token in explicit.split():
        if "=" in token:
            key, value = token.split("=", 1)
            if key in CAP_KEYS:
                merged[key] = value
    result: dict[str, float] = {}
    for key in CAP_KEYS:
        try:
            result[key] = float(merged[key])
        except (KeyError, TypeError, ValueError):
            raise GateError("GROSS_CAP_MISSING:" + key) from None
    return result

def validate_pins(source: str) -> dict:
    pins, _ = json_file(PINS)
    require(pins.get("target") == TARGET and isinstance(pins.get("runners"), dict), "PINS_INVALID")
    rows = pins["runners"]
    for runner in RUNNERS:
        row = rows.get(runner)
        require(isinstance(row, dict), "PIN_MISSING:" + runner)
        require(row.get("sha") == source, "PIN_SHA_MISMATCH:" + runner)
        require(row.get("serviceUnit") == unit_for(runner, source), "PIN_UNIT_MISMATCH:" + runner)
        require(row.get("releaseRoot") == str(BASE / source), "PIN_ROOT_MISMATCH:" + runner)
    return rows

def validate_units(source: str) -> dict[str, dict[str, str]]:
    result = {}
    for runner in RUNNERS:
        unit = unit_for(runner, source)
        require(systemd_value(unit, "ActiveState") == "active", "RUNNER_NOT_ACTIVE:" + runner)
        require(systemd_value(unit, "SubState") == "running", "RUNNER_NOT_RUNNING:" + runner)
        pid = systemd_value(unit, "MainPID")
        require(pid.isdigit() and int(pid) > 100, "RUNNER_PID_INVALID:" + runner)
        restarts = systemd_value(unit, "NRestarts")
        require(restarts.isdigit(), "RUNNER_RESTART_COUNT_INVALID:" + runner)
        result[runner] = {"unit": unit, "pid": pid, "restarts": restarts}
    return result

def validate_caps(source: str) -> dict[str, dict[str, float]]:
    rows = {}
    for runner in RUNNERS:
        values = effective_caps(unit_for(runner, source))
        for key, expected in EXPECTED_CAPS.items():
            require(math.isfinite(values[key]) and abs(values[key] - expected) < 1e-9,
                    "GROSS_CAP_MISMATCH:" + runner + ":" + key)
        rows[runner] = values
    return rows

def validate_hold() -> tuple[dict, bytes, str]:
    value, raw = json_file(HOLD)
    require(value.get("active") is True and value.get("action") == "HOLD_PROTECTED"
            and value.get("scope") == "GLOBAL", "GLOBAL_HOLD_NOT_PROTECTED")
    st = HOLD.stat()
    require(st.st_uid in (0, 1000) and (st.st_mode & 0o022) == 0, "GLOBAL_HOLD_METADATA_INVALID")
    return value, raw, sha256(raw)

def validate_shared() -> None:
    risk, _ = json_file(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is False, "SHARED_RISK_NOT_HEALTHY")
    require(abs(float(risk.get("maximumLossPct")) - 7.5) < 1e-9, "SHARED_RISK_LIMIT_MISMATCH")
    updated = risk.get("updatedAt")
    now = int(time.time() * 1000)
    require(type(updated) in (int, float) and -1000 <= now - updated <= 15 * 60_000, "SHARED_RISK_STALE")
    margin, _ = json_file(MARGIN)
    require(margin.get("stage") == "HEALTHY" and margin.get("ordersAllowed") is True, "MARGIN_GUARD_NOT_HEALTHY")
    checked = margin.get("checkedAt")
    require(type(checked) in (int, float) and -1000 <= now - checked <= 15 * 60_000, "MARGIN_GUARD_STALE")
    pending, _ = json_file(PENDING)
    entries = pending.get("entries")
    require(isinstance(entries, list) and not any(str(e.get("status", "")).upper() != "RELEASED" for e in entries), "PENDING_EXPOSURE_ACTIVE")

def signed_get(source: str) -> tuple[str, int, int, str]:
    release = BASE / source
    require(release.is_dir() and not release.is_symlink(), "RELEASE_NOT_INSTALLED")
    command = (
        'set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env '
        '/etc/disdex/disdex-v12-pengu-v2-v52.env /etc/disdex/disdex-v12-v4.env; do . "$f"; done; set +a; '
        "exec /usr/bin/node " + str(release / "node_modules/tsx/dist/cli.mjs") +
        " scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    p = subprocess.run(["/bin/bash", "-c", command], cwd=release, capture_output=True, text=True, timeout=65)
    require(p.returncode == 0, "SIGNED_ASTER_GET_FAILED")
    rows = [line for line in p.stdout.splitlines() if line.startswith("{")]
    require(rows, "SIGNED_ASTER_GET_EMPTY")
    value = json.loads(rows[-1])
    require(value.get("status") == "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS", "SIGNED_ASTER_GET_NOT_PASS")
    require(all(value.get(k) == 0 for k in ("ordersSent", "cancelsSent", "positionChangesSent")), "SIGNED_GET_MUTATION")
    positions, orders = value.get("positions"), value.get("openOrders")
    require(isinstance(positions, list) and isinstance(orders, list)
            and len(positions) == 0 and len(orders) == 0, "VENUE_NOT_FLAT")
    stamp = str(value.get("observedAt") or value.get("venueTime") or "")
    require(stamp, "SIGNED_GET_TIMESTAMP_MISSING")
    return stamp, len(positions), len(orders), sha256(json.dumps({"positions": positions, "openOrders": orders}, sort_keys=True, separators=(",", ":")).encode())

def validate_hype_h48(source: str) -> dict[str, str]:
    cert = H48_ROOT / (source + ".json")
    issuance = H48_ISSUANCE / (source + ".json")
    permit = H48_ROOT / (source + ".order-enable.json")
    require(cert.is_file() and not cert.is_symlink(), "H48_CERTIFICATE_MISSING")
    require(issuance.is_file() and not issuance.is_symlink(), "H48_ISSUANCE_RECEIPT_MISSING")
    require(permit.is_file() and not permit.is_symlink(), "H48_ORDER_PERMIT_MISSING")
    for path in (cert, issuance, permit):
        st = path.stat()
        require(st.st_uid == 0 and (st.st_mode & 0o222) == 0, "H48_ARTIFACT_NOT_IMMUTABLE")
    return {"certificateSha256": sha256(cert.read_bytes()), "permitSha256": sha256(permit.read_bytes())}

def require_stable4_dd30_gross_source_consistency(plan: dict) -> None:
    """Reject authorization based on mismatched STABLE4 economic lineage.

    The original DD30 monitor cutover source and approved monitor plan enforce
    Crypto3 / Stock4 / Total4.25.  The integrated HYPE Long source has a 1.5
    sleeve cap, distinct from the ZEC research sidecar cap of 1.0.  This gate
    does not authorize a return to these caps; it blocks the inconsistent
    orders-enabled plan until a separately reviewed candidate, strategy
    allocation matrix, and signed Owner plan are prepared.
    """
    gross = (plan.get("economics") or {}).get("grossCaps") or {}
    expected = {"crypto": 3.0, "stock": 4.0, "total": 4.25, "hype": 1.5}
    require(gross == expected, "STABLE4_DD30_GROSS_LINEAGE_MISMATCH")


def preflight(source: str, plan_path: Path, plan_sha: str) -> dict:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    plan = load_plan(plan_path, plan_sha)
    require_stable4_dd30_gross_source_consistency(plan)
    require(SHA_RE.fullmatch(source) is not None, "SOURCE_SHA_INVALID")
    release_marker = BASE / source / ".disdex-release-sha"
    require(release_marker.is_file() and release_marker.read_text(encoding="utf-8").strip() == source, "RELEASE_MARKER_INVALID")
    validate_pins(source)
    units = validate_units(source)
    caps = validate_caps(source)
    hold, hold_raw, hold_digest = validate_hold()
    validate_shared()
    reads = [signed_get(source) for _ in range(3)]
    hype = validate_hype_h48(source)
    require(len({row[0] for row in reads}) == 3, "SIGNED_GET_TIMESTAMPS_NOT_UNIQUE")
    return {
        "status": "STABLE4_DD30_ALLRUNNERS_LIVE_PREFLIGHT_PASS",
        "sourceSha": source,
        "planSha256": plan_sha,
        "runnerCount": len(RUNNERS),
        "runners": units,
        "effectiveGrossCaps": caps,
        "globalHoldDigest": hold_digest,
        "globalHoldActive": bool(hold.get("active")),
        "signedGets": 3,
        "venue": {"positions": reads[-1][1], "openOrders": reads[-1][2], "inventoryDigest": reads[-1][3]},
        "hypeH48": hype,
        "ordersEnabled": True,
        "ordersSent": 0,
        "cancelsSent": 0,
        "positionChangesSent": 0,
    }

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--plan-sha256", required=True)
    parser.add_argument("--preflight-readonly", action="store_true", required=True)
    args = parser.parse_args()
    try:
        result = preflight(args.source_sha, args.plan, args.plan_sha256)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "STABLE4_DD30_ALLRUNNERS_LIVE_PREFLIGHT_BLOCKED",
                          "reason": safe_text(exc), "ordersSent": 0, "cancelsSent": 0,
                          "positionChangesSent": 0}, sort_keys=True), file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
