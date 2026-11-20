#!/usr/bin/env python3
"""Owner-reviewed, single-target V52 f333 peer-SHA hotfix switch. No test orders or risk override.

This procedure switches ONLY the two exact V52 service identities while the
shared Kill Switch is already active. It never clears HOLD or touches STOPs.
All failures after stopping old V52 attempt immediate rollback of the pin
and old service. Run via reviewed GitHub Action, never a cron/scheduled job.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

PROD = "7688ed7c93a1918d8b44837339b7da5584a868f5"
OLD = "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
NEW = "f33301be4805969333a5c580feaa38b72f825236"
V4 = "53a0be396719f0284af4e11b35c66a4ac7d58f79"
BASE = Path("/home/deploy/disdex-trading/releases")
OLD_UNIT = f"disdex-v52-aster-only@{OLD}.service"
NEW_UNIT = f"disdex-v52-aster-only@{NEW}.service"
PIN = Path("/etc/disdex/current-runtime/v52-current.env")
RUNNER_PINS = Path("/etc/disdex/runner-pins.json")
CURRENT_PLAN = Path("/var/lib/disdex/unified-deploy/current-plan.json")
APPROVAL = Path(f"/var/lib/disdex/shared/operator-activation/v52-{NEW}.json")
KILL = Path("/var/lib/disdex/shared/kill-switch.json")
RISK = Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
STATE = Path("/var/lib/disdex/v52-aster-only/runner-live.json")
BACKUP_DIR = Path("/var/backups/disdex-v52-owner-approved-cutover")
ACTIVATION = BASE / NEW / "scripts/ops/root/disdex-live-operator-activation-gate.mjs"
GUARD = BASE / NEW / "scripts/ops/root/disdex-fet-preemption-readiness-guard.py"
OLD_OVERRIDE = Path(f"/etc/disdex/current-runtime/{OLD}-v52-overrides.env")
NEW_OVERRIDE = Path(f"/etc/disdex/current-runtime/{NEW}-v52-overrides.env")
OLD_CADENCE = Path(f"/etc/disdex/current-runtime/{OLD}-market-closed-api-cadence.env")
NEW_CADENCE = Path(f"/etc/disdex/current-runtime/{NEW}-market-closed-api-cadence.env")
OLD_FRAGMENT = Path(f"/etc/systemd/system/{OLD_UNIT}")
NEW_FRAGMENT = Path(f"/etc/systemd/system/{NEW_UNIT}")
OLD_DROPIN_DIR = Path(f"/etc/systemd/system/{OLD_UNIT}.d")
NEW_DROPIN_DIR = Path(f"/etc/systemd/system/{NEW_UNIT}.d")
OLD_HOTFIX = OLD_DROPIN_DIR / "zzzzzzzzzzzzzzzz-v52-hotfix-4d33.conf"
NEW_HOTFIX = NEW_DROPIN_DIR / "zzzzzzzzzzzzzzzz-v52-hotfix-f333.conf"
OLD_CADENCE_DROPIN = OLD_DROPIN_DIR / "zzzzzzzzzzzzzzzzzzzzzz-market-closed-api-cadence.conf"
NEW_CADENCE_DROPIN = NEW_DROPIN_DIR / "zzzzzzzzzzzzzzzzzzzzzz-market-closed-api-cadence.conf"

def run(*argv: str, timeout: int = 35) -> str:
    process = subprocess.run(argv, text=True, capture_output=True, timeout=timeout)
    if process.returncode:
        raise RuntimeError(f"COMMAND_FAILED:{argv[0]}:{process.returncode}")
    return process.stdout.strip()

def unit_property(unit: str, key: str) -> str:
    return run("systemctl", "show", unit, f"--property={key}", "--value")

def service_active(unit: str) -> bool:
    return unit_property(unit, "ActiveState") == "active"

def is_enabled(unit: str) -> bool:
    p = subprocess.run(["systemctl", "is-enabled", unit], capture_output=True, text=True, timeout=12)
    require(p.returncode in (0, 1) and p.stdout.strip() in ("enabled", "disabled", "indirect", "static"),
            "SERVICE_ENABLED_STATE_UNAVAILABLE")
    return p.stdout.strip() == "enabled"

def require(cond: bool, message: str) -> None:
    if not cond:
        raise RuntimeError(message)

def read_json(p: Path) -> dict:
    require(p.is_file() and not p.is_symlink(), "STATE_FILE_MISSING_OR_LINK:" + p.name)
    data = json.loads(p.read_text())
    require(isinstance(data, dict), "STATE_JSON_NOT_OBJECT:" + p.name)
    return data

def risk_snapshot(require_activation: bool = False) -> None:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require((BASE / PROD / ".disdex-release-sha").read_text().strip() == PROD, "PRODUCTION_RELEASE_INVALID")
    require(Path("/home/deploy/disdex-trading/current/.disdex-release-sha").read_text().strip() == PROD, "PRODUCTION_SHA_CHANGED")
    require((BASE / NEW / ".disdex-release-sha").read_text().strip() == NEW, "HOTFIX_RELEASE_SHA_INVALID")
    kill = read_json(KILL)
    require(kill.get("active") is True and kill.get("action") == "HOLD_PROTECTED", "SHARED_HOLD_MUST_BE_ACTIVE")
    require(kill.get("recoverable") is True
            and kill.get("operator") == "disdex-v52-aster-only"
            and str(kill.get("reason") or "") ==
                "V52 upstream state unavailable: QUALITY102_STATE_MISMATCH:runtimeCommitSha",
            "UNEXPECTED_HOLD_REASON")
    risk = read_json(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is False, "SHARED_RISK_NOT_HEALTHY")
    now = int(time.time() * 1000)
    risk_updated = risk.get("updatedAt")
    require(risk.get("utcDay") == datetime.fromtimestamp(now / 1000, timezone.utc).date().isoformat(),
            "SHARED_RISK_WRONG_UTC_DAY")
    require(type(risk_updated) in (int, float) and -1000 <= now - risk_updated <= 15 * 60_000,
            "SHARED_RISK_STALE")
    require(abs(float(risk.get("maximumLossPct")) - 7.5) < 1e-9,
            "SHARED_RISK_LIMIT_MISMATCH")
    margin = read_json(MARGIN)
    require(margin.get("stage") == "HEALTHY" and margin.get("ordersAllowed") is True, "MARGIN_GUARD_NOT_HEALTHY")
    checked = margin.get("checkedAt")
    require(type(checked) in (int, float) and -1000 <= now - checked <= 15 * 60_000,
            "MARGIN_GUARD_STALE")
    pending = read_json(PENDING)
    require(isinstance(pending.get("entries"), list) and not any(
        x.get("status") != "RELEASED" for x in pending["entries"]), "PENDING_EXPOSURE_ACTIVE")
    if require_activation:
        activation = read_json(APPROVAL)
        require(activation.get("approvedSha") == NEW and activation.get("ordersEnabled") is True
                and activation.get("operatorAcknowledgement") == "I_ACK_REAL_MONEY_LIVE_ACTIVATION"
                and activation.get("fetCorePreemptionReady") is True
                and {"V52", "FET_BRK48_RESIDUAL"}.issubset(activation.get("approvedRunners", [])),
                "OWNER_ACTIVATION_ARTIFACT_MISMATCH")
        result = json.loads(run("/usr/bin/node", str(ACTIVATION), "--release-root", str(BASE / NEW),
                              "--sha", NEW, "--runner", "V52", "--activation-path", str(APPROVAL)))
        require(result.get("status") == "OPERATOR_ACTIVATION_READY" and result.get("allowed") is True,
                "EXACT_OPERATOR_CERTIFICATION_BLOCKED")

        flags = {}
        for file in (Path(f"/etc/disdex/current-runtime/{PROD}.env"),
                     Path(f"/etc/disdex/current-runtime/{NEW}-v52-overrides.env")):
            require(file.is_file() and not file.is_symlink(), "DURABLE_RUNTIME_ENV_MISSING")
            for line in file.read_text().splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    if k in ("DISDEX_RUNTIME_COMMIT_SHA", "FET_BRK48_CORE_PREEMPTION_READY"):
                        flags[k] = v.strip()
        env = dict(os.environ, **flags)
        proc = subprocess.run(["/usr/bin/python3", str(GUARD), "--prestart", "--sha", NEW,
                               "--activation-path", str(APPROVAL)], capture_output=True,
                              text=True, env=env, timeout=25)
        require(proc.returncode == 0 and json.loads(proc.stdout).get("status") == "HEALTHY",
                "V52_FET_PRESTART_BLOCKED")

def normalize_inventory(d: dict) -> dict:
    positions = []
    raw_positions = d.get("positions")
    raw_orders = d.get("openOrders")
    require(isinstance(raw_positions, list) and isinstance(raw_orders, list),
            "SIGNED_GET_ARRAYS_INVALID")
    for row in raw_positions:
        require(isinstance(row, dict), "POSITION_NOT_OBJECT")
        require(type(row.get('positionAmt')) in (str,int,float), 'POSITION_AMT_INVALID')
        try:
            amount = float(row.get("positionAmt"))
        except (TypeError, ValueError):
            raise RuntimeError("POSITION_AMT_INVALID") from None
        require(math.isfinite(amount), 'POSITION_AMT_INVALID')
        if abs(amount) < 1e-15:
            continue
        positions.append({
            "symbol": str(row.get("symbol") or ""),
            "positionAmt": str(row.get("positionAmt") or ""),
            "positionSide": str(row.get("positionSide") or "BOTH"),
            "entryPrice": str(row.get("entryPrice") or ""),
        })
    orders = []
    for row in raw_orders:
        require(isinstance(row, dict), "ORDER_NOT_OBJECT")
        orders.append({
            "symbol": str(row.get("symbol") or ""),
            "orderId": str(row.get("orderId") or ""),
            "clientOrderId": str(row.get("clientOrderId") or ""),
            "status": str(row.get("status") or ""),
            "side": str(row.get("side") or ""),
            "positionSide": str(row.get("positionSide") or "BOTH"),
            "type": str(row.get("type") or ""),
            "reduceOnly": row.get("reduceOnly") is True,
            "closePosition": row.get("closePosition") is True,
            "origQty": str(row.get("origQty") or ""),
            "executedQty": str(row.get("executedQty") or ""),
            "stopPrice": str(row.get("stopPrice") or ""),
        })
    positions.sort(key=lambda x: (x["symbol"], x["positionSide"], x["positionAmt"]))
    orders.sort(key=lambda x: (x["symbol"], x["orderId"], x["clientOrderId"]))
    return {"positions": positions, "openOrders": orders}


def inventory_digest(value: dict) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return hashlib.sha256(raw).hexdigest()


def venue_get() -> tuple[str, dict, str]:
    # Read-only venue evidence must preserve whatever the account currently owns;
    # never assume a historical symbol, quantity, or STOP client id.
    expression = (
        "set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env /etc/disdex/disdex-v12-v4.env; "
        "do . \"$f\"; done; set +a; exec /usr/bin/node "
        + str(BASE / V4 / "node_modules/tsx/dist/cli.mjs")
        + " scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    p = subprocess.run(["/bin/bash", "-c", expression], cwd=BASE / V4,
                       text=True, capture_output=True, timeout=55)
    require(p.returncode == 0, "SIGNED_ASTER_GET_FAILED")
    rows = [line for line in p.stdout.splitlines() if line.startswith("{")]
    require(bool(rows), "SIGNED_ASTER_GET_EMPTY")
    d = json.loads(rows[-1])
    require(d.get("status") == "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
            "SIGNED_ASTER_STATUS_NOT_PASS")
    require(all(d.get(k) == 0 for k in ("ordersSent", "cancelsSent", "positionChangesSent")),
            "SIGNED_GET_NOT_READONLY")
    inventory = normalize_inventory(d)
    stamp = str(d.get("observedAt") or d.get("venueTime") or "")
    require(bool(stamp), "SIGNED_ASTER_TIMESTAMP_MISSING")
    return stamp, inventory, inventory_digest(inventory)


def candidate_preflight_readonly() -> dict:
    release = BASE / NEW
    require(release.is_dir() and not release.is_symlink(), "CANDIDATE_RELEASE_MISSING")
    marker = release / ".disdex-release-sha"
    require(marker.is_file() and not marker.is_symlink()
            and marker.read_text().strip() == NEW, "CANDIDATE_RELEASE_MARKER_INVALID")
    expression = (
        "set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env "
        "/etc/disdex/disdex-v52-formal-approval.env "
        f"/etc/disdex/current-runtime/{PROD}.env "
        f"/etc/disdex/current-runtime/{OLD}-v52-overrides.env "
        f"/etc/disdex/current-runtime/{OLD}-market-closed-api-cadence.env; "
        "do . \"$f\"; done; "
        f"export DISDEX_RELEASE_SHA={NEW} DISDEX_RUNTIME_SHA={NEW} "
        f"DISDEX_RUNTIME_COMMIT_SHA={NEW} DISDEX_RELEASE_ROOT={release}; "
        "export PYTHONPATH=/home/deploy/dis-dex-manager/.venv-stock/lib/python3.12/site-packages; "
        "set +a; exec /usr/sbin/runuser -u deploy --preserve-environment -- "
        f"{release}/.venv2/bin/python scripts/disdex_v52_aster_only_live_engine.py "
        "--mode live --preflight-readonly"
    )
    p = subprocess.run(["/bin/bash", "-c", expression], cwd=release,
                       text=True, capture_output=True, timeout=90)
    require(p.returncode == 0, "CANDIDATE_READONLY_PREFLIGHT_FAILED:" + (p.stderr or p.stdout)[-240:])
    rows = [line for line in p.stdout.splitlines() if line.startswith("{")]
    require(bool(rows), "CANDIDATE_READONLY_PREFLIGHT_EMPTY")
    value = json.loads(rows[-1])
    require(value.get("readOnly") is True and value.get("ordersSent") in (False, 0),
            "CANDIDATE_READONLY_PREFLIGHT_CONTRACT_INVALID")
    return value

def pinned() -> tuple[bytes, int, int, int]:
    require(PIN.is_file() and not PIN.is_symlink(), "V52_PIN_NOT_REGULAR_FILE")
    st = PIN.stat()
    require(st.st_uid == 0 and st.st_mode & 0o022 == 0, "V52_PIN_PERMISSIONS_INVALID")
    data = PIN.read_bytes()
    lines = data.decode("utf-8").splitlines()
    require(lines.count(f"DISDEX_V52_RUNTIME_SHA={OLD}") == 1, "OLD_V52_SHA_PIN_CHANGED")
    require(lines.count(f"DISDEX_V52_RUNTIME_ROOT={BASE / OLD}") == 1, "OLD_V52_ROOT_PIN_CHANGED")
    require(sum(x.startswith("DISDEX_V52_RUNTIME_SHA=") for x in lines) == 1
            and sum(x.startswith("DISDEX_V52_RUNTIME_ROOT=") for x in lines) == 1,
            "V52_PIN_DUPLICATE_KEYS")
    return data, st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode)

def atomic_pin(data: bytes, uid: int, gid: int, mode: int) -> None:
    fd, tmp = tempfile.mkstemp(dir=PIN.parent, prefix=".v52-approved-cutover-")
    try:
        with os.fdopen(fd, "wb") as f:
            os.fchmod(f.fileno(), mode)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chown(tmp, uid, gid)
        os.replace(tmp, PIN)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def new_pin(old: bytes) -> bytes:
    text = old.decode("utf-8")
    text = text.replace(f"DISDEX_V52_RUNTIME_SHA={OLD}", f"DISDEX_V52_RUNTIME_SHA={NEW}")
    text = text.replace(f"DISDEX_V52_RUNTIME_ROOT={BASE / OLD}", f"DISDEX_V52_RUNTIME_ROOT={BASE / NEW}")
    return text.encode()


def root_metadata_baseline() -> tuple[bytes, int, bytes, int]:
    for path in (RUNNER_PINS, CURRENT_PLAN):
        require(path.is_file() and not path.is_symlink(), "ROOT_METADATA_INVALID:" + path.name)
        st = path.stat()
        require(st.st_uid == 0 and st.st_mode & 0o022 == 0,
                "ROOT_METADATA_PERMISSIONS_INVALID:" + path.name)
    pins_raw = RUNNER_PINS.read_bytes()
    pins = json.loads(pins_raw)
    row = (pins.get("runners") or {}).get("V52") or {}
    require(row.get("sha") == OLD
            and row.get("serviceUnit") == OLD_UNIT
            and row.get("releaseRoot") == str(BASE / OLD),
            "RUNNER_PINS_V52_BASELINE_MISMATCH")
    plan_raw = CURRENT_PLAN.read_bytes()
    plan = json.loads(plan_raw)
    require(plan.get("ordersEnabled") is False
            and (plan.get("runners") or {}).get("V52") == OLD,
            "CURRENT_PLAN_V52_BASELINE_MISMATCH")
    return pins_raw, stat.S_IMODE(RUNNER_PINS.stat().st_mode), plan_raw, stat.S_IMODE(CURRENT_PLAN.stat().st_mode)


def next_runner_pins(raw: bytes) -> bytes:
    value = json.loads(raw)
    row = value["runners"]["V52"]
    row["sha"] = NEW
    row["serviceUnit"] = NEW_UNIT
    row["releaseRoot"] = str(BASE / NEW)
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def next_current_plan(raw: bytes) -> bytes:
    value = json.loads(raw)
    value["runners"]["V52"] = NEW
    value["ordersEnabled"] = False
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def atomic_root_file(path: Path, data: bytes, mode: int) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix="." + path.name + ".")
    try:
        with os.fdopen(fd, "wb") as f:
            os.fchmod(f.fileno(), mode)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chown(tmp, 0, 0)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def all_preflight() -> tuple[bytes,int,int,int,dict,str]:
    risk_snapshot()
    require(service_active(OLD_UNIT) and not service_active(NEW_UNIT), "EXPECTED_OLD_ONLY_V52_RUNNING")
    pid = int(unit_property(OLD_UNIT, "MainPID"))
    require(pid > 100, "OLD_V52_MAINPID_INVALID")
    require(os.path.realpath(f"/proc/{pid}/cwd") == str(BASE / OLD), "OLD_V52_RELEASE_CWD_MISMATCH")
    pin = pinned()
    root_metadata_baseline()
    candidate_preflight_readonly()
    observations = [venue_get() for _ in range(3)]
    stamps = [row[0] for row in observations]
    digests = [row[2] for row in observations]
    require(len(set(stamps)) == 3, "SIGNED_ASTER_GET_TIMESTAMPS_NOT_INCREASING")
    require(len(set(digests)) == 1, "VENUE_INVENTORY_CHANGED_DURING_PREFLIGHT")
    risk_snapshot()
    print("V52_F333_SAFE_PREFLIGHT=PASS",flush=True)
    print("VENUE_SIGNED_GETS=3",flush=True)
    print("VENUE_INVENTORY_DIGEST=" + digests[0],flush=True)
    print("OLD_V52_ONLY=TRUE",flush=True)
    print("ORDERS_SENT=0 CANCELS_SENT=0 POSITION_CHANGES=0",flush=True)
    return (*pin, observations[-1][1], digests[0])


def build_activation(run_id: str, actor: str, inventory_digest_value: str) -> dict:
    require(re.fullmatch(r"[0-9]{1,20}", run_id or "") is not None, "RUN_ID_INVALID")
    require(actor == "dunamishajime-bit", "GITHUB_ACTOR_NOT_OWNER")
    require(re.fullmatch(r"[0-9a-f]{64}", inventory_digest_value or "") is not None,
            "INVENTORY_DIGEST_INVALID")
    return {
        "schema": "disdex-live-operator-activation/v1",
        "target": "DD1296_FINAL_ALLIN_10BPS",
        "approvedSha": NEW,
        "approvedRunners": ["V52", "FET_BRK48_RESIDUAL"],
        "ordersEnabled": True,
        "activationClass": "FULL_LIVE",
        "operatorAcknowledgement": "I_ACK_REAL_MONEY_LIVE_ACTIVATION",
        "approvedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "fetCorePreemptionReady": True,
        "formalCertification": False,
        "venueLifecycleCertified": False,
        "forwardEvidenceApplicable": False,
        "authorizationMethod": "GITHUB_ACTIONS_PRODUCTION_ENVIRONMENT",
        "authorizedActor": actor,
        "githubRunId": run_id,
        "evidence": {
            "sourceSha": NEW,
            "githubRunId": run_id,
            "signedAsterReadOnly": True,
            "signedReadOnlyGets": 3,
            "positionsReconciled": True,
            "pendingExposureReconciled": True,
            "sharedRiskHealthy": True,
            "marginGuardHealthy": True,
            "killSwitchActive": True,
            "killSwitchOwner": "disdex-v52-aster-only",
            "killSwitchReason": "V52 upstream state unavailable: QUALITY102_STATE_MISMATCH:runtimeCommitSha",
            "startUnderProtectedHold": True,
            "inventoryDigest": inventory_digest_value,
            "ordersSent": 0,
            "cancelSent": 0,
            "positionChangesSent": 0,
        },
        "notes": (
            "Exact f333 V52 peer-SHA hotfix. Authorized by the disdex-production "
            "GitHub Actions environment; startup remains under existing HOLD_PROTECTED. "
            "This artifact does not authorize Kill Switch clearance."
        ),
    }


def write_new_root_file(path: Path, data: bytes, mode: int) -> None:
    require(not path.exists() and not path.is_symlink(), "PREPARE_TARGET_ALREADY_EXISTS:" + str(path))
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix="." + path.name + ".")
    try:
        with os.fdopen(fd, "wb") as f:
            os.fchmod(f.fileno(), mode)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chown(tmp, 0, 0)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def exact_sha_replace(source: Path, old: str, new: str, minimum: int = 1) -> bytes:
    require(source.is_file() and not source.is_symlink(), "PREPARE_SOURCE_INVALID:" + str(source))
    text = source.read_text(encoding="utf-8")
    require(text.count(old) >= minimum, "PREPARE_SOURCE_SHA_NOT_FOUND:" + source.name)
    value = text.replace(old, new)
    require(old not in value, "PREPARE_SOURCE_OLD_SHA_REMAINS:" + source.name)
    return value.encode("utf-8")


def prepare_runtime_material(run_id: str, actor: str) -> str:
    _pin, _uid, _gid, _mode, _inventory, digest = all_preflight()
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    for source in (OLD_OVERRIDE, OLD_CADENCE, OLD_FRAGMENT, OLD_HOTFIX, OLD_CADENCE_DROPIN):
        require(source.is_file() and not source.is_symlink(),
                "PREPARE_SOURCE_MISSING:" + str(source))
    created = []
    try:
        write_new_root_file(NEW_OVERRIDE, exact_sha_replace(OLD_OVERRIDE, OLD, NEW, 1), 0o600)
        created.append(NEW_OVERRIDE)
        write_new_root_file(NEW_CADENCE, OLD_CADENCE.read_bytes(), 0o600)
        created.append(NEW_CADENCE)
        write_new_root_file(NEW_FRAGMENT, exact_sha_replace(OLD_FRAGMENT, OLD, NEW, 3), 0o644)
        created.append(NEW_FRAGMENT)
        require(not NEW_DROPIN_DIR.exists() and not NEW_DROPIN_DIR.is_symlink(),
                "PREPARE_DROPIN_DIR_EXISTS")
        NEW_DROPIN_DIR.mkdir(mode=0o755)
        os.chown(NEW_DROPIN_DIR, 0, 0)
        created.append(NEW_DROPIN_DIR)
        write_new_root_file(NEW_HOTFIX, exact_sha_replace(OLD_HOTFIX, OLD, NEW, 5), 0o644)
        created.append(NEW_HOTFIX)
        write_new_root_file(
            NEW_CADENCE_DROPIN,
            exact_sha_replace(OLD_CADENCE_DROPIN, OLD, NEW, 1),
            0o644,
        )
        created.append(NEW_CADENCE_DROPIN)
        artifact = build_activation(run_id, actor, digest)
        write_new_root_file(
            APPROVAL,
            (json.dumps(artifact, indent=2, sort_keys=True) + "\n").encode("utf-8"),
            0o600,
        )
        created.append(APPROVAL)
        run("/usr/bin/systemctl", "daemon-reload", timeout=30)
        run("/usr/bin/systemd-analyze", "verify", NEW_UNIT, timeout=45)
        risk_snapshot(require_activation=True)
        candidate_preflight_readonly()
    except Exception:
        for path in reversed(created):
            try:
                if path.is_dir() and not path.is_symlink():
                    path.rmdir()
                else:
                    path.unlink(missing_ok=True)
            except OSError:
                pass
        try:
            run("/usr/bin/systemctl", "daemon-reload", timeout=30)
        except Exception:
            pass
        raise
    print("V52_F333_RUNTIME_PREPARED=TRUE", flush=True)
    print("V52_F333_INVENTORY_DIGEST=" + digest, flush=True)
    return digest

def wait_unit(unit: str, cwd: str, secs: int = 65) -> None:
    deadline = time.monotonic() + secs
    while time.monotonic() < deadline:
        if service_active(unit):
            pid = int(unit_property(unit, "MainPID") or "0")
            if pid > 100 and os.path.realpath(f"/proc/{pid}/cwd") == cwd:
                time.sleep(3)
                if service_active(unit) and int(unit_property(unit, "MainPID")) == pid:
                    return
        time.sleep(2)
    raise RuntimeError("NEW_V52_NOT_STABLE")

def wait_state_sha(expected: str, secs: int = 45) -> None:
    deadline = time.monotonic() + secs
    while time.monotonic() < deadline:
        try:
            state = read_json(STATE)
            if str(state.get("runtimeCommitSha") or "").lower() == expected:
                return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError("V52_STATE_SHA_NOT_MIGRATED")


def execute(run_id: str) -> None:
    require(re.fullmatch(r"[0-9]{1,20}", run_id) is not None,"RUN_ID_INVALID")
    old, uid, gid, mode, baseline_inventory, baseline_digest = all_preflight()
    old_runner_pins, runner_pins_mode, old_plan, current_plan_mode = root_metadata_baseline()
    BACKUP_DIR.mkdir(mode=0o700,parents=True,exist_ok=True)
    st = BACKUP_DIR.stat()
    require(st.st_uid == 0 and st.st_mode & 0o077 == 0, "BACKUP_DIR_UNSAFE")
    backups = {
        PIN: BACKUP_DIR / f"v52-pin-before-{run_id}.env",
        RUNNER_PINS: BACKUP_DIR / f"runner-pins-before-{run_id}.json",
        CURRENT_PLAN: BACKUP_DIR / f"current-plan-before-{run_id}.json",
    }
    for source, backup in backups.items():
        require(not backup.exists() and not backup.is_symlink(), "BACKUP_ALREADY_EXISTS")
        payload = source.read_bytes()
        with backup.open("xb") as f:
            os.fchmod(f.fileno(), 0o600)
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        require(backup.read_bytes() == payload, "BACKUP_NOT_EXACT:" + source.name)

    switched = False
    old_enabled = is_enabled(OLD_UNIT)
    new_enabled = is_enabled(NEW_UNIT)
    try:
        # Production remains HOLD_PROTECTED for the entire V52 switch.
        risk_snapshot(require_activation=True)
        require(PIN.read_bytes() == old, "PIN_CHANGED_BEFORE_CUTOVER")
        run("systemctl","stop",OLD_UNIT,timeout=90)
        require(not service_active(OLD_UNIT), "OLD_V52_STILL_ACTIVE")
        # Every attempted metadata publication must enter rollback, including
        # failure between the first pin write and the final current-plan write.
        switched = True
        atomic_pin(new_pin(old),uid,gid,mode)
        atomic_root_file(RUNNER_PINS, next_runner_pins(old_runner_pins), runner_pins_mode)
        atomic_root_file(CURRENT_PLAN, next_current_plan(old_plan), current_plan_mode)
        cutover_started = int(time.time()) - 2
        run("systemctl","start",NEW_UNIT,timeout=100)
        wait_unit(NEW_UNIT,str(BASE/NEW))
        require(not service_active(OLD_UNIT),"DUAL_V52_OWNER")
        wait_state_sha(NEW)
        journal = run("/usr/bin/journalctl", "-u", NEW_UNIT, "--since",
                      "@" + str(cutover_started), "--no-pager", "-o", "cat", timeout=25)
        require("QUALITY102_STATE_MISMATCH:runtimeCommitSha" not in journal,
                "V52_Q102_SHA_MISMATCH_RECURRED")
        risk_snapshot(require_activation=True)
        _stamp, post_inventory, post_digest = venue_get()
        require(post_digest == baseline_digest and post_inventory == baseline_inventory,
                "VENUE_INVENTORY_CHANGED_DURING_CUTOVER")
        require(PIN.read_bytes() == new_pin(old),"PIN_CHANGED_AFTER_CUTOVER")
        require(RUNNER_PINS.read_bytes() == next_runner_pins(old_runner_pins),
                "RUNNER_PINS_CHANGED_AFTER_CUTOVER")
        require(CURRENT_PLAN.read_bytes() == next_current_plan(old_plan),
                "CURRENT_PLAN_CHANGED_AFTER_CUTOVER")
        if old_enabled: run("systemctl","disable",OLD_UNIT)
        if not new_enabled: run("systemctl","enable",NEW_UNIT)
        require(service_active(NEW_UNIT) and not service_active(OLD_UNIT),"V52_FINAL_SERVICE_MISMATCH")
        require(read_json(KILL).get("active") is True,"KILL_SWITCH_UNEXPECTEDLY_CLEARED")
        print("V52_HOTFIX_CUTOVER=SUCCESS")
        print(f"V52_ACTIVE_SHA={NEW}")
        print("OLD_V52_ACTIVE=FALSE SHARED_HOLD_PRESERVED=TRUE")
        print("SIGNED_POSTCUTOVER_VENUE_PROOF=PASS VENUE_INVENTORY_PRESERVED=TRUE ORDERS_SENT=0 CANCELS_SENT=0")
    except Exception as err:
        print("V52_HOTFIX_CUTOVER=BLOCKED_ROLLBACK_START",file=sys.stderr)
        try:
            run("systemctl","stop",NEW_UNIT,timeout=80)
            if switched:
                atomic_pin(old,uid,gid,mode)
                atomic_root_file(RUNNER_PINS, old_runner_pins, runner_pins_mode)
                atomic_root_file(CURRENT_PLAN, old_plan, current_plan_mode)
            if old_enabled: run("systemctl","enable",OLD_UNIT)
            if not new_enabled: run("systemctl","disable",NEW_UNIT)
            if not service_active(OLD_UNIT): run("systemctl","start",OLD_UNIT,timeout=95)
            wait_unit(OLD_UNIT,str(BASE/OLD),secs=45)
            require(PIN.read_bytes() == old, "ROLLBACK_PIN_MISMATCH")
            require(RUNNER_PINS.read_bytes() == old_runner_pins,
                    "ROLLBACK_RUNNER_PINS_MISMATCH")
            require(CURRENT_PLAN.read_bytes() == old_plan,
                    "ROLLBACK_CURRENT_PLAN_MISMATCH")
            require(read_json(KILL).get("active") is True,"KILL_SWITCH_NOT_PROTECTED_AFTER_ROLLBACK")
            print("V52_HOTFIX_ROLLBACK=SUCCESS",file=sys.stderr)
        except Exception as rollback_err:
            print(f"V52_HOTFIX_ROLLBACK=FAILED:{type(rollback_err).__name__}:{str(rollback_err)[:120]}",file=sys.stderr)
        raise RuntimeError("V52_CUTOVER_BLOCKED:" + str(err)[:150]) from err

def main() -> int:
    parser=argparse.ArgumentParser()
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--preflight-readonly",action="store_true")
    group.add_argument("--execute-approved",action="store_true")
    group.add_argument("--prepare-approved",action="store_true")
    parser.add_argument("--github-run-id")
    parser.add_argument("--github-actor")
    args=parser.parse_args()
    try:
        if args.preflight_readonly:
            all_preflight()
        elif args.prepare_approved:
            prepare_runtime_material(args.github_run_id or "", args.github_actor or "")
        else:
            require((args.github_actor or "") == "dunamishajime-bit", "GITHUB_ACTOR_NOT_OWNER")
            execute(args.github_run_id or "")
        return 0
    except Exception as e:
        print("V52_HOTFIX_BLOCKED:" + type(e).__name__ + ":" + str(e)[:185],file=sys.stderr)
        return 1

if __name__=="__main__":
    sys.exit(main())
