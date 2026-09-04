from __future__ import annotations

import math
import os
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

EPSILON = 1e-9


@dataclass(frozen=True)
class StrictPortfolioCaps:
    v12_gross: float = 1.50
    pengu_gross: float = 0.75
    quality102_gross: float = 0.50
    stock_gross: float = 1.50
    crypto_gross: float = 2.00
    total_gross: float = 2.50


STRICT_CAPS = StrictPortfolioCaps()
QUALITY102_LIVE_SELECTOR_PARITY = False
QUALITY102_LIVE_ENABLED = False
QUALITY102_LIVE_STATUS = "FAIL_CLOSED_SELECTOR_PARITY_UNPROVEN"
QUALITY102_STRATEGY_ID = "QUALITY102_CAUSAL_V1"
QUALITY102_STATE_VERSION = 1
QUALITY102_STATE_MAX_AGE_MS = 15 * 60_000
_SHA256_RE = re.compile(r"^[0-9a-fA-F]{40}$")


@dataclass(frozen=True)
class Quality102OwnedPosition:
    symbol: str
    side: int
    quantity: float
    entry_price: float
    entry_ts: float
    runtime_commit_sha: str


def _quality102_state_path() -> Path | None:
    for name in ("QUALITY102_CAUSAL_V1_STATE_PATH", "DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH"):
        raw = str(os.environ.get(name) or "").strip()
        if raw:
            return Path(raw).expanduser().resolve()
    return None


def _quality102_finite(value: object, field: str, *, positive: bool = False) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"QUALITY102_STATE_MALFORMED:{field}") from error
    if not math.isfinite(number) or (positive and number <= 0):
        raise RuntimeError(f"QUALITY102_STATE_MALFORMED:{field}")
    return number


def _quality102_object(value: object, field: str) -> dict:
    if not isinstance(value, dict):
        raise RuntimeError(f"QUALITY102_STATE_MALFORMED:{field}")
    return value


