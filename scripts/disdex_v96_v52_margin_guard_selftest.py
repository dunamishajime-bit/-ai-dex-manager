from __future__ import annotations

from disdex_v96_v52_margin_guard import MarginGuard


class FakeAsterClient:
    def __init__(self) -> None:
        self.rows = [
            {
                "symbol": "BTCUSDT",
                "positionAmt": "0.125",
                "markPrice": "100",
                "liquidationPrice": "90",
                "leverage": "5",
                "marginType": "cross",
            },
            {
                "symbol": "METAUSDT",
                "positionAmt": "-2",
                "markPrice": "50",
                "liquidationPrice": "58",
                "leverage": "5",
                "marginType": "cross",
            },
        ]
        self.canceled_symbols: list[str] = []
        self.orders: list[dict] = []

    def positions(self) -> list[dict]:
        return [dict(row) for row in self.rows]

    def open_orders(self) -> list[dict]:
        return [
            {"symbol": "BTCUSDT", "clientOrderId": "old-btc"},
            {"symbol": "METAUSDT", "clientOrderId": "old-meta"},
        ]

    def cancel_all(self, symbol: str) -> dict:
        self.canceled_symbols.append(symbol)
        return {"symbol": symbol, "status": "CANCELED"}

    def _signed(self, method: str, path: str, params: dict) -> dict:
        assert method == "POST"
        assert path == "/fapi/v3/order"
        assert params["type"] == "MARKET"
        assert params["positionSide"] == "BOTH"
        assert params["reduceOnly"] == "true"
        symbol = str(params["symbol"])
        side = str(params["side"])
        quantity = float(params["quantity"])
        row = next(item for item in self.rows if item["symbol"] == symbol)
        current = float(row["positionAmt"])
        assert quantity == abs(current)
        assert side == ("SELL" if current > 0 else "BUY")
        self.orders.append(dict(params))
        row["positionAmt"] = "0"
        return {
            "symbol": symbol,
            "side": side,
            "clientOrderId": params["newClientOrderId"],
            "orderId": len(self.orders),
            "status": "FILLED",
            "executedQty": params["quantity"],
            "avgPrice": row["markPrice"],
        }


def main() -> int:
    guard = object.__new__(MarginGuard)
    guard.live = True
    guard.mode = "live"
    guard.client = FakeAsterClient()
    result = guard.emergency_flatten_managed({
        "stage": "REDUCE",
        "maintenanceMarginRatioPct": 65.0,
        "minimumLiquidationBufferPct": 8.0,
    })
    assert result["status"] == "PASS"
    assert result["cancelRequestsSent"] == 2
    assert result["reduceOnlyOrdersSent"] == 2
    assert result["ordersSent"] is True
    assert result["cancelSent"] is True
    assert result["positionChangesSent"] is True
    assert result["remainingManagedPositions"] == []
    assert sorted(guard.client.canceled_symbols) == ["BTCUSDT", "METAUSDT"]
    assert all(order["reduceOnly"] == "true" for order in guard.client.orders)
    assert {order["side"] for order in guard.client.orders} == {"BUY", "SELL"}
    print("V96/V52 emergency reduce-only Margin Guard self-test: PASS")
    print("exposureIncreasingOrdersSent=false")
    print("reduceOnlyOrdersSent=2")
    print("remainingManagedPositions=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
