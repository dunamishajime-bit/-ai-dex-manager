from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Iterable, Mapping, Optional

DEFAULT_V12_STATE_PATH = "/var/lib/disdex/v12-x1-all/runner.json"
DEFAULT_PENGU_STATE_PATH = "/var/lib/disdex/pengu-dual-ls-v2/runner-live.json"
DEFAULT_Q102_STATE_PATH = "/var/lib/disdex/quality102-causal-v1/state.json"
DEFAULT_V52_STATE_PATH = "/var/lib/disdex/v52-aster-only/runner-live.json"

QTY_EPS = 1e-8
QTY_REL_TOL = 0.001


class EmergencyStateReconcileError(RuntimeError):
    pass


def _finite(value: object, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number == number and number not in (float("inf"), float("-inf")) else default


def _normalized_symbol(value: object) -> str:
    symbol = str(value or "").strip().upper()
    if not symbol or any(ch.isspace() for ch in symbol):
        raise EmergencyStateReconcileError(f"INVALID_SYMBOL:{value}")
    return symbol


def _read_object(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EmergencyStateReconcileError(f"STATE_READ_FAILED:{path}:{error}") from error
    if not isinstance(raw, dict):
        raise EmergencyStateReconcileError(f"STATE_NOT_OBJECT:{path}")
    return raw


def _state_paths(env: Mapping[str, str]) -> dict[str, Path]:
    pengu_root = str(env.get("PENGU_DUAL_LS_V2_STATE_DIR") or "").strip()
    v52_root = str(env.get("DISDEX_V52_ASTER_ONLY_STATE_DIR") or env.get("DISDEX_V13D_V11EQ_V96_STATE_DIR") or "").strip()
    return {
        "V12": Path(str(env.get("V12_X1_ALL_STATE_PATH") or DEFAULT_V12_STATE_PATH)).resolve(),
        "PENGU": Path(str(env.get("PENGU_DUAL_LS_V2_STATE_PATH") or (Path(pengu_root) / "runner-live.json" if pengu_root else DEFAULT_PENGU_STATE_PATH))).resolve(),
        "Q102": Path(str(env.get("QUALITY102_CAUSAL_V1_STATE_PATH") or env.get("DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH") or DEFAULT_Q102_STATE_PATH)).resolve(),
        "V52": Path(str(env.get("DISDEX_V52_ASTER_ONLY_STATE_PATH") or (Path(v52_root) / "runner-live.json" if v52_root else DEFAULT_V52_STATE_PATH))).resolve(),
    }


def _claim(strategy: str, symbol: str, quantity: float, close_side: str) -> dict:
    if not (quantity > QTY_EPS):
        raise EmergencyStateReconcileError(f"INVALID_CLAIM_QUANTITY:{strategy}:{symbol}:{quantity}")
    if close_side not in {"BUY", "SELL"}:
        raise EmergencyStateReconcileError(f"INVALID_CLAIM_SIDE:{strategy}:{symbol}:{close_side}")
    return {"strategy": strategy, "symbol": _normalized_symbol(symbol), "quantity": quantity, "closeSide": close_side}


def _claims_from_states(states: Mapping[str, Optional[dict]], stock_symbol_map: Mapping[str, str]) -> list[dict]:
    claims: list[dict] = []

    v12 = states.get("V12")
    if v12 is not None:
        if v12.get("strategyId") != "V12_X1.00_ALL":
            raise EmergencyStateReconcileError("V12_STATE_IDENTITY_MISMATCH")
        if v12.get("pending") is not None:
            raise EmergencyStateReconcileError("V12_PENDING_REQUIRES_RECONCILIATION")
        raw_actives = v12.get("activePositions")
        if isinstance(raw_actives, list) and raw_actives:
            actives = raw_actives
        elif isinstance(v12.get("active"), dict):
            actives = [v12["active"]]
        else:
            actives = []
        for row in actives:
            if not isinstance(row, dict):
                raise EmergencyStateReconcileError("V12_ACTIVE_STATE_MALFORMED")
            side = str(row.get("side") or "").upper()
            claims.append(_claim(
                "V12",
                str(row.get("symbol") or ""),
                abs(_finite(row.get("quantity"))),
                "SELL" if side == "LONG" else "BUY" if side == "SHORT" else "",
            ))

    pengu = states.get("PENGU")
    if pengu is not None:
        if pengu.get("strategyId") != "PENGU_DUAL_LS_V2_FINAL":
            raise EmergencyStateReconcileError("PENGU_STATE_IDENTITY_MISMATCH")
        if pengu.get("pending") is not None:
            raise EmergencyStateReconcileError("PENGU_PENDING_REQUIRES_RECONCILIATION")
        position = pengu.get("position")
        if position is not None:
            if not isinstance(position, dict):
                raise EmergencyStateReconcileError("PENGU_POSITION_STATE_MALFORMED")
            side = int(_finite(position.get("side")))
            claims.append(_claim(
                "PENGU",
                "PENGUUSDT",
                abs(_finite(position.get("quantity"))),
                "SELL" if side == 1 else "BUY" if side == -1 else "",
            ))

    q102 = states.get("Q102")
    if q102 is not None:
        if q102.get("strategyId") != "QUALITY102_CAUSAL_V1":
            raise EmergencyStateReconcileError("Q102_STATE_IDENTITY_MISMATCH")
        if q102.get("pending") is not None:
            raise EmergencyStateReconcileError("Q102_PENDING_REQUIRES_RECONCILIATION")
        position = q102.get("position")
        if position is not None:
            if not isinstance(position, dict):
                raise EmergencyStateReconcileError("Q102_POSITION_STATE_MALFORMED")
            side = int(_finite(position.get("side")))
            claims.append(_claim(
                "Q102",
                str(position.get("symbol") or ""),
                abs(_finite(position.get("quantity"))),
                "SELL" if side == 1 else "BUY" if side == -1 else "",
            ))

    v52 = states.get("V52")
    if v52 is not None:
        if v52.get("strategyId") not in {None, "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96"}:
            raise EmergencyStateReconcileError("V52_STATE_IDENTITY_MISMATCH")
        if v52.get("pendingOrder") is not None:
            raise EmergencyStateReconcileError("V52_PENDING_REQUIRES_RECONCILIATION")
        positions = v52.get("positions") or {}
        if not isinstance(positions, dict):
            raise EmergencyStateReconcileError("V52_POSITIONS_STATE_MALFORMED")
        for slot, row in positions.items():
            if not isinstance(row, dict):
                raise EmergencyStateReconcileError(f"V52_POSITION_STATE_MALFORMED:{slot}")
            stock_symbol = str(row.get("symbol") or "").upper()
            aster_symbol = stock_symbol_map.get(stock_symbol)
            if not aster_symbol:
                raise EmergencyStateReconcileError(f"V52_ASTER_SYMBOL_UNKNOWN:{stock_symbol}")
            open_side = str(row.get("asterOpenSide") or "").upper()
            claims.append(_claim(
                "V52",
                aster_symbol,
                abs(_finite(row.get("asterQty"))),
                "SELL" if open_side == "BUY" else "BUY" if open_side == "SELL" else "",
            ))
    return claims


def _aggregate_claims(claims: Iterable[dict]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for claim in claims:
        symbol = claim["symbol"]
        row = result.setdefault(symbol, {"quantity": 0.0, "closeSide": claim["closeSide"], "strategies": []})
        if row["closeSide"] != claim["closeSide"]:
            raise EmergencyStateReconcileError(f"CONFLICTING_LOCAL_SIDES:{symbol}")
        row["quantity"] += float(claim["quantity"])
        row["strategies"].append(claim["strategy"])
    return result


def _aggregate_fills(fill_results: Iterable[dict]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for fill in fill_results:
        if not isinstance(fill, dict):
            continue
        status = str(fill.get("status") or "").upper()
        qty = abs(_finite(fill.get("executedQty")))
        if status not in {"FILLED", "PARTIALLY_FILLED"} or qty <= QTY_EPS:
            continue
        symbol = _normalized_symbol(fill.get("symbol"))
        side = str(fill.get("side") or "").upper()
        if side not in {"BUY", "SELL"}:
            raise EmergencyStateReconcileError(f"INVALID_FILL_SIDE:{symbol}:{side}")
        row = result.setdefault(symbol, {"quantity": 0.0, "side": side})
        if row["side"] != side:
            raise EmergencyStateReconcileError(f"CONFLICTING_FILL_SIDES:{symbol}")
        row["quantity"] += qty
    return result


def _assert_fill_evidence(claims: dict[str, dict], fills: dict[str, dict]) -> None:
    if set(claims) != set(fills):
        raise EmergencyStateReconcileError(
            f"CLAIM_FILL_SYMBOL_MISMATCH:claims={sorted(claims)}:fills={sorted(fills)}"
        )
    for symbol, expected in claims.items():
        actual = fills[symbol]
        if expected["closeSide"] != actual["side"]:
            raise EmergencyStateReconcileError(
                f"CLAIM_FILL_SIDE_MISMATCH:{symbol}:expected={expected['closeSide']}:actual={actual['side']}"
            )
        expected_qty = float(expected["quantity"])
        actual_qty = float(actual["quantity"])
        tolerance = max(QTY_EPS, expected_qty * QTY_REL_TOL)
        if abs(expected_qty - actual_qty) > tolerance:
            raise EmergencyStateReconcileError(
                f"CLAIM_FILL_QTY_MISMATCH:{symbol}:expected={expected_qty}:actual={actual_qty}:tol={tolerance}"
            )


def _backup_and_write(path: Path, raw: dict, now_ms: int) -> str:
    stamp = f"{now_ms}-{os.getpid()}"
    backup = path.with_name(f"{path.name}.before-margin-emergency-reconcile-{stamp}.json")
    if backup.exists():
        raise EmergencyStateReconcileError(f"BACKUP_EXISTS:{backup}")
    original_stat = path.stat()
    shutil.copy2(path, backup)
    if hasattr(os, "chown"):
        try:
            os.chown(backup, original_stat.st_uid, original_stat.st_gid)
        except PermissionError:
            pass
    handle, temp_name = tempfile.mkstemp(prefix=f".{path.name}.margin-reconcile.", dir=str(path.parent))
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as writer:
            json.dump(raw, writer, ensure_ascii=False, indent=2)
            writer.write("\n")
            writer.flush()
            os.fsync(writer.fileno())
        os.chmod(temp_name, 0o600)
        if hasattr(os, "chown"):
            try:
                os.chown(temp_name, original_stat.st_uid, original_stat.st_gid)
            except PermissionError:
                current_uid = os.geteuid() if hasattr(os, "geteuid") else None
                if current_uid != original_stat.st_uid:
                    raise EmergencyStateReconcileError(
                        f"STATE_OWNERSHIP_PRESERVATION_FAILED:{path}:{original_stat.st_uid}:{original_stat.st_gid}"
                    )
        os.replace(temp_name, path)
        os.chmod(path, 0o600)
        if hasattr(os, "chown"):
            replaced = path.stat()
            if replaced.st_uid != original_stat.st_uid or replaced.st_gid != original_stat.st_gid:
                raise EmergencyStateReconcileError(
                    f"STATE_OWNERSHIP_CHANGED:{path}:{original_stat.st_uid}:{original_stat.st_gid}"
                    f"->{replaced.st_uid}:{replaced.st_gid}"
                )
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    return str(backup)


def reconcile_emergency_flatten_states(
    fill_results: Iterable[dict],
    *,
    env: Optional[Mapping[str, str]] = None,
    stock_symbol_map: Optional[Mapping[str, str]] = None,
    now_ms: Optional[int] = None,
) -> dict:
    environment = os.environ if env is None else env
    paths = _state_paths(environment)
    states = {name: _read_object(path) for name, path in paths.items()}
    claims_list = _claims_from_states(states, stock_symbol_map or {})
    claims = _aggregate_claims(claims_list)
    fills = _aggregate_fills(fill_results)

    if not claims and not fills:
        return {
            "status": "PASS",
            "claimCount": 0,
            "fillSymbolCount": 0,
            "modifiedStrategies": [],
            "backups": {},
        }
    if not claims:
        raise EmergencyStateReconcileError(f"EMERGENCY_FILL_HAS_NO_LOCAL_OWNER:{sorted(fills)}")
    _assert_fill_evidence(claims, fills)

    now = int(time.time() * 1000) if now_ms is None else int(now_ms)
    modified: list[str] = []
    backups: dict[str, str] = {}

    v12 = states.get("V12")
    if v12 is not None and any(c["strategy"] == "V12" for c in claims_list):
        v12.pop("active", None)
        v12.pop("activePositions", None)
        v12.pop("pending", None)
        v12.pop("manualReview", None)
        v12.pop("killSwitch", None)
        reference = int(_finite(v12.get("lastReferenceTs")))
        existing_cd = int(_finite(v12.get("cooldownUntilTs")))
        if reference > 0:
            v12["cooldownUntilTs"] = max(existing_cd, reference + 2 * 60 * 60 * 1000)
        v12["updatedAt"] = now
        backups["V12"] = _backup_and_write(paths["V12"], v12, now)
        modified.append("V12")

    pengu = states.get("PENGU")
    if pengu is not None and any(c["strategy"] == "PENGU" for c in claims_list):
        pengu.pop("position", None)
        pengu.pop("pending", None)
        reference = int(_finite(pengu.get("lastSignalReferenceTs")))
        existing_cd = int(_finite(pengu.get("cooldownUntilTs")))
        if reference > 0:
            pengu["cooldownUntilTs"] = max(existing_cd, reference + 6 * 60 * 60 * 1000)
        failures = pengu.get("failures") if isinstance(pengu.get("failures"), list) else []
        failures.append({"occurredAt": now, "message": "MARGIN_GUARD_EMERGENCY_FLAT_RECONCILED"})
        pengu["failures"] = failures[-100:]
        pengu["updatedAt"] = now
        backups["PENGU"] = _backup_and_write(paths["PENGU"], pengu, now)
        modified.append("PENGU")

    q102 = states.get("Q102")
    if q102 is not None and any(c["strategy"] == "Q102" for c in claims_list):
        q102.pop("position", None)
        q102.pop("pending", None)
        failures = q102.get("failures") if isinstance(q102.get("failures"), list) else []
        failures.append({"occurredAt": now, "message": "MARGIN_GUARD_EMERGENCY_FLAT_RECONCILED"})
        q102["failures"] = failures[-100:]
        q102["lastReconciledAt"] = now
        q102["updatedAt"] = now
        backups["Q102"] = _backup_and_write(paths["Q102"], q102, now)
        modified.append("Q102")

    v52 = states.get("V52")
    if v52 is not None and any(c["strategy"] == "V52" for c in claims_list):
        v52["positions"] = {}
        v52["pendingOrder"] = None
        v52["updatedAt"] = now
        backups["V52"] = _backup_and_write(paths["V52"], v52, now)
        modified.append("V52")

    return {
        "status": "PASS",
        "claimCount": len(claims_list),
        "fillSymbolCount": len(fills),
        "claims": claims,
        "fills": fills,
        "modifiedStrategies": modified,
        "backups": backups,
    }
