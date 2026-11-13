#!/usr/bin/env python3
"""Recover the currently pinned stopped DisDex runners under explicit Production approval.

This helper starts only the exact pinned PENGU, HYPE and IDLE systemd units after
fresh flat-account, shared-risk, margin, pending-exposure, durable-ledger and
operator-activation checks.  It never creates a test order, never calls venue
order/cancel APIs, never changes a STOP, Kill Switch, risk limit, strategy file,
operator activation or runner pin.  Once started, the normal certified LIVE
runners may place natural strategy orders.
"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
import re
import subprocess
import sys
import time

BASE = Path("/home/deploy/disdex-trading/releases")
PINS = Path("/etc/disdex/runner-pins.json")
KILL = Path("/var/lib/disdex/shared/kill-switch.json")
RISK = Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
V4_STORE = Path("/var/lib/disdex/v12-v4/orders.json")
V4_HEARTBEAT = Path("/var/lib/disdex/v12-v4/heartbeat.json")

V4_SHA = "3ad65403013b701db5d9e53e8814e6ab827a28e8"
PENGU_SHA = "1657e173d250ad58f53e62f7bb0a3428fb405496"
HYPE_SHA = "d6bcc94512a6416189cd92d7203b9ac3b2c98e70"
IDLE_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"
Q102_SHA = "ef1ab178e26a7bf5bddb6473467765edba242e1d"
V52_SHA = "8495daf24e53a6cf0dd5e38f022008fa8f78c688"
FET_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"
RISK_SHA = "2737c30e1f6d014d24a2c6d025e7f91332bf7962"
MARGIN_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"

EXPECTED = {
    "PENGU_V8": {
        "sha": PENGU_SHA,
        "unit": f"disdex-pengu-dual-ls-v2@{PENGU_SHA}.service",
        "activation": Path(f"/var/lib/disdex/shared/operator-activation/pengu-{PENGU_SHA}.json"),
    },
    "HYPE_TREND_LONG": {
        "sha": HYPE_SHA,
        "unit": f"disdex-hype-long@{HYPE_SHA}.service",
        "activation": Path(f"/var/lib/disdex/shared/operator-activation/hype-{HYPE_SHA}.json"),
    },
    "IDLE_PRIORITY_SHORT": {
        "sha": IDLE_SHA,
        "unit": f"disdex-idle-priority-short@{IDLE_SHA}.service",
        "activation": Path("/var/lib/disdex/shared/operator-activation/current.json"),
    },
}
START_ORDER = ("PENGU_V8", "HYPE_TREND_LONG", "IDLE_PRIORITY_SHORT")

REQUIRED_ACTIVE = {
    "V12_V4": f"disdex-v12-v4@{V4_SHA}.service",
    "QUALITY102_CAUSAL_V1": f"disdex-quality102-causal-v1@{Q102_SHA}.service",
    "V52": f"disdex-v52-aster-only@{V52_SHA}.service",
    "FET_BRK48_RESIDUAL": f"disdex-fet-brk48@{FET_SHA}.service",
    "SHARED_CRYPTO_RISK": f"disdex-shared-crypto-risk@{RISK_SHA}.service",
    "MARGIN_GUARD": f"disdex-v12-v52-margin-guard@{MARGIN_SHA}.service",
}

def require(ok: bool, reason: str) -> None:
    if not ok:
        raise RuntimeError(reason)

def json_file(path: Path) -> dict:
    require(path.is_file() and not path.is_symlink(), "STATE_FILE_INVALID:" + str(path))
    value = json.loads(path.read_text())
    require(isinstance(value, dict), "STATE_NOT_OBJECT:" + str(path))
    return value

def prop(unit: str, key: str) -> str:
    p = subprocess.run(
        ["systemctl", "show", unit, f"--property={key}", "--value"],
        capture_output=True, text=True, timeout=15,
    )
    require(p.returncode == 0, "SYSTEMD_PROPERTY_FAILED:" + unit + ":" + key)
    return p.stdout.strip()

def active(unit: str) -> bool:
    return prop(unit, "ActiveState") == "active"

def validate_pins() -> None:
    doc = json_file(PINS)
    require(doc.get("schema") == "disdex-runner-pin-manifest/v1", "PIN_SCHEMA_MISMATCH")
    runners = doc.get("runners")
    require(isinstance(runners, dict), "PIN_RUNNERS_INVALID")
    expected_all = {
        "V12_V4": (V4_SHA, REQUIRED_ACTIVE["V12_V4"]),
        "PENGU_V8": (PENGU_SHA, EXPECTED["PENGU_V8"]["unit"]),
        "HYPE_TREND_LONG": (HYPE_SHA, EXPECTED["HYPE_TREND_LONG"]["unit"]),
        "IDLE_PRIORITY_SHORT": (IDLE_SHA, EXPECTED["IDLE_PRIORITY_SHORT"]["unit"]),
        "QUALITY102_CAUSAL_V1": (Q102_SHA, REQUIRED_ACTIVE["QUALITY102_CAUSAL_V1"]),
        "V52": (V52_SHA, REQUIRED_ACTIVE["V52"]),
        "FET_BRK48_RESIDUAL": (FET_SHA, REQUIRED_ACTIVE["FET_BRK48_RESIDUAL"]),
        "SHARED_CRYPTO_RISK": (RISK_SHA, REQUIRED_ACTIVE["SHARED_CRYPTO_RISK"]),
        "MARGIN_GUARD": (MARGIN_SHA, REQUIRED_ACTIVE["MARGIN_GUARD"]),
    }
    for key, (sha, unit) in expected_all.items():
        row = runners.get(key)
        require(isinstance(row, dict), "PIN_MISSING:" + key)
        require(row.get("sha") == sha and row.get("serviceUnit") == unit, "PIN_MISMATCH:" + key)
        marker = BASE / sha / ".disdex-release-sha"
        require(marker.is_file() and marker.read_text().strip() == sha, "RELEASE_MARKER_MISMATCH:" + key)

def shared_health(require_pending_flat: bool) -> None:
    now = int(time.time() * 1000)
    kill = json_file(KILL)
    require(kill.get("active") is False, "SHARED_KILL_SWITCH_ACTIVE")

    risk = json_file(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is False, "SHARED_RISK_NOT_HEALTHY")
    require(risk.get("utcDay") == datetime.fromtimestamp(now / 1000, timezone.utc).date().isoformat(),
            "SHARED_RISK_WRONG_UTC_DAY")
    updated = risk.get("updatedAt")
    require(type(updated) is int and -1000 <= now - updated <= 15 * 60_000, "SHARED_RISK_STALE")
    limit = risk.get("maximumLossPct")
    require(not isinstance(limit, bool) and math.isfinite(float(limit)) and abs(float(limit) - 7.5) < 1e-9,
            "SHARED_RISK_LIMIT_MISMATCH")

    margin = json_file(MARGIN)
    require(margin.get("stage") == "HEALTHY" and margin.get("ordersAllowed") is True,
            "MARGIN_GUARD_NOT_HEALTHY")
    checked = margin.get("checkedAt")
    require(type(checked) is int and -1000 <= now - checked <= 15 * 60_000, "MARGIN_GUARD_STALE")

    pending = json_file(PENDING)
    updated = pending.get("updatedAt")
    require(type(updated) is int and -1000 <= now - updated <= 5 * 60_000, "PENDING_EXPOSURE_STALE")
    entries = pending.get("entries")
    require(isinstance(entries, list) and all(isinstance(row, dict) for row in entries),
            "PENDING_EXPOSURE_INVALID")
    if require_pending_flat:
        require(not any(str(row.get("status", "")).upper() != "RELEASED" for row in entries),
                "PENDING_EXPOSURE_ACTIVE")

    for key, unit in REQUIRED_ACTIVE.items():
        require(active(unit), "REQUIRED_PEER_NOT_ACTIVE:" + key)

def durable_flat() -> None:
    doc = json_file(V4_STORE)
    require(doc.get("releaseSha") == V4_SHA, "V4_STORE_SHA_MISMATCH")
    state = doc.get("state")
    require(isinstance(state, dict), "V4_STORE_STATE_INVALID")
    require(state.get("foreign") == [], "V4_FOREIGN_EXPOSURE_PRESENT")
    require(state.get("executionReview") is None, "V4_EXECUTION_REVIEW_ACTIVE")
    initial = state.get("initial") or {}
    require(initial.get("holdProtected") is False, "V4_HOLD_PROTECTED_ACTIVE")
    legs = state.get("legs")
    require(isinstance(legs, dict), "V4_LEGS_INVALID")
    for leg_id, leg in legs.items():
        require(isinstance(leg, dict), "V4_LEG_INVALID:" + str(leg_id))
        qty = float(leg.get("qty") or 0)
        require(abs(qty) < 1e-12, "V4_DURABLE_NONZERO_QTY:" + str(leg_id))
        require(str(leg.get("status")) in {"CLOSED", "CANCELLED"}, "V4_DURABLE_OPEN_LEG:" + str(leg_id))
    xrp = legs.get("XRPUSDT:REC_X06_TIME_12H:SHORT:1794067200000")
    require(isinstance(xrp, dict) and xrp.get("status") == "CLOSED", "XRP_DURABLE_CLOSE_MISSING")

def activation_ready(name: str) -> None:
    spec = EXPECTED[name]
    root = BASE / spec["sha"]
    gate = root / "scripts/ops/root/disdex-live-operator-activation-gate.mjs"
    require(gate.is_file(), "ACTIVATION_GATE_MISSING:" + name)
    p = subprocess.run(
        [
            "/usr/bin/node", str(gate),
            "--release-root", str(root),
            "--sha", spec["sha"],
            "--runner", name,
            "--activation-path", str(spec["activation"]),
        ],
        capture_output=True, text=True, timeout=30,
    )
    require(p.returncode == 0, "OPERATOR_ACTIVATION_BLOCKED:" + name + ":" + (p.stderr or p.stdout)[-220:])
    rows = [line for line in p.stdout.splitlines() if line.startswith("{")]
    require(rows, "ACTIVATION_GATE_EMPTY:" + name)
    value = json.loads(rows[-1])
    require(value.get("allowed") is True and value.get("status") == "OPERATOR_ACTIVATION_READY",
            "ACTIVATION_NOT_READY:" + name)

def signed_account_diagnostic(require_flat: bool) -> dict:
    release = BASE / V4_SHA
    command = (
        "set -ae; for f in "
        "/etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env "
        "/etc/disdex/disdex-v12-v4.env "
        f"/etc/disdex/current-runtime/{V4_SHA}.env; do . \"$f\"; done; set +a; "
        "export DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=/var/lib/disdex/shared/aster-rate-budget.json; "
        f"cd {release}; "
        f"exec /usr/sbin/runuser -u deploy --preserve-environment -- /usr/bin/node "
        f"{release}/node_modules/tsx/dist/cli.mjs scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    last = ""
    for attempt in range(6):
        p = subprocess.run(["/bin/bash", "-c", command], capture_output=True, text=True, timeout=55)
        text = (p.stdout or "") + "\n" + (p.stderr or "")
        last = text[-1000:]
        if p.returncode == 0:
            rows = [line for line in p.stdout.splitlines() if line.startswith("{")]
            require(rows, "ASTER_SIGNED_GET_EMPTY")
            value = json.loads(rows[-1])
            require(value.get("status") == "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
                    "ASTER_SIGNED_GET_NOT_PASS")
            require(all(value.get(k) == 0 for k in ("ordersSent", "cancelsSent", "positionChangesSent")),
                    "ASTER_DIAGNOSTIC_NOT_READ_ONLY")
            positions = value.get("positions")
            orders = value.get("openOrders")
            require(isinstance(positions, list) and isinstance(orders, list), "ASTER_SIGNED_GET_SHAPE_INVALID")
            if require_flat:
                require(len(positions) == 0 and len(orders) == 0, "ASTER_ACCOUNT_NOT_FLAT")
            return {
                "observedAt": value.get("observedAt"),
                "positions": len(positions),
                "openOrders": len(orders),
            }
        m = re.search(r"ASTER_GLOBAL_RATE_BUDGET_SATURATED:(\d+)", text)
        lock = "ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT" in text
        if attempt == 5 or (not m and not lock):
            break
        wait_ms = max(750, int(m.group(1)) if m else 1500)
        time.sleep(min(6.0, wait_ms / 1000.0))
    raise RuntimeError("ASTER_SIGNED_GET_FAILED:" + last.replace("\n", " ")[:300])

def start_exact(name: str) -> tuple[int, bool]:
    unit = EXPECTED[name]["unit"]
    if active(unit):
        pid = int(prop(unit, "MainPID") or "0")
        require(pid > 100, "ACTIVE_RUNNER_PID_INVALID:" + name)
        return pid, True
    p = subprocess.run(["systemctl", "start", unit], capture_output=True, text=True, timeout=75)
    require(p.returncode == 0, "SYSTEMD_START_FAILED:" + name + ":" + (p.stderr or p.stdout)[-220:])
    deadline = time.time() + 25
    while time.time() < deadline:
        if active(unit):
            pid = int(prop(unit, "MainPID") or "0")
            if pid > 100:
                return pid, False
        time.sleep(1)
    raise RuntimeError("RUNNER_DID_NOT_STAY_ACTIVE:" + name)

def wait_v4_unblocked() -> dict:
    deadline = time.time() + 120
    last = {}
    while time.time() < deadline:
        last = json_file(V4_HEARTBEAT)
        if (
            last.get("releaseSha") == V4_SHA
            and last.get("processAlive") is True
            and last.get("safetyState") != "BLOCKED"
            and last.get("status") != "blocked"
            and last.get("orderEnabled") is True
            and last.get("ordersAllowed") is True
        ):
            return last
        time.sleep(3)
    raise RuntimeError("V4_DID_NOT_UNBLOCK:" + str(last.get("reason", ""))[:260])

def main(run_id: str) -> None:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require(run_id.isdecimal() and len(run_id) < 21, "RUN_ID_INVALID")

    validate_pins()
    shared_health(require_pending_flat=True)
    durable_flat()
    before = signed_account_diagnostic(require_flat=True)
    for name in START_ORDER:
        activation_ready(name)

    started = {}
    for name in START_ORDER:
        pid, already = start_exact(name)
        started[name] = {"pid": pid, "alreadyActive": already}

    time.sleep(5)
    for name in START_ORDER:
        require(active(EXPECTED[name]["unit"]), "RUNNER_NOT_ACTIVE_POSTSTART:" + name)

    v4 = wait_v4_unblocked()
    shared_health(require_pending_flat=False)
    after = signed_account_diagnostic(require_flat=False)

    print(json.dumps({
        "status": "DISDEX_STOPPED_RUNNER_LIVE_RECOVERY_PASS",
        "runId": run_id,
        "started": started,
        "v4SafetyState": v4.get("safetyState"),
        "v4Status": v4.get("status"),
        "v4OrderEnabled": v4.get("orderEnabled"),
        "v4OrdersAllowed": v4.get("ordersAllowed"),
        "signedBefore": before,
        "signedAfter": after,
        "testOrdersSent": 0,
        "forcedOrdersSent": 0,
        "stopChangesByHelper": 0,
        "killSwitchChangesByHelper": 0,
        "activationChangesByHelper": 0,
    }, sort_keys=True))

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    try:
        main(args.run_id)
    except Exception as exc:
        print("DISDEX_STOPPED_RUNNER_LIVE_RECOVERY=BLOCKED:" + type(exc).__name__ + ":" + str(exc)[:400],
              file=sys.stderr)
        raise
