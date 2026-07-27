from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import os
import shutil
import signal
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import disdex_v11eq_aster_only_live_engine as legacy

base = legacy.base

STRATEGY_ID = "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96"
LIVE_ACK = "I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY"
STATE_SCHEMA_VERSION = 3
V11_SLOT = "V11_EQ"
V50_SLOT = "V50_POST_OPEN_BASIS"
V50_WINDOWS = ("11:30", "12:30", "13:30")
V50_MIN_ENTRY_BASIS_BPS = 75.0
V50_MAX_HOLDING_HOURS = 3
V50_MAX_DAILY_TRADES = 3
V50_CONVERGENCE_BPS = 15.0
V50_BASIS_STOP_MULTIPLE = 1.5
V50_MAX_ADVERSE_BASIS_MOVE_BPS = 10.0
V50_MAX_ROUND_TRIP_COST_BPS = 60.0
V50_MIN_NET_EDGE_BPS = 10.0


class V52AsterOnlyEngine(legacy.AsterOnlyStockEngine):
    def __init__(self, mode: str):
        super().__init__(mode)
        self.state_root = Path(os.getenv("DISDEX_V52_ASTER_ONLY_STATE_DIR", str(self.state_root))).resolve()
        self.state_path = self.state_root / f"runner-{mode}.json"
        self.audit_path = self.state_root / f"audit-{mode}.jsonl"
        self.kill_switch_path = Path(os.getenv("DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE", str(self.kill_switch_path))).resolve()
        self.lock = base.FileLock(self.state_root / f"runner-{mode}.lock", base.int_env("DISDEX_STOCK_LOCK_STALE_MS", 15 * 60_000))
        self.state = base.read_json(self.state_path, {}) or {}
        self.crypto_gross_cap = base.float_env("DISDEX_V52_CRYPTO_GROSS_CAP", 1.0)
        self.stock_gross_cap = base.float_env("DISDEX_V52_STOCK_GROSS_CAP", 1.5)
        self.portfolio_gross_cap = base.float_env("DISDEX_V52_PORTFOLIO_GROSS_CAP", 2.5)
        self.v11_gross_cap = base.float_env("DISDEX_V52_V11_GROSS_CAP", 1.0)
        self.v50_gross_cap = base.float_env("DISDEX_V52_V50_GROSS_CAP", 1.0)
        self.gross_tolerance = base.float_env("DISDEX_V52_GROSS_TOLERANCE", 0.03)
        self.minimum_entry_usd = base.float_env("DISDEX_V52_MIN_ENTRY_USD", 5.0)
        self._migrate_state()

    def _migrate_state(self) -> None:
        positions = self.state.get("positions")
        if positions is not None and not isinstance(positions, dict):
            raise RuntimeError("V52 positions state must be an object")
        positions = dict(positions or {})
        old = self.state.pop("position", None)
        if old:
            if positions:
                raise RuntimeError("Legacy position and V52 positions both exist")
            if str(old.get("strategy")) != V11_SLOT:
                raise RuntimeError("Only a legacy V11_EQ position can migrate into V52")
            if self.live:
                enabled = base.bool_env("DISDEX_V52_ALLOW_V11_STATE_MIGRATION", False)
                ack = os.getenv("DISDEX_V52_STATE_MIGRATION_ACKNOWLEDGEMENT")
                if not enabled or ack != "I_ACKNOWLEDGE_V11_TO_V52_STATE_MIGRATION":
                    raise RuntimeError("Active legacy V11 state requires explicit V52 migration acknowledgement")
                if self.state_path.exists():
                    stamp = dt.datetime.now(tz=base.UTC).strftime("%Y%m%dT%H%M%SZ")
                    shutil.copy2(self.state_path, self.state_path.with_name(f"{self.state_path.name}.v11-backup-{stamp}"))
            positions[V11_SLOT] = old
            self.state["legacyV11MigratedAt"] = base.now_ms()
        self.state["positions"] = positions
        self.state["schemaVersion"] = STATE_SCHEMA_VERSION
        self.state["strategyId"] = STRATEGY_ID
        self.state.setdefault("v50SignalBasis", {})
        self.state.setdefault("v50Attempted", {})
        self.state.setdefault("v50CompletedTrades", 0)

    def save(self) -> None:
        self.state.pop("position", None)
        self.state["schemaVersion"] = STATE_SCHEMA_VERSION
        self.state["strategyId"] = STRATEGY_ID
        self.state["updatedAt"] = base.now_ms()
        base.atomic_write_json(self.state_path, self.state)

    def positions(self) -> Dict[str, dict]:
        value = self.state.setdefault("positions", {})
        if not isinstance(value, dict):
            raise RuntimeError("V52 positions state invalid")
        return value

    def reset_days(self) -> None:
        utc_day = dt.datetime.now(tz=base.UTC).date().isoformat()
        ny_day = dt.datetime.now(tz=base.NY).date().isoformat()
        if self.state.get("utcDay") != utc_day:
            equity = self.portfolio_equity()
            self.state.update({"utcDay": utc_day, "dayStartEquity": equity, "dailyLossTripped": False})
        if self.state.get("nyDay") != ny_day:
            self.state.update({"nyDay": ny_day, "v11Attempted": False, "v11SignalBasis": {}, "v11SignalSelectedSymbol": None, "v11SignalAt": None, "v50SignalBasis": {}, "v50Attempted": {}, "v50CompletedTrades": 0})
        self.save()

    def managed_aster_positions(self) -> Dict[str, float]:
        if self.live:
            result: Dict[str, float] = {}
            for row in self.aster.positions():
                symbol = str(row.get("symbol") or "")
                quantity = base.finite(row.get("positionAmt"))
                if symbol in base.ASTER_SYMBOL.values() and abs(quantity) > 1e-12:
                    result[symbol] = quantity
            return result
        result: Dict[str, float] = {}
        for position in self.positions().values():
            side = 1 if position.get("asterOpenSide") == "BUY" else -1
            symbol = base.ASTER_SYMBOL[str(position["symbol"])]
            result[symbol] = result.get(symbol, 0.0) + side * base.finite(position.get("asterQty"))
        return result

    def _actual_stock_notional(self) -> float:
        if not self.live:
            return sum(abs(base.finite(p.get("asterQty")) * base.finite(p.get("asterEntryPrice"))) for p in self.positions().values())
        total = 0.0
        for row in self.aster.positions():
            symbol = str(row.get("symbol") or "")
            if symbol in base.ASTER_SYMBOL.values():
                total += abs(base.finite(row.get("positionAmt"))) * base.finite(row.get("markPrice") or row.get("entryPrice"))
        return total

    def gross_snapshot(self) -> dict:
        equity = self.portfolio_equity()
        if equity <= 0:
            raise RuntimeError("Aster equity must be positive")
        crypto_notional = self.current_v96_notional()
        stock_notional = self._actual_stock_notional()
        account = self.aster.account_summary()
        return {"equityUsd": equity, "availableBalanceUsd": account["availableBalanceUsd"], "crossWalletBalanceUsd": account["crossWalletBalanceUsd"], "unrealizedPnlUsd": account["unrealizedPnlUsd"], "cryptoNotionalUsd": crypto_notional, "stockNotionalUsd": stock_notional, "cryptoGross": crypto_notional / equity, "stockGross": stock_notional / equity, "totalGross": (crypto_notional + stock_notional) / equity}

    def execution_capacity_gross(self, snapshot: dict, slot: str) -> float:
        equity = base.finite(snapshot.get("equityUsd"))
        available = base.finite(snapshot.get("availableBalanceUsd"), equity)
        reserve = max(self.minimum_entry_usd, equity * base.float_env("DISDEX_V52_CASH_RESERVE_PCT", 10.0) / 100.0)
        required_margin = base.finite(snapshot.get("cryptoNotionalUsd")) / max(1.0, base.float_env("DISDEX_V52_LEVERAGE", 1.0))
        fee_slippage_buffer = max(0.0, equity * base.float_env("DISDEX_V52_ENTRY_COST_BUFFER_PCT", 0.25) / 100.0)
        cost_headroom = max(0.0, available - reserve - required_margin - fee_slippage_buffer)
        capacity = max(0.0, min(1.0, cost_headroom / equity if equity > 0 else 0.0))
        snapshot.update({"signalGross": 1.0, "executionGross": capacity, "equityUsd": equity, "availableBalanceUsd": available, "reserveUsd": reserve, "requiredMarginUsd": required_margin, "costHeadroomUsd": cost_headroom, "currentCryptoGross": snapshot.get("cryptoGross", 0.0), "currentStockGross": snapshot.get("stockGross", 0.0), "projectedTotalGross": snapshot.get("totalGross", 0.0) + capacity, "scaleReason": "BALANCE_RESERVE_MARGIN_COST" if capacity < 1.0 else "NONE"})
        return capacity

    def available_slot_gross(self, slot: str) -> Tuple[float, dict]:
        snapshot = self.gross_snapshot()
        if slot in self.positions() or self.v96_requires_margin():
            return 0.0, snapshot
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        available = min(slot_cap, max(0.0, self.stock_gross_cap - snapshot["stockGross"]), max(0.0, self.portfolio_gross_cap - snapshot["totalGross"]))
        return max(0.0, available), snapshot

    def assert_gross_safe(self, snapshot: Optional[dict] = None) -> None:
        row = snapshot or self.gross_snapshot()
        for name, value, cap in (("Crypto", row["cryptoGross"], self.crypto_gross_cap), ("Stock", row["stockGross"], self.stock_gross_cap), ("Portfolio", row["totalGross"], self.portfolio_gross_cap)):
            if value > cap + self.gross_tolerance:
                raise RuntimeError(f"{name} Gross exceeds V52 cap: {value:.6f} > {cap:.6f}")

    def reconcile(self) -> None:
        if self.state.get("pendingOrder"):
            raise RuntimeError("Unresolved V52 pending order requires operator review before restart")
        if not self.live:
            return
        actual = self.managed_aster_positions()
        expected: Dict[str, float] = {}
        for position in self.positions().values():
            symbol = base.ASTER_SYMBOL[str(position["symbol"])]
            signed = base.finite(position.get("asterQty")) * (1 if position.get("asterOpenSide") == "BUY" else -1)
            expected[symbol] = expected.get(symbol, 0.0) + signed
        if set(actual) != set(expected):
            self.activate_kill_switch("V52 managed Stock symbol reconciliation mismatch")
            raise RuntimeError("V52 managed Stock symbols do not match state")
        for symbol, expected_qty in expected.items():
            actual_qty = base.finite(actual.get(symbol))
            if abs(expected_qty - actual_qty) > max(1e-8, abs(expected_qty) * 0.02):
                self.activate_kill_switch("V52 managed Stock quantity reconciliation mismatch")
                raise RuntimeError("V52 managed Stock quantity mismatch")
        for symbol in base.ASTER_SYMBOL.values():
            for order in self.aster.open_orders(symbol):
                client = str(order.get("clientOrderId") or "")
                if client.startswith(("stock-v11eq-aster-only-", "stock-v52-")):
                    raise RuntimeError(f"V52 pre-existing open order requires review: {client}")
        self.assert_gross_safe()

    def client_id(self, strategy: str, symbol: str, action: str) -> str:
        digest = base.hashlib.sha256(f"{strategy}|{symbol}|{action}|{base.now_ms()}".encode()).hexdigest()[:10]
        return f"stock-v52-{strategy.lower()}-{symbol.lower()}-{action.lower()}-{digest}"[:36]

    def _set_pending(self, payload: dict) -> None:
        if self.state.get("pendingOrder"):
            raise RuntimeError("Another V52 order is unresolved")
        self.state["pendingOrder"] = payload
        self.save()

    def _clear_pending(self) -> None:
        self.state["pendingOrder"] = None
        self.save()

    def v11_candidates(self, rows):
        if self.v11_notional < self.minimum_entry_usd:
            return None, {"ROUTER": ["V11_GROSS_CAPACITY_INSUFFICIENT"]}
        return base.StockEngine.v11_candidates(self, rows)

    def open_basis_position(self, slot: str, candidate: dict, target_gross: float) -> bool:
        self.recheck_entry_conditions(candidate)
        if slot in self.positions() or any(p.get("symbol") == candidate["symbol"] for p in self.positions().values()):
            return False
        snapshot = self.gross_snapshot()
        self.assert_gross_safe(snapshot)
        target_gross = min(target_gross, self.execution_capacity_gross(snapshot, slot))
        target_notional = target_gross * snapshot["equityUsd"]
        if target_notional < self.minimum_entry_usd:
            return False
        symbol = str(candidate["symbol"])
        aster_symbol = base.ASTER_SYMBOL[symbol]
        side = str(candidate["side"])
        quantity = target_notional / base.finite(candidate["entryPrice"])
        quantity, price = self.aster.normalize(aster_symbol, quantity, base.finite(candidate["entryPrice"]), side)
        client = self.client_id(slot, symbol, "OPEN")
        self._set_pending({"slot": slot, "action": "OPEN", "symbol": symbol, "side": side, "quantity": quantity, "clientId": client, "candidate": candidate, "targetGross": target_gross, "price": price})
        initial = self.aster.place_limit(symbol=aster_symbol, side=side, quantity=quantity, price=price, client_id=client, post_only=True)
        fill = initial if not self.live else self.aster.poll_fill(aster_symbol, client, quantity, side, base.V11_ENTRY_TTL_MS, recheck=lambda: (self.recheck_entry_conditions(candidate) or True))
        self.log("v52-entry-result", slot=slot, candidate=candidate, targetGross=target_gross, fill=dataclasses.asdict(fill))
        if fill.fill_ratio >= base.V11_MIN_FILL_RATIO:
            try:
                self.recheck_entry_conditions(candidate)
            except Exception as error:
                self.log("v52-post-fill-recheck-failed", slot=slot, candidate=candidate, error=str(error))
                self.flatten_aster_leg(symbol, side, fill.executed_qty, "ENTRY_POST_FILL_RECHECK")
                return False
        if fill.fill_ratio < base.V11_MIN_FILL_RATIO:
            if fill.executed_qty > 0:
                self.flatten_aster_leg(symbol, side, fill.executed_qty, f"{slot}_LOW_FILL")
            self._clear_pending()
            return False
        local = dt.datetime.now(tz=base.NY)
        next_checkpoint = local.replace(minute=30, second=0, microsecond=0) + dt.timedelta(hours=1)
        maximum_exit = min(local + dt.timedelta(hours=V50_MAX_HOLDING_HOURS), local.replace(hour=15, minute=30, second=0, microsecond=0))
        position = {"strategy": slot, "symbol": symbol, "openedAt": base.now_ms(), "entryBasisBps": candidate["basisBps"], "signalBasisBps": candidate.get("signalBasisBps"), "asterOpenSide": side, "asterQty": fill.executed_qty, "asterEntryPrice": fill.average_price or price, "targetGross": target_gross, "route": candidate.get("route")}
        if slot == V50_SLOT:
            position.update({"checksCompleted": 0, "nextCheckpointAt": int(next_checkpoint.timestamp() * 1000), "maximumExitAt": int(maximum_exit.timestamp() * 1000)})
        self.positions()[slot] = position
        self._clear_pending()
        self.save()
        self.log("v52-position-open", slot=slot, position=position)
        return True

    def close_slot(self, slot: str, reason: str) -> None:
        position = self.positions().get(slot)
        if not position:
            return
        symbol = str(position["symbol"])
        open_side = str(position["asterOpenSide"])
        close_side = "SELL" if open_side == "BUY" else "BUY"
        quantity = base.finite(position["asterQty"])
        book = self.aster.book(base.ASTER_SYMBOL[symbol], 20)
        price = base.passive_exit_price(book, close_side)
        client = self.client_id(slot, symbol, "CLOSE")
        self._set_pending({"slot": slot, "action": "CLOSE", "symbol": symbol, "side": close_side, "quantity": quantity, "clientId": client})
        urgent = reason in {"BASIS_STOP", "MISSED_CHECKPOINT_FAIL_CLOSED", "FINAL_1530", "V96_MARGIN_PRIORITY", "DAILY_LOSS", "KILL_SWITCH", "FATAL_TICK_ERROR"} or reason.startswith("STATE_INCONSISTENCY")
        try:
            initial = self.aster.place_market(symbol=base.ASTER_SYMBOL[symbol], side=close_side, quantity=quantity, expected_price=book.ask if close_side == "BUY" else book.bid, client_id=client, reduce_only=True) if urgent else self.aster.place_limit(symbol=base.ASTER_SYMBOL[symbol], side=close_side, quantity=quantity, price=price, client_id=client, reduce_only=True, post_only=True)
        except RuntimeError as error:
            if urgent or "GTX" not in str(error).upper():
                raise
            self.log("post-only-exit-rejected-fallback", symbol=symbol, reason=reason, error=str(error))
            initial = base.Fill("ASTER", base.ASTER_SYMBOL[symbol], close_side, quantity, 0.0, 0.0, "REJECTED", client, error=str(error))
        fill = initial if not self.live else self.aster.poll_fill(base.ASTER_SYMBOL[symbol], client, quantity, close_side, 2000)
        remaining = max(0.0, quantity - fill.executed_qty)
        if remaining > quantity * 0.01:
            market = self.flatten_aster_leg(symbol, open_side, remaining, reason + "-TAKER")
            if market.fill_ratio < 0.99:
                self.activate_kill_switch(f"{slot} close did not fully complete")
                raise RuntimeError(f"{slot} close incomplete")
        self.positions().pop(slot, None)
        if slot == V50_SLOT:
            self.state["v50CompletedTrades"] = int(self.state.get("v50CompletedTrades", 0)) + 1
        self._clear_pending()
        self.save()
        self.log("v52-position-closed", slot=slot, symbol=symbol, reason=reason)

    def flatten_all(self, reason: str) -> None:
        for symbol in base.ASTER_SYMBOL.values():
            self.aster.cancel_all(symbol)
        if self.state.get("pendingOrder"):
            self.state["pendingOrder"] = None
            self.save()
        for slot in list(self.positions()):
            self.close_slot(slot, reason)
        if self.live and self.managed_aster_positions():
            raise RuntimeError("V52 flatten left unmanaged Aster Stock positions")

    def capture_v50_signal(self, window: str, rows: dict) -> None:
        signals = self.state.setdefault("v50SignalBasis", {})
        if signals.get(window):
            return
        signals[window] = {symbol: (aster.mid / reference.price - 1.0) * 10_000.0 for symbol, (aster, _xyz, reference) in rows.items()}
        self.save()
        self.log("v50-signal-recorded", window=window, basis=signals[window])

    def v50_candidate(self, window: str, rows: dict, notional: float) -> Tuple[Optional[dict], Dict[str, List[str]]]:
        signal = (self.state.get("v50SignalBasis") or {}).get(window) or {}
        eligible: List[dict] = []
        rejections: Dict[str, List[str]] = {}
        now = base.now_ms()
        active_symbols = {str(p.get("symbol")) for p in self.positions().values()}
        for symbol, (aster, _xyz, reference) in rows.items():
            basis = (aster.mid / reference.price - 1.0) * 10_000.0
            signal_basis = base.finite(signal.get(symbol), 0.0)
            side = "SELL" if basis > 0 else "BUY"
            exit_action = "BUY" if side == "SELL" else "SELL"
            cost, detail = self.estimate_v11_cost(aster, exit_action, notional)
            adverse = max(0.0, abs(basis) - abs(signal_basis))
            reasons: List[str] = []
            if symbol in active_symbols: reasons.append("SAME_SYMBOL_ACTIVE")
            if abs(basis) < V50_MIN_ENTRY_BASIS_BPS: reasons.append("BASIS_BELOW_75")
            if signal_basis * basis <= 0: reasons.append("SIGN_CHANGED")
            if adverse > V50_MAX_ADVERSE_BASIS_MOVE_BPS: reasons.append("ADVERSE_BASIS_MOVE")
            if now - aster.received_ms > base.V11_MAX_DATA_AGE_MS or now - reference.timestamp_ms > base.V11_MAX_DATA_AGE_MS: reasons.append("STALE_DATA")
            if abs(aster.event_ms - reference.timestamp_ms) > base.V11_MAX_SOURCE_CLOCK_DIFF_MS: reasons.append("SOURCE_CLOCK_MISMATCH")
            if cost > V50_MAX_ROUND_TRIP_COST_BPS: reasons.append("ROUND_TRIP_COST_OVER_60")
            if abs(basis) - V50_CONVERGENCE_BPS - cost < V50_MIN_NET_EDGE_BPS: reasons.append("NET_EDGE_BELOW_10")
            if aster.depth_usd(exit_action) < 2.0 * notional: reasons.append("DEPTH_BELOW_2X")
            if aster.spread_bps > base.V11_MAX_SPREAD_BPS: reasons.append("SPREAD_OVER_20")
            rejections[symbol] = reasons
            if not reasons:
                eligible.append({"symbol": symbol, "basisBps": basis, "signalBasisBps": signal_basis, "side": side, "entryPrice": aster.bid if side == "BUY" else aster.ask, "estimatedRoundTripCostBps": cost, "adverseBasisMoveBps": adverse, "costDetail": detail, "route": f"POST_{window.replace(':', '')}"})
        if not eligible:
            return None, rejections
        return sorted(eligible, key=lambda row: (-abs(row["basisBps"]), row["symbol"]))[0], rejections

    def manage_positions(self, rows: dict) -> None:
        v11 = self.positions().get(V11_SLOT)
        if v11:
            symbol = str(v11["symbol"])
            aster, _xyz, reference = rows[symbol]
            basis = (aster.mid / reference.price - 1.0) * 10_000.0
            entry = base.finite(v11["entryBasisBps"])
            if abs(basis) <= base.V11_CONVERGENCE_BPS or basis * entry <= 0: self.close_slot(V11_SLOT, "BASIS_CONVERGED")
            elif abs(basis) >= base.V11_BASIS_STOP_MULTIPLE * abs(entry): self.close_slot(V11_SLOT, "BASIS_STOP")
            elif base.ny_seconds() >= base.clock("15:30:00"): self.close_slot(V11_SLOT, "FINAL_1530")
        v50 = self.positions().get(V50_SLOT)
        if not v50:
            return
        now = base.now_ms()
        next_checkpoint = int(v50.get("nextCheckpointAt") or 0)
        if now < next_checkpoint:
            return
        if now > next_checkpoint + 5 * 60_000:
            self.close_slot(V50_SLOT, "MISSED_CHECKPOINT_FAIL_CLOSED")
            return
        symbol = str(v50["symbol"])
        aster, _xyz, reference = rows[symbol]
        basis = (aster.mid / reference.price - 1.0) * 10_000.0
        entry = base.finite(v50["entryBasisBps"])
        if abs(basis) <= V50_CONVERGENCE_BPS or basis * entry <= 0:
            self.close_slot(V50_SLOT, "BASIS_CONVERGED"); return
        if abs(basis) >= V50_BASIS_STOP_MULTIPLE * abs(entry):
            self.close_slot(V50_SLOT, "BASIS_STOP"); return
        checks = int(v50.get("checksCompleted", 0)) + 1
        if checks >= V50_MAX_HOLDING_HOURS or now >= int(v50.get("maximumExitAt") or 0) or base.ny_seconds() >= base.clock("15:30:00"):
            self.close_slot(V50_SLOT, "TIME_3H"); return
        v50["checksCompleted"] = checks
        v50["nextCheckpointAt"] = next_checkpoint + 60 * 60_000
        self.save()
        self.log("v50-checkpoint-hold", symbol=symbol, basisBps=basis, checksCompleted=checks)

    def tick(self) -> None:
        self.reset_days()
        kill = self.kill_switch()
        if kill:
            self.flatten_all(str(kill.get("reason") or "KILL_SWITCH")); return
        self.enforce_daily_loss()
        if self.kill_switch():
            self.flatten_all("DAILY_LOSS"); return
        self.update_history()
        local = dt.datetime.now(tz=base.NY)
        if local.weekday() >= 5:
            return
        sec = base.ny_seconds(local)
        if not self.positions() and not (base.clock("09:59:50") <= sec <= base.clock("15:30:30")):
            return
        rows = self.books_and_refs()
        if self.v96_requires_margin():
            if self.positions(): self.flatten_all("V96_MARGIN_PRIORITY")
            return
        if not self.state.get("v11SignalBasis") and base.clock("09:59:55") <= sec <= base.clock("10:00:20"):
            self.record_v11_signal(rows)
        for window in V50_WINDOWS:
            entry = base.clock(window + ":00")
            if entry - 10 <= sec < entry: self.capture_v50_signal(window, rows)
        self.manage_positions(rows)
        if not self.state.get("v11Attempted") and base.clock("10:30:00") <= sec <= base.clock("10:30:20"):
            self.state["v11Attempted"] = True; self.save()
            gross, snapshot = self.available_slot_gross(V11_SLOT)
            self.v11_notional = gross * snapshot["equityUsd"]
            candidate, rejections = (None, {"ROUTER": ["NO_GROSS_CAPACITY"]}) if gross <= 0 else self.v11_candidates(rows)
            self.log("v52-v11-decision", candidate=candidate, rejections=rejections, allocatedGross=gross, grossSnapshot=snapshot)
            if candidate: self.open_basis_position(V11_SLOT, candidate, gross)
        attempted = self.state.setdefault("v50Attempted", {})
        for window in V50_WINDOWS:
            entry = base.clock(window + ":00")
            if attempted.get(window) or not (entry <= sec <= entry + 20): continue
            attempted[window] = True; self.save()
            if int(self.state.get("v50CompletedTrades", 0)) >= V50_MAX_DAILY_TRADES or V50_SLOT in self.positions(): continue
            gross, snapshot = self.available_slot_gross(V50_SLOT)
            notional = gross * snapshot["equityUsd"]
            candidate, rejections = (None, {"ROUTER": ["NO_GROSS_CAPACITY"]}) if gross <= 0 else self.v50_candidate(window, rows, notional)
            self.log("v52-v50-decision", window=window, candidate=candidate, rejections=rejections, allocatedGross=gross, grossSnapshot=snapshot)
            if candidate: self.open_basis_position(V50_SLOT, candidate, gross)

    def preflight(self) -> dict:
        if self.live:
            if not base.bool_env("DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED", False): raise RuntimeError("V52 LIVE requires DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=true")
            if os.getenv("DISDEX_V52_ASTER_ONLY_LIVE_ACKNOWLEDGEMENT") != LIVE_ACK: raise RuntimeError(f"V52 LIVE requires acknowledgement {LIVE_ACK}")
        self.state_root.mkdir(parents=True, exist_ok=True); self.save()
        if self.kill_switch(): raise RuntimeError("Shared Kill Switch is active")
        if self.state.get("pendingOrder"): raise RuntimeError("V52 pending order must be resolved before no-order preflight")
        self.aster.ping(); self.aster.exchange_info()
        missing = [symbol for symbol in base.ASTER_SYMBOL.values() if symbol not in self.aster._rules]
        if missing: raise RuntimeError(f"Aster Stock symbols missing: {missing}")
        from disdex_v13d_v11eq_stock_free_live_engine import reference_health, regular_us_equity_session
        health = reference_health(self.reference)
        if regular_us_equity_session():
            for symbol in base.SYMBOLS:
                quote = self.reference.quote(symbol)
                if base.now_ms() - quote.timestamp_ms > base.V11_MAX_DATA_AGE_MS: raise RuntimeError(f"Reference quote stale for {symbol}")
        self.reconcile()
        snapshot = self.gross_snapshot(); self.assert_gross_safe(snapshot)
        return {"strategyId": STRATEGY_ID, "mode": self.mode, "schemaVersion": STATE_SCHEMA_VERSION, "asterPing": True, "asterSymbols": list(base.ASTER_SYMBOL.values()), "referenceHealth": health.get("status"), "positions": self.positions(), "gross": snapshot, "caps": {"crypto": self.crypto_gross_cap, "stock": self.stock_gross_cap, "portfolio": self.portfolio_gross_cap, "v11": self.v11_gross_cap, "v50": self.v50_gross_cap}, "ordersSent": False}

    def run(self, daemon: bool) -> None:
        self.lock.acquire()
        try:
            self.reset_days(); self.reconcile()
            self.log("v52-runner-start", strategyId=STRATEGY_ID, caps={"crypto": self.crypto_gross_cap, "stock": self.stock_gross_cap, "portfolio": self.portfolio_gross_cap, "v11": self.v11_gross_cap, "v50": self.v50_gross_cap})
            while not self.stop_requested:
                started = base.now_ms()
                try: self.tick()
                except Exception as error:
                    self.log("v52-tick-error", error=str(error))
                    if self.live:
                        self.activate_kill_switch(f"V52 fatal tick error: {error}"); self.flatten_all("FATAL_TICK_ERROR"); raise
                if not daemon: break
                active = base.clock("09:59:50") <= base.ny_seconds() <= base.clock("15:30:30") or bool(self.positions())
                interval = 250 if active else base.int_env("DISDEX_STOCK_IDLE_INTERVAL_MS", 5000)
                time.sleep(max(0, interval - (base.now_ms() - started)) / 1000.0)
        finally: self.lock.release()


