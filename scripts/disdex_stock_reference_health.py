from __future__ import annotations

from collections.abc import Iterable
from typing import Any


def reference_payload_is_ready(
    payload: Any,
    *,
    require_fresh: bool,
    required_symbols: Iterable[str] = (),
) -> bool:
    """Validate either the Pyth/IEX or active Alpaca reference health contract.

    The health endpoint only establishes source connectivity. During an open
    session, the caller still must fetch every quote and apply its normal
    timestamp/quality gate before it can plan an order.
    """
    if not isinstance(payload, dict):
        return False
    status = payload.get("status")
    if status not in {"ok", "deferred"}:
        return False

    pyth_iex_connected = payload.get("pythConnected") is True and payload.get("iexConnected") is True
    alpaca_connected = payload.get("connected") is True
    if not (pyth_iex_connected or alpaca_connected):
        return False

    if not require_fresh:
        return True

    if pyth_iex_connected:
        return status == "ok" and payload.get("freshnessReady") is True

    symbols = payload.get("symbols")
    if not isinstance(symbols, dict):
        return False
    required = tuple(str(symbol) for symbol in required_symbols)
    if not required or any(symbol not in symbols for symbol in required):
        return False
    return all(
        isinstance(symbols[symbol], dict)
        and isinstance(symbols[symbol].get("ageMs"), (int, float))
        and symbols[symbol]["ageMs"] >= 0
        for symbol in required
    )
