from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Any, Optional


SCHEMA_VERSION = 1
DEFAULT_SPOOL_PATH = "/var/lib/disdex/shared/trade-fill-notifications/inbox.jsonl"


def _truthy(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number == number and abs(number) != float("inf") else fallback


def enqueue_trade_fill_notification(
    fill: Any,
    *,
    strategy_id: str,
    event_type: str,
    reason: str,
    live: bool,
    metadata: Optional[dict[str, Any]] = None,
    env: Optional[dict[str, str]] = None,
) -> bool:
    """Append one confirmed live fill to the shared notifier spool.

    This function never sends mail and never raises into the trading path.  A
    runner must explicitly pass ``live=True`` and enable the notification
    switch; paper/self-test fills therefore cannot become email events.
    """
    values = env if env is not None else os.environ
    if not live or not _truthy(values.get("DISDEX_TRADE_FILL_NOTIFICATION_ENABLED")):
        return False
    configured_mode = str(values.get("DISDEX_TRADE_FILL_NOTIFICATION_MODE", "live")).strip().lower()
    if configured_mode != "live":
        return False
    status = str(getattr(fill, "status", "UNKNOWN") or "UNKNOWN").strip().upper()
    executed_quantity = _finite(getattr(fill, "executed_qty", 0.0))
    symbol = str(getattr(fill, "symbol", "") or "").strip().upper()
    side = str(getattr(fill, "side", "") or "").strip().upper()
    client_order_id = str(getattr(fill, "client_id", "") or "").strip()
    if status not in {"FILLED", "PARTIALLY_FILLED"} or executed_quantity <= 0 or not symbol or not client_order_id or side not in {"BUY", "SELL"}:
        return False
    average_price = _finite(getattr(fill, "average_price", 0.0))
    order_id = getattr(fill, "order_id", None)
    event = {
        "schemaVersion": SCHEMA_VERSION,
        "strategyId": str(strategy_id),
        "eventType": str(event_type),
        "symbol": symbol,
        "side": side,
        "reduceOnly": str(event_type).upper() == "EXIT_FILL",
        "status": status,
        "requestId": client_order_id,
        "orderId": str(order_id) if order_id is not None else None,
        "clientOrderId": client_order_id,
        "executedQuantity": executed_quantity,
        "averagePrice": average_price,
        "quoteQuantity": executed_quantity * average_price if average_price > 0 else 0.0,
        "executedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "reason": str(reason),
        "metadata": metadata or {},
    }
    spool = Path(str(values.get("DISDEX_TRADE_FILL_NOTIFICATION_SPOOL_PATH") or DEFAULT_SPOOL_PATH))
    try:
        spool.parent.mkdir(parents=True, exist_ok=True)
        with spool.open("a", encoding="utf-8") as writer:
            writer.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
            writer.flush()
        if os.name != "nt":
            try:
                spool.chmod(0o600)
            except OSError:
                pass
        return True
    except OSError:
        return False
