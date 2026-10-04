from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import signal
import time
from pathlib import Path
from typing import Dict, List, Tuple

import disdex_v52_aster_only_live_engine as legacy
from disdex_v96_v52_margin_guard import MANAGED_SYMBOLS, verify_managed_configuration
from disdex_v96_v52_margin_risk_policy import (
    HEALTHY_POLL_INTERVAL_MS,
    WARNING_POLL_INTERVAL_MS,
    build_margin_risk_snapshot,
    classify_margin_risk,
)

base = legacy.base
ReferenceQualityError = legacy.ReferenceQualityError
STRATEGY_ID = legacy.STRATEGY_ID
V11_SLOT = legacy.V11_SLOT
V50_SLOT = legacy.V50_SLOT
EPSILON = 1e-9
ACTIVE_LOOP_INTERVAL_MS = 2_000
DAILY_LOSS_CHECK_INTERVAL_MS = 60_000


class MarginAwareV52AsterOnlyEngine(legacy.V52AsterOnlyEngine):
    def __init__(self, mode: str):
        super().__init__(mode)
        self.crypto_gross_cap = base.float_env("DISDEX_V52_CRYPTO_GROSS_CAP", 1.5)
        self.stock_gross_cap = base.float_env("DISDEX_V52_STOCK_GROSS_CAP", 1.5)
        self.portfolio_gross_cap = base.float_env("DISDEX_V52_PORTFOLIO_GROSS_CAP", 2.5)
        self.v11_gross_cap = base.float_env("DISDEX_V52_V11_GROSS_CAP", 1.5)
        self.v50_gross_cap = base.float_env("DISDEX_V52_V50_GROSS_CAP", 1.25)
        self.reserved_first_stock_gross = base.float_env("DISDEX_V52_RESERVED_FIRST_STOCK_GROSS", 1.0)
        self.minimum_first_stock_gross = base.float_env("DISDEX_V52_MINIMUM_FIRST_STOCK_GROSS", 0.5)
        self.minimum_second_stock_gross = base.float_env("DISDEX_V52_MINIMUM_SECOND_STOCK_GROSS", 0.25)
        self.maximum_concurrent_stock_positions = base.int_env("DISDEX_V52_MAX_CONCURRENT_STOCK_POSITIONS", 2)
        self.required_initial_leverage = base.int_env("DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE", 5)
        self.maximum_initial_margin_fraction = base.float_env("DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION", 0.70)
        self.minimum_available_balance_fraction = base.float_env("DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION", 0.20)
        combined_root = Path(os.getenv(
            "DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT",
            str(self.state_root.parent),
        )).resolve()
        self.margin_guard_state_path = Path(os.getenv(
            "DISDEX_V96_V52_MARGIN_GUARD_STATE_FILE",
            str(combined_root / "margin-risk" / f"guard-{mode}.json"),
        )).resolve()
        self._last_daily_loss_check_ms = 0
        self._last_daily_loss_result = False
        self._last_reset_utc_day = None
        self._last_reset_ny_day = None
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
            raise RuntimeError("V52 policy does not reserve Gross 1.0 for the first Stock position")
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

    def account_info(self) -> dict:
        if not self.live:
            equity = base.float_env("DISDEX_STOCK_PAPER_ASTER_EQUITY_USD", 1000.0)
            return {
                "totalMaintMargin": "0",
                "totalMarginBalance": str(equity),
                "totalPositionInitialMargin": "0",
                "totalOpenOrderInitialMargin": "0",
                "availableBalance": str(equity),
            }
        return self.aster._signed("GET", "/fapi/v3/account", {})

    def _write_guard_state(self, decision: dict, configuration: Dict[str, dict]) -> None:
        now = base.now_ms()
        payload = {
            "schemaVersion": 1,
            "strategyId": "DISDEX_V96_V52_SHARED_MARGIN_GUARD",
            "mode": self.mode,
            "checkedAt": now,
            "nextCheckAt": now + int(decision["pollIntervalMs"]),
            "consecutiveFailures": 0,
            "accountConfiguration": configuration,
            "ordersSent": False,
            "cancelSent": False,
            "positionChangesSent": False,
            **decision,
        }
        self.margin_guard_state_path.parent.mkdir(parents=True, exist_ok=True)
        base.atomic_write_json(self.margin_guard_state_path, payload)

    def gross_snapshot_from_rows(self, account: dict, rows: List[dict]) -> dict:
        equity = base.finite(account.get("totalMarginBalance"))
        if equity <= 0:
            raise RuntimeError("Aster totalMarginBalance must be positive")
        crypto_symbols = {"BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"}
        stock_symbols = set(base.ASTER_SYMBOL.values())
        crypto_notional = 0.0
        stock_notional = 0.0
        for row in rows:
            symbol = str(row.get("symbol") or "").upper()
            notional = abs(base.finite(row.get("positionAmt"))) * base.finite(row.get("markPrice") or row.get("entryPrice"))
            if symbol in crypto_symbols:
                crypto_notional += notional
            elif symbol in stock_symbols:
                stock_notional += notional
        return {
            "equityUsd": equity,
            "cryptoNotionalUsd": crypto_notional,
            "stockNotionalUsd": stock_notional,
            "cryptoGross": crypto_notional / equity,
            "stockGross": stock_notional / equity,
            "totalGross": (crypto_notional + stock_notional) / equity,
        }

    def fresh_order_risk_check(self, *, write_state: bool = True, allow_kill_switch: bool = True) -> dict:
        account = self.account_info()
        rows = self.aster.positions() if self.live else [
            {
                "symbol": symbol,
                "positionAmt": "0",
                "markPrice": "1",
                "liquidationPrice": "0",
                "leverage": "5",
                "marginType": "cross",
            }
            for symbol in MANAGED_SYMBOLS
        ]
        configuration = verify_managed_configuration(rows)
        previous = base.read_json(self.margin_guard_state_path, {}) or {}
        snapshot = build_margin_risk_snapshot(account, rows, MANAGED_SYMBOLS)
        decision = classify_margin_risk(snapshot, str(previous.get("stage") or "HEALTHY"))
        decision["gross"] = self.gross_snapshot_from_rows(account, rows)
        if write_state:
            self._write_guard_state(decision, configuration)
        if allow_kill_switch and decision["stage"] in {"REDUCE", "CRITICAL"}:
            self.activate_kill_switch(
                "V52 pre-order Margin Guard triggered pre-liquidation stop-loss: "
                f"stage={decision['stage']}, marginRatio={decision['maintenanceMarginRatioPct']:.4f}%, "
                f"minimumLiquidationBuffer={decision['minimumLiquidationBufferPct']}"
            )
        return decision

    def projected_margin_capacity_gross(self, decision: dict) -> float:
        equity = base.finite(decision.get("totalMarginBalanceUsd"))
        if equity <= 0:
            return 0.0
        initial_margin = (
            base.finite(decision.get("totalPositionInitialMarginUsd"))
            + base.finite(decision.get("totalOpenOrderInitialMarginUsd"))
        )
        available = base.finite(decision.get("availableBalanceUsd"))
        room_by_fraction = max(0.0, equity * self.maximum_initial_margin_fraction - initial_margin)
        room_by_balance = max(0.0, available - equity * self.minimum_available_balance_fraction)
        return min(room_by_fraction, room_by_balance) * self.required_initial_leverage / equity

    def available_slot_gross(self, slot: str) -> Tuple[float, dict]:
        positions = self.positions()
        if slot in positions or self.v96_requires_margin() or len(positions) >= self.maximum_concurrent_stock_positions:
            return 0.0, self.gross_snapshot()
        decision = self.fresh_order_risk_check() if self.live else {
            "stage": "HEALTHY",
            "ordersAllowed": True,
            "gross": self.gross_snapshot(),
            "totalMarginBalanceUsd": self.portfolio_equity(),
            "totalPositionInitialMarginUsd": 0.0,
            "totalOpenOrderInitialMarginUsd": 0.0,
            "availableBalanceUsd": self.portfolio_equity(),
        }
        snapshot = decision["gross"]
        if not decision.get("ordersAllowed"):
            self.log("v52-entry-blocked-by-margin-guard", slot=slot, marginRisk=decision)
            return 0.0, snapshot
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        capacity = min(
            slot_cap,
            max(0.0, self.stock_gross_cap - snapshot["stockGross"]),
            max(0.0, self.portfolio_gross_cap - snapshot["totalGross"]),
            self.projected_margin_capacity_gross(decision),
        )
        minimum = self.minimum_first_stock_gross if not positions else self.minimum_second_stock_gross
        if capacity + EPSILON < minimum:
            return 0.0, {**snapshot, "minimumRequiredSlotGross": minimum, "marginRisk": decision}
        return max(0.0, capacity), {**snapshot, "minimumRequiredSlotGross": minimum, "marginRisk": decision}

    def open_basis_position(self, slot: str, candidate: dict, target_gross: float) -> bool:
        if self.live:
            decision = self.fresh_order_risk_check()
            if not decision.get("ordersAllowed"):
                self.log("v52-final-preorder-margin-guard-blocked", slot=slot, marginRisk=decision)
                return False
            snapshot = decision["gross"]
            current_capacity = min(
                self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap,
                max(0.0, self.stock_gross_cap - snapshot["stockGross"]),
                max(0.0, self.portfolio_gross_cap - snapshot["totalGross"]),
                self.projected_margin_capacity_gross(decision),
            )
            minimum = self.minimum_first_stock_gross if not self.positions() else self.minimum_second_stock_gross
            if current_capacity + EPSILON < minimum or target_gross > current_capacity + self.gross_tolerance:
                self.log(
                    "v52-final-preorder-capacity-blocked",
                    slot=slot,
                    requestedGross=target_gross,
                    currentCapacityGross=current_capacity,
                    minimumRequiredGross=minimum,
                    marginRisk=decision,
                )
                return False
        return super().open_basis_position(slot, candidate, target_gross)

    def reset_days(self) -> None:
        utc_day = dt.datetime.now(tz=base.UTC).date().isoformat()
        ny_day = dt.datetime.now(tz=base.NY).date().isoformat()
        latch = self.state.get("v52StrategyDailyLossLatch")
        if (
            self._last_reset_utc_day == utc_day
            and self._last_reset_ny_day == ny_day
            and isinstance(latch, dict)
            and latch.get("utcDay") == utc_day
        ):
            return
        super().reset_days()
        self._last_reset_utc_day = utc_day
        self._last_reset_ny_day = ny_day

    def _cached_equity(self) -> float:
        row = base.read_json(self.margin_guard_state_path, {}) or {}
        equity = base.finite(row.get("totalMarginBalanceUsd"))
        if equity > 0:
            return equity
        return base.float_env("DISDEX_STOCK_PAPER_ASTER_EQUITY_USD", 1000.0) if not self.live else 0.0

    def excess_margin_usd(self) -> float:
        equity = self._cached_equity()
        if equity <= 0:
            if self.live:
                decision = self.fresh_order_risk_check()
                equity = base.finite(decision.get("totalMarginBalanceUsd"))
            else:
                equity = self.portfolio_equity()
        if equity <= 0:
            return 0.0
        return equity * min(1.0, self.stock_gross_cap / self.portfolio_gross_cap)

    def _v52_unrealized_pnl(self) -> float:
        total = 0.0
        for position in self.positions().values():
            symbol = str(position["symbol"])
            book = self.aster.book(base.ASTER_SYMBOL[symbol], 5)
            mark = book.mid
            entry = base.finite(position.get("asterEntryPrice"))
            quantity = base.finite(position.get("asterQty"))
            direction = 1.0 if position.get("asterOpenSide") == "BUY" else -1.0
            total += (mark - entry) * quantity * direction
        return total

    def enforce_daily_loss(self) -> bool:
        now = base.now_ms()
        if now - self._last_daily_loss_check_ms < DAILY_LOSS_CHECK_INTERVAL_MS:
            return self._last_daily_loss_result
        self._last_daily_loss_check_ms = now
        self._last_daily_loss_result = super().enforce_daily_loss()
        return self._last_daily_loss_result

    def preflight(self, read_only: bool = False) -> dict:
        checks = super().preflight(read_only=read_only)
        decision = self.fresh_order_risk_check(
            write_state=not read_only,
            allow_kill_switch=not read_only,
        )
        if decision["stage"] != "HEALTHY":
            raise RuntimeError(f"V52 preflight requires HEALTHY Margin Guard, got {decision['stage']}")
        gross = decision["gross"]
        first_capacity = min(
            self.v11_gross_cap,
            max(0.0, self.stock_gross_cap - gross["stockGross"]),
            max(0.0, self.portfolio_gross_cap - gross["totalGross"]),
            self.projected_margin_capacity_gross(decision),
        )
        if not self.positions() and first_capacity + EPSILON < self.minimum_first_stock_gross:
            raise RuntimeError(f"Combined account cannot support minimum first V52 Stock Gross: {first_capacity:.6f}")
        strategy_capital = (
            base.finite(decision.get("totalMarginBalanceUsd"))
            * min(1.0, self.stock_gross_cap / self.portfolio_gross_cap)
        )
        checks.update({
            "marginGuard": decision,
            "v52StrategyCapitalUsd": strategy_capital,
            "requiredInitialLeverage": 5,
            "requiredMarginType": "cross",
            "maximumInitialMarginFraction": self.maximum_initial_margin_fraction,
            "minimumAvailableBalanceFractionAfterOrder": self.minimum_available_balance_fraction,
            "reservedFirstStockGross": self.reserved_first_stock_gross,
            "minimumFirstStockGross": self.minimum_first_stock_gross,
            "minimumSecondStockGross": self.minimum_second_stock_gross,
            "maximumConcurrentStockPositions": self.maximum_concurrent_stock_positions,
            "firstStockCapacityGross": first_capacity,
            "healthyMarginPollIntervalMs": HEALTHY_POLL_INTERVAL_MS,
            "warningMarginPollIntervalMs": WARNING_POLL_INTERVAL_MS,
            "activeLoopIntervalMs": ACTIVE_LOOP_INTERVAL_MS,
            "dailyLossCheckIntervalMs": DAILY_LOSS_CHECK_INTERVAL_MS,
            "runtimeStateChanged": not read_only,
        })
        return checks

    def run(self, daemon: bool) -> None:
        self.lock.acquire()
        try:
            self.reset_days()
            self.reconcile()
            self.log(
                "v52-margin-aware-runner-start",
                strategyId=STRATEGY_ID,
                healthyMarginPollIntervalMs=HEALTHY_POLL_INTERVAL_MS,
                warningMarginPollIntervalMs=WARNING_POLL_INTERVAL_MS,
                activeLoopIntervalMs=ACTIVE_LOOP_INTERVAL_MS,
                dailyLossCheckIntervalMs=DAILY_LOSS_CHECK_INTERVAL_MS,
            )
            while not self.stop_requested:
                started = base.now_ms()
                try:
                    self.tick()
                except Exception as error:
                    if self._handle_tick_error(error):
                        if not daemon: break
                    else:
                        self.log("v52-margin-aware-tick-error", error=str(error))
                        if self.live:
                            self.activate_kill_switch(f"V52 margin-aware fatal tick error: {error}")
                            self.flatten_all("FATAL_TICK_ERROR")
                            raise
                if not daemon:
                    break
                active = base.clock("09:59:50") <= base.ny_seconds() <= base.clock("15:30:30") or bool(self.positions())
                interval = ACTIVE_LOOP_INTERVAL_MS if active else base.int_env("DISDEX_STOCK_IDLE_INTERVAL_MS", 5000)
                time.sleep(max(0.0, interval - (base.now_ms() - started)) / 1000.0)
        finally:
            self.lock.release()


