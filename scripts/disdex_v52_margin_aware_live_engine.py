from __future__ import annotations

import argparse
import json
import os
import signal
from typing import Dict, List, Optional, Tuple

import disdex_v52_aster_only_live_engine as legacy

base = legacy.base
STRATEGY_ID = legacy.STRATEGY_ID
V11_SLOT = legacy.V11_SLOT
V50_SLOT = legacy.V50_SLOT
MANAGED_CRYPTO_SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT")
MANAGED_STOCK_SYMBOLS = tuple(base.ASTER_SYMBOL.values())
MANAGED_SYMBOLS = MANAGED_CRYPTO_SYMBOLS + MANAGED_STOCK_SYMBOLS
EPSILON = 1e-9
ACCOUNT_RISK_POLL_INTERVAL_MS = 30_000


def normalized_margin_type(row: dict) -> str:
    raw = str(row.get("marginType") or "").strip().lower()
    if raw in {"cross", "crossed"}:
        return "cross"
    if raw in {"isolated", "isolate"}:
        return "isolated"
    if row.get("isolated") is False:
        return "cross"
    if row.get("isolated") is True:
        return "isolated"
    return "unknown"


def position_notional(row: dict) -> float:
    return abs(base.finite(row.get("positionAmt"))) * base.finite(row.get("markPrice") or row.get("entryPrice"))


def row_initial_margin(row: dict) -> float:
    for key in ("initialMargin", "positionInitialMargin", "isolatedMargin"):
        raw = row.get(key)
        if raw is not None and str(raw).strip() != "":
            reported = base.finite(raw, -1.0)
            if reported >= 0:
                return reported
    notional = position_notional(row)
    leverage = base.finite(row.get("leverage"))
    if notional <= 0:
        return 0.0
    if leverage < 1:
        raise RuntimeError(f"Invalid leverage for {row.get('symbol')}: {row.get('leverage')}")
    return notional / leverage