def load_quality102_live_state(path: Path | None = None, *, now_ms: float | None = None) -> Quality102OwnedPosition | None:
    """Load only a schema-valid LIVE Q102 state for cross-runner accounting.

    Absence is equivalent to no owned Q102 position. Any present-but-invalid
    file is a hard failure so the base runners cannot trade against an
    ambiguous ownership or gross snapshot.
    """
    resolved = path or _quality102_state_path()
    if resolved is None or not resolved.exists():
        return None
    try:
        raw = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:json") from error
    root = _quality102_object(raw, "root")
    allowed = {
        "version", "strategyId", "mode", "runtimeCommitSha", "updatedAt",
        "lastProcessedReferenceTs", "lastCompletedIdempotencyKey", "position",
        "pending", "lastReduction", "lastReconciledAt", "failures",
    }
    if set(root) - allowed:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:unknown_field")
    required = {"version", "strategyId", "mode", "runtimeCommitSha", "updatedAt", "failures"}
    if not required.issubset(root):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:required_field")
    if root.get("version") != QUALITY102_STATE_VERSION or root.get("strategyId") != QUALITY102_STRATEGY_ID or root.get("mode") != "LIVE":
        raise RuntimeError("QUALITY102_STATE_MISMATCH:identity")
    runtime_sha = str(root.get("runtimeCommitSha") or "")
    if not _SHA256_RE.fullmatch(runtime_sha):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:runtimeCommitSha")
    expected_sha = str(os.environ.get("DISDEX_RUNTIME_COMMIT_SHA") or "").strip()
    if expected_sha and runtime_sha.lower() != expected_sha.lower():
        raise RuntimeError("QUALITY102_STATE_MISMATCH:runtimeCommitSha")
    updated_at = _quality102_finite(root.get("updatedAt"), "updatedAt", positive=True)
    clock = _quality102_finite(now_ms if now_ms is not None else time.time() * 1000, "now_ms", positive=True)
    if updated_at > clock + 5_000:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:updatedAt_future")
    max_age = _quality102_finite(os.environ.get("DISDEX_QUALITY102_STATE_MAX_AGE_MS", QUALITY102_STATE_MAX_AGE_MS), "state_max_age", positive=True)
    if clock - updated_at > max_age:
        raise RuntimeError("QUALITY102_STATE_STALE")
    for field in ("lastProcessedReferenceTs", "lastReconciledAt"):
        if field in root:
            _quality102_finite(root[field], field, positive=True)
    if "lastCompletedIdempotencyKey" in root and not isinstance(root["lastCompletedIdempotencyKey"], str):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:lastCompletedIdempotencyKey")
    failures = root.get("failures")
    if not isinstance(failures, list):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:failures")
    for index, failure in enumerate(failures):
        row = _quality102_object(failure, f"failures[{index}]")
        if "occurredAt" not in row or "message" not in row or set(row) - {"occurredAt", "message", "idempotencyKey"}:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:failure")
        _quality102_finite(row["occurredAt"], f"failures[{index}].occurredAt", positive=True)
        if not isinstance(row["message"], str) or not row["message"]:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:failure_message")
        if "idempotencyKey" in row and not isinstance(row["idempotencyKey"], str):
            raise RuntimeError("QUALITY102_STATE_MALFORMED:failure_idempotencyKey")

    position = root.get("position")
    if position is None:
        return None
    position = _quality102_object(position, "position")
    if set(position) - {"symbol", "side", "quantity", "entryPrice", "entryTs", "hardStop", "bestPrice", "trailActive"}:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:position_field")
    symbol = str(position.get("symbol") or "").upper()
    if not symbol.endswith("USDT") or not symbol[:-4] or symbol in KNOWN_BASE_SYMBOLS:
        raise RuntimeError("QUALITY102_STATE_MISMATCH:position_symbol")
    side = position.get("side")
    if side not in (-1, 1):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:position_side")
    quantity = _quality102_finite(position.get("quantity"), "position.quantity", positive=True)
    entry_price = _quality102_finite(position.get("entryPrice"), "position.entryPrice", positive=True)
    entry_ts = _quality102_finite(position.get("entryTs"), "position.entryTs", positive=True)
    if "hardStop" in position:
        hard_stop = _quality102_finite(position["hardStop"], "position.hardStop", positive=True)
        if hard_stop > 0.15:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:position.hardStop")
    if "bestPrice" in position:
        _quality102_finite(position["bestPrice"], "position.bestPrice", positive=True)
    if "trailActive" in position and not isinstance(position["trailActive"], bool):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:position.trailActive")
    pending = root.get("pending")
    if pending is not None:
        pending = _quality102_object(pending, "pending")
        required_pending = {"idempotencyKey", "clientOrderId", "phase", "symbol", "side", "quantity", "reduceOnly", "referenceTs", "createdAt", "updatedAt"}
        if not required_pending.issubset(pending) or set(pending) - required_pending - {"expectedPrice", "targetGross", "hardStop", "reason", "lastError"}:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:pending")
        if pending.get("phase") not in {"planned", "submitted", "manual_review"} or pending.get("side") not in {"BUY", "SELL"} or not isinstance(pending.get("reduceOnly"), bool):
            raise RuntimeError("QUALITY102_STATE_MALFORMED:pending_identity")
        pending_symbol = str(pending.get("symbol") or "").upper()
        if not pending_symbol.endswith("USDT") or pending_symbol in KNOWN_BASE_SYMBOLS:
            raise RuntimeError("QUALITY102_STATE_MISMATCH:pending_symbol")
        for field in ("quantity", "referenceTs", "createdAt", "updatedAt"):
            _quality102_finite(pending.get(field), f"pending.{field}", positive=field == "quantity")
        if not isinstance(pending.get("idempotencyKey"), str) or not pending["idempotencyKey"] or not isinstance(pending.get("clientOrderId"), str) or not pending["clientOrderId"]:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:pending_order_identity")
        if "targetGross" in pending and _quality102_finite(pending["targetGross"], "pending.targetGross", positive=True) > 0.5:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:pending.targetGross")
        if position is not None and pending_symbol != symbol:
            raise RuntimeError("QUALITY102_STATE_MISMATCH:pending_position_symbol")
        if position is not None and not pending["reduceOnly"]:
            raise RuntimeError("QUALITY102_STATE_MISMATCH:entry_pending_with_position")
        if position is None and pending["reduceOnly"]:
            raise RuntimeError("QUALITY102_STATE_MISMATCH:exit_pending_without_position")
    if "lastReduction" in root:
        reduction = _quality102_object(root["lastReduction"], "lastReduction")
        required_reduction = {"idempotencyKey", "symbol", "side", "reducedQuantity", "markTs", "markPrice", "realizedPnl", "transactionCost", "fundingCost", "accounting"}
        if set(reduction) != required_reduction or reduction.get("side") not in (-1, 1) or reduction.get("accounting") != "MARK_TO_MARKET_REALIZED_PNL":
            raise RuntimeError("QUALITY102_STATE_MALFORMED:lastReduction")
        if not isinstance(reduction.get("idempotencyKey"), str) or not reduction["idempotencyKey"] or not isinstance(reduction.get("symbol"), str) or not reduction["symbol"]:
            raise RuntimeError("QUALITY102_STATE_MALFORMED:lastReduction_identity")
        for field in ("reducedQuantity", "markTs", "markPrice", "realizedPnl", "transactionCost", "fundingCost"):
            _quality102_finite(reduction.get(field), f"lastReduction.{field}", positive=field in {"reducedQuantity", "markPrice"})
    return Quality102OwnedPosition(symbol, int(side), quantity, entry_price, entry_ts, runtime_sha)


