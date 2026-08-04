from __future__ import annotations

import argparse
import json
import os
import signal
from typing import Dict, List, Optional, Tuple

import disdex_v52_aster_only_live_engine as legacy

base = legacy.base

STRATEGY_ID = legacy.STRATEGY_ID
LIVE_ACK = legacy.LIVE_ACK
V11_SLOT = legacy.V11_SLOT
V50_SLOT = legacy.V50_SLOT
MANAGED_CRYPTO_SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT")
MANAGED_STOCK_SYMBOLS = tuple(base.ASTER_SYMBOL.values())
MANAGED_SYMBOLS = MANAGED_CRYPTO_SYMBOLS + MANAGED_STOCK_SYMBOLS
EPSILON = 1e-9


def normalized_margin_type(row: dict) -> str:
    raw = str(row.get("marginType") or "").strip().lower()
    if raw in {"cross", "crossed"}:
        return "cross"
    if raw in {"isolated", "isolate"}:
        return "isolated"
    isolated = row.get("isolated")
    if isolated is False:
        return "cross"
    if isolated is True:
        return "isolated"
    return "unknown"


def position_notional(row: dict) -> float:
    quantity = abs(base.finite(row.get("positionAmt")))
    price = base.finite(row.get("markPrice") or row.get("entryPrice"))
    return quantity * price


def row_initial_margin(row: dict) -> float:
    reported = base.finite(
        row.get("initialMargin")
        or row.get("positionInitialMargin")
        or row.get("isolatedMargin"),
        -1.0,
    )
    if reported >= 0:
        return reported
    leverage = base.finite(row.get("leverage"))
    notional = position_notional(row)
    if notional <= 0:
        return 0.0
    if leverage < 1:
        raise RuntimeError(f"Invalid leverage for {row.get('symbol')}: {row.get('leverage')}")
    return notional / leverage


def verify_fixed_account_configuration(rows: List[dict], required_leverage: int) -> Dict[str, dict]:
    by_symbol = {str(row.get("symbol") or "").upper(): row for row in rows}
    checked: Dict[str, dict] = {}
    for symbol in MANAGED_SYMBOLS:
        row = by_symbol.get(symbol)
        if row is None:
            raise RuntimeError(f"Aster position-risk row missing for managed symbol: {symbol}")
        leverage = int(base.finite(row.get("leverage")))
        margin_type = normalized_margin_type(row)
        if leverage != required_leverage:
            raise RuntimeError(
                f"Managed symbol leverage mismatch for {symbol}: expected {required_leverage}, got {leverage}"
            )
        if margin_type != "cross":
            raise RuntimeError(
                f"Managed symbol margin type mismatch for {symbol}: expected cross, got {margin_type}"
            )
        checked[symbol] = {"leverage": leverage, "marginType": margin_type}
    return checked


