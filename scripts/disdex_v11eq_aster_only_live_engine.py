from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import signal
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import disdex_v13d_v11eq_stock_live_engine as base


STRATEGY_ID = "DISDEX_V11EQ_ASTER_ONLY_EXCESS_MARGIN"
# REFERENCE_FRESHNESS_DEFERRED_MARKET_CLOSED: quote freshness is required during regular US session only.
LIVE_ACK = "I_ACCEPT_REAL_MONEY_V96_V11EQ_ASTER_ONLY"
# Generic crypto accounting for the integrated V12 + PENGU portfolio.  The
# legacy name is retained for state compatibility, but it must not omit V12
# symbols when V52 checks available gross capacity.
V96_SYMBOLS = {
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT",
    "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT",
    "AAVEUSDT", "NEARUSDT", "PENGUUSDT",
}


class AsterOnlyStockEngine(base.StockEngine):
    def __init__(self, mode: str):
        self.mode = mode
        self.live = mode == "live"
        self.state_root = Path(os.getenv("DISDEX_V11EQ_ASTER_ONLY_STATE_DIR", ".runtime-state/disdex-v11eq-aster-only")).resolve()
        self.state_path = self.state_root / f"runner-{mode}.json"
        self.audit_path = self.state_root / f"audit-{mode}.jsonl"
        self.kill_switch_path = Path(os.getenv("DISDEX_V11EQ_ASTER_ONLY_KILL_SWITCH_FILE", str(self.state_root / "kill-switch.json"))).resolve()
        self.lock = base.FileLock(self.state_root / f"runner-{mode}.lock", base.int_env("DISDEX_STOCK_LOCK_STALE_MS", 15 * 60_000))
        self.aster = base.AsterClient(self.live)
        self.reference = base.ReferenceProvider(self.live)
        self.max_daily_loss_pct = base.float_env("DISDEX_V11EQ_ASTER_ONLY_MAX_DAILY_LOSS_PCT", 2.0)
        self.safety_reserve_pct = base.float_env("DISDEX_V96_SAFETY_RESERVE_PCT", 10.0)
        self.minimum_reserve_usd = base.float_env("DISDEX_V96_MINIMUM_RESERVE_USD", 5.0)
        self.v11_min_entry_usd = base.float_env("DISDEX_V11EQ_MIN_ENTRY_USD", 5.0)
        self.aster_maker_fee_bps = base.float_env("ASTER_STOCK_MAKER_FEE_BPS", 0.0)
        self.aster_taker_fee_bps = base.float_env("ASTER_STOCK_TAKER_FEE_BPS", 6.0)
        self.v11_safety_buffer_bps = base.float_env("DISDEX_V11EQ_COST_SAFETY_BUFFER_BPS", 5.0)
        self.aster_market_slippage_bps = base.float_env("DISDEX_STOCK_ASTER_MAX_SLIPPAGE_BPS", 25.0)
        self.state = base.read_json(self.state_path, {}) or {}
        self.spreads = {symbol: base.deque() for symbol in base.SYMBOLS}
        self.mids = {symbol: base.deque() for symbol in base.SYMBOLS}
        self.stop_requested = False
        self.v11_notional = 0.0

    def client_id(self, strategy: str, symbol: str, action: str) -> str:
        digest = base.hashlib.sha256(f"{strategy}|{symbol}|{action}|{base.now_ms()}".encode()).hexdigest()[:12]
        return f"stock-v11eq-aster-only-{strategy.lower()}-{symbol.lower()}-{action.lower()}-{digest}"[:36]

    def portfolio_equity(self) -> float:
        return self.aster.equity()

    def managed_xyz_positions(self) -> Dict[str, float]:
        return {}

    def v96_state_path(self) -> Path:
        state_dir = Path(os.getenv("DISDEX_V96_STATE_DIR", ".runtime-state/disdex-v96"))
        return state_dir / "runner-live.json"

    def v96_requires_margin(self) -> bool:
        state = base.read_json(self.v96_state_path(), {}) or {}
        if state.get("pending") or state.get("manualReviewReason") or state.get("bootstrapRequired"):
            return True
        daily = state.get("dailyRisk") or {}
        return bool(daily.get("killSwitchActive") or daily.get("tripped") or state.get("portfolioDailyLossLatch", {}).get("tripped"))

    def current_v96_notional(self) -> float:
        total = 0.0
        for row in self.aster.positions():
            symbol = str(row.get("symbol") or "").upper()
            qty = abs(base.finite(row.get("positionAmt")))
            price = base.finite(row.get("markPrice") or row.get("entryPrice"))
            if qty <= 1e-12:
                continue
            if symbol in V96_SYMBOLS:
                total += qty * price
            elif symbol in base.ASTER_SYMBOL.values():
                # Known stock sleeves are accounted by V52 stock gross.
                continue
            else:
                raise RuntimeError(f"Unknown non-flat Aster symbol requires manual review: {symbol}")
        return total

    def excess_margin_usd(self) -> float:
        if self.v96_requires_margin():
            return 0.0
        equity = self.portfolio_equity()
        used_by_v96 = self.current_v96_notional()
        reserve = max(self.minimum_reserve_usd, equity * self.safety_reserve_pct / 100.0)
        return max(0.0, equity - used_by_v96 - reserve)

    def reconcile(self) -> None:
        if not self.live:
            return
        position = self.state.get("position")
        actual = self.managed_aster_positions()
        if not position and actual:
            self.activate_kill_switch("Aster-only managed V11-EQ position exists without runner state")
            raise RuntimeError("Aster-only managed position exists without runner state")
        if position:
            expected = base.ASTER_SYMBOL[position["symbol"]]
            expected_qty = base.finite(position.get("asterQty")) * (1 if position.get("asterOpenSide") == "BUY" else -1)
            actual_qty = base.finite(actual.get(expected))
            if abs(expected_qty - actual_qty) > max(1e-8, abs(expected_qty) * 0.02):
                self.activate_kill_switch("Aster-only managed position reconciliation mismatch")
                raise RuntimeError("Aster-only managed position reconciliation mismatch")
        for symbol in base.ASTER_SYMBOL.values():
            for order in self.aster.open_orders(symbol):
                client = str(order.get("clientOrderId") or "")
                if client.startswith("stock-v11eq-aster-only-"):
                    self.aster.cancel(symbol, client)

    def books_and_refs(self):
        result = {}
        with ThreadPoolExecutor(max_workers=10) as pool:
            jobs = {}
            for symbol in base.SYMBOLS:
                jobs[(symbol, "aster")] = pool.submit(self.aster.book, base.ASTER_SYMBOL[symbol], 20)
                jobs[(symbol, "ref")] = pool.submit(self.reference.quote, symbol)
            for symbol in base.SYMBOLS:
                aster = jobs[(symbol, "aster")].result()
                # The inherited V11-EQ candidate path ignores the second book.
                result[symbol] = (aster, aster, jobs[(symbol, "ref")].result())
        return result

    def v11_candidates(self, rows):
        self.v11_notional = self.excess_margin_usd()
        if self.v11_notional < self.v11_min_entry_usd:
            return None, {"EXCESS_MARGIN": ["V11EQ_EXCESS_MARGIN_INSUFFICIENT"]}
        return super().v11_candidates(rows)

    def flatten_all(self, reason: str) -> None:
        for symbol in base.ASTER_SYMBOL.values():
            self.aster.cancel_all(symbol)
        position = self.state.get("position")
        if position:
            self.close_v11(reason)
        elif self.live:
            for symbol, qty in self.managed_aster_positions().items():
                if abs(qty) <= 1e-12:
                    continue
                side = "BUY" if qty < 0 else "SELL"
                book = self.aster.book(symbol, 20)
                self.aster.place_market(symbol=symbol, side=side, quantity=abs(qty),
                                        expected_price=book.ask if side == "BUY" else book.bid,
                                        client_id=self.client_id("RECOVERY", symbol, "ASTER_ONLY"), reduce_only=True)

    def tick(self) -> None:
        self.reset_days()
        kill = self.kill_switch()
        if kill:
            self.flatten_all(str(kill.get("reason") or "KILL_SWITCH"))
            return
        self.enforce_daily_loss()
        if self.kill_switch():
            self.flatten_all("DAILY_LOSS")
            return
        self.update_history()
        local = dt.datetime.now(tz=base.NY)
        if local.weekday() >= 5:
            return
        sec = base.ny_seconds(local)
        need_rows = self.state.get("position") is not None or base.clock("09:59:55") <= sec <= base.clock("15:30:30")
        if not need_rows:
            return
        rows = self.books_and_refs()
        if not self.state.get("v11SignalBasis") and base.clock("09:59:55") <= sec <= base.clock("10:00:20"):
            self.record_v11_signal(rows)
        if self.state.get("position"):
            if self.v96_requires_margin():
                self.close_v11("V96_MARGIN_PRIORITY")
                return
            self.manage_position(rows)
            return
        if not self.state.get("v11Attempted") and base.clock("10:30:00") <= sec <= base.clock("10:30:20"):
            self.state["v11Attempted"] = True
            self.save()
            candidate, rejections = self.v11_candidates(rows)
            self.log("v11eq-aster-only-decision", candidate=candidate, rejections=rejections,
                     excessMarginUsd=self.v11_notional, v96RequiresMargin=self.v96_requires_margin())
            if candidate:
                self.open_v11(candidate)

    def preflight(self) -> dict:
        if self.live:
            if not base.bool_env("DISDEX_V11EQ_ASTER_ONLY_LIVE_EXECUTION_ENABLED", False):
                raise RuntimeError("Aster-only LIVE execution requires DISDEX_V11EQ_ASTER_ONLY_LIVE_EXECUTION_ENABLED=true")
            if os.getenv("DISDEX_V11EQ_ASTER_ONLY_LIVE_ACKNOWLEDGEMENT") != LIVE_ACK:
                raise RuntimeError(f"Aster-only LIVE requires acknowledgement {LIVE_ACK}")
        self.state_root.mkdir(parents=True, exist_ok=True)
        probe = self.state_root / ".write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        if self.kill_switch():
            raise RuntimeError("Shared Kill Switch is active")
        self.aster.ping()
        self.aster.exchange_info()
        missing = [symbol for symbol in base.ASTER_SYMBOL.values() if symbol not in self.aster._rules]
        if missing:
            raise RuntimeError(f"Aster symbols missing: {missing}")
        from disdex_v13d_v11eq_stock_free_live_engine import reference_health, regular_us_equity_session
        health = reference_health(self.reference)
        checks = {"asterPing": True, "asterSymbols": list(base.ASTER_SYMBOL.values()),
                  "referenceHealth": health.get("status"), "hyperliquid": "excluded",
                  "v13d": "disabled"}
        if regular_us_equity_session():
            for symbol in base.SYMBOLS:
                quote = self.reference.quote(symbol)
                if base.now_ms() - quote.timestamp_ms > base.V11_MAX_DATA_AGE_MS:
                    raise RuntimeError(f"Reference quote stale for {symbol}")
        checks["referenceQuotesFresh"] = True
        if self.live:
            equity = self.aster.equity()
            if equity <= 0:
                raise RuntimeError("Aster equity must be positive")
            checks["asterEquity"] = equity
            checks["managedAsterPositions"] = self.managed_aster_positions()
            if self.state.get("position") is None and checks["managedAsterPositions"]:
                raise RuntimeError("Aster-only V11-EQ position exists at bootstrap")
            open_orders = sum(len(self.aster.open_orders(symbol)) for symbol in base.ASTER_SYMBOL.values())
            if open_orders:
                raise RuntimeError(f"Aster open orders must be zero at bootstrap: {open_orders}")
        checks["currentV96NotionalUsd"] = self.current_v96_notional() if self.live else 0.0
        checks["excessMarginUsd"] = self.excess_margin_usd() if self.live else 0.0
        checks["safetyReservePct"] = self.safety_reserve_pct
        checks["mode"] = self.mode
        return checks

    def run(self, daemon: bool) -> None:
        self.lock.acquire()
        try:
            self.reset_days()
            self.reconcile()
            self.log("aster-only-stock-runner-start", strategyId=STRATEGY_ID,
                     hyperliquid="excluded", v13d="disabled", excessMarginMode=True)
            while not self.stop_requested:
                started = base.now_ms()
                try:
                    self.tick()
                except Exception as error:
                    self.log("aster-only-tick-error", error=str(error))
                    if self.live:
                        self.activate_kill_switch(f"Aster-only fatal tick error: {error}")
                        self.flatten_all("FATAL_TICK_ERROR")
                        raise
                if not daemon:
                    break
                local_sec = base.ny_seconds()
                active = base.clock("09:59:50") <= local_sec <= base.clock("10:30:30") or self.state.get("position") is not None
                interval = 250 if active else base.int_env("DISDEX_STOCK_IDLE_INTERVAL_MS", 5000)
                time.sleep(max(0, interval - (base.now_ms() - started)) / 1000.0)
        finally:
            self.lock.release()


def self_test() -> None:
    assert LIVE_ACK == "I_ACCEPT_REAL_MONEY_V96_V11EQ_ASTER_ONLY"
    assert STRATEGY_ID == "DISDEX_V11EQ_ASTER_ONLY_EXCESS_MARGIN"
    assert "HYPERLIQUID_API_PRIVATE_KEY" not in os.environ
    assert "V13D" not in STRATEGY_ID
    print("V11-EQ Aster-only excess-margin self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("paper", "live"), default=os.getenv("DISDEX_V11EQ_ASTER_ONLY_RUNNER_MODE", "paper"))
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    runner = AsterOnlyStockEngine(args.mode)
    signal.signal(signal.SIGINT, lambda *_: setattr(runner, "stop_requested", True))
    signal.signal(signal.SIGTERM, lambda *_: setattr(runner, "stop_requested", True))
    if args.preflight:
        print(json.dumps({"status": "READY", "checks": runner.preflight()}, ensure_ascii=False, indent=2))
        return 0
    runner.run(daemon=args.daemon and not args.once)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