def verify_fixed_account_configuration(rows: List[dict], required_leverage: int) -> Dict[str, dict]:
    by_symbol = {str(row.get("symbol") or "").upper(): row for row in rows}
    result: Dict[str, dict] = {}
    for symbol in MANAGED_SYMBOLS:
        row = by_symbol.get(symbol)
        if row is None:
            raise RuntimeError(f"Aster position-risk row missing for managed symbol: {symbol}")
        leverage = int(base.finite(row.get("leverage")))
        margin_type = normalized_margin_type(row)
        if leverage != required_leverage:
            raise RuntimeError(f"Managed symbol leverage mismatch for {symbol}: expected {required_leverage}, got {leverage}")
        if margin_type != "cross":
            raise RuntimeError(f"Managed symbol margin type mismatch for {symbol}: expected cross, got {margin_type}")
        result[symbol] = {"leverage": leverage, "marginType": margin_type}
    return result


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
        self.minimum_available_balance_fraction = base.float_env("DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION", 0.20)
        self._last_account_risk_check_ms = 0
        self._account_risk_cache = None
        self._assert_policy_configuration()

    def _assert_policy_configuration(self) -> None:
        for actual, expected, label in (
            (self.crypto_gross_cap, 1.5, "Crypto sleeve Gross"),
            (self.stock_gross_cap, 1.5, "Stock sleeve Gross"),
            (self.portfolio_gross_cap, 2.5, "combined Portfolio Gross"),
        ):
            if abs(actual - expected) > EPSILON:
                raise RuntimeError(f"V52 fixed {label} must be {expected}")
        if self.crypto_gross_cap + self.reserved_first_stock_gross > self.portfolio_gross_cap + EPSILON:
            raise RuntimeError("V52 policy does not reserve enough Gross for the first Stock position")
        if self.maximum_concurrent_stock_positions != 2:
            raise RuntimeError("V52 maximum concurrent Stock positions must be exactly 2")
        if self.required_initial_leverage != 5:
            raise RuntimeError("V96/V52 managed-symbol leverage must be exactly 5x")
        if not 0 < self.maximum_initial_margin_fraction <= 0.70 + EPSILON:
            raise RuntimeError("Maximum initial-margin fraction must be no greater than 0.70")
        if not 0.20 - EPSILON <= self.minimum_available_balance_fraction < 1:
            raise RuntimeError("Minimum available-balance fraction must be at least 0.20")
        if self.minimum_second_stock_gross < 0.25 - EPSILON:
            raise RuntimeError("Second Stock position minimum Gross must be at least 0.25")

    def excess_margin_usd(self) -> float:
        equity = self.portfolio_equity()
        if equity <= 0 or self.portfolio_gross_cap <= 0:
            return 0.0
        return equity * min(1.0, self.stock_gross_cap / self.portfolio_gross_cap)

    def _usdt_balance(self) -> dict:
        row = next((item for item in self.aster.balances() if str(item.get("asset") or "").upper() == "USDT"), None)
        if row is None:
            raise RuntimeError("Aster USDT balance row is missing")
        return row

    def account_margin_snapshot(self, rows: List[dict]) -> dict:
        equity = self.portfolio_equity()
        if equity <= 0:
            raise RuntimeError("Aster equity must be positive")
        available = base.finite(self._usdt_balance().get("availableBalance"))
        if available < 0:
            raise RuntimeError("Aster available balance is invalid")
        initial_margin = sum(row_initial_margin(row) for row in rows)
        return {
            "equityUsd": equity,
            "availableBalanceUsd": available,
            "currentInitialMarginUsd": initial_margin,
            "currentInitialMarginFraction": initial_margin / equity,
        }

    def assert_account_margin_safe(self, *, force: bool = False, rows: Optional[List[dict]] = None) -> dict:
        now = base.now_ms()
        if not force and self._account_risk_cache and now - self._last_account_risk_check_ms < ACCOUNT_RISK_POLL_INTERVAL_MS:
            return self._account_risk_cache
        position_rows = rows if rows is not None else self.aster.positions()
        configuration = verify_fixed_account_configuration(position_rows, self.required_initial_leverage)
        margin = self.account_margin_snapshot(position_rows)
        if margin["currentInitialMarginFraction"] > self.maximum_initial_margin_fraction + EPSILON:
            raise RuntimeError(
                f"Combined initial-margin fraction exceeds safety maximum: {margin['currentInitialMarginFraction']:.6f} > {self.maximum_initial_margin_fraction:.6f}"
            )
        minimum_available = margin["equityUsd"] * self.minimum_available_balance_fraction
        if margin["availableBalanceUsd"] + EPSILON < minimum_available:
            raise RuntimeError(
                f"Combined available balance is below reserve: {margin['availableBalanceUsd']:.6f} < {minimum_available:.6f}"
            )
        self._account_risk_cache = {"configuration": configuration, "margin": margin}
        self._last_account_risk_check_ms = now
        return self._account_risk_cache

    def projected_margin_capacity_gross(self, snapshot: dict, margin: dict) -> float:
        equity = base.finite(snapshot.get("equityUsd"))
        if equity <= 0:
            return 0.0
        room_by_fraction = max(0.0, equity * self.maximum_initial_margin_fraction - base.finite(margin.get("currentInitialMarginUsd")))
        room_by_balance = max(0.0, base.finite(margin.get("availableBalanceUsd")) - equity * self.minimum_available_balance_fraction)
        return min(room_by_fraction, room_by_balance) * self.required_initial_leverage / equity

    def available_slot_gross(self, slot: str) -> Tuple[float, dict]:
        snapshot = self.gross_snapshot()
        positions = self.positions()
        if slot in positions or self.v96_requires_margin() or len(positions) >= self.maximum_concurrent_stock_positions:
            return 0.0, snapshot
        if self.live:
            margin = self.assert_account_margin_safe(force=True)["margin"]
        else:
            margin = {
                "equityUsd": snapshot["equityUsd"],
                "availableBalanceUsd": snapshot["equityUsd"],
                "currentInitialMarginUsd": snapshot["totalGross"] * snapshot["equityUsd"] / self.required_initial_leverage,
                "currentInitialMarginFraction": snapshot["totalGross"] / self.required_initial_leverage,
            }
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        capacity = min(
            slot_cap,
            max(0.0, self.stock_gross_cap - snapshot["stockGross"]),
            max(0.0, self.portfolio_gross_cap - snapshot["totalGross"]),
            self.projected_margin_capacity_gross(snapshot, margin),
        )
        minimum = self.minimum_first_stock_gross if not positions else self.minimum_second_stock_gross
        if capacity + EPSILON < minimum:
            return 0.0, {**snapshot, "margin": margin, "minimumRequiredSlotGross": minimum}
        return max(0.0, capacity), {**snapshot, "margin": margin, "minimumRequiredSlotGross": minimum}

    def open_basis_position(self, slot: str, candidate: dict, target_gross: float) -> bool:
        self._account_risk_cache = None
        current_capacity, capacity_snapshot = self.available_slot_gross(slot)
        if target_gross <= 0 or target_gross > current_capacity + self.gross_tolerance:
            self.log("v52-entry-capacity-recheck-blocked", slot=slot, requestedGross=target_gross,
                     currentCapacityGross=current_capacity, capacitySnapshot=capacity_snapshot)
            return False
        return super().open_basis_position(slot, candidate, min(target_gross, current_capacity))

    def tick(self) -> None:
        if self.live and base.now_ms() - self._last_account_risk_check_ms >= ACCOUNT_RISK_POLL_INTERVAL_MS:
            self.assert_account_margin_safe(force=True)
            self.assert_gross_safe()
        super().tick()

    def preflight(self, read_only: bool = False) -> dict:
        checks = super().preflight(read_only=read_only)
        if self.live:
            account = self.assert_account_margin_safe(force=True)
            configuration, margin = account["configuration"], account["margin"]
        else:
            configuration = {symbol: {"leverage": 5, "marginType": "cross"} for symbol in MANAGED_SYMBOLS}
            equity = self.portfolio_equity()
            margin = {"equityUsd": equity, "availableBalanceUsd": equity,
                      "currentInitialMarginUsd": 0.0, "currentInitialMarginFraction": 0.0}
        gross = checks["gross"]
        first_capacity = min(
            self.v11_gross_cap,
            max(0.0, self.stock_gross_cap - gross["stockGross"]),
            max(0.0, self.portfolio_gross_cap - gross["totalGross"]),
            self.projected_margin_capacity_gross(gross, margin),
        )
        if not self.positions() and first_capacity + EPSILON < self.minimum_first_stock_gross:
            raise RuntimeError(f"Combined account cannot support minimum first V52 Stock Gross: {first_capacity:.6f}")
        checks.update({
            "accountConfiguration": configuration,
            "accountMargin": margin,
            "v52StrategyCapitalUsd": self.excess_margin_usd(),
            "requiredInitialLeverage": 5,
            "requiredMarginType": "cross",
            "maximumInitialMarginFraction": self.maximum_initial_margin_fraction,
            "minimumAvailableBalanceFractionAfterOrder": self.minimum_available_balance_fraction,
            "reservedFirstStockGross": self.reserved_first_stock_gross,
            "minimumFirstStockGross": self.minimum_first_stock_gross,
            "minimumSecondStockGross": self.minimum_second_stock_gross,
            "maximumConcurrentStockPositions": self.maximum_concurrent_stock_positions,
            "firstStockCapacityGross": first_capacity,
            "accountRiskPollIntervalMs": ACCOUNT_RISK_POLL_INTERVAL_MS,
        })
        return checks