class MarginAwareV52AsterOnlyEngine(legacy.V52AsterOnlyEngine):
    def __init__(self, mode: str):
        super().__init__(mode)
        self.crypto_gross_cap = base.float_env("DISDEX_V52_CRYPTO_GROSS_CAP", 1.5)
        self.stock_gross_cap = base.float_env("DISDEX_V52_STOCK_GROSS_CAP", 1.5)
        self.portfolio_gross_cap = base.float_env("DISDEX_V52_PORTFOLIO_GROSS_CAP", 2.5)
        self.v11_gross_cap = base.float_env("DISDEX_V52_V11_GROSS_CAP", 1.0)
        self.v50_gross_cap = base.float_env("DISDEX_V52_V50_GROSS_CAP", 1.0)
        self.reserved_first_stock_gross = base.float_env("DISDEX_V52_RESERVED_FIRST_STOCK_GROSS", 1.0)
        self.minimum_first_stock_gross = base.float_env("DISDEX_V52_MINIMUM_FIRST_STOCK_GROSS", 0.5)
        self.minimum_second_stock_gross = base.float_env("DISDEX_V52_MINIMUM_SECOND_STOCK_GROSS", 0.25)
        self.maximum_concurrent_stock_positions = base.int_env("DISDEX_V52_MAX_CONCURRENT_STOCK_POSITIONS", 2)
        self.required_initial_leverage = base.int_env("DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE", 5)
        self.maximum_initial_margin_fraction = base.float_env("DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION", 0.70)
        self.minimum_available_balance_fraction = base.float_env(
            "DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION", 0.20
        )
        self._assert_policy_configuration()

    def _assert_policy_configuration(self) -> None:
        if abs(self.crypto_gross_cap - 1.5) > EPSILON:
            raise RuntimeError("V52 fixed Crypto sleeve Gross must be 1.5")
        if abs(self.stock_gross_cap - 1.5) > EPSILON:
            raise RuntimeError("V52 fixed Stock sleeve Gross must be 1.5")
        if abs(self.portfolio_gross_cap - 2.5) > EPSILON:
            raise RuntimeError("V52 fixed combined Portfolio Gross must be 2.5")
        if self.crypto_gross_cap + self.reserved_first_stock_gross > self.portfolio_gross_cap + EPSILON:
            raise RuntimeError("V52 policy does not reserve enough Gross for the first Stock position")
        if self.maximum_concurrent_stock_positions != 2:
            raise RuntimeError("V52 maximum concurrent Stock positions must be exactly 2")
        if self.required_initial_leverage != 5:
            raise RuntimeError("V96/V52 managed-symbol leverage must be exactly 5x")
        if not 0 < self.maximum_initial_margin_fraction <= 0.70 + EPSILON:
            raise RuntimeError("Maximum initial-margin fraction must be positive and no greater than 0.70")
        if not 0.20 - EPSILON <= self.minimum_available_balance_fraction < 1:
            raise RuntimeError("Minimum available-balance fraction must be at least 0.20")
        if self.minimum_second_stock_gross < 0.25 - EPSILON:
            raise RuntimeError("Second Stock position minimum Gross must be at least 0.25")

    def _usdt_balance(self) -> dict:
        rows = self.aster.balances()
        row = next((item for item in rows if str(item.get("asset") or "").upper() == "USDT"), None)
        if row is None:
            raise RuntimeError("Aster USDT balance row is missing")
        return row

    def account_margin_snapshot(self, rows: Optional[List[dict]] = None) -> dict:
        position_rows = rows if rows is not None else self.aster.positions()
        equity = self.portfolio_equity()
        if equity <= 0:
            raise RuntimeError("Aster equity must be positive")
        balance = self._usdt_balance()
        available = base.finite(balance.get("availableBalance"))
        if available < 0:
            raise RuntimeError("Aster available balance is invalid")
        current_initial_margin = sum(row_initial_margin(row) for row in position_rows)
        return {
            "equityUsd": equity,
            "availableBalanceUsd": available,
            "currentInitialMarginUsd": current_initial_margin,
            "currentInitialMarginFraction": current_initial_margin / equity,
        }

    def account_configuration(self, rows: Optional[List[dict]] = None) -> Dict[str, dict]:
        position_rows = rows if rows is not None else self.aster.positions()
        return verify_fixed_account_configuration(position_rows, self.required_initial_leverage)

    def projected_margin_capacity_gross(self, snapshot: dict, margin: dict) -> float:
        equity = base.finite(snapshot.get("equityUsd"))
        if equity <= 0:
            return 0.0
        current_initial_margin = base.finite(margin.get("currentInitialMarginUsd"))
        available_balance = base.finite(margin.get("availableBalanceUsd"))
        room_by_initial_margin = max(
            0.0,
            equity * self.maximum_initial_margin_fraction - current_initial_margin,
        )
        room_by_available_balance = max(
            0.0,
            available_balance - equity * self.minimum_available_balance_fraction,
        )
        margin_room = min(room_by_initial_margin, room_by_available_balance)
        return margin_room * self.required_initial_leverage / equity

    def available_slot_gross(self, slot: str) -> Tuple[float, dict]:
        snapshot = self.gross_snapshot()
        positions = self.positions()
        if slot in positions or self.v96_requires_margin():
            return 0.0, snapshot
        if len(positions) >= self.maximum_concurrent_stock_positions:
            return 0.0, snapshot
        rows = self.aster.positions() if self.live else []
        if self.live:
            self.account_configuration(rows)
            margin = self.account_margin_snapshot(rows)
        else:
            margin = {
                "equityUsd": snapshot["equityUsd"],
                "availableBalanceUsd": snapshot["equityUsd"],
                "currentInitialMarginUsd": snapshot["totalGross"] * snapshot["equityUsd"] / self.required_initial_leverage,
                "currentInitialMarginFraction": snapshot["totalGross"] / self.required_initial_leverage,
            }
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        gross_capacity = min(
            slot_cap,
            max(0.0, self.stock_gross_cap - snapshot["stockGross"]),
            max(0.0, self.portfolio_gross_cap - snapshot["totalGross"]),
            self.projected_margin_capacity_gross(snapshot, margin),
        )
        minimum = self.minimum_first_stock_gross if len(positions) == 0 else self.minimum_second_stock_gross
        allocated = max(0.0, gross_capacity)
        if allocated + EPSILON < minimum:
            return 0.0, {
                **snapshot,
                "margin": margin,
                "minimumRequiredSlotGross": minimum,
                "marginCapacityGross": self.projected_margin_capacity_gross(snapshot, margin),
            }
        return allocated, {
            **snapshot,
            "margin": margin,
            "minimumRequiredSlotGross": minimum,
            "marginCapacityGross": self.projected_margin_capacity_gross(snapshot, margin),
        }

    def open_basis_position(self, slot: str, candidate: dict, target_gross: float) -> bool:
        current_capacity, capacity_snapshot = self.available_slot_gross(slot)
        if target_gross <= 0 or target_gross > current_capacity + self.gross_tolerance:
            self.log(
                "v52-entry-capacity-recheck-blocked",
                slot=slot,
                requestedGross=target_gross,
                currentCapacityGross=current_capacity,
                capacitySnapshot=capacity_snapshot,
            )
            return False
        return super().open_basis_position(slot, candidate, min(target_gross, current_capacity))

    def preflight(self, read_only: bool = False) -> dict:
        checks = super().preflight(read_only=read_only)
        rows = self.aster.positions() if self.live else []
        configuration = self.account_configuration(rows) if self.live else {
            symbol: {"leverage": self.required_initial_leverage, "marginType": "cross"}
            for symbol in MANAGED_SYMBOLS
        }
        margin = self.account_margin_snapshot(rows) if self.live else {
            "equityUsd": self.portfolio_equity(),
            "availableBalanceUsd": self.portfolio_equity(),
            "currentInitialMarginUsd": 0.0,
            "currentInitialMarginFraction": 0.0,
        }
        gross = checks["gross"]
        first_slot_capacity = min(
            self.v11_gross_cap,
            max(0.0, self.stock_gross_cap - gross["stockGross"]),
            max(0.0, self.portfolio_gross_cap - gross["totalGross"]),
            self.projected_margin_capacity_gross(gross, margin),
        )
        if not self.positions() and first_slot_capacity + EPSILON < self.minimum_first_stock_gross:
            raise RuntimeError(
                f"Combined account cannot support the minimum first V52 Stock Gross: {first_slot_capacity:.6f}"
            )
        checks.update({
            "accountConfiguration": configuration,
            "accountMargin": margin,
            "requiredInitialLeverage": self.required_initial_leverage,
            "requiredMarginType": "cross",
            "maximumInitialMarginFraction": self.maximum_initial_margin_fraction,
            "minimumAvailableBalanceFractionAfterOrder": self.minimum_available_balance_fraction,
            "reservedFirstStockGross": self.reserved_first_stock_gross,
            "minimumFirstStockGross": self.minimum_first_stock_gross,
            "minimumSecondStockGross": self.minimum_second_stock_gross,
            "maximumConcurrentStockPositions": self.maximum_concurrent_stock_positions,
            "firstStockCapacityGross": first_slot_capacity,
        })
        return checks