def self_test() -> None:
    engine = object.__new__(MarginAwareV52AsterOnlyEngine)
    engine.crypto_gross_cap = 1.5
    engine.stock_gross_cap = 1.5
    engine.portfolio_gross_cap = 2.5
    engine.v11_gross_cap = 1.5
    engine.v50_gross_cap = 1.25
    engine.reserved_first_stock_gross = 1.25
    engine.minimum_first_stock_gross = 0.5
    engine.minimum_second_stock_gross = 0.25
    engine.maximum_concurrent_stock_positions = 2
    engine.required_initial_leverage = 5
    engine.maximum_initial_margin_fraction = 0.20
    engine.maximum_initial_margin_fraction = 0.70
    engine.minimum_available_balance_fraction = 0.20
    engine.gross_tolerance = 0.03
    engine.live = False
    engine.v96_requires_margin = lambda: False
    engine.portfolio_equity = lambda: 100.0
    engine.positions = lambda: {}
    engine.gross_snapshot = lambda: {
        "equityUsd": 100.0,
        "cryptoNotionalUsd": 115.0,
        "stockNotionalUsd": 0.0,
        "cryptoGross": 1.15,
        "stockGross": 0.0,
        "totalGross": 1.15,
    }
    first, _ = engine.available_slot_gross(V11_SLOT)
    assert abs(first - 1.35) < EPSILON

    engine.positions = lambda: {V11_SLOT: {"symbol": "META"}}
    engine.gross_snapshot = lambda: {
        "equityUsd": 100.0,
        "cryptoNotionalUsd": 115.0,
        "stockNotionalUsd": 100.0,
        "cryptoGross": 1.15,
        "stockGross": 1.0,
        "totalGross": 2.15,
    }
    second, _ = engine.available_slot_gross(V50_SLOT)
    assert abs(second - 0.35) < EPSILON
    assert HEALTHY_POLL_INTERVAL_MS == 300_000
    assert WARNING_POLL_INTERVAL_MS == 60_000
    assert ACTIVE_LOOP_INTERVAL_MS == 2_000
    assert DAILY_LOSS_CHECK_INTERVAL_MS == 60_000
    print("V52 adaptive margin-aware concurrent Stock runner self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("paper", "live"), default=os.getenv("DISDEX_V52_ASTER_ONLY_RUNNER_MODE", "paper"))
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