def self_test() -> None:
    assert LIVE_ACK == "I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY"
    assert V50_WINDOWS == ("11:30", "12:30", "13:30")
    assert V50_MIN_ENTRY_BASIS_BPS == 75.0
    engine = object.__new__(V52AsterOnlyEngine)
    engine.crypto_gross_cap = 1.0; engine.stock_gross_cap = 1.5; engine.portfolio_gross_cap = 2.5
    engine.v11_gross_cap = 1.0; engine.v50_gross_cap = 1.0; engine.gross_tolerance = 0.03
    engine.minimum_entry_usd = 5.0
    engine.state = {"positions": {V11_SLOT: {}}}; engine.v96_requires_margin = lambda: False
    engine.gross_snapshot = lambda: {"equityUsd": 100.0, "availableBalanceUsd": 100.0, "cryptoNotionalUsd": 0.0, "cryptoGross": 1.0, "stockGross": 1.0, "totalGross": 2.0}
    gross, _ = engine.available_slot_gross(V50_SLOT)
    assert gross == 0.5
    assert base.passive_exit_price(base.Book("ASTER", "AMZNUSDT", 99.9, 10, 100.1, 10, [], [], 1, 1), "SELL") == 100.1
    assert base.passive_exit_price(base.Book("ASTER", "AMZNUSDT", 99.9, 10, 100.1, 10, [], [], 1, 1), "BUY") == 99.9
    assert engine.execution_capacity_gross({"equityUsd": 100.0, "availableBalanceUsd": 58.7, "cryptoNotionalUsd": 0.0}, V50_SLOT) < 1.0
    print("V52 V11-EQ + V50 Aster-only live engine self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("paper", "live"), default=os.getenv("DISDEX_V52_ASTER_ONLY_RUNNER_MODE", "paper"))
    parser.add_argument("--daemon", action="store_true"); parser.add_argument("--once", action="store_true")
    parser.add_argument("--preflight", action="store_true"); parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test: self_test(); return 0
    runner = V52AsterOnlyEngine(args.mode)
    signal.signal(signal.SIGINT, lambda *_: setattr(runner, "stop_requested", True)); signal.signal(signal.SIGTERM, lambda *_: setattr(runner, "stop_requested", True))
    if args.preflight: print(json.dumps(runner.preflight(), indent=2, ensure_ascii=False)); return 0
    runner.run(args.daemon); return 0


if __name__ == "__main__":
    raise SystemExit(main())
