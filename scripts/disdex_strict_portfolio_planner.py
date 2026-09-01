from __future__ import annotations

import math
import os
from dataclasses import dataclass
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