def read_quality102_live_state_document(
    path: Path | None = None,
    *,
    now_ms: float | None = None,
) -> tuple[Path, dict, Quality102OwnedPosition | None] | None:
    """Return a validated live-state document for cross-runner coordination.

    Validation is deliberately delegated to ``load_quality102_live_state``
    before the document is returned.  Callers that need to update the state
    (for example, a base-priority MTM reduction) must hold the shared account
    lock; this function does not provide locking itself.
    """
    resolved = path or _quality102_state_path()
    if resolved is None or not resolved.exists():
        return None
    owned = load_quality102_live_state(resolved, now_ms=now_ms)
    try:
        raw = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:json") from error
    if not isinstance(raw, dict):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:root")
    return resolved, raw, owned


KNOWN_BASE_SYMBOLS = frozenset({
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT",
    "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT",
    "AAVEUSDT", "NEARUSDT", "PENGUUSDT", "AMZNUSDT", "METAUSDT", "MSFTUSDT",
    "NVDAUSDT", "TSLAUSDT",
})


def quality102_crypto_notional_from_positions(
    rows: list[dict] | tuple[dict, ...],
    *,
    known_crypto: frozenset[str] = frozenset(),
    known_stock: frozenset[str] = frozenset(),
    now_ms: float | None = None,
) -> float:
    """Account Q102 mark notional while preserving unknown-symbol fail-closed."""
    owned = load_quality102_live_state(now_ms=now_ms)
    q102_rows: list[dict] = []
    total = 0.0
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError("QUALITY102_POSITION_MALFORMED:row")
        symbol = str(row.get("symbol") or "").upper()
        quantity = _quality102_finite(row.get("positionAmt"), f"{symbol}.positionAmt")
        if abs(quantity) <= EPSILON:
            continue
        mark = row.get("markPrice")
        if mark in (None, ""):
            if owned is not None and symbol == owned.symbol:
                raise RuntimeError(f"QUALITY102_POSITION_MALFORMED:{symbol}.markPrice")
            # Preserve the pre-existing base-runner fallback for known
            # strategy positions; Q102 itself requires a current mark.
            mark = row.get("entryPrice")
        price = _quality102_finite(mark, f"{symbol}.markPrice", positive=True)
        if symbol in known_stock:
            continue
        if symbol in known_crypto:
            total += abs(quantity) * price
            continue
        if owned is None or symbol != owned.symbol:
            raise RuntimeError(f"Unknown non-flat Aster symbol requires manual review: {symbol}")
        q102_rows.append(row)
        if (1 if quantity > 0 else -1) != owned.side or abs(abs(quantity) - owned.quantity) > max(1e-8, owned.quantity * 0.02):
            raise RuntimeError("QUALITY102_STATE_POSITION_MISMATCH")
        total += abs(quantity) * price
    if owned is not None and len(q102_rows) != 1:
        raise RuntimeError("QUALITY102_STATE_POSITION_MISMATCH")
    return total


