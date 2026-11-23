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
MONITOR_ROOT = Path("/var/lib/disdex/stable4-dd30-monitor")
STALE_Q102 = "b8d681f048b087f07e0dcfb743cc14ec3a796b27"
STALE_MARGIN = "c7310d34ba1b6de07071d8883a2ed0de8dcce2a7"
STALE_PENGU = "2e3014778341107fd3929a6dd6a329b96c76779e"
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
    except subprocess.TimeoutExpired as exc:
        raise ContractError("SYSTEMD_HEALTH_SNAPSHOT_TIMEOUT") from exc
    return parse_unit_health_snapshot(output, expected_units)


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


def validate_shared_files(margin_unit: str) -> None:
    hold_snapshot()
    risk = read_json(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is False, "SHARED_RISK_NOT_HEALTHY")
    require(abs(float(risk.get("maximumLossPct")) - 7.5) < 1e-9, "SHARED_RISK_LIMIT_MISMATCH")
    updated = risk.get("updatedAt")
    require(isinstance(updated, (int, float)) and -1000 <= int(time.time() * 1000) - float(updated) <= 15 * 60_000, "SHARED_RISK_STALE")
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
        "PENGU_V8": root / "pengu" / "runner-shadow.json",
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
        common += ["Environment=PENGU_DUAL_LS_V2_MODE=SHADOW", "Environment=PENGU_DUAL_LS_V2_ENABLED=true", "Environment=PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED=false", "Environment=PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED=false", "Environment=PENGU_DUAL_LS_V2_STATE_DIR=" + str(MONITOR_ROOT / target / "pengu"), "Environment=PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT=7.5", f"ExecStart=/bin/sh -ec 'export PENGU_DUAL_LS_V2_MODE=SHADOW PENGU_DUAL_LS_V2_ENABLED=true PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED=false PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED=false PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT=7.5 DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT=7.5; exec {root}/node_modules/.bin/tsx scripts/disdex-pengu-dual-ls-v2-live-runner.ts --daemon'", f"ReadWritePaths={MONITOR_ROOT / target / 'pengu'} /var/lib/disdex/shared"]
    elif runner == "QUALITY102_CAUSAL_V1":
        common += ["Environment=QUALITY102_CAUSAL_V1_MODE=LIVE", "Environment=QUALITY102_CAUSAL_V1_MONITOR_ONLY=true", "Environment=QUALITY102_CAUSAL_V1_ENABLED=false", "Environment=QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED=false", "Environment=QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false", "Environment=QUALITY102_CAUSAL_V1_OPERATOR_ARMED=false", "Environment=QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4", "Environment=QUALITY102_CAUSAL_V1_LIVE_ACK=" + target, "Environment=QUALITY102_CAUSAL_V1_SYMBOLS=SUIUSDT,SEIUSDT,APTUSDT,ARBUSDT,OPUSDT,ENAUSDT,ONDOUSDT,FILUSDT,TRXUSDT", "Environment=QUALITY102_LIVE_SELECTOR_PARITY=false", "Environment=QUALITY102_LIVE_ENABLED=false", "Environment=QUALITY102_CAUSAL_V1_MAX_GROSS=3.0", "Environment=QUALITY102_CAUSAL_V1_PREFLIGHT_HISTORY_CHECK=false", "Environment=QUALITY102_CAUSAL_V1_MONITOR_SERVICE_UNIT=" + unit, "Environment=QUALITY102_CAUSAL_V1_MONITOR_HEALTH_PATH=/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json", "Environment=QUALITY102_CAUSAL_V1_MONITOR_TICK_PATH=/var/lib/disdex/runner-health/ticks/quality102-causal-v1.json", f"ExecStart=/bin/sh -ec 'export QUALITY102_CAUSAL_V1_MODE=LIVE QUALITY102_CAUSAL_V1_MONITOR_ONLY=true QUALITY102_CAUSAL_V1_ENABLED=false QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED=false QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false QUALITY102_CAUSAL_V1_OPERATOR_ARMED=false DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT=7.5 QUALITY102_CAUSAL_V1_MAX_DAILY_LOSS_PCT=7.5 DISDEX_RUNTIME_COMMIT_SHA={target} DISDEX_RELEASE_SHA={target} DISDEX_RUNTIME_SHA={target} DISDEX_RELEASE_ROOT={root} QUALITY102_CAUSAL_V1_LIVE_ACK={target} QUALITY102_CAUSAL_V1_SYMBOLS=SUIUSDT,SEIUSDT,APTUSDT,ARBUSDT,OPUSDT,ENAUSDT,ONDOUSDT,FILUSDT,TRXUSDT QUALITY102_LIVE_SELECTOR_PARITY=false QUALITY102_LIVE_ENABLED=false QUALITY102_CAUSAL_V1_MAX_GROSS=3.0 QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4; exec {root}/node_modules/.bin/tsx scripts/disdex-quality102-causal-v1-monitor.ts --daemon'", "ReadWritePaths=/var/lib/disdex/runner-health/heartbeats /var/lib/disdex/runner-health/ticks /var/lib/disdex/shared /var/lib/disdex/quality102-causal-v1"]
    elif runner == "V52":
        common += ["Environment=DISDEX_MONITOR_NEW_ORDERS_ALLOWED=false", "Environment=DISDEX_V52_MONITOR_ONLY=true", "Environment=DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=false", "Environment=DISDEX_V52_ASTER_ONLY_LIVE_ACKNOWLEDGEMENT=I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY", "Environment=DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=/var/lib/disdex/shared/aster-rate-budget.json", "Environment=DISDEX_V52_MONITOR_HEALTH_PATH=/var/lib/disdex/runner-health/heartbeats/v52.json", "Environment=DISDEX_V52_MONITOR_TICK_PATH=/var/lib/disdex/runner-health/ticks/v52-monitor.json", "Environment=DISDEX_V52_MONITOR_SERVICE_UNIT=" + unit, f"ExecStartPre=/usr/bin/test -f {root}/scripts/disdex_v52_aster_only_live_engine.py", f"ExecStart=/bin/sh -ec 'export DISDEX_V52_MONITOR_ONLY=true DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=false DISDEX_MONITOR_NEW_ORDERS_ALLOWED=false; exec /usr/bin/python3 {root}/scripts/disdex_v52_aster_only_live_engine.py --mode live --daemon --monitor-only-daemon'", "ReadWritePaths=/var/lib/disdex/runner-health/heartbeats /var/lib/disdex/runner-health/ticks /var/lib/disdex/v52-monitor"]
    elif runner == "FET_BRK48_RESIDUAL":
        common += ["Environment=DISDEX_Q102_RUNTIME_SHA=" + target, "Environment=FET_BRK48_SHADOW_STATE_PATH=" + str(MONITOR_ROOT / target / "fet" / "shadow.json"), f"ExecStart={root}/node_modules/.bin/tsx scripts/disdex-fet-brk48-shadow-runner.ts --daemon", f"ReadWritePaths={MONITOR_ROOT / target / 'fet'} /var/lib/disdex/shared"]
    elif runner == "IDLE_PRIORITY_SHORT":
        common += ["Environment=DISDEX_RUNTIME_SHA=" + target, "Environment=DISDEX_IDLE_PRIORITY_MODE=SHADOW", "Environment=DISDEX_IDLE_PRIORITY_ENABLED=true", "Environment=DISDEX_IDLE_PRIORITY_OPERATOR_ARMED=false", "Environment=DISDEX_IDLE_RESIDUAL_LONG_ENABLED=false", "Environment=DISDEX_IDLE_RESIDUAL_LONG_OPERATOR_ARMED=false", "Environment=DISDEX_IDLE_PRIORITY_STATE_PATH=" + str(MONITOR_ROOT / target / "idle" / "state.json"), "Environment=DISDEX_IDLE_PRIORITY_DECISION_PATH=" + str(MONITOR_ROOT / target / "idle" / "decision.json"), "Environment=DISDEX_IDLE_PRIORITY_DECISION_DETAILS_PATH=" + str(MONITOR_ROOT / target / "idle" / "decision-details.json"), f"ExecStart={root}/node_modules/.bin/tsx {root}/scripts/disdex-idle-priority-short-live-runner.ts --daemon", f"ReadWritePaths={MONITOR_ROOT / target / 'idle'} /var/lib/disdex/shared"]
    elif runner == "HYPE_TREND_LONG":
        common += ["Environment=DISDEX_HYPE_ZEC_MODE=SHADOW", "Environment=DISDEX_HYPE_ZEC_ENABLED=true", "Environment=DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED=false", "Environment=DISDEX_HYPE_ZEC_PRODUCTION_CONFIG_LIVE_ENABLED=false", "Environment=DISDEX_HYPE_ZEC_OPERATOR_ARMED=false", "Environment=DISDEX_HYPE_ZEC_SIGNAL_MODE=TREND", "Environment=DISDEX_HYPE_ZEC_SYMBOLS=HYPEUSDT", "Environment=DISDEX_HYPE_ZEC_RUNTIME_SHA=" + target, "Environment=DISDEX_HYPE_ZEC_STATE_PATH=" + str(MONITOR_ROOT / target / "hype" / "runner.json"), f"ExecStart={root}/node_modules/.bin/tsx scripts/disdex-hype-trend-live-runner.ts --daemon", f"ReadWritePaths={MONITOR_ROOT / target / 'hype'} /var/lib/disdex/shared"]
    else:
        raise ContractError("MONITOR_RUNNER_UNKNOWN:" + runner)
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


