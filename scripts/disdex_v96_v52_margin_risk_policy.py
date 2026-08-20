from __future__ import annotations

from typing import Dict, Iterable, Optional, Set

HEALTHY_POLL_INTERVAL_MS = 5 * 60_000
WARNING_POLL_INTERVAL_MS = 60_000
WARNING_MARGIN_RATIO_PCT = 50.0
REDUCE_MARGIN_RATIO_PCT = 65.0
CRITICAL_MARGIN_RATIO_PCT = 75.0
WARNING_LIQUIDATION_BUFFER_PCT = 12.0
REDUCE_LIQUIDATION_BUFFER_PCT = 8.0
CRITICAL_LIQUIDATION_BUFFER_PCT = 5.0
RECOVERY_MARGIN_RATIO_PCT = 45.0
RECOVERY_LIQUIDATION_BUFFER_PCT = 15.0

STAGES = {"HEALTHY", "WARNING", "REDUCE", "CRITICAL"}


def finite(value: object, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if result == result and result not in (float("inf"), float("-inf")) else fallback


def maintenance_margin_ratio_pct(account: dict) -> float:
    maintenance = max(0.0, finite(account.get("totalMaintMargin")))
    margin_balance = finite(account.get("totalMarginBalance"))
    if maintenance <= 0:
        return 0.0
    if margin_balance <= 0:
        return 100.0
    return maintenance / margin_balance * 100.0


def liquidation_buffer_pct(row: dict) -> Optional[float]:
    quantity = finite(row.get("positionAmt"))
    if abs(quantity) <= 1e-12:
        return None
    mark = finite(row.get("markPrice"))
    liquidation = finite(row.get("liquidationPrice"))
    if mark <= 0 or liquidation <= 0:
        raise RuntimeError(f"Active position has invalid mark/liquidation price: {row.get('symbol')}")
    buffer = (mark - liquidation) / mark if quantity > 0 else (liquidation - mark) / mark
    return max(0.0, buffer * 100.0)


def build_margin_risk_snapshot(account: dict, positions: Iterable[dict], managed_symbols: Iterable[str], grandfathered_symbols: Iterable[str] = ()) -> dict:
    symbols = {str(symbol).upper() for symbol in managed_symbols}
    grandfathered: Set[str] = {str(symbol).upper() for symbol in grandfathered_symbols}
    active = []
    liquidation_data_unavailable = []
    minimum_buffer: Optional[float] = None
    nearest_symbol: Optional[str] = None
    for row in positions:
        symbol = str(row.get("symbol") or "").upper()
        if symbol not in symbols or abs(finite(row.get("positionAmt"))) <= 1e-12:
            continue
        try:
            buffer = liquidation_buffer_pct(row)
        except RuntimeError:
            if symbol not in grandfathered:
                raise
            buffer = None
            liquidation_data_unavailable.append(symbol)
        active.append({
            "symbol": symbol,
            "positionAmt": finite(row.get("positionAmt")),
            "markPrice": finite(row.get("markPrice")),
            "liquidationPrice": finite(row.get("liquidationPrice")),
            "liquidationBufferPct": buffer,
            "liquidationPriceUnavailable": buffer is None,
            "grandfathered": symbol in grandfathered,
            "leverage": finite(row.get("leverage")),
            "marginType": str(row.get("marginType") or ("isolated" if row.get("isolated") is True else "cross" if row.get("isolated") is False else "unknown")).lower(),
        })
        if minimum_buffer is None or buffer < minimum_buffer:
            minimum_buffer = buffer
            nearest_symbol = symbol
    ratio = maintenance_margin_ratio_pct(account)
    return {
        "maintenanceMarginRatioPct": ratio,
        "minimumLiquidationBufferPct": minimum_buffer,
        "nearestLiquidationSymbol": nearest_symbol,
        "liquidationDataUnavailableSymbols": sorted(set(liquidation_data_unavailable)),
        "grandfatheredPositionCount": len(liquidation_data_unavailable),
        "activeManagedPositionCount": len(active),
        "activeManagedPositions": active,
        "totalMaintMarginUsd": max(0.0, finite(account.get("totalMaintMargin"))),
        "totalMarginBalanceUsd": finite(account.get("totalMarginBalance")),
        "totalPositionInitialMarginUsd": max(0.0, finite(account.get("totalPositionInitialMargin"))),
        "totalOpenOrderInitialMarginUsd": max(0.0, finite(account.get("totalOpenOrderInitialMargin"))),
        "availableBalanceUsd": finite(account.get("availableBalance")),
    }


def classify_margin_risk(snapshot: dict, previous_stage: str = "HEALTHY") -> dict:
    previous = previous_stage if previous_stage in STAGES else "HEALTHY"
    ratio = finite(snapshot.get("maintenanceMarginRatioPct"))
    raw_buffer = snapshot.get("minimumLiquidationBufferPct")
    buffer = float("inf") if raw_buffer is None else finite(raw_buffer)

    if ratio >= CRITICAL_MARGIN_RATIO_PCT or buffer <= CRITICAL_LIQUIDATION_BUFFER_PCT:
        stage = "CRITICAL"
    elif ratio >= REDUCE_MARGIN_RATIO_PCT or buffer <= REDUCE_LIQUIDATION_BUFFER_PCT:
        stage = "REDUCE"
    elif ratio >= WARNING_MARGIN_RATIO_PCT or buffer <= WARNING_LIQUIDATION_BUFFER_PCT:
        stage = "WARNING"
    elif previous != "HEALTHY" and not (
        ratio < RECOVERY_MARGIN_RATIO_PCT and buffer > RECOVERY_LIQUIDATION_BUFFER_PCT
    ):
        stage = "WARNING"
    else:
        stage = "HEALTHY"

    return {
        **snapshot,
        "stage": stage,
        "ordersAllowed": stage == "HEALTHY",
        "pollIntervalMs": HEALTHY_POLL_INTERVAL_MS if stage == "HEALTHY" else WARNING_POLL_INTERVAL_MS,
        "action": {
            "HEALTHY": "NONE",
            "WARNING": "BLOCK_NEW_ORDERS_AND_MONITOR_1M",
            "REDUCE": "ACTIVATE_SHARED_KILL_SWITCH_FLATTEN_MANAGED",
            "CRITICAL": "ACTIVATE_SHARED_KILL_SWITCH_FLATTEN_MANAGED_IMMEDIATELY",
        }[stage],
        "thresholds": {
            "warningMarginRatioPct": WARNING_MARGIN_RATIO_PCT,
            "reduceMarginRatioPct": REDUCE_MARGIN_RATIO_PCT,
            "criticalMarginRatioPct": CRITICAL_MARGIN_RATIO_PCT,
            "warningLiquidationBufferPct": WARNING_LIQUIDATION_BUFFER_PCT,
            "reduceLiquidationBufferPct": REDUCE_LIQUIDATION_BUFFER_PCT,
            "criticalLiquidationBufferPct": CRITICAL_LIQUIDATION_BUFFER_PCT,
            "recoveryMarginRatioPct": RECOVERY_MARGIN_RATIO_PCT,
            "recoveryLiquidationBufferPct": RECOVERY_LIQUIDATION_BUFFER_PCT,
        },
    }


def self_test() -> None:
    healthy = classify_margin_risk({
        "maintenanceMarginRatioPct": 10.0,
        "minimumLiquidationBufferPct": 25.0,
    })
    assert healthy["stage"] == "HEALTHY"
    assert healthy["pollIntervalMs"] == 300_000
    assert healthy["ordersAllowed"] is True

    warning = classify_margin_risk({
        "maintenanceMarginRatioPct": 50.0,
        "minimumLiquidationBufferPct": 20.0,
    })
    assert warning["stage"] == "WARNING"
    assert warning["pollIntervalMs"] == 60_000
    assert warning["ordersAllowed"] is False

    reduce = classify_margin_risk({
        "maintenanceMarginRatioPct": 64.0,
        "minimumLiquidationBufferPct": 8.0,
    })
    assert reduce["stage"] == "REDUCE"

    critical = classify_margin_risk({
        "maintenanceMarginRatioPct": 75.0,
        "minimumLiquidationBufferPct": 20.0,
    })
    assert critical["stage"] == "CRITICAL"

    hysteresis = classify_margin_risk({
        "maintenanceMarginRatioPct": 47.0,
        "minimumLiquidationBufferPct": 14.0,
    }, "WARNING")
    assert hysteresis["stage"] == "WARNING"

    recovered = classify_margin_risk({
        "maintenanceMarginRatioPct": 40.0,
        "minimumLiquidationBufferPct": 16.0,
    }, "WARNING")
    assert recovered["stage"] == "HEALTHY"

    account = {"totalMaintMargin": "10", "totalMarginBalance": "100"}
    rows = [{"symbol": "BTCUSDT", "positionAmt": "1", "markPrice": "100", "liquidationPrice": "90"}]
    snapshot = build_margin_risk_snapshot(account, rows, ["BTCUSDT"])
    assert abs(snapshot["maintenanceMarginRatioPct"] - 10.0) < 1e-12
    assert abs(snapshot["minimumLiquidationBufferPct"] - 10.0) < 1e-12
    print("V96/V52 adaptive margin risk policy self-test: PASS")


if __name__ == "__main__":
    self_test()
