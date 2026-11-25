#!/usr/bin/env python3
"""Fail-closed STABLE4 DD30 monitor-only Root cutover.

The helper is intentionally narrower than an order-enable transaction.  It
stages one immutable release, quiesces the old Runner instances, starts only
explicit no-order monitor entrypoints, and verifies fresh state evidence.  It
never clears GLOBAL HOLD and never calls an exchange mutation endpoint.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
try:
    import pwd
except ImportError:  # pragma: no cover - Windows CI only imports pure helpers
    pwd = None  # type: ignore[assignment]
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from disdex_owner_approval import verify as verify_owner_token

TARGET_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")
REPO = "dunamishajime-bit/-ai-dex-manager"
OPERATOR = "dunamishajime-bit"
TARGET_HOST = "professional-dismanager.net"
SCOPE = "FULL_PROJECT"
ROUTE = "GITHUB_ACTIONS"
OPERATOR_TARGET = "DD1296_FINAL_ALLIN_10BPS"
HOLD_DIGEST = "928a1c83b08c6445211639631ed69ccf7ea935741cb21786c41fc63e294322cf"
BASE = Path("/home/deploy/disdex-trading/releases")
CURRENT = Path("/home/deploy/disdex-trading/current")
PINS = Path("/etc/disdex/runner-pins.json")
CURRENT_PLAN = Path("/var/lib/disdex/unified-deploy/current-plan.json")
HOLD = Path("/var/lib/disdex/shared/kill-switch.json")
RISK = Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
PENDING_PROOF = Path("/var/lib/disdex/v12-v4/monitor/pending-proof.json")
ACCOUNT_LOCK = Path("/var/lib/disdex/shared/account-order.lock")
MONITOR_ROOT = Path("/var/lib/disdex/stable4-dd30-monitor")
STALE_Q102 = "b8d681f048b087f07e0dcfb743cc14ec3a796b27"
STALE_MARGIN = "c7310d34ba1b6de07071d8883a2ed0de8dcce2a7"
# P1 observed this prior failed candidate left an auto-restart loop behind.
STALE_MARGIN_CANDIDATE = "a851129bf90c05ac4cce570af7e942a9a238ef70"
STALE_PENGU = "2e3014778341107fd3929a6dd6a329b96c76779e"
# Instance families whose stale non-pinned processes can interfere with a
# monitor-only generation.  The cleanup is deliberately allow-listed; it never
# scans or stops unrelated systemd services.
STALE_INSTANCE_BASES = (
    "disdex-v12-v4",
    "disdex-v4-rate-budget-broker",
    "disdex-pengu-dual-ls-v2",
    "disdex-quality102-causal-v1",
    "disdex-v52-aster-only",
    "disdex-fet-brk48",
    "disdex-idle-priority-short",
    "disdex-hype-long",
    "disdex-shared-crypto-risk",
    "disdex-v12-v52-margin-guard",
)
INSTANCE_UNIT_RE = re.compile(
    r"^(?P<base>" + "|".join(re.escape(item) for item in STALE_INSTANCE_BASES) +
    r")@(?P<sha>[0-9a-f]{40})\.service$"
)
PENGU_TEMPLATE = Path("/etc/systemd/system/disdex-pengu-dual-ls-v2@.service")
PENGU_TEMPLATE_SHA256 = "c04e05755d939ccd51ff6db69de4ef8a41ad725ad3e83c87f8c45dc0483e90ce"
V52_TEMPLATE = Path("/etc/systemd/system/disdex-v52-aster-only@.service")
V52_TEMPLATE_SHA256 = "1e8a2707e5835b77be8374f8b8b3d615dc1de754543cd36efca85ff1cdc5a45a"
V4_OVERLAY_SCHEMA = "disdex-v4-staged-overlay/v1"
V4_OVERLAY_BASE_SHA = "53a0be396719f0284af4e11b35c66a4ac7d58f79"


class ContractError(RuntimeError):
    pass


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise ContractError(reason)


def safe_text(value: object, limit: int = 240) -> str:
    text = " ".join(str(value or "").split())
    text = re.sub(r"(?i)(token|secret|password|passwd|authorization|bearer|api[_-]?key|credential|signature)[^\s]*", r"\1=<redacted>", text)
    return re.sub(r"[^A-Za-z0-9_@%+.,:;/=()\- ]", "?", text)[:limit]


def run(*argv: str, timeout: int = 60, check: bool = True, input_text: str | None = None) -> str:
    proc = subprocess.run(list(argv), input=input_text, text=True, capture_output=True, timeout=timeout)
    if check and proc.returncode != 0:
        raise ContractError("COMMAND_FAILED:" + safe_text(" ".join(argv)) + ":" + safe_text(proc.stderr or proc.stdout))
    return proc.stdout.strip()


def read_regular(path: Path, max_bytes: int = 2_000_000) -> bytes:
    require(path.exists() and not path.is_symlink() and path.is_file(), "FILE_NOT_REGULAR:" + str(path))
    data = path.read_bytes()
    require(len(data) <= max_bytes, "FILE_TOO_LARGE:" + str(path))
    return data


def read_json(path: Path) -> dict:
    try:
        value = json.loads(read_regular(path).decode("utf-8"))
    except Exception as exc:
        raise ContractError("JSON_INVALID:" + str(path)) from exc
    require(isinstance(value, dict), "JSON_OBJECT_REQUIRED:" + str(path))
    return value


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def file_meta(path: Path) -> tuple[int, int, int]:
    st = path.stat()
    return st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode)


def write_atomic(path: Path, data: bytes, meta: tuple[int, int, int] | None = None) -> None:
    require(not path.is_symlink(), "WRITE_SYMLINK_FORBIDDEN:" + str(path))
    path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        with open(tmp, "xb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        uid, gid, mode = meta or (0, 0, 0o644)
        os.chown(tmp, uid, gid)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _overlay_path(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    require(relative and not Path(relative).is_absolute() and ".." not in Path(relative).parts,
            "V4_OVERLAY_PATH_INVALID:" + str(relative))
    require(root.resolve() in candidate.parents, "V4_OVERLAY_PATH_ESCAPE:" + str(relative))
    return candidate


def materialize_v4_staged_overlay(stage: Path) -> None:
    """Expand the reviewed .src V4 overlay into the immutable release tree.

    The repository deliberately keeps this overlay as source-only preview
    material.  The production archive therefore must apply the exact manifest
    mapping before the release is installed; otherwise systemd can point at a
    broker or runner file that is absent from the release.  All source files
    remain inside the candidate archive and every path is checked fail-closed.
    """
    overlay_root = stage / "deploy" / "v4-staged-overlay"
    manifest = read_json(overlay_root / "manifest.json")
    require(manifest.get("schema") == V4_OVERLAY_SCHEMA, "V4_OVERLAY_MANIFEST_INVALID")
    require(manifest.get("baseSha") == V4_OVERLAY_BASE_SHA, "V4_OVERLAY_BASE_SHA_INVALID")
    rows = manifest.get("files")
    require(isinstance(rows, list) and rows, "V4_OVERLAY_FILES_INVALID")
    targets: set[str] = set()
    for row in rows:
        require(isinstance(row, dict), "V4_OVERLAY_ROW_INVALID")
        source = str(row.get("source", ""))
        target = str(row.get("target", ""))
        require(source.endswith(".src"), "V4_OVERLAY_SOURCE_SUFFIX_INVALID:" + source)
        require(target not in targets, "V4_OVERLAY_TARGET_DUPLICATE:" + target)
        targets.add(target)
        src = _overlay_path(overlay_root, "" if not source else source)
        dst = _overlay_path(stage, target)
        require(src.is_file() and not src.is_symlink(), "V4_OVERLAY_SOURCE_MISSING:" + source)
        require(not dst.is_symlink(), "V4_OVERLAY_TARGET_SYMLINK:" + target)
        # The release tree is chmod-hardened by stage_candidate after all
        # material is present.  Avoid applying POSIX mode bits while building
        # the temporary tree so the pure helper remains portable on Windows CI.
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)


def harden_immutable_tree(root: Path) -> None:
    """Remove all write bits from a staged release tree."""
    paths = [root, *root.rglob("*")]
    for path in paths:
        if path.is_symlink():
            continue
        os.chmod(path, stat.S_IMODE(path.stat().st_mode) & ~0o222)


def unit_property(unit: str, key: str) -> str:
    return run("/usr/bin/systemctl", "show", unit, "--property=" + key, "--value", timeout=20)


def parse_unit_health_snapshot(output: str, expected_units: set[str]) -> dict[str, dict[str, str]]:
    """Parse one batched systemd health query and require complete coverage."""
    rows: dict[str, dict[str, str]] = {}
    current: str | None = None
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key == "Id":
            current = value.strip()
            rows[current] = {}
        elif current is not None and key in {"ActiveState", "NRestarts"}:
            rows[current][key] = value.strip()
    require(set(rows) == set(expected_units), "SYSTEMD_HEALTH_SNAPSHOT_INCOMPLETE")
    for unit in expected_units:
        require(set(rows[unit]) == {"ActiveState", "NRestarts"}, "SYSTEMD_HEALTH_SNAPSHOT_FIELDS_MISSING:" + unit)
    return rows


def _missing_health_unit(reason: str) -> str | None:
    prefix = "SYSTEMD_HEALTH_SNAPSHOT_FIELDS_MISSING:"
    if not reason.startswith(prefix):
        return None
    unit = reason[len(prefix):].strip()
    return unit or None


def _single_unit_health(unit: str) -> dict[str, str]:
    """Read one unit with a bounded retry before failing closed.
    
    The first query keeps the existing complete-property contract.  A single
    retry handles a transient D-Bus/systemd delay seen on HYPE; if the retry
    still lacks NRestarts, only then use the property-only fallback.
    """
    try:
        try:
            single = run(
                "/usr/bin/systemctl",
                "show",
                unit,
                "--property=Id,ActiveState,NRestarts",
                "--no-pager",
                timeout=20,
            )
        except subprocess.TimeoutExpired:
            single = run(
                "/usr/bin/systemctl",
                "show",
                unit,
                "--property=Id,ActiveState,NRestarts",
                "--no-pager",
                timeout=30,
            )
    except subprocess.TimeoutExpired as exc:
        raise ContractError("SYSTEMD_HEALTH_SINGLE_UNIT_TIMEOUT:" + unit) from exc
    try:
        return parse_unit_health_snapshot(single, {unit})[unit]
    except ContractError as single_exc:
        if _missing_health_unit(str(single_exc)) != unit:
            raise
        try:
            identity = run(
                "/usr/bin/systemctl",
                "show",
                unit,
                "--property=Id,ActiveState",
                "--no-pager",
                timeout=20,
            )
            n_restarts = run(
                "/usr/bin/systemctl",
                "show",
                unit,
                "--property=NRestarts",
                "--value",
                "--no-pager",
                timeout=20,
            ).strip()
        except subprocess.TimeoutExpired as exc:
            raise ContractError("SYSTEMD_HEALTH_SINGLE_UNIT_TIMEOUT:" + unit) from exc
        if "=" in n_restarts:
            key, value = n_restarts.split("=", 1)
            if key.strip() == "NRestarts":
                n_restarts = value.strip()
        require(n_restarts.isdigit(), "SYSTEMD_HEALTH_SNAPSHOT_FIELDS_MISSING:" + unit)
        return parse_unit_health_snapshot(identity + "\nNRestarts=" + n_restarts, {unit})[unit]

def unit_health_snapshot(units: dict[str, str]) -> dict[str, dict[str, str]]:
    """Read all target ActiveState/NRestarts values in one bounded systemd call."""
    expected_units = set(units.values())
    require(expected_units and len(expected_units) == len(units), "SYSTEMD_HEALTH_UNIT_SET_INVALID")
    try:
        output = run(
            "/usr/bin/systemctl",
            "show",
            *units.values(),
            "--property=Id,ActiveState,NRestarts",
            "--no-pager",
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        return {unit: _single_unit_health(unit) for unit in sorted(expected_units)}
    try:
        return parse_unit_health_snapshot(output, expected_units)
    except ContractError as exc:
        missing = _missing_health_unit(str(exc))
        if missing is None:
            raise
        recovered = _single_unit_health(missing)
        partial: dict[str, dict[str, str]] = {}
        current: str | None = None
        for raw_line in output.splitlines():
            line = raw_line.strip()
            if not line or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key == "Id":
                current = value.strip()
                if current in expected_units and current != missing:
                    partial[current] = {}
            elif current in partial and key in {"ActiveState", "NRestarts"}:
                partial[current][key] = value.strip()
        require(set(partial) == expected_units - {missing}, "SYSTEMD_HEALTH_SNAPSHOT_INCOMPLETE")
        for unit in partial:
            require(set(partial[unit]) == {"ActiveState", "NRestarts"}, "SYSTEMD_HEALTH_SNAPSHOT_FIELDS_MISSING:" + unit)
        partial[missing] = recovered
        return partial


def unit_state(unit: str) -> tuple[str, str]:
    return unit_property(unit, "ActiveState"), unit_property(unit, "SubState")


def unit_active(unit: str) -> bool:
    return unit_property(unit, "ActiveState") == "active"


def stop_unit(unit: str) -> None:
    state, _sub = unit_state(unit)
    if state in {"active", "activating", "deactivating", "reloading"}:
        run("/usr/bin/systemctl", "stop", unit, timeout=100)
    require(unit_property(unit, "MainPID") in {"0", ""}, "UNIT_PID_REMAINS:" + unit)
    require(unit_property(unit, "ActiveState") in {"inactive", "failed", "deactivating", "unknown"}, "UNIT_NOT_TERMINAL:" + unit)


SHARED_RISK_UNIT_RE = re.compile(r"disdex-shared-crypto-risk@[0-9a-f]{40}\.service")


def shared_risk_units() -> list[str]:
    """List only concrete, SHA-scoped writer units (not the template)."""
    listing = run("/usr/bin/systemctl", "list-units", "--all", "--type=service",
                  "--no-legend", "--plain", "disdex-shared-crypto-risk@*.service", timeout=30)
    units: set[str] = set()
    for line in listing.splitlines():
        unit = next((word for word in line.split() if SHARED_RISK_UNIT_RE.fullmatch(word)), None)
        if unit:
            units.add(unit)
    return sorted(units)


def pinned_shared_risk_unit(pins_raw: bytes) -> str:
    pins = json.loads(pins_raw.decode("utf-8"))
    row = (pins.get("runners") or {}).get("SHARED_CRYPTO_RISK") or {}
    sha = row.get("sha")
    unit = row.get("serviceUnit")
    require(isinstance(sha, str) and TARGET_SHA_RE.fullmatch(sha) is not None,
            "SHARED_RISK_PIN_SHA_INVALID")
    require(unit == "disdex-shared-crypto-risk@" + sha + ".service",
            "SHARED_RISK_PIN_UNIT_INVALID")
    return unit


def assert_single_shared_risk_writer(pins_raw: bytes, *, target: str | None = None) -> str:
    pinned = pinned_shared_risk_unit(pins_raw)
    require(unit_active(pinned), "PINNED_SHARED_RISK_WRITER_NOT_ACTIVE")
    for unit in shared_risk_units():
        if unit == pinned:
            continue
        state = unit_property(unit, "ActiveState")
        require(state not in {"active", "activating", "reloading", "deactivating"},
                "MULTIPLE_SHARED_RISK_WRITERS:" + unit)
    if target is not None:
        candidate = "disdex-shared-crypto-risk@" + target + ".service"
        require(candidate != pinned, "TARGET_SHARED_RISK_WRITER_PINNED_UNEXPECTEDLY")
        require(unit_property(candidate, "UnitFileState") == "masked",
                "TARGET_SHARED_RISK_WRITER_NOT_MASKED")
        require(unit_property(candidate, "MainPID") in {"", "0"},
                "TARGET_SHARED_RISK_WRITER_PID_REMAINS")
    return pinned


def retire_non_pinned_shared_risk_writers(pins_raw: bytes, target: str) -> list[str]:
    """Quiesce and mask only SHA-specific non-pinned writer instances.

    Disabled is insufficient: disabled instances may remain active or be started
    by another unit.  A concrete mask prevents auto-start at the next cutover.
    Never stop, restart, mask or disable the pinned canonical writer.
    """
    pinned = pinned_shared_risk_unit(pins_raw)
    candidate = "disdex-shared-crypto-risk@" + target + ".service"
    require(pinned != candidate, "TARGET_SHARED_RISK_WRITER_PINNED_UNEXPECTEDLY")
    listed = set(shared_risk_units())
    listed.add(candidate)
    retired: list[str] = []
    for unit in sorted(listed):
        if unit == pinned:
            continue
        state = unit_property(unit, "ActiveState")
        if state in {"active", "activating", "reloading", "deactivating"}:
            stop_unit(unit)
            retired.append(unit)
        # The candidate must ALWAYS be masked, even if it was disabled/dead.
        # Stale siblings are masked only when we actually had to stop them.
        if unit == candidate or unit in retired:
            run("/usr/bin/systemctl", "mask", unit, timeout=30)
            require(unit_property(unit, "UnitFileState") == "masked",
                    "SHARED_RISK_WRITER_MASK_FAILED:" + unit)
            require(unit_property(unit, "MainPID") in {"", "0"},
                    "SHARED_RISK_WRITER_PID_REMAINS:" + unit)
    return retired


def hold_metadata_valid(uid: int, mode: int) -> bool:
    return uid in {0, 1000} and mode == 0o600


def hold_snapshot() -> tuple[bytes, dict, str]:
    raw = read_regular(HOLD, 32_768)
    st = HOLD.stat()
    # The production HOLD is intentionally writable by the dedicated deploy
    # runtime (uid 1000) and is also readable by Root.  Accept only those two
    # established owners, with the exact private-file mode; never loosen this
    # to an arbitrary user/group or a world-readable file.
    require(hold_metadata_valid(st.st_uid, stat.S_IMODE(st.st_mode)), "GLOBAL_HOLD_METADATA_INVALID")
    value = json.loads(raw.decode("utf-8"))
    got = hashlib.sha256(raw).hexdigest()
    require(got == HOLD_DIGEST, "GLOBAL_HOLD_DIGEST_MISMATCH")
    require(value.get("active") is True and value.get("action") == "HOLD_PROTECTED" and value.get("scope") == "GLOBAL", "GLOBAL_HOLD_NOT_PROTECTED")
    return raw, value, got


def normalize_inventory(value: dict) -> dict:
    positions = []
    for row in value.get("positions") or []:
        if not isinstance(row, dict):
            raise ContractError("POSITION_NOT_OBJECT")
        if abs(float(row.get("positionAmt") or 0)) > 1e-15:
            positions.append({k: str(row.get(k) or "") for k in ("symbol", "positionAmt", "positionSide", "entryPrice")})
    orders = []
    for row in value.get("openOrders") or []:
        if not isinstance(row, dict):
            raise ContractError("ORDER_NOT_OBJECT")
        orders.append({k: row.get(k) for k in ("symbol", "orderId", "clientOrderId", "status", "side", "positionSide", "type", "reduceOnly", "closePosition", "origQty", "executedQty", "stopPrice")})
    positions.sort(key=lambda x: (x["symbol"], x["positionSide"], x["positionAmt"]))
    orders.sort(key=lambda x: (x["symbol"], str(x["orderId"]), str(x["clientOrderId"])))
    require(not positions and not orders, "VENUE_NOT_FLAT_OR_HAS_OPEN_ORDERS")
    return {"positions": positions, "openOrders": orders}


def signed_get() -> tuple[str, str]:
    release = CURRENT.resolve()
    require(release.is_dir() and str(release).startswith(str(BASE) + "/"), "CURRENT_RELEASE_INVALID")
    command = (
        "set -ae; for f in /etc/disdex/disdex-v13d-v11eq-v96.env "
        "/etc/disdex/disdex-v12-pengu-v2-v52.env /etc/disdex/disdex-v12-v4.env; do . \"$f\"; done; "
        "set +a; exec /usr/bin/node " + str(release / "node_modules/tsx/dist/cli.mjs") +
        " scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    proc = subprocess.run(["/bin/bash", "-c", command], cwd=release, capture_output=True, text=True, timeout=65)
    require(proc.returncode == 0, "SIGNED_ASTER_GET_FAILED")
    rows = [line for line in proc.stdout.splitlines() if line.startswith("{")]
    require(rows, "SIGNED_ASTER_GET_EMPTY")
    value = json.loads(rows[-1])
    require(value.get("status") == "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS", "SIGNED_ASTER_GET_NOT_PASS")
    require(all(value.get(k) == 0 for k in ("ordersSent", "cancelsSent", "positionChangesSent")), "SIGNED_GET_MUTATION")
    inventory = normalize_inventory(value)
    stamp = str(value.get("observedAt") or value.get("venueTime") or "")
    require(stamp, "SIGNED_GET_TIMESTAMP_MISSING")
    return stamp, digest(inventory)


def recover_expired_account_lock(release: Path, run_id: str) -> bool:
    """Archive only the known expired read-only reconciliation lock.

    The TypeScript recovery command re-checks PID liveness, reservations and
    exact bytes. This wrapper binds it to the staged immutable release and
    never touches the exchange or any order state.
    """
    if not ACCOUNT_LOCK.exists():
        return False
    value = json.loads(read_regular(ACCOUNT_LOCK, 262_144).decode("utf-8"))
    require(value.get("schema") == "disdex-account-lock/v1", "ACCOUNT_LOCK_SCHEMA_INVALID")
    owner_id = str(value.get("ownerId") or "")
    require(owner_id, "ACCOUNT_LOCK_OWNER_INVALID")
    expires_at = value.get("expiresAt")
    require(isinstance(expires_at, (int, float)) and not isinstance(expires_at, bool), "ACCOUNT_LOCK_EXPIRES_INVALID")
    if float(expires_at) > time.time() * 1000:
        return False
    require(re.fullmatch(r"PENDING_READONLY_RECONCILE:[0-9]+:[0-9]+", owner_id) is not None, "ACCOUNT_LOCK_RECOVERY_OWNER_UNSUPPORTED")
    reservations = value.get("reservations")
    require(isinstance(reservations, list), "ACCOUNT_LOCK_RESERVATIONS_INVALID")
    require(not reservations, "ACCOUNT_LOCK_RESERVATIONS_PRESENT")
    cli = release / "node_modules" / "tsx" / "dist" / "cli.mjs"
    script = release / "scripts" / "disdex-account-order-lock-expired-recovery.ts"
    require(cli.is_file() and script.is_file(), "ACCOUNT_LOCK_RECOVERY_SOURCE_MISSING")
    request_id = "stable4-dd30-" + re.sub(r"[^A-Za-z0-9._-]", "_", str(run_id))
    common = [
        "/usr/bin/node", str(cli), str(script),
        "--path", str(ACCOUNT_LOCK),
        "--expected-owner-id", owner_id,
        "--request-id", request_id,
    ]
    verify = run(*common, "--verify-only", timeout=90)
    require("EXPIRED_ACCOUNT_LOCK_RECOVERY_ELIGIBLE" in verify, "ACCOUNT_LOCK_RECOVERY_VERIFY_FAILED")
    applied = run(*common, "--apply", "--ack", "I_ACK_EXPIRED_ACCOUNT_LOCK_RECOVERY_AFTER_3X_READONLY_RECONCILIATION", timeout=90)
    require("EXPIRED_ACCOUNT_LOCK_ARCHIVED" in applied, "ACCOUNT_LOCK_RECOVERY_APPLY_FAILED")
    return True


def refresh_v4_pending_proof(target: str) -> str:
    """Bind the stale pending registry to fresh signed-flat monitor evidence."""
    raw = read_regular(PENDING, 262_144)
    value = json.loads(raw.decode("utf-8"))
    require(value.get("schema") == "disdex-pending-exposure/v1" and value.get("accountScope") == "ASTER_FUTURES", "PENDING_REGISTRY_INVALID")
    entries = value.get("entries")
    require(isinstance(entries, list) and not any(str(row.get("status", "")).upper() != "RELEASED" for row in entries if isinstance(row, dict)), "PENDING_REGISTRY_ACTIVE")
    updated_at = value.get("updatedAt")
    require(isinstance(updated_at, int) and updated_at > 0, "PENDING_REGISTRY_TIMESTAMP_INVALID")
    meta = file_meta(PENDING_PROOF)
    require(meta[0] == 0 and stat.S_IMODE(meta[2]) & 0o002 == 0, "V4_PENDING_PROOF_METADATA_INVALID")
    payload = {
        "cancelsSent": 0,
        "candidateSha": target,
        "openOrderCount": 0,
        "ordersSent": 0,
        "positionChangesSent": 0,
        "positionCount": 0,
        "priorUpdatedAt": updated_at,
        "registryEntries": len(entries),
        "registryHash": hashlib.sha256(raw).hexdigest(),
        "schema": "disdex-pending-readonly-proof/v1",
        "source": "SIGNED_ASTER_READONLY_ACCOUNT_LOCK",
        "verifiedAt": int(time.time() * 1000),
    }
    proof_raw = (json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    write_atomic(PENDING_PROOF, proof_raw, meta)
    return hashlib.sha256(proof_raw).hexdigest()


def validate_shared_files(margin_unit: str, *, allow_stale_shared_risk: bool = False) -> None:
    _hold_raw, hold, _hold_digest = hold_snapshot()
    risk = read_json(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is False, "SHARED_RISK_NOT_HEALTHY")
    require(abs(float(risk.get("maximumLossPct")) - 7.5) < 1e-9, "SHARED_RISK_LIMIT_MISMATCH")
    updated = risk.get("updatedAt")
    age_ms = int(time.time() * 1000) - float(updated) if isinstance(updated, (int, float)) else None
    # With GLOBAL HOLD and orders disabled, allow only a bounded stale
    # snapshot long enough to restart the pinned Writer and prove three real
    # updates.  Beyond 90 minutes this remains fail-closed.
    require(age_ms is not None and -1000 <= age_ms <= 90 * 60_000, "SHARED_RISK_STALE")
    if age_ms > 15 * 60_000:
        require(
            allow_stale_shared_risk
            and hold.get("active") is True
            and hold.get("action") == "HOLD_PROTECTED"
            and hold.get("scope") == "GLOBAL",
            "SHARED_RISK_STALE",
        )
    margin = read_json(MARGIN)
    require(margin.get("stage") == "HEALTHY" and margin.get("ordersAllowed") is True, "MARGIN_GUARD_NOT_HEALTHY")
    checked = margin.get("checkedAt")
    require(isinstance(checked, (int, float)) and -1000 <= int(time.time() * 1000) - float(checked) <= 15 * 60_000, "MARGIN_GUARD_STALE")
    require(unit_active(margin_unit), "MARGIN_GUARD_UNIT_NOT_ACTIVE")
    pending = read_json(PENDING)
    require(isinstance(pending.get("entries"), list) and not any(str(row.get("status", "")).upper() != "RELEASED" for row in pending["entries"]), "PENDING_EXPOSURE_ACTIVE")


def validate_plan(plan: dict, execution_plan_sha256: str) -> None:
    require(plan.get("schema") == "disdex-stable4-dd30-monitor-only-root-plan/v1", "PLAN_SCHEMA_INVALID")
    require(plan.get("target") == TARGET_HOST and plan.get("route") == ROUTE and plan.get("scope") == SCOPE, "PLAN_TARGET_OR_ROUTE_INVALID")
    require(plan.get("sourceBinding") == "GITHUB_RUN_HEAD_SHA" and plan.get("ordersEnabled") is False, "PLAN_SOURCE_OR_ORDER_INVALID")
    require(HASH_RE.fullmatch(execution_plan_sha256) is not None, "EXECUTION_PLAN_SHA_INVALID")
    require(str(plan.get("ownerGoalId")) and HASH_RE.fullmatch(str(plan.get("ownerGoalFingerprint"))), "PLAN_GOAL_BINDING_INVALID")
    ids = {str(row.get("id")) for row in (plan.get("runnerTargets") or []) if isinstance(row, dict)}
    require(ids == {"V12_V4", "PENGU_V8", "QUALITY102_CAUSAL_V1", "V52", "FET_BRK48_RESIDUAL", "IDLE_PRIORITY_SHORT", "HYPE_TREND_LONG"}, "PLAN_RUNNER_SCOPE_INVALID")
    prefixes = {str(row.get("id")): str(row.get("unitPrefix")) for row in (plan.get("runnerTargets") or []) if isinstance(row, dict)}
    require(prefixes == {
        "V12_V4": "disdex-v12-v4@",
        "PENGU_V8": "disdex-pengu-dual-ls-v2@",
        "QUALITY102_CAUSAL_V1": "disdex-quality102-causal-v1@",
        "V52": "disdex-v52-aster-only@",
        "FET_BRK48_RESIDUAL": "disdex-fet-brk48@",
        "IDLE_PRIORITY_SHORT": "disdex-idle-priority-short@",
        "HYPE_TREND_LONG": "disdex-hype-long@",
    }, "PLAN_UNIT_PREFIX_INVALID")
    economics = plan.get("economics") or {}
    require(economics.get("v4NewEntryDrawdownHold") == 0.3 and economics.get("cryptoGrossCap") == 3.0 and economics.get("stockGrossCap") == 4.0 and economics.get("totalGrossCap") == 4.25 and economics.get("sharedCryptoDailyLoss") == 0.075 and economics.get("penguDrawdownProtection") == 0.17, "PLAN_ECONOMICS_INVALID")
    hold = plan.get("globalHold") or {}
    require(hold.get("active") is True and hold.get("action") == "HOLD_PROTECTED" and hold.get("scope") == "GLOBAL" and hold.get("clearGlobalHold") is False and hold.get("digestSha256") == HOLD_DIGEST, "PLAN_HOLD_INVALID")
    venue = plan.get("venuePreflight") or {}
    require(venue.get("signedAsterGets") == 3 and venue.get("requireFlatPositions") is True and venue.get("requireNoOpenOrders") is True, "PLAN_VENUE_CONTRACT_INVALID")
    require(all(venue.get(key) == 0 for key in ("ordersSent", "cancelsSent", "positionChangesSent")), "PLAN_MUTATION_CONTRACT_INVALID")
    verification = plan.get("verification") or {}
    require(verification.get("postCutoverCycles") == 3 and all(verification.get(key) is True for key in ("requireFreshHeartbeat", "requireStableRestartCounts", "requireQ102Freshness", "requireGlobalHoldDigestUnchanged", "requireTradingMutationZero", "requireRollbackEvidence")), "PLAN_VERIFICATION_INVALID")
    stale = plan.get("staleRepair") or {}
    require(stale.get("manualSystemdCommands") is False and stale.get("dualRunnerForbidden") is True, "PLAN_STALE_REPAIR_INVALID")


RUNNER_IDS = ("V12_V4", "PENGU_V8", "QUALITY102_CAUSAL_V1", "V52", "FET_BRK48_RESIDUAL", "IDLE_PRIORITY_SHORT", "HYPE_TREND_LONG")


def target_units(target: str) -> dict[str, str]:
    require(TARGET_SHA_RE.fullmatch(target) is not None, "TARGET_SHA_INVALID")
    return {
        "V12_V4": f"disdex-v12-v4@{target}.service",
        "PENGU_V8": f"disdex-pengu-dual-ls-v2@{target}.service",
        "QUALITY102_CAUSAL_V1": f"disdex-quality102-causal-v1@{target}.service",
        "V52": f"disdex-v52-aster-only@{target}.service",
        "FET_BRK48_RESIDUAL": f"disdex-fet-brk48@{target}.service",
        "IDLE_PRIORITY_SHORT": f"disdex-idle-priority-short@{target}.service",
        "HYPE_TREND_LONG": f"disdex-hype-long@{target}.service",
    }


def evidence_paths(target: str) -> dict[str, Path]:
    root = MONITOR_ROOT / target
    return {
        "V12_V4": Path("/var/lib/disdex/runner-health/ticks/v12-v4.json"),
        "PENGU_V8": root / "pengu" / "monitor-tick.json",
        "QUALITY102_CAUSAL_V1": Path("/var/lib/disdex/runner-health/ticks/quality102-causal-v1.json"),
        "V52": Path("/var/lib/disdex/runner-health/ticks/v52-monitor.json"),
        "FET_BRK48_RESIDUAL": root / "fet" / "shadow.json",
        "IDLE_PRIORITY_SHORT": root / "idle" / "state.json",
        "HYPE_TREND_LONG": root / "hype" / "runner.json",
    }


def snapshot_paths(paths: list[Path]) -> dict[Path, tuple[bool, bytes | None, tuple[int, int, int] | None]]:
    out: dict[Path, tuple[bool, bytes | None, tuple[int, int, int] | None]] = {}
    for path in paths:
        if path.is_symlink():
            raise ContractError("PATH_SYMLINK:" + str(path))
        out[path] = (path.exists(), path.read_bytes() if path.is_file() else None, file_meta(path) if path.exists() else None)
    return out


def restore_paths(snapshot: dict[Path, tuple[bool, bytes | None, tuple[int, int, int] | None]]) -> None:
    for path, (exists, data, meta) in snapshot.items():
        if exists:
            require(meta is not None, "PATH_SNAPSHOT_INVALID")
            if data is not None:
                write_atomic(path, data, meta)
            else:
                require(path.is_dir() and not path.is_symlink(), "PATH_DIRECTORY_SNAPSHOT_INVALID")
                os.chown(path, meta[0], meta[1])
                os.chmod(path, meta[2])
        elif path.exists() or path.is_symlink():
            require(not path.is_symlink(), "ROLLBACK_SYMLINK")
            if path.is_file():
                path.unlink()


def dropin_path(unit: str) -> Path:
    return Path("/etc/systemd/system") / (unit + ".d") / "zz-stable4-dd30-monitor-only.conf"


# Economics preserved from the Owner-selected original STABLE4 DD30 source
# (179e3f4e50f86ca8ab60baadaba1a96ed4c914ee) and monitor-only Root plan.
# The HYPE Trend sleeve is not the disabled ZEC sidecar.
# These shared keys are inspected by the integrated TypeScript contract
# regardless of which strategy calls it. Preserve its adopted defaults in
# every process; only actual engine-specific aliases remain Runner-scoped.
DD30_COMMON_GROSS_ENV = {
    "V12_BASE_GROSS_CAP": "2.0",
    "V12_DYNAMIC_GROSS_CAP": "2.0",
    "PENGU_DUAL_LS_V2_MAX_GROSS": "1.0",
    "HYPE_LONG_RISK_PCT": "5.0",
    "HYPE_LONG_MAX_GROSS": "1.5",
    "ZEC_LONG_RISK_PCT": "4.5",
    "HYPE_ZEC_MAX_GROSS": "1.0",
    "HYPE_ZEC_MAX_REDUCTION_FRACTION": "0.5",
    "QUALITY102_CAUSAL_V1_MAX_GROSS": "3.0",
    "CRYPTO_GROSS_CAP": "3.0",
    "CRYPTO_GROSS_HARD_CAP": "5.0",
    "STOCK_GROSS_CAP": "4.0",
    "TOTAL_GROSS_CAP": "4.25",
    "TOTAL_GROSS_HARD_CAP": "8.0",
    "DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT": "7.5",
    "DISDEX_KILL_SWITCH_RECOVERY_GRACE_MS": "600000",
}
DD30_RUNNER_GROSS_ENV = {
    "V12_V4": {"V12_GROSS_CAP": "2.0"},
    "PENGU_V8": {
        "PENGU_GROSS_CAP": "1.0", "PENGU_DUAL_LS_V2_PORTFOLIO_GROSS_CAP": "3.0",
    },
    "QUALITY102_CAUSAL_V1": {},
    "V52": {
        "DISDEX_V52_CRYPTO_GROSS_CAP": "3.0",
        "DISDEX_V52_STOCK_GROSS_CAP": "4.0",
        "DISDEX_V52_PORTFOLIO_GROSS_CAP": "4.25",
        "DISDEX_V52_V11_GROSS_CAP": "2.0",
        "DISDEX_V52_V50_GROSS_CAP": "2.0",
    },
    "HYPE_TREND_LONG": {"DISDEX_HYPE_ZEC_MAX_GROSS": "1.5"},
    "FET_BRK48_RESIDUAL": {},
    "IDLE_PRIORITY_SHORT": {},
}


def adopted_gross_env(runner: str) -> dict[str, str]:
    require(runner in DD30_RUNNER_GROSS_ENV, "DD30_GROSS_RUNNER_UNKNOWN")
    return {**DD30_COMMON_GROSS_ENV, **DD30_RUNNER_GROSS_ENV[runner]}


def verify_adopted_gross_source(release: Path) -> None:
    v50 = json.loads(read_regular(release / "config/v52V50Runtime.json", 32768))
    require(v50.get("stockAggregateGross") == 4.0 and v50.get("slotGross") == 2.0,
            "DD30_V52_ADOPTED_SOURCE_GROSS_MISMATCH")
    integrated = read_regular(release / "config/integratedProductionRiskPolicy.ts", 131072).decode("utf-8")
    require(all(t in integrated for t in (
        "cryptoGrossCap: 3.0", "totalGrossCap: 4.25",
        "stockGrossCap: Number(v52V50Runtime.stockAggregateGross)",
        "hypeLongMaximumGross: 1.5", "cryptoDailyLossPct: 7.5",
    )), "DD30_INTEGRATED_ADOPTED_GROSS_MISMATCH")
    hype = read_regular(release / "config/hypeTrendLongPolicy.ts", 32768).decode("utf-8")
    require("maximumGross: 1.5" in hype, "DD30_HYPE_ADOPTED_SOURCE_GROSS_MISMATCH")


def check_running_gross_env(raw: bytes, runner: str) -> None:
    # Only allowlisted numeric keys are inspected; never include credentials
    # or the full process environment in a log/error.
    expected = adopted_gross_env(runner)
    observed = {}
    for item in raw.split(b"\0"):
        key, sep, value = item.partition(b"=")
        if sep and key in {name.encode("ascii") for name in expected}:
            name = key.decode("ascii")
            require(name not in observed, "DD30_DUPLICATE_GROSS_ENV:" + runner + ":" + name)
            observed[name] = value
    for key, value in expected.items():
        require(observed.get(key) == value.encode("ascii"),
                "DD30_EFFECTIVE_GROSS_MISMATCH:" + runner + ":" + key)


def verify_running_gross_env(unit: str, runner: str) -> None:
    require(unit_active(unit), "DD30_GROSS_RUNNER_INACTIVE:" + runner)
    pid = int(unit_property(unit, "MainPID") or "0")
    require(pid > 100, "DD30_GROSS_PID_INVALID:" + runner)
    # /proc environ is read only while the unit is running.  ExecStart uses
    # /usr/bin/env to set the same numeric values after EnvironmentFiles have
    # been loaded, so inherited stale values cannot override this contract.
    check_running_gross_env(Path(f"/proc/{pid}/environ").read_bytes(), runner)
    require(unit_property(unit, "MainPID") == str(pid), "DD30_GROSS_PID_CHANGED:" + runner)


def dropin_text(runner: str, target: str, unit: str) -> str:
    root = f"/home/deploy/disdex-trading/releases/{target}"
    common = ["[Unit]", "Requires=", "Wants=", "Wants=network-online.target", "After=", "After=network-online.target", "[Service]", f"WorkingDirectory={root}", f"Environment=DISDEX_RELEASE_SHA={target}", f"Environment=DISDEX_RUNTIME_COMMIT_SHA={target}", f"Environment=DISDEX_RELEASE_ROOT={root}", "ExecStartPre=", f"ExecStartPre=/usr/bin/test -f {root}/.disdex-release-sha", f"ExecStartPre=/usr/bin/grep -Fxq {target} {root}/.disdex-release-sha", "ExecStart="]
    if runner == "V12_V4":
        common.insert(common.index("Wants="), f"Requires=disdex-v4-rate-budget-broker@{target}.service")
        common.insert(common.index("After=") + 2, f"After=disdex-v4-rate-budget-broker@{target}.service")
    if runner == "V12_V4":
        # The installed V4 template has a required per-release current-runtime
        # EnvironmentFile. The audited VPS does not provision that file for a
        # fresh immutable candidate, so clear inherited EnvironmentFile entries
        # and retain only the three reviewed, present shared V4 inputs. This is
        # fail-closed for missing files while preserving the base credentials,
        # risk settings, and V4 path configuration; no secret file is created.
        common += ["EnvironmentFile=", "EnvironmentFile=/etc/disdex/disdex-v13d-v11eq-v96.env", "EnvironmentFile=/etc/disdex/disdex-v12-pengu-v2-v52.env", "EnvironmentFile=/etc/disdex/disdex-v12-v4.env", "Environment=DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET=/run/disdex-v4-budget-" + target + "/budget.sock", "Environment=V12_V4_OPERATION_MODE=MONITOR_ONLY", "Environment=V12_V4_ORDERS_ENABLED=false", f"Environment=V12_V4_SERVICE_UNIT={unit}", "Environment=V12_V4_HEALTH_STATE_PATH=/var/lib/disdex/v12-v4/heartbeat.json", f"ExecStart=/bin/sh -ec 'export V12_V4_OPERATION_MODE=MONITOR_ONLY V12_V4_ORDERS_ENABLED=false DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=/var/lib/disdex/shared/aster-rate-budget.json DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET=/run/disdex-v4-budget-{target}/budget.sock; exec {root}/node_modules/.bin/tsx scripts/v12-v4-production-runner.ts --monitor-only --daemon'", "ReadWritePaths=/var/lib/disdex/v12-v4 /var/lib/disdex/shared /var/lib/disdex/runner-health"]
    elif runner == "PENGU_V8":
        common += ["Environment=PENGU_DUAL_LS_V2_MODE=SHADOW", "Environment=PENGU_DUAL_LS_V2_MONITOR_POLL_MS=5000", "Environment=PENGU_DUAL_LS_V2_ENABLED=true", "Environment=PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED=false", "Environment=PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED=false", "Environment=PENGU_DUAL_LS_V2_STATE_DIR=" + str(MONITOR_ROOT / target / "pengu"), "Environment=PENGU_DUAL_LS_V2_MONITOR_TICK_PATH=" + str(MONITOR_ROOT / target / "pengu" / "monitor-tick.json"), "Environment=PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT=7.5", f"ExecStart=/bin/sh -ec 'export PENGU_DUAL_LS_V2_MODE=SHADOW PENGU_DUAL_LS_V2_ENABLED=true PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED=false PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED=false PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT=7.5 DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT=7.5; exec {root}/node_modules/.bin/tsx scripts/disdex-pengu-dual-ls-v2-live-runner.ts --daemon'", f"ReadWritePaths={MONITOR_ROOT / target / 'pengu'} /var/lib/disdex/shared"]
    elif runner == "QUALITY102_CAUSAL_V1":
        common += ["Environment=QUALITY102_CAUSAL_V1_MODE=LIVE", "Environment=QUALITY102_CAUSAL_V1_MONITOR_ONLY=true", "Environment=QUALITY102_CAUSAL_V1_ENABLED=false", "Environment=QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED=false", "Environment=QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false", "Environment=QUALITY102_CAUSAL_V1_OPERATOR_ARMED=false", "Environment=QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4", "Environment=QUALITY102_CAUSAL_V1_LIVE_ACK=" + target, "Environment=QUALITY102_CAUSAL_V1_SYMBOLS=SUIUSDT,SEIUSDT,APTUSDT,ARBUSDT,OPUSDT,ENAUSDT,ONDOUSDT,FILUSDT,TRXUSDT", "Environment=QUALITY102_LIVE_SELECTOR_PARITY=false", "Environment=QUALITY102_LIVE_ENABLED=false", "Environment=QUALITY102_CAUSAL_V1_MAX_GROSS=3.0", "Environment=QUALITY102_CAUSAL_V1_PREFLIGHT_HISTORY_CHECK=false", "Environment=QUALITY102_CAUSAL_V1_MONITOR_SERVICE_UNIT=" + unit, "Environment=QUALITY102_CAUSAL_V1_MONITOR_HEALTH_PATH=/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json", "Environment=QUALITY102_CAUSAL_V1_MONITOR_TICK_PATH=/var/lib/disdex/runner-health/ticks/quality102-causal-v1.json", f"ExecStart=/bin/sh -ec 'export QUALITY102_CAUSAL_V1_MODE=LIVE QUALITY102_CAUSAL_V1_MONITOR_ONLY=true QUALITY102_CAUSAL_V1_ENABLED=false QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED=false QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false QUALITY102_CAUSAL_V1_OPERATOR_ARMED=false DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT=7.5 QUALITY102_CAUSAL_V1_MAX_DAILY_LOSS_PCT=7.5 DISDEX_RUNTIME_COMMIT_SHA={target} DISDEX_RELEASE_SHA={target} DISDEX_RUNTIME_SHA={target} DISDEX_RELEASE_ROOT={root} QUALITY102_CAUSAL_V1_LIVE_ACK={target} QUALITY102_CAUSAL_V1_SYMBOLS=SUIUSDT,SEIUSDT,APTUSDT,ARBUSDT,OPUSDT,ENAUSDT,ONDOUSDT,FILUSDT,TRXUSDT QUALITY102_LIVE_SELECTOR_PARITY=false QUALITY102_LIVE_ENABLED=false QUALITY102_CAUSAL_V1_MAX_GROSS=3.0 QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4; exec {root}/node_modules/.bin/tsx scripts/disdex-quality102-causal-v1-monitor.ts --daemon'", "ReadWritePaths=/var/lib/disdex/runner-health/heartbeats /var/lib/disdex/runner-health/ticks /var/lib/disdex/shared /var/lib/disdex/quality102-causal-v1"]
    elif runner == "V52":
        common += ["Environment=DISDEX_MONITOR_NEW_ORDERS_ALLOWED=false", "Environment=DISDEX_V52_MONITOR_ONLY=true", "Environment=DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=false", "Environment=DISDEX_V52_ASTER_ONLY_LIVE_ACKNOWLEDGEMENT=I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY", "Environment=DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=/var/lib/disdex/shared/aster-rate-budget.json", "Environment=DISDEX_V52_MONITOR_HEALTH_PATH=/var/lib/disdex/runner-health/heartbeats/v52.json", "Environment=DISDEX_V52_MONITOR_TICK_PATH=/var/lib/disdex/runner-health/ticks/v52-monitor.json", "Environment=DISDEX_V52_MONITOR_SERVICE_UNIT=" + unit, f"ExecStartPre=/usr/bin/test -f {root}/scripts/disdex_v52_aster_only_live_engine.py", f"ExecStart=/bin/sh -ec 'export DISDEX_V52_MONITOR_ONLY=true DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=false DISDEX_MONITOR_NEW_ORDERS_ALLOWED=false; exec /usr/bin/python3 {root}/scripts/disdex_v52_aster_only_live_engine.py --mode live --daemon --monitor-only-daemon'", "ReadWritePaths=/var/lib/disdex/runner-health/heartbeats /var/lib/disdex/runner-health/ticks /var/lib/disdex/v52-monitor"]
    elif runner == "FET_BRK48_RESIDUAL":
        common += ["Environment=DISDEX_Q102_RUNTIME_SHA=" + target, "Environment=FET_BRK48_SHADOW_STATE_PATH=" + str(MONITOR_ROOT / target / "fet" / "shadow.json"), f"ExecStart={root}/node_modules/.bin/tsx scripts/disdex-fet-brk48-shadow-runner.ts --daemon", f"ReadWritePaths={MONITOR_ROOT / target / 'fet'} /var/lib/disdex/shared"]
    elif runner == "IDLE_PRIORITY_SHORT":
        common += ["Environment=DISDEX_RUNTIME_SHA=" + target, "Environment=DISDEX_IDLE_PRIORITY_MODE=SHADOW", "Environment=DISDEX_IDLE_PRIORITY_POLL_MS=5000", "Environment=DISDEX_IDLE_PRIORITY_ENABLED=true", "Environment=DISDEX_IDLE_PRIORITY_OPERATOR_ARMED=false", "Environment=DISDEX_IDLE_RESIDUAL_LONG_ENABLED=false", "Environment=DISDEX_IDLE_RESIDUAL_LONG_OPERATOR_ARMED=false", "Environment=DISDEX_IDLE_PRIORITY_STATE_PATH=" + str(MONITOR_ROOT / target / "idle" / "state.json"), "Environment=DISDEX_IDLE_PRIORITY_DECISION_PATH=" + str(MONITOR_ROOT / target / "idle" / "decision.json"), "Environment=DISDEX_IDLE_PRIORITY_DECISION_DETAILS_PATH=" + str(MONITOR_ROOT / target / "idle" / "decision-details.json"), f"ExecStart={root}/node_modules/.bin/tsx {root}/scripts/disdex-idle-priority-short-live-runner.ts --daemon", f"ReadWritePaths={MONITOR_ROOT / target / 'idle'} /var/lib/disdex/shared"]
    elif runner == "HYPE_TREND_LONG":
        # The base HYPE template loads SHA-pinned current-runtime EnvironmentFile
        # entries after the shared contract. Clear inherited entries before
        # re-adding only the audited shared inputs so monitor-only flags cannot
        # be overridden back to LIVE or operator-armed state.
        common += ["EnvironmentFile=", "EnvironmentFile=/etc/disdex/disdex-v13d-v11eq-v96.env", "EnvironmentFile=/etc/disdex/disdex-v12-pengu-v2-v52.env", "EnvironmentFile=-/etc/disdex/disdex-quality102-causal-v1.env", "Environment=DISDEX_HYPE_ZEC_MODE=SHADOW", "Environment=DISDEX_HYPE_ZEC_ENABLED=true", "Environment=DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED=false", "Environment=DISDEX_HYPE_ZEC_PRODUCTION_CONFIG_LIVE_ENABLED=false", "Environment=DISDEX_HYPE_ZEC_OPERATOR_ARMED=false", "Environment=DISDEX_HYPE_ZEC_SIGNAL_MODE=TREND", "Environment=DISDEX_HYPE_ZEC_SYMBOLS=HYPEUSDT", "Environment=DISDEX_HYPE_MONITOR_POLL_MS=5000", "Environment=DISDEX_HYPE_ZEC_RUNTIME_SHA=" + target, "Environment=DISDEX_HYPE_ZEC_STATE_PATH=" + str(MONITOR_ROOT / target / "hype" / "runner.json"), f"ExecStart={root}/node_modules/.bin/tsx scripts/disdex-hype-trend-live-runner.ts --daemon", f"ReadWritePaths={MONITOR_ROOT / target / 'hype'} /var/lib/disdex/shared"]
    else:
        raise ContractError("MONITOR_RUNNER_UNKNOWN:" + runner)
    # Environment= is useful for systemd diagnostics, but a later
    # EnvironmentFile may override it. Bind the numeric cap values again
    # at the final exec boundary without changing any entrypoint/monitor flag.
    gross = adopted_gross_env(runner)
    assignments = " ".join(f"{key}={value}" for key, value in gross.items())
    common += [f"Environment={key}={value}" for key, value in gross.items()]
    launches = [line for line in common if line.startswith("ExecStart=") and line != "ExecStart="]
    require(len(launches) == 1, "DD30_GROSS_LAUNCH_CONTRACT_INVALID:" + runner)
    launch = launches[0]
    common[common.index(launch)] = "ExecStart=/usr/bin/env " + assignments + " " + launch[len("ExecStart="):]
    return "\n".join(common) + "\n"


def install_state_dirs(target: str) -> None:
    root = MONITOR_ROOT / target
    require(not MONITOR_ROOT.is_symlink(), "MONITOR_STATE_ROOT_SYMLINK")
    if MONITOR_ROOT.exists():
        require(MONITOR_ROOT.is_dir() and MONITOR_ROOT.stat().st_uid == 0 and stat.S_IMODE(MONITOR_ROOT.stat().st_mode) & 0o022 == 0, "MONITOR_STATE_ROOT_UNSAFE")
    else:
        MONITOR_ROOT.mkdir(mode=0o755, parents=False)
        os.chown(MONITOR_ROOT, 0, 0)
        os.chmod(MONITOR_ROOT, 0o755)
    require(not root.exists(), "MONITOR_STATE_DIR_ALREADY_EXISTS")
    require(pwd is not None, "DEPLOY_USER_DATABASE_UNAVAILABLE")
    deploy = pwd.getpwnam("deploy")
    for child in (root, root / "pengu", root / "fet", root / "idle", root / "hype"):
        child.mkdir(mode=0o700, parents=True, exist_ok=False)
        os.chown(child, deploy.pw_uid, deploy.pw_gid)
        os.chmod(child, 0o700)


def q102_metadata_valid(
    parent_uid: int, parent_gid: int, parent_mode: int,
    state_uid: int, state_gid: int, state_mode: int,
    deploy_uid: int, deploy_gid: int,
) -> bool:
    private_parent = (
        parent_uid == deploy_uid and parent_gid == deploy_gid and parent_mode == 0o700
    ) or (
        parent_uid == 0 and parent_mode in {0o700, 0o710}
    )
    private_state = (
        state_uid == 0 and state_gid == deploy_gid and state_mode == 0o640
    ) or (
        state_uid == deploy_uid and state_gid == deploy_gid and state_mode in {0o600, 0o660}
    ) or (
        state_uid == 0 and state_gid == 0 and state_mode == 0o600
    )
    return private_parent and private_state


def prepare_q102_state_access(state_path: Path) -> None:
    """Validate the canonical private Q102 state contract without chowning it."""
    require(pwd is not None, "DEPLOY_USER_DATABASE_UNAVAILABLE")
    parent = state_path.parent
    require(parent.is_dir() and not parent.is_symlink(), "Q102_STATE_PARENT_INVALID")
    before = hashlib.sha256(read_regular(state_path)).hexdigest()
    deploy = pwd.getpwnam("deploy")
    parent_st = parent.stat()
    state_st = state_path.stat()
    require(q102_metadata_valid(
        parent_st.st_uid, parent_st.st_gid, stat.S_IMODE(parent_st.st_mode),
        state_st.st_uid, state_st.st_gid, stat.S_IMODE(state_st.st_mode),
        deploy.pw_uid, deploy.pw_gid,
    ), "Q102_STATE_METADATA_UNTRUSTED")
    require(hashlib.sha256(read_regular(state_path)).hexdigest() == before, "Q102_STATE_BYTES_CHANGED")


def stage_candidate(tar_path: Path, manifest_path: Path, target: str) -> None:
    release = BASE / target
    stage = BASE / ("." + target + ".stage")
    require(not release.exists() and not release.is_symlink() and not stage.exists() and not stage.is_symlink(), "TARGET_RELEASE_ALREADY_EXISTS")
    listing = run("/usr/bin/tar", "-tzf", str(tar_path), timeout=120)
    for name in listing.splitlines():
        require(name and not name.startswith("/") and ".." not in Path(name).parts, "CANDIDATE_ARCHIVE_PATH_INVALID")
    stage.mkdir(mode=0o755)
    try:
        run("/usr/bin/tar", "--extract", "--gzip", "--file", str(tar_path), "--directory", str(stage), "--no-same-owner", "--no-same-permissions", timeout=180)
        for path in stage.rglob("*"):
            require(not path.is_symlink(), "CANDIDATE_ARCHIVE_SYMLINK_FORBIDDEN")
        marker = stage / ".disdex-release-sha"
        marker.write_text(target + "\n", encoding="ascii")
        current = CURRENT.resolve()
        for dep in ("node_modules", ".venv2"):
            source = current / dep
            require(source.exists(), "CURRENT_DEPENDENCY_MISSING:" + dep)
            (stage / dep).symlink_to(source, target_is_directory=True)
        manifest = read_json(manifest_path)
        require(manifest.get("targetSha") == target, "CANDIDATE_MANIFEST_TARGET_INVALID")
        for rel, expected in (manifest.get("files") or {}).items():
            path = stage / rel
            require(path.is_file() and not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest() == expected, "CANDIDATE_SOURCE_HASH_MISMATCH:" + str(rel))
        # Validate the immutable Git archive first; the reviewed V4 overlay is
        # then expanded deterministically into the release paths it declares.
        materialize_v4_staged_overlay(stage)
        harden_immutable_tree(stage)
        os.replace(stage, release)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def v52_instance_text(target: str, margin_unit: str) -> bytes:
    raw = read_regular(V52_TEMPLATE, 256_000)
    require(hashlib.sha256(raw).hexdigest() == V52_TEMPLATE_SHA256, "V52_TEMPLATE_SHA_MISMATCH")
    text = raw.decode("utf-8")
    old_after = "After=network-online.target disdex-stock-reference-free.service disdex-v12-v52-margin-guard@%i.service"
    old_requires = "Requires=disdex-stock-reference-free.service disdex-v12-v52-margin-guard@%i.service"
    require(text.count(old_after) == 1 and text.count(old_requires) == 1, "V52_TEMPLATE_DEPENDENCIES_UNEXPECTED")
    return text.replace(old_after, "After=network-online.target disdex-stock-reference-free.service " + margin_unit).replace(old_requires, "Requires=disdex-stock-reference-free.service " + margin_unit).encode("utf-8")


def pengu_instance_text(target: str, margin_unit: str, risk_unit: str) -> bytes:
    """Bind a no-order PENGU monitor to the reviewed canonical safety writers.

    systemd dependency lists cannot be cleared from a drop-in. A same-SHA
    template otherwise pulls in duplicate Margin Guard and Shared Risk units.
    """
    require(TARGET_SHA_RE.fullmatch(target) is not None, "PENGU_TARGET_SHA_INVALID")
    for unit, family in ((margin_unit, "disdex-v12-v52-margin-guard"), (risk_unit, "disdex-shared-crypto-risk")):
        match = INSTANCE_UNIT_RE.fullmatch(unit)
        require(match is not None and match.group("base") == family, "PENGU_SAFETY_PIN_INVALID")
        require(match.group("sha") != target, "PENGU_SAFETY_PIN_CANDIDATE_WRITER")
    raw = read_regular(PENGU_TEMPLATE, 256_000)
    require(hashlib.sha256(raw).hexdigest() == PENGU_TEMPLATE_SHA256, "PENGU_TEMPLATE_SHA_MISMATCH")
    text = raw.decode("utf-8")
    previous = "network-online.target disdex-shared-crypto-risk@%i.service disdex-v12-v52-margin-guard@%i.service"
    updated = "network-online.target " + risk_unit + " " + margin_unit
    for directive in ("After=", "Wants="):
        require(text.count(directive + previous) == 1, "PENGU_TEMPLATE_DEPENDENCIES_UNEXPECTED")
        text = text.replace(directive + previous, directive + updated, 1)
    require("disdex-shared-crypto-risk@%i.service" not in text and "disdex-v12-v52-margin-guard@%i.service" not in text,
            "PENGU_TEMPLATE_SAME_SHA_DEPENDENCY_REMAINS")
    return text.encode("utf-8")


def validate_pengu_safety_dependencies(unit: str, margin_unit: str, risk_unit: str) -> None:
    expected = {margin_unit, risk_unit}
    prefixes = ("disdex-v12-v52-margin-guard@", "disdex-shared-crypto-risk@")
    for property_name in ("After", "Wants"):
        actual = {value for value in unit_property(unit, property_name).split() if value.startswith(prefixes)}
        require(actual == expected, "PENGU_EFFECTIVE_SAFETY_DEPENDENCY_MISMATCH:" + property_name)
    requires = {value for value in unit_property(unit, "Requires").split() if value.startswith(prefixes)}
    require(requires.issubset(expected), "PENGU_EFFECTIVE_SAFETY_DEPENDENCY_MISMATCH:Requires")


def target_pins(raw: bytes, target: str, units: dict[str, str]) -> bytes:
    value = json.loads(raw.decode("utf-8"))
    rows = value.get("runners") or {}
    require(all(key in rows for key in RUNNER_IDS), "PIN_RUNNER_SET_INCOMPLETE")
    for key in RUNNER_IDS:
        row = rows[key]
        require(str(row.get("sha")) != target, "PIN_ALREADY_TARGET:" + key)
        row["sha"] = target
        row["releaseRoot"] = str(BASE / target)
        row["serviceUnit"] = units[key]
        row["monitorOnly"] = True
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def _auxiliary_sha(value: dict, roots: dict, key: str) -> str:
    root_text = str(roots.get(key) or "")
    require(root_text, "CURRENT_PLAN_AUXILIARY_ROOT_MISSING:" + key)
    marker = Path(root_text) / ".disdex-release-sha"
    candidate = ""
    if marker.is_file() and not marker.is_symlink():
        try:
            candidate = marker.read_text(encoding="ascii").strip()
        except Exception as exc:
            raise ContractError("CURRENT_PLAN_AUXILIARY_MARKER_UNREADABLE:" + key) from exc
    if not candidate:
        candidate = str(value.get(key + "Sha") or "")
    require(TARGET_SHA_RE.fullmatch(candidate) is not None, "CURRENT_PLAN_AUXILIARY_SHA_INVALID:" + key)
    return candidate


def canonicalize_release_roots(value: dict) -> dict:
    legacy_roots = value.get("releaseRoots") or {}
    require(isinstance(legacy_roots, dict), "CURRENT_PLAN_RELEASE_ROOTS_INVALID")
    ui_root = str(legacy_roots.get("ui") or "")
    monitor_root = str(legacy_roots.get("monitor") or "")
    require(ui_root and monitor_root, "CURRENT_PLAN_AUXILIARY_ROOT_MISSING")
    value["uiSha"] = _auxiliary_sha(value, legacy_roots, "ui")
    value["monitorSha"] = _auxiliary_sha(value, legacy_roots, "monitor")
    # Root validation requires exactly the three lineage roots. The prior
    # current-plan carried one releaseRoot per Runner, which made the pinned
    # Shared Risk prestart fail closed before it could refresh its evidence.
    value["releaseRoots"] = {
        "runners": str(BASE),
        "ui": ui_root,
        "monitor": monitor_root,
    }
    return value


def target_plan(raw: bytes, target: str) -> bytes:
    value = json.loads(raw.decode("utf-8"))
    require(value.get("ordersEnabled") is False, "CURRENT_PLAN_ORDERS_NOT_DISABLED")
    value["scope"] = "FULL_PROJECT"
    value["sourceSha"] = target
    runners = value.setdefault("runners", {})
    for key in RUNNER_IDS:
        require(key in runners and runners[key] != target, "CURRENT_PLAN_RUNNER_INVALID:" + key)
        runners[key] = target
    value = canonicalize_release_roots(value)
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def validate_target_unit(unit: str, target: str, runner: str) -> None:
    require(unit_property(unit, "LoadState") == "loaded", "TARGET_UNIT_NOT_LOADED:" + runner)
    require(not unit_active(unit), "TARGET_UNIT_ALREADY_ACTIVE:" + runner)
    text = run("/usr/bin/systemctl", "cat", unit, timeout=30)
    require(target in text and "/home/deploy/disdex-trading/releases/" + target in text, "TARGET_UNIT_RELEASE_NOT_BOUND:" + runner)
    expected = {
        "V12_V4": "--monitor-only --daemon", "PENGU_V8": "PENGU_DUAL_LS_V2_MODE=SHADOW", "QUALITY102_CAUSAL_V1": "disdex-quality102-causal-v1-monitor.ts --daemon", "V52": "--monitor-only-daemon", "FET_BRK48_RESIDUAL": "disdex-fet-brk48-shadow-runner.ts --daemon", "IDLE_PRIORITY_SHORT": "DISDEX_IDLE_PRIORITY_MODE=SHADOW", "HYPE_TREND_LONG": "DISDEX_HYPE_ZEC_MODE=SHADOW",
    }[runner]
    require(expected in text, "TARGET_MONITOR_CONTRACT_MISSING:" + runner)


def verify_environment(unit: str, runner: str) -> None:
    env = unit_property(unit, "Environment")
    required = {
        "V12_V4": ("V12_V4_OPERATION_MODE=MONITOR_ONLY", "V12_V4_ORDERS_ENABLED=false"),
        "PENGU_V8": ("PENGU_DUAL_LS_V2_MODE=SHADOW", "PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED=false"),
        "QUALITY102_CAUSAL_V1": ("QUALITY102_CAUSAL_V1_MONITOR_ONLY=true", "QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false"),
        "V52": ("DISDEX_V52_MONITOR_ONLY=true", "DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=false"),
        "FET_BRK48_RESIDUAL": ("FET_BRK48_SHADOW_STATE_PATH=",),
        "IDLE_PRIORITY_SHORT": ("DISDEX_IDLE_PRIORITY_MODE=SHADOW", "DISDEX_IDLE_PRIORITY_ENABLED=true"),
        "HYPE_TREND_LONG": ("DISDEX_HYPE_ZEC_MODE=SHADOW", "DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED=false"),
    }[runner]
    require(all(item in env for item in required), "TARGET_ENVIRONMENT_NOT_MONITOR_ONLY:" + runner)


def validate_evidence(path: Path, target: str, runner: str) -> None:
    value = read_json(path)
    for key in ("ordersSent", "cancelsSent", "cancelSent", "positionChangesSent"):
        if key in value:
            require(value.get(key) in (0, False), "MONITOR_MUTATION_NONZERO:" + runner + ":" + key)
    for key in ("runtimeSha", "expectedSha", "releaseSha"):
        if key in value:
            require(str(value.get(key)).lower() == target, "MONITOR_SHA_MISMATCH:" + runner)
    if runner in {"V12_V4", "QUALITY102_CAUSAL_V1", "V52"}:
        # V4's canonical runner-health tick predates the generic mode field:
        # it proves monitor-only authority with newOrdersAllowed=false and the
        # explicit V4 safety-block reason.  Accept that reviewed schema only
        # for V4; Q102/V52 must continue to carry mode=MONITOR_ONLY.
        if runner == "V12_V4" and "mode" not in value:
            require(value.get("schema") == "disdex-runner-tick/v1" and value.get("runnerId") == "V12_V4", "MONITOR_HEARTBEAT_SCHEMA_INVALID:" + runner)
        else:
            require(value.get("mode") == "MONITOR_ONLY", "MONITOR_HEARTBEAT_MODE_INVALID:" + runner)
        require(value.get("newOrdersAllowed") is False, "MONITOR_HEARTBEAT_ORDER_AUTHORITY_INVALID:" + runner)
        status = str(value.get("status", ""))
        if runner == "V12_V4" and status == "blocked":
            # The shared Kill Switch is intentionally retained during this
            # monitor-only cutover.  Accept only the explicit V4 safety block
            # as a fresh monitor heartbeat; never reinterpret it as order
            # authority or clear the underlying protection.
            reason = str(value.get("reason", ""))
            require(reason.startswith("V4_MONITOR_ENTRY_SAFETY_BLOCKED:") and "V4_KILL_SWITCH_ACTIVE" in reason, "MONITOR_HEARTBEAT_NOT_OBSERVING:" + runner)
        else:
            require(status == "observing", "MONITOR_HEARTBEAT_NOT_OBSERVING:" + runner)
    else:
        if "mode" in value:
            require(str(value.get("mode")).upper() == "SHADOW", "SHADOW_EVIDENCE_MODE_INVALID:" + runner)


def poll_cycles(target: str, units: dict[str, str], paths: dict[str, Path], restart_before: dict[str, str], timeout: int = 600) -> None:
    previous: dict[str, tuple[int, str]] = {}
    seen = {runner: 0 for runner in RUNNER_IDS}
    for runner, path in paths.items():
        if path.is_file() and not path.is_symlink():
            previous[runner] = (path.stat().st_mtime_ns, hashlib.sha256(path.read_bytes()).hexdigest())
        else:
            previous[runner] = (0, "")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline and min(seen.values()) < 3:
        health = unit_health_snapshot(units)
        for runner in RUNNER_IDS:
            unit = units[runner]
            require(health[unit]["ActiveState"] == "active", "TARGET_RUNNER_LOST_ACTIVE:" + runner)
            path = paths[runner]
            if not path.is_file() or path.is_symlink():
                continue
            current = (path.stat().st_mtime_ns, hashlib.sha256(path.read_bytes()).hexdigest())
            # V4 uses a shared tick path, so a prior-generation heartbeat can
            # legitimately exist before the new unit publishes its first tick.
            # Do not treat that stale evidence as the candidate's identity; wait
            # for an atomic file change, then validate the new content strictly.
            if current == previous[runner]:
                continue
            validate_evidence(path, target, runner)
            seen[runner] += 1
            previous[runner] = current
        for runner, unit in units.items():
            require(health[unit]["NRestarts"] == restart_before[runner], "TARGET_RESTART_COUNT_CHANGED:" + runner)
        if min(seen.values()) < 3:
            time.sleep(3)
    if min(seen.values()) < 3:
        detail = ",".join(f"{runner}={seen[runner]}" for runner in RUNNER_IDS)
        raise ContractError("THREE_MONITOR_CYCLES_NOT_OBSERVED:" + detail)



def discover_stale_instance_units(protected_units: set[str], target_units_set: set[str]) -> list[str]:
    """Return only active non-pinned instances from audited runner families.

    A previous failed cutover can leave a missing-release instance in
    activating/auto-restart.  Restrict discovery to the allow-listed families,
    preserve every currently pinned service and the new target units, and do
    not touch failed/inactive historical units.
    """
    rows = run(
        "/usr/bin/systemctl",
        "list-units",
        "--all",
        "--type=service",
        "--plain",
        "--no-legend",
        "--no-pager",
        timeout=60,
    )
    candidates: set[str] = set()
    for raw in rows.splitlines():
        unit = raw.strip().split(None, 1)[0] if raw.strip() else ""
        match = INSTANCE_UNIT_RE.fullmatch(unit)
        if not match or unit in protected_units or unit in target_units_set:
            continue
        state = unit_property(unit, "ActiveState")
        if state in {"active", "activating", "deactivating", "reloading"}:
            candidates.add(unit)
    return sorted(candidates)


def validate_token(token: str, public_key: Path, target: str, execution_plan_sha256: str, approval_id: str) -> None:
    require(UUID_RE.fullmatch(approval_id) is not None and token and len(token) <= 16_384, "APPROVAL_INPUT_INVALID")
    require(public_key.is_file() and not public_key.is_symlink(), "OWNER_PUBLIC_KEY_MISSING")
    verify_owner_token(token, public_key, REPO, target, SCOPE, OPERATOR, execution_plan_sha256, route=ROUTE, deployment_target=TARGET_HOST, operator_target=OPERATOR_TARGET, orders_enabled=False)


def _shared_risk_tick() -> int:
    risk = read_json(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is False, "SHARED_RISK_REPAIR_NOT_HEALTHY")
    require(abs(float(risk.get("maximumLossPct")) - 7.5) < 1e-9, "SHARED_RISK_REPAIR_LIMIT_MISMATCH")
    updated = risk.get("updatedAt")
    require(isinstance(updated, int) and updated > 0, "SHARED_RISK_REPAIR_TIMESTAMP_INVALID")
    return updated


def repair_current_plan_roots() -> tuple[bytes, tuple[int, int, int], bool]:
    raw = read_regular(CURRENT_PLAN, 131_072)
    current = json.loads(raw.decode("utf-8"))
    require(current.get("ordersEnabled") is False, "CURRENT_PLAN_ORDERS_NOT_DISABLED")
    pins = json.loads(read_regular(PINS, 131_072).decode("utf-8"))
    rows = pins.get("runners") or {}
    pin_values = {str(key): str(row.get("sha") or "") for key, row in rows.items() if isinstance(row, dict)}
    require(pin_values and current.get("runners") == pin_values, "CURRENT_PLAN_PIN_BINDING_INVALID")
    repaired = canonicalize_release_roots(current)
    encoded = (json.dumps(repaired, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")
    metadata = file_meta(CURRENT_PLAN)
    if encoded == raw:
        return raw, metadata, False
    write_atomic(CURRENT_PLAN, encoded, metadata)
    run("/usr/bin/systemctl", "daemon-reload", timeout=30)
    return raw, metadata, True


def repair_shared_risk_writer(pins_raw: bytes, timeout: int = 360) -> list[int]:
    """Restart the already pinned no-order Shared Risk Writer and prove real ticks.

    This is a bounded maintenance step inside the approved monitor-only goal. It
    never edits the HOLD, sends venue mutations, enables orders, or changes the
    pinned Shared Risk SHA. The prestart hook remains the authority for exact
    plan, receipt, nonce, and single-writer checks.
    """
    pins = json.loads(pins_raw.decode("utf-8"))
    row = (pins.get("runners") or {}).get("SHARED_CRYPTO_RISK") or {}
    sha = str(row.get("sha") or "")
    unit = str(row.get("serviceUnit") or "")
    require(TARGET_SHA_RE.fullmatch(sha) is not None, "SHARED_RISK_PIN_SHA_INVALID")
    require(unit == f"disdex-shared-crypto-risk@{sha}.service", "SHARED_RISK_PIN_UNIT_INVALID")
    env_path = Path("/etc/disdex/current-runtime") / f"{sha}-shared-risk-scoped.env"
    env_text = read_regular(env_path, 16_384).decode("utf-8")
    require(
        re.search(r"(?m)^DISDEX_SHARED_RISK_ORDERS_ENABLED=false$",
                   env_text) is not None,
        "SHARED_RISK_ORDER_FLAG_NOT_FALSE",
    )
    _hold_raw, hold, _hold_digest = hold_snapshot()
    require(hold.get("active") is True and hold.get("action") == "HOLD_PROTECTED" and hold.get("scope") == "GLOBAL", "GLOBAL_HOLD_NOT_PROTECTED")
    current_plan = read_json(CURRENT_PLAN)
    require(current_plan.get("ordersEnabled") is False, "CURRENT_PLAN_ORDERS_NOT_DISABLED")
    before = _shared_risk_tick()
    run("/usr/bin/systemctl", "restart", unit, timeout=120)
    seen: list[int] = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline and len(seen) < 3:
        state = unit_property(unit, "ActiveState")
        require(state not in {"failed", "inactive", "dead"}, "SHARED_RISK_REPAIR_UNIT_NOT_ACTIVE")
        try:
            tick = _shared_risk_tick()
        except ContractError:
            tick = 0
        if tick > before and tick not in seen:
            seen.append(tick)
        if len(seen) < 3:
            time.sleep(5)
    require(len(seen) >= 3, "SHARED_RISK_REPAIR_REAL_REFRESH_TIMEOUT")
    require(unit_active(unit), "SHARED_RISK_REPAIR_UNIT_NOT_ACTIVE")
    return seen


def repair_shared_risk_only() -> None:
    original_raw, original_metadata, changed = repair_current_plan_roots()
    try:
        ticks = repair_shared_risk_writer(read_regular(PINS, 131_072))
        _hold_raw, hold, hold_digest = hold_snapshot()
        require(hold.get("active") is True and hold.get("action") == "HOLD_PROTECTED" and hold.get("scope") == "GLOBAL", "GLOBAL_HOLD_NOT_PROTECTED")
        print(json.dumps({
            "status": "SHARED_RISK_NO_ORDER_REPAIR_PASS",
            "ordersEnabled": False,
            "globalHoldDigest": hold_digest,
            "refreshes": len(ticks),
            "currentPlanCanonicalized": changed,
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
        }, sort_keys=True))
    except Exception:
        if changed:
            write_atomic(CURRENT_PLAN, original_raw, original_metadata)
            run("/usr/bin/systemctl", "daemon-reload", timeout=30)
        raise


def baseline(target: str, plan: dict, *, allow_stale_shared_risk: bool = False) -> tuple[bytes, bytes, bytes, str, dict[str, tuple[str, str]], dict[str, str], str]:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require(not (BASE / target).exists(), "TARGET_RELEASE_ALREADY_EXISTS")
    hold_raw, _hold, hold_digest = hold_snapshot()
    require(hold_digest == HOLD_DIGEST, "GLOBAL_HOLD_DIGEST_MISMATCH")
    pins_raw = read_regular(PINS, 131_072)
    plan_raw = read_regular(CURRENT_PLAN, 131_072)
    pins = json.loads(pins_raw.decode("utf-8")); current_plan = json.loads(plan_raw.decode("utf-8"))
    require(current_plan.get("ordersEnabled") is False, "CURRENT_PLAN_ORDERS_NOT_DISABLED")
    rows = pins.get("runners") or {}
    require(all(key in rows for key in RUNNER_IDS), "BASELINE_PIN_SET_INCOMPLETE")
    old_units = {key: str(rows[key].get("serviceUnit") or "") for key in RUNNER_IDS}
    require(all(unit and target not in unit for unit in old_units.values()), "BASELINE_ALREADY_TARGET")
    # A monitor-only candidate is not allowed to inherit simultaneous writers.
    # Preflight is read-only and fails closed; execute retires only scoped units.
    assert_single_shared_risk_writer(pins_raw)
    margin_unit = str((rows.get("MARGIN_GUARD") or {}).get("serviceUnit") or "")
    require(margin_unit, "MARGIN_GUARD_PIN_MISSING")
    validate_shared_files(margin_unit, allow_stale_shared_risk=allow_stale_shared_risk)
    states = {key: unit_state(unit) for key, unit in old_units.items()}
    observations = [signed_get() for _ in range(3)]
    require(len({stamp for stamp, _ in observations}) == 3 and len({inv for _, inv in observations}) == 1, "SIGNED_GET_BASELINE_CHANGED")
    q102_state = read_json(Path("/var/lib/disdex/quality102-causal-v1/state.json"))
    require(not q102_state.get("position") and not q102_state.get("pending"), "Q102_BASELINE_NOT_FLAT")
    return pins_raw, plan_raw, hold_raw, observations[-1][1], states, old_units, margin_unit


def execute(target: str, plan: dict, execution_plan_sha256: str, tar_path: Path, manifest_path: Path, token: str, public_key: Path, approval_id: str, run_id: str) -> None:
    validate_token(token, public_key, target, execution_plan_sha256, approval_id)
    pins_raw, plan_raw, hold_raw, baseline_inventory, old_states, old_units, margin_unit = baseline(target, plan, allow_stale_shared_risk=True)
    units = target_units(target)
    paths = evidence_paths(target)
    dropins = {runner: dropin_path(unit) for runner, unit in units.items()}
    instance = Path("/etc/systemd/system") / units["V52"]
    pengu_instance = Path("/etc/systemd/system") / units["PENGU_V8"]
    risk_unit = str((json.loads(pins_raw.decode("utf-8"))["runners"].get("SHARED_CRYPTO_RISK") or {}).get("serviceUnit") or "")
    q102_path = Path("/var/lib/disdex/quality102-causal-v1/state.json")
    file_snapshot = snapshot_paths([PINS, CURRENT_PLAN, q102_path, q102_path.parent, PENDING_PROOF, *dropins.values(), instance, pengu_instance])
    state_root_created = False
    release = BASE / target
    target_margin_unit = f"disdex-v12-v52-margin-guard@{target}.service"
    target_shared_risk_unit = f"disdex-shared-crypto-risk@{target}.service"
    target_v4_broker_unit = f"disdex-v4-rate-budget-broker@{target}.service"
    try:
        stage_candidate(tar_path, manifest_path, target)
        verify_adopted_gross_source(release)
        lock_recovered = recover_expired_account_lock(release, run_id)
        install_state_dirs(target); state_root_created = True
        # The V52 template has a same-SHA guard dependency. Clone only the
        # reviewed instance and bind it to the existing healthy Margin Guard.
        write_atomic(instance, v52_instance_text(target, margin_unit), (0, 0, 0o644))
        write_atomic(pengu_instance, pengu_instance_text(target, margin_unit, risk_unit), (0, 0, 0o644))
        for runner, unit in units.items():
            path = dropins[runner]
            path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            os.chown(path.parent, 0, 0); os.chmod(path.parent, 0o755)
            write_atomic(path, dropin_text(runner, target, unit).encode("utf-8"), (0, 0, 0o644))
        run("/usr/bin/systemctl", "daemon-reload", timeout=30)
        for runner, unit in units.items():
            validate_target_unit(unit, target, runner)
            verify_environment(unit, runner)
        validate_pengu_safety_dependencies(units["PENGU_V8"], margin_unit, risk_unit)
        # Reconcile immediately before quiescing any old process.
        _h, _v, hd = hold_snapshot(); require(hd == hashlib.sha256(hold_raw).hexdigest(), "GLOBAL_HOLD_CHANGED_PRECUTOVER")
        _stamp, inv = signed_get(); require(inv == baseline_inventory, "VENUE_CHANGED_PRECUTOVER")
        q102_before = read_json(q102_path)
        require(not q102_before.get("position") and not q102_before.get("pending"), "Q102_STATE_NOT_FLAT")
        prepare_q102_state_access(q102_path)
        q102_access_meta = file_meta(q102_path)
        # Stop all old runner instances plus the three audited stale
        # restart-loop units.  This is the only systemd quiesce; no order
        # endpoint is used.  The PENGU instance is a missing-release CHDIR
        # loop and is explicitly pinned here so the repair remains auditable.
        # Keep the pinned generation and audited canonical shared guards,
        # but discover every other active/restarting instance in the bounded
        # allow-list.  This closes the gap where a prior failed candidate left
        # a different SHA in auto-restart and stole the account lock.
        pinned_rows = (json.loads(pins_raw.decode("utf-8")).get("runners") or {})
        protected_units = set(old_units.values())
        for key in ("SHARED_CRYPTO_RISK", "MARGIN_GUARD"):
            row = pinned_rows.get(key) or {}
            service = str(row.get("serviceUnit") or "")
            if service:
                protected_units.add(service)
        stale_units = [
            f"disdex-quality102-causal-v1@{STALE_Q102}.service",
            f"disdex-v12-v52-margin-guard@{STALE_MARGIN}.service",
            f"disdex-v12-v52-margin-guard@{STALE_MARGIN_CANDIDATE}.service",
            f"disdex-pengu-dual-ls-v2@{STALE_PENGU}.service",
            # A prior failed candidate may have left its per-SHA Margin Guard
            # restart-loop unit behind. The monitor cutover never needs a
            # candidate-specific Margin Guard because V52 is bound to the
            # audited canonical guard; retire only this exact target unit.
            target_margin_unit,
        ]
        stale_units.extend(discover_stale_instance_units(protected_units, set(units.values())))
        for unit in sorted(set((*old_units.values(), *stale_units))):
            stop_unit(unit)
            run("/usr/bin/systemctl", "disable", unit, check=False, timeout=30)
        # A candidate writer can be disabled yet running. Enforce the
        # immutable single-writer invariant BEFORE any new Runner starts.
        shared_risk_retired = retire_non_pinned_shared_risk_writers(pins_raw, target)
        q102_state = dict(q102_before); q102_state["runtimeCommitSha"] = target
        write_atomic(q102_path, (json.dumps(q102_state, separators=(",", ":")) + "\n").encode("utf-8"), q102_access_meta)
        write_atomic(PINS, target_pins(pins_raw, target, units), file_snapshot[PINS][2] or (0, 0, 0o644))
        write_atomic(CURRENT_PLAN, target_plan(plan_raw, target), file_snapshot[CURRENT_PLAN][2] or (0, 0, 0o644))
        run("/usr/bin/systemctl", "daemon-reload", timeout=30)
        # The pinned Shared Risk Writer was previously trapped by the malformed
        # legacy current-plan. Repair it only after the canonical no-order
        # plan/pins are installed, then demand three new risk timestamps before
        # any target Runner is started.
        shared_risk_refreshes = repair_shared_risk_writer(read_regular(PINS, 131_072))
        validate_shared_files(margin_unit)
        pending_proof_digest = refresh_v4_pending_proof(target)
        for runner, unit in units.items():
            validate_target_unit(unit, target, runner)
            run("/usr/bin/systemctl", "start", unit, timeout=120)
            verify_environment(unit, runner)
        restart_snapshot = unit_health_snapshot(units)
        restart_before = {runner: restart_snapshot[unit]["NRestarts"] for runner, unit in units.items()}
        for runner, unit in units.items():
            require(restart_snapshot[unit]["ActiveState"] == "active", "TARGET_RUNNER_NOT_ACTIVE:" + runner)
            pid = int(unit_property(unit, "MainPID") or "0")
            require(pid > 100 and Path(f"/proc/{pid}/cwd").resolve() == release, "TARGET_RUNNER_CWD_MISMATCH:" + runner)
        poll_cycles(target, units, paths, restart_before)
        for runner, unit in units.items():
            verify_running_gross_env(unit, runner)
        assert_single_shared_risk_writer(read_regular(PINS, 131_072), target=target)
        final_reads = [signed_get() for _ in range(3)]
        require(len({stamp for stamp, _ in final_reads}) == 3 and all(inv == baseline_inventory for _, inv in final_reads), "SIGNED_GET_POSTCUTOVER_CHANGED")
        _h2, _v2, hd2 = hold_snapshot(); require(hd2 == HOLD_DIGEST, "GLOBAL_HOLD_MUTATED")
        require(not any(unit_active(unit) for unit in old_units.values()), "DUAL_RUNNER_ACTIVE")
        # Reconfirm singleton after final venue/HOLD reconciliation.
        validate_pengu_safety_dependencies(units["PENGU_V8"], margin_unit, risk_unit)
        assert_single_shared_risk_writer(read_regular(PINS, 131_072), target=target)
        print(json.dumps({"status": "STABLE4_DD30_MONITOR_CUTOVER_PASS", "targetSha": target,
                          "ownerGoalId": plan.get("ownerGoalId"),
                          "signedGetsBefore": 3, "signedGetsAfter": 3, "monitorCycles": 3,
                          "globalHoldDigest": hd2, "ordersEnabled": False,
                          "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0,
                          "oldGenerationActive": False, "staleLoopsRetired": True,
                          "accountLockRecovered": lock_recovered,
                          "sharedRiskRefreshes": len(shared_risk_refreshes),
                          "pendingProofDigest": pending_proof_digest,
                          "sharedRiskSingleWriter": True, "sharedRiskRetired": shared_risk_retired,
                          "effectiveGrossVerified": True,
                          "runnerGrossEnvironment": {runner: adopted_gross_env(runner) for runner in RUNNER_IDS},
                          "runnerUnits": units}, sort_keys=True))
    except Exception as exc:
        try:
            # Quiesce candidate units before any rollback read.  If the signed
            # read is unavailable, fail closed with the candidate stopped
            # instead of leaving a partial target running.
            for unit in (*units.values(), target_margin_unit, target_shared_risk_unit, target_v4_broker_unit):
                if unit_active(unit):
                    stop_unit(unit)
            _stamp, inv = signed_get(); require(inv == baseline_inventory, "ROLLBACK_VENUE_CHANGED_MANUAL_REVIEW")
            restore_paths(file_snapshot)
            run("/usr/bin/systemctl", "daemon-reload", timeout=30)
            for runner, unit in old_units.items():
                prior = old_states[runner][0]
                if prior == "active":
                    run("/usr/bin/systemctl", "start", unit, timeout=120)
            if release.exists() and not release.is_symlink():
                shutil.rmtree(release)
            if state_root_created:
                shutil.rmtree(MONITOR_ROOT / target, ignore_errors=True)
            print("ROLLBACK=SUCCESS", file=sys.stderr)
        except Exception as rollback_error:
            print("ROLLBACK=MANUAL_REVIEW_REQUIRED:" + safe_text(rollback_error), file=sys.stderr)
        raise ContractError("CUTOVER_BLOCKED:" + safe_text(exc)) from exc


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--preflight-readonly", action="store_true")
    group.add_argument("--repair-shared-risk", action="store_true")
    group.add_argument("--execute-approved", action="store_true")
    parser.add_argument("--target-sha", required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--execution-plan-sha256", required=True)
    parser.add_argument("--approval-id", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--public-key", type=Path, required=True)
    parser.add_argument("--tar", type=Path)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    try:
        require(TARGET_SHA_RE.fullmatch(args.target_sha) is not None, "TARGET_SHA_INVALID")
        plan = read_json(args.plan)
        validate_plan(plan, args.execution_plan_sha256)
        token = sys.stdin.read().strip()
        validate_token(token, args.public_key, args.target_sha, args.execution_plan_sha256, args.approval_id)
        if args.preflight_readonly:
            pins_raw, plan_raw, hold_raw, inventory, states, old_units, margin = baseline(args.target_sha, plan)
            print(json.dumps({"status": "STABLE4_DD30_MONITOR_PREFLIGHT_PASS", "targetSha": args.target_sha, "signedGets": 3, "ordersEnabled": False, "globalHoldDigest": hashlib.sha256(hold_raw).hexdigest(), "oldUnits": old_units, "marginGuardUnit": margin, "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}, sort_keys=True))
            return 0
        if args.repair_shared_risk:
            repair_shared_risk_only()
            return 0
        require(args.tar is not None and args.manifest is not None, "CANDIDATE_ARCHIVE_AND_MANIFEST_REQUIRED")
        execute(args.target_sha, plan, args.execution_plan_sha256, args.tar, args.manifest, token, args.public_key, args.approval_id, args.run_id)
        return 0
    except Exception as exc:
        print(json.dumps({"status": "STABLE4_DD30_MONITOR_CUTOVER_BLOCKED", "reason": safe_text(exc), "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