def target_plan(raw: bytes, target: str) -> bytes:
    value = json.loads(raw.decode("utf-8"))
    require(value.get("ordersEnabled") is False, "CURRENT_PLAN_ORDERS_NOT_DISABLED")
    value["scope"] = "FULL_PROJECT"
    value["sourceSha"] = target
    value["monitorSha"] = target
    runners = value.setdefault("runners", {})
    for key in RUNNER_IDS:
        require(key in runners and runners[key] != target, "CURRENT_PLAN_RUNNER_INVALID:" + key)
        runners[key] = target
    roots = value.setdefault("releaseRoots", {})
    for key in RUNNER_IDS:
        roots[key] = str(BASE / target)
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
        require(value.get("mode") == "MONITOR_ONLY" and value.get("newOrdersAllowed") is False, "MONITOR_HEARTBEAT_ORDER_AUTHORITY_INVALID:" + runner)
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


def poll_cycles(target: str, units: dict[str, str], paths: dict[str, Path], restart_before: dict[str, str], timeout: int = 240) -> None:
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
    require(min(seen.values()) >= 3, "THREE_MONITOR_CYCLES_NOT_OBSERVED")


def validate_token(token: str, public_key: Path, target: str, execution_plan_sha256: str, approval_id: str) -> None:
    require(UUID_RE.fullmatch(approval_id) is not None and token and len(token) <= 16_384, "APPROVAL_INPUT_INVALID")
    require(public_key.is_file() and not public_key.is_symlink(), "OWNER_PUBLIC_KEY_MISSING")
    verify_owner_token(token, public_key, REPO, target, SCOPE, OPERATOR, execution_plan_sha256, route=ROUTE, deployment_target=TARGET_HOST, operator_target=OPERATOR_TARGET, orders_enabled=False)