def self_test() -> None:
    rows = []
    for symbol in MANAGED_SYMBOLS:
        rows.append({"symbol": symbol, "leverage": "5", "marginType": "cross", "positionAmt": "0", "markPrice": "1"})
    checked = verify_fixed_account_configuration(rows, 5)
    assert len(checked) == len(MANAGED_SYMBOLS)

    engine = object.__new__(MarginAwareV52AsterOnlyEngine)
    engine.crypto_gross_cap = 1.5
    engine.stock_gross_cap = 1.5
    engine.portfolio_gross_cap = 2.5
    engine.v11_gross_cap = 1.0
    engine.v50_gross_cap = 1.0
    engine.reserved_first_stock_gross = 1.0
    engine.minimum_first_stock_gross = 0.5
    engine.minimum_second_stock_gross = 0.25
    engine.maximum_concurrent_stock_positions = 2
    engine.required_initial_leverage = 5
    engine.maximum_initial_margin_fraction = 0.70
    engine.minimum_available_balance_fraction = 0.20
    engine.gross_tolerance = 0.03
    engine.live = False
    engine.v96_requires_margin = lambda: False

    engine.state = {"positions": {}}
    engine.gross_snapshot = lambda: {
        "equityUsd": 100.0,
        "cryptoNotionalUsd": 115.0,
        "stockNotionalUsd": 0.0,
        "cryptoGross": 1.15,
        "stockGross": 0.0,
        "totalGross": 1.15,
    }
    gross, _ = engine.available_slot_gross(V11_SLOT)
    assert abs(gross - 1.0) < EPSILON

    engine.state = {"positions": {V11_SLOT: {"symbol": "META"}}}
    engine.gross_snapshot = lambda: {
        "equityUsd": 100.0,
        "cryptoNotionalUsd": 115.0,
        "stockNotionalUsd": 100.0,
        "cryptoGross": 1.15,
        "stockGross": 1.0,
        "totalGross": 2.15,
    }
    gross, _ = engine.available_slot_gross(V50_SLOT)
    assert abs(gross - 0.35) < EPSILON

    engine.gross_snapshot = lambda: {
        "equityUsd": 100.0,
        "cryptoNotionalUsd": 150.0,
        "stockNotionalUsd": 100.0,
        "cryptoGross": 1.5,
        "stockGross": 1.0,
        "totalGross": 2.5,
    }
    gross, _ = engine.available_slot_gross(V50_SLOT)
    assert gross == 0.0

    print("V52 margin-aware concurrent Stock runner self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=("paper", "live"),
        default=os.getenv("DISDEX_V52_ASTER_ONLY_RUNNER_MODE", "paper"),
    )
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--preflight-readonly", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    runner = MarginAwareV52AsterOnlyEngine(args.mode)
    signal.signal(signal.SIGINT, lambda *_: setattr(runner, "stop_requested", True))
    signal.signal(signal.SIGTERM, lambda *_: setattr(runner, "stop_requested", True))
    if args.preflight_readonly:
        print(json.dumps(runner.preflight(read_only=True), ensure_ascii=False, separators=(",", ":")))
        return 0
    if args.preflight:
        print(json.dumps(runner.preflight(), indent=2, ensure_ascii=False))
        return 0
    runner.run(args.daemon and not args.once)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