def _enabled(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _finite(value: object, label: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise RuntimeError(f"STRICT_PORTFOLIO_INVALID_{label}")
    return number


def _assert_cap_env(env: Mapping[str, str], name: str, expected: float) -> None:
    raw = env.get(name)
    if raw is None or str(raw).strip() == "":
        return
    actual = _finite(raw, name)
    if abs(actual - expected) > EPSILON:
        raise RuntimeError(f"STRICT_PORTFOLIO_CONFIG_MISMATCH:{name}:{raw}:EXPECTED_{expected}")


def assert_strict_live_configuration(env: Mapping[str, str] | None = None) -> StrictPortfolioCaps:
    source = os.environ if env is None else env
    if not _enabled(source.get("STRICT_PORTFOLIO_PLANNER_ACTIVE")):
        raise RuntimeError("STRICT_PORTFOLIO_PLANNER_NOT_ACTIVE")
    _assert_cap_env(source, "V12_GROSS_CAP", STRICT_CAPS.v12_gross)
    _assert_cap_env(source, "PENGU_GROSS_CAP", STRICT_CAPS.pengu_gross)
    _assert_cap_env(source, "STOCK_GROSS_CAP", STRICT_CAPS.stock_gross)
    _assert_cap_env(source, "CRYPTO_GROSS_CAP", STRICT_CAPS.crypto_gross)
    _assert_cap_env(source, "TOTAL_GROSS_CAP", STRICT_CAPS.total_gross)
    _assert_cap_env(source, "DISDEX_V52_STOCK_GROSS_CAP", STRICT_CAPS.stock_gross)
    _assert_cap_env(source, "DISDEX_V52_CRYPTO_GROSS_CAP", STRICT_CAPS.crypto_gross)
    _assert_cap_env(source, "DISDEX_V52_PORTFOLIO_GROSS_CAP", STRICT_CAPS.total_gross)
    if _enabled(source.get("QUALITY102_LIVE_ENABLED")) or _enabled(source.get("QUALITY102_LIVE_SELECTOR_PARITY")):
        raise RuntimeError("QUALITY102_LIVE_BLOCKED_FAIL_CLOSED")
    return STRICT_CAPS


def validate_gross_snapshot(snapshot: Mapping[str, object], caps: StrictPortfolioCaps = STRICT_CAPS) -> dict:
    equity = _finite(snapshot.get("equityUsd", 0), "EQUITY")
    crypto = _finite(snapshot.get("cryptoGross", 0), "CRYPTO_GROSS")
    stock = _finite(snapshot.get("stockGross", 0), "STOCK_GROSS")
    total = _finite(snapshot.get("totalGross", 0), "TOTAL_GROSS")
    if equity <= 0:
        raise RuntimeError("STRICT_PORTFOLIO_EQUITY_NOT_POSITIVE")
    if min(crypto, stock, total) < -EPSILON:
        raise RuntimeError("STRICT_PORTFOLIO_NEGATIVE_GROSS")
    if crypto > caps.crypto_gross + EPSILON:
        raise RuntimeError(f"CRYPTO_GROSS_OVER_CAP:{crypto:.9f}>{caps.crypto_gross:.9f}")
    if stock > caps.stock_gross + EPSILON:
        raise RuntimeError(f"STOCK_GROSS_OVER_CAP:{stock:.9f}>{caps.stock_gross:.9f}")
    if total > caps.total_gross + EPSILON:
        raise RuntimeError(f"TOTAL_GROSS_OVER_CAP:{total:.9f}>{caps.total_gross:.9f}")
    if abs((crypto + stock) - total) > 1e-6:
        raise RuntimeError("STRICT_PORTFOLIO_GROSS_SNAPSHOT_INCONSISTENT")
    return {"equityUsd": equity, "cryptoGross": crypto, "stockGross": stock, "totalGross": total}


def plan_v52_stock_capacity(
    snapshot: Mapping[str, object],
    requested_gross: float,
    slot_cap: float,
    caps: StrictPortfolioCaps = STRICT_CAPS,
) -> dict:
    current = validate_gross_snapshot(snapshot, caps)
    requested = _finite(requested_gross, "REQUESTED_GROSS")
    per_slot = _finite(slot_cap, "V52_SLOT_CAP")
    if requested < 0 or per_slot < 0:
        raise RuntimeError("STRICT_PORTFOLIO_NEGATIVE_REQUEST")
    stock_residual = max(0.0, caps.stock_gross - current["stockGross"])
    total_residual = max(0.0, caps.total_gross - current["totalGross"])
    accepted = max(0.0, min(requested, per_slot, stock_residual, total_residual))
    return {
        "status": "planned" if accepted > EPSILON else "blocked",
        "requestedGross": requested,
        "acceptedGross": accepted,
        "stockResidualGross": stock_residual,
        "totalResidualGross": total_residual,
        "strictPortfolioPlannerActive": True,
        "cryptoGrossCap": caps.crypto_gross,
        "stockGrossCap": caps.stock_gross,
        "totalGrossCap": caps.total_gross,
        "quality102LiveSelectorParity": False,
        "quality102LiveBlockedFailClosed": True,
    }


def self_test() -> None:
    caps = assert_strict_live_configuration({
        "STRICT_PORTFOLIO_PLANNER_ACTIVE": "true",
        "CRYPTO_GROSS_CAP": "2.0",
        "STOCK_GROSS_CAP": "1.5",
        "TOTAL_GROSS_CAP": "2.5",
        "DISDEX_V52_CRYPTO_GROSS_CAP": "2.0",
        "DISDEX_V52_STOCK_GROSS_CAP": "1.5",
        "DISDEX_V52_PORTFOLIO_GROSS_CAP": "2.5",
    })
    assert caps.crypto_gross == 2.0
    at_limit = plan_v52_stock_capacity({"equityUsd": 1000, "cryptoGross": 2.0, "stockGross": 0.5, "totalGross": 2.5}, 1.0, 1.0)
    assert at_limit["status"] == "blocked"
    residual = plan_v52_stock_capacity({"equityUsd": 1000, "cryptoGross": 1.25, "stockGross": 0.5, "totalGross": 1.75}, 1.0, 1.0)
    assert abs(residual["acceptedGross"] - 0.75) < EPSILON
    try:
        assert_strict_live_configuration({"STRICT_PORTFOLIO_PLANNER_ACTIVE": "true", "CRYPTO_GROSS_CAP": "1.5"})
        raise AssertionError("legacy 1.5 crypto cap must fail")
    except RuntimeError as error:
        assert "CONFIG_MISMATCH" in str(error)
    try:
        assert_strict_live_configuration({"STRICT_PORTFOLIO_PLANNER_ACTIVE": "true", "QUALITY102_LIVE_ENABLED": "true"})
        raise AssertionError("Quality102 must stay fail-closed")
    except RuntimeError as error:
        assert "QUALITY102_LIVE_BLOCKED_FAIL_CLOSED" in str(error)
    print("DISDEX_STRICT_PORTFOLIO_PLANNER_PY_SELFTEST_PASS")


if __name__ == "__main__":
    self_test()