def baseline(target: str, plan: dict) -> tuple[bytes, bytes, bytes, str, dict[str, tuple[str, str]], dict[str, str], str]:
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
    margin_unit = str((rows.get("MARGIN_GUARD") or {}).get("serviceUnit") or "")
    require(margin_unit, "MARGIN_GUARD_PIN_MISSING")
    validate_shared_files(margin_unit)
    states = {key: unit_state(unit) for key, unit in old_units.items()}
    observations = [signed_get() for _ in range(3)]
    require(len({stamp for stamp, _ in observations}) == 3 and len({inv for _, inv in observations}) == 1, "SIGNED_GET_BASELINE_CHANGED")
    q102_state = read_json(Path("/var/lib/disdex/quality102-causal-v1/state.json"))
    require(not q102_state.get("position") and not q102_state.get("pending"), "Q102_BASELINE_NOT_FLAT")
    return pins_raw, plan_raw, hold_raw, observations[-1][1], states, old_units, margin_unit


def execute(target: str, plan: dict, execution_plan_sha256: str, tar_path: Path, manifest_path: Path, token: str, public_key: Path, approval_id: str, run_id: str) -> None:
    validate_token(token, public_key, target, execution_plan_sha256, approval_id)
    pins_raw, plan_raw, hold_raw, baseline_inventory, old_states, old_units, margin_unit = baseline(target, plan)
    units = target_units(target)
    paths = evidence_paths(target)
    dropins = {runner: dropin_path(unit) for runner, unit in units.items()}
    instance = Path("/etc/systemd/system") / units["V52"]
    q102_path = Path("/var/lib/disdex/quality102-causal-v1/state.json")
    file_snapshot = snapshot_paths([PINS, CURRENT_PLAN, q102_path, q102_path.parent, *dropins.values(), instance])
    state_root_created = False
    release = BASE / target
    try:
        stage_candidate(tar_path, manifest_path, target)
        install_state_dirs(target); state_root_created = True
        # The V52 template has a same-SHA guard dependency. Clone only the
        # reviewed instance and bind it to the existing healthy Margin Guard.
        write_atomic(instance, v52_instance_text(target, margin_unit), (0, 0, 0o644))
        for runner, unit in units.items():
            path = dropins[runner]
            path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            os.chown(path.parent, 0, 0); os.chmod(path.parent, 0o755)
            write_atomic(path, dropin_text(runner, target, unit).encode("utf-8"), (0, 0, 0o644))
        run("/usr/bin/systemctl", "daemon-reload", timeout=30)
        for runner, unit in units.items():
            validate_target_unit(unit, target, runner)
            verify_environment(unit, runner)
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
        stale_units = [
            f"disdex-quality102-causal-v1@{STALE_Q102}.service",
            f"disdex-v12-v52-margin-guard@{STALE_MARGIN}.service",
            f"disdex-pengu-dual-ls-v2@{STALE_PENGU}.service",
        ]
        for unit in (*old_units.values(), *stale_units):
            stop_unit(unit)
            run("/usr/bin/systemctl", "disable", unit, check=False, timeout=30)
        q102_state = dict(q102_before); q102_state["runtimeCommitSha"] = target
        write_atomic(q102_path, (json.dumps(q102_state, separators=(",", ":")) + "\n").encode("utf-8"), q102_access_meta)
        write_atomic(PINS, target_pins(pins_raw, target, units), file_snapshot[PINS][2] or (0, 0, 0o644))
        write_atomic(CURRENT_PLAN, target_plan(plan_raw, target), file_snapshot[CURRENT_PLAN][2] or (0, 0, 0o644))
        run("/usr/bin/systemctl", "daemon-reload", timeout=30)
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
        final_reads = [signed_get() for _ in range(3)]
        require(len({stamp for stamp, _ in final_reads}) == 3 and all(inv == baseline_inventory for _, inv in final_reads), "SIGNED_GET_POSTCUTOVER_CHANGED")
        _h2, _v2, hd2 = hold_snapshot(); require(hd2 == HOLD_DIGEST, "GLOBAL_HOLD_MUTATED")
        require(not any(unit_active(unit) for unit in old_units.values()), "DUAL_RUNNER_ACTIVE")
        print(json.dumps({"status": "STABLE4_DD30_MONITOR_CUTOVER_PASS", "targetSha": target, "ownerGoalId": plan.get("ownerGoalId"), "signedGetsBefore": 3, "signedGetsAfter": 3, "monitorCycles": 3, "globalHoldDigest": hd2, "ordersEnabled": False, "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0, "oldGenerationActive": False, "staleLoopsRetired": True, "runnerUnits": units}, sort_keys=True))
    except Exception as exc:
        try:
            _stamp, inv = signed_get(); require(inv == baseline_inventory, "ROLLBACK_VENUE_CHANGED_MANUAL_REVIEW")
            for unit in units.values():
                if unit_active(unit):
                    stop_unit(unit)
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
        require(args.tar is not None and args.manifest is not None, "CANDIDATE_ARCHIVE_AND_MANIFEST_REQUIRED")
        execute(args.target_sha, plan, args.execution_plan_sha256, args.tar, args.manifest, token, args.public_key, args.approval_id, args.run_id)
        return 0
    except Exception as exc:
        print(json.dumps({"status": "STABLE4_DD30_MONITOR_CUTOVER_BLOCKED", "reason": safe_text(exc), "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