def self_test() -> None:
    rows = [{"symbol": symbol, "leverage": "5", "marginType": "cross", "positionAmt": "0", "markPrice": "1"}
            for symbol in MANAGED_SYMBOLS]
    assert len(verify_fixed_account_configuration(rows, 5)) == len(MANAGED_SYMBOLS)
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
    engine.portfolio_equity = lambda: 100.0
    assert abs(engine.excess_margin_usd() - 60.0) < EPSILON

    engine.state = {"positions": {}}
    engine.gross_snapshot = lambda: {"equityUsd": 100.0, "cryptoNotionalUsd": 115.0, "stockNotionalUsd": 0.0,
                                     "cryptoGross": 1.15, "stockGross": 0.0, "totalGross": 1.15}
    first, _ = engine.available_slot_gross(V11_SLOT)
    assert abs(first - 1.0) < EPSILON

    engine.state = {"positions": {V11_SLOT: {"symbol": "META"}}}
    engine.gross_snapshot = lambda: {"equityUsd": 100.0, "cryptoNotionalUsd": 115.0, "stockNotionalUsd": 100.0,
                                     "cryptoGross": 1.15, "stockGross": 1.0, "totalGross": 2.15}
    second, _ = engine.available_slot_gross(V50_SLOT)
    assert abs(second - 0.35) < EPSILON

    engine.gross_snapshot = lambda: {"equityUsd": 100.0, "cryptoNotionalUsd": 150.0, "stockNotionalUsd": 100.0,
                                     "cryptoGross": 1.5, "stockGross": 1.0, "totalGross": 2.5}
    blocked, _ = engine.available_slot_gross(V50_SLOT)
    assert blocked == 0.0
    assert abs(2.5 / 5.0 - 0.50) < EPSILON
    print("V52 margin-aware concurrent Stock runner self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("paper", "live"),
                        default=os.getenv("DISDEX_V52_ASTER_ONLY_RUNNER_MODE", "paper"))
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--preflight-readonly", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test(); return 0
    runner = MarginAwareV52AsterOnlyEngine(args.mode)
    signal.signal(signal.SIGINT, lambda *_: setattr(runner, "stop_requested", True))
    signal.signal(signal.SIGTERM, lambda *_: setattr(runner, "stop_requested", True))
    if args.preflight_readonly:
        print(json.dumps(runner.preflight(read_only=True), ensure_ascii=False, separators=(",", ":"))); return 0
    if args.preflight:
        print(json.dumps(runner.preflight(), indent=2, ensure_ascii=False)); return 0
    runner.run(args.daemon and not args.once)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
