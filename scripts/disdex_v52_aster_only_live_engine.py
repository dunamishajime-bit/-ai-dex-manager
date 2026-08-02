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
from disdex_v52_daily_loss import update_v52_strategy_daily_latch

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
        self.max_daily_loss_pct = base.float_env("DISDEX_V52_MAX_DAILY_LOSS_PCT", 3.5)
        self.state.setdefault("v52Ledger", {"strategyId": STRATEGY_ID, "trades": []})
        self._migrate_state()
        self._decision_items: Dict[Tuple[str, str], dict] = {}
        self._decision_market_open = False
        self._decision_market_label = "LIVE判定未取得"

    def write_decision_snapshot(self, *, market_open: bool, market_label: str) -> None:
        """Publish the latest V52 decision inputs for the read-only UI."""
        checked_at = dt.datetime.now(tz=base.UTC).isoformat().replace("+00:00", "Z")
        items = list(self._decision_items.values())
        if not items:
            items = [
                {
                    "symbol": symbol,
                    "slot": V11_SLOT,
                    "status": "outside_hours" if not market_open else "unavailable",
                    "side": "WAIT",
                    "reasons": [
                        "米国株式市場の対象時間外です。" if not market_open else "V52 LIVE Runnerの判定データがまだありません。"
                    ],
                    "checkedAt": checked_at,
                }
                for symbol in base.SYMBOLS
            ]
        path = Path(os.getenv("DISDEX_V52_DECISION_SNAPSHOT_FILE", str(self.state_root / "decision-status.json"))).resolve()
        payload = {
            "version": 1,
            "checkedAt": checked_at,
            "source": "disdex-v52-live-runner",
            "strategyId": STRATEGY_ID,
            "runnerMode": "live" if self.live else "paper",
            "marketOpen": market_open,
            "marketLabel": market_label,
            "items": items,
        }
        base.atomic_write_json(path, payload)

    def _record_decision_items(self, *, slot: str, candidate: Optional[dict], rejections: Dict[str, List[str]], checked_at: str) -> None:
        candidate_symbol = str(candidate.get("symbol")) if candidate else ""
        for symbol in base.SYMBOLS:
            if symbol == candidate_symbol:
                side = str(candidate.get("side"))
                status = "candidate"
                reasons = ["V52 LIVE Runnerの全条件を通過しました。"]
            else:
                side = "WAIT"
                status = "rejected"
                reasons = list(rejections.get(symbol) or rejections.get("ROUTER") or ["候補条件を満たしていません。"])
            self._decision_items[(symbol, slot)] = {
                "symbol": symbol,
                "slot": slot,
                "status": status,
                "side": side if side in {"BUY", "SELL"} else "WAIT",
                "reasons": reasons,
                "checkedAt": checked_at,
                "dataUpdatedAt": checked_at,
            }
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
        latch = self.state.get("v52StrategyDailyLossLatch")
        if not isinstance(latch, dict) or latch.get("utcDay") != utc_day:
            configured_capital = base.float_env("DISDEX_V52_STRATEGY_CAPITAL_USD", 0.0)
            if configured_capital <= 0:
                try:
                    configured_capital = max(self.minimum_entry_usd, self.excess_margin_usd())
                except Exception:
                    configured_capital = 0.0
            self.state["v52StrategyDailyLossLatch"] = update_v52_strategy_daily_latch(
                previous=latch if isinstance(latch, dict) else None,
                trades=(self.state.get("v52Ledger") or {}).get("trades", []),
                unrealized_pnl=0.0,
                strategy_capital_usd=configured_capital,
                now_ms=base.now_ms(),
                maximum_daily_loss_pct=self.max_daily_loss_pct,
                data_available=configured_capital > 0,
            )
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
        return {"equityUsd": equity, "cryptoNotionalUsd": crypto_notional, "stockNotionalUsd": stock_notional, "cryptoGross": crypto_notional / equity, "stockGross": stock_notional / equity, "totalGross": (crypto_notional + stock_notional) / equity}

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
        if slot in self.positions() or any(p.get("symbol") == candidate["symbol"] for p in self.positions().values()):
            return False
        snapshot = self.gross_snapshot()
        self.assert_gross_safe(snapshot)
        target_notional = target_gross * snapshot["equityUsd"]
        if target_notional < self.minimum_entry_usd:
            return False
        symbol = str(candidate["symbol"])
        aster_symbol = base.ASTER_SYMBOL[symbol]
        side = str(candidate["side"])
        minimum_basis = base.V11_MIN_BASIS_BPS if slot == V11_SLOT else V50_MIN_ENTRY_BASIS_BPS
        maximum_ratio = base.V11_MAX_COST_BASIS_RATIO if slot == V11_SLOT else None
        candidate, reasons = self.recheck_entry_candidate(
            candidate, target_notional, minimum_basis_bps=minimum_basis,
            maximum_cost_bps=V50_MAX_ROUND_TRIP_COST_BPS,
            minimum_net_edge_bps=V50_MIN_NET_EDGE_BPS,
            maximum_cost_ratio=maximum_ratio,
        )
        if candidate is None:
            self.log("v52-entry-recheck-rejected", slot=slot, symbol=symbol, reasons=reasons)
            return False
        quantity = target_notional / base.finite(candidate["entryPrice"])
        quantity, price = self.aster.normalize(aster_symbol, quantity, base.finite(candidate["entryPrice"]), side)
        client = self.client_id(slot, symbol, "OPEN")
        self._set_pending({"slot": slot, "action": "OPEN", "symbol": symbol, "side": side, "quantity": quantity, "clientId": client, "candidate": candidate, "targetGross": target_gross, "price": price})
        try:
            initial = self.aster.place_limit(symbol=aster_symbol, side=side, quantity=quantity, price=price, client_id=client, post_only=True)
        except base.HttpRequestError as error:
            if not base.is_post_only_rejection(error):
                raise
            self.log("v52-entry-post-only-rejected", slot=slot, symbol=symbol, error=str(error))
            self._clear_pending()
            return False
        fill = initial if not self.live else self.aster.poll_fill(aster_symbol, client, quantity, side, base.V11_ENTRY_TTL_MS)
        self.log("v52-entry-result", slot=slot, candidate=candidate, targetGross=target_gross, fill=dataclasses.asdict(fill))
        if fill.fill_ratio < base.V11_MIN_FILL_RATIO:
            if fill.executed_qty > 0:
                self.flatten_aster_leg(symbol, side, fill.executed_qty, f"{slot}_LOW_FILL")
            self._clear_pending()
            return False
        local = dt.datetime.now(tz=base.NY)
        next_checkpoint = local.replace(minute=30, second=0, microsecond=0) + dt.timedelta(hours=1)
        maximum_exit = min(local + dt.timedelta(hours=V50_MAX_HOLDING_HOURS), local.replace(hour=15, minute=30, second=0, microsecond=0))
        position = {"strategy": slot, "positionId": client, "entryClientOrderId": client, "symbol": symbol, "openedAt": base.now_ms(), "entryBasisBps": candidate["basisBps"], "signalBasisBps": candidate.get("signalBasisBps"), "asterOpenSide": side, "asterQty": fill.executed_qty, "asterEntryPrice": fill.average_price or price, "entryCommission": (fill.executed_qty * (fill.average_price or price)) * self.aster_taker_fee_bps / 10000.0, "targetGross": target_gross, "route": candidate.get("route")}
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
        client = self.client_id(slot, symbol, "CLOSE")
        self._set_pending({"slot": slot, "action": "CLOSE", "symbol": symbol, "side": close_side, "quantity": quantity, "clientId": client})
        maker_fill = base.Fill("ASTER", base.ASTER_SYMBOL[symbol], close_side, quantity, 0.0, 0.0, "NOT_SENT", client)
        maker_price = 0.0
        market_fill = base.Fill("ASTER", base.ASTER_SYMBOL[symbol], close_side, 0.0, 0.0, 0.0, "NOT_SENT", client + "-TAKER")
        if reason in base.EMERGENCY_EXIT_REASONS:
            market_fill = self.flatten_aster_leg(symbol, open_side, quantity, reason)
        else:
            book = self.aster.book(base.ASTER_SYMBOL[symbol], 20, force_refresh=True)
            maker_price = base.passive_exit_price(book, close_side)
            try:
                maker_fill = self.aster.place_limit(
                    symbol=base.ASTER_SYMBOL[symbol], side=close_side, quantity=quantity,
                    price=maker_price, client_id=client, reduce_only=True, post_only=True,
                    position_quantity=quantity,
                )
            except base.HttpRequestError as error:
                if not base.is_post_only_rejection(error):
                    raise
                maker_fill = base.Fill("ASTER", base.ASTER_SYMBOL[symbol], close_side, quantity, 0.0, maker_price, "POST_ONLY_REJECTED", client, error=str(error))
            if self.live and maker_fill.status not in {"POST_ONLY_REJECTED", "REJECTED", "EXPIRED", "CANCELED"}:
                maker_fill = self.aster.poll_fill(base.ASTER_SYMBOL[symbol], client, quantity, close_side, 2000)
            remaining = max(0.0, quantity - maker_fill.executed_qty)
            if remaining > 0:
                market_fill = self.flatten_aster_leg(symbol, open_side, remaining, reason + "-TAKER")
        executed = maker_fill.executed_qty + market_fill.executed_qty
        if executed < quantity * 0.999:
            self.state["manualReviewReason"] = f"{slot} close incomplete: {executed:.12f}/{quantity:.12f}"
            self.save()
            raise RuntimeError(f"{slot} close incomplete")
        if self.live and self.managed_aster_positions(force_refresh=True).get(base.ASTER_SYMBOL[symbol], 0.0):
            self.state["manualReviewReason"] = f"{slot} close reconciliation mismatch"
            self.save()
            raise RuntimeError(f"{slot} close left an Aster position")
        maker_px = maker_fill.average_price or maker_price
        market_px = market_fill.average_price or maker_px
        exit_price = ((maker_fill.executed_qty * maker_px) + (market_fill.executed_qty * market_px)) / executed if executed > 0 else market_px
        direction = 1.0 if open_side == "BUY" else -1.0
        gross_pnl = (exit_price - base.finite(position.get("asterEntryPrice"))) * executed * direction
        commission = base.finite(position.get("entryCommission")) + (maker_fill.executed_qty * maker_px * self.aster_maker_fee_bps / 10000.0) + (market_fill.executed_qty * market_px * self.aster_taker_fee_bps / 10000.0)
        self._v52_ledger().append({"strategyId": slot, "symbol": symbol, "side": "LONG" if direction > 0 else "SHORT", "entryAt": position.get("openedAt"), "exitAt": base.now_ms(), "realizedPnl": gross_pnl - commission, "unrealizedPnl": 0.0, "commission": commission, "funding": 0.0, "deposits": 0.0, "withdrawals": 0.0, "unattributedDifference": 0.0, "clientOrderId": client, "tradeId": client, "positionId": position.get("positionId"), "exitReason": reason, "makerExecutedQty": maker_fill.executed_qty, "takerExecutedQty": market_fill.executed_qty})
        self.positions().pop(slot, None)
        if slot == V50_SLOT:
            self.state["v50CompletedTrades"] = int(self.state.get("v50CompletedTrades", 0)) + 1
        self._clear_pending()
        self.save()
        self.log("v52-position-closed", slot=slot, symbol=symbol, reason=reason, makerFill=dataclasses.asdict(maker_fill), takerFill=dataclasses.asdict(market_fill))

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
            freshness_reasons, _book_ts, _reference_ts = base.market_data_freshness_reasons(aster, reference, now)
            reasons.extend(freshness_reasons)
            if symbol in active_symbols: reasons.append("SAME_SYMBOL_ACTIVE")
            if abs(basis) < V50_MIN_ENTRY_BASIS_BPS: reasons.append("BASIS_BELOW_75")
            if signal_basis * basis <= 0: reasons.append("SIGN_CHANGED")
            if adverse > V50_MAX_ADVERSE_BASIS_MOVE_BPS: reasons.append("ADVERSE_BASIS_MOVE")
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

    def _v52_unrealized_pnl(self) -> float:
        if not self.live:
            return 0.0
        marks = {str(row.get("symbol") or ""): row for row in self.aster.positions()}
        total = 0.0
        for position in self.positions().values():
            symbol = base.ASTER_SYMBOL[str(position["symbol"])]
            row = marks.get(symbol) or {}
            mark = base.finite(row.get("markPrice") or row.get("entryPrice"))
            entry = base.finite(position.get("asterEntryPrice"))
            qty = base.finite(position.get("asterQty"))
            direction = 1.0 if position.get("asterOpenSide") == "BUY" else -1.0
            total += (mark - entry) * qty * direction
        return total

    def _v52_ledger(self) -> list:
        ledger = self.state.setdefault("v52Ledger", {"strategyId": STRATEGY_ID, "trades": []})
        if ledger.get("strategyId") != STRATEGY_ID or not isinstance(ledger.get("trades"), list):
            raise RuntimeError("V52 PnL ledger is invalid")
        return ledger["trades"]

    def enforce_daily_loss(self) -> bool:
        latch = self.state.get("v52StrategyDailyLossLatch")
        if not isinstance(latch, dict):
            latch = None
        try:
            capital = base.float_env("DISDEX_V52_STRATEGY_CAPITAL_USD", 0.0)
            if capital <= 0:
                capital = max(self.minimum_entry_usd, self.excess_margin_usd())
            next_latch = update_v52_strategy_daily_latch(
                previous=latch,
                trades=self._v52_ledger(),
                unrealized_pnl=self._v52_unrealized_pnl(),
                strategy_capital_usd=capital,
                now_ms=base.now_ms(),
                maximum_daily_loss_pct=self.max_daily_loss_pct,
                data_available=capital > 0,
            )
        except base.TransientDataError:
            raise
        except Exception as error:
            next_latch = {
                "latchName": "v52StrategyDailyLossLatch",
                "utcDay": dt.datetime.now(tz=base.UTC).date().isoformat(),
                "strategyStartCapitalUsd": 0.0,
                "realizedPnl": 0.0,
                "unrealizedPnl": 0.0,
                "commission": 0.0,
                "funding": 0.0,
                "deposits": 0.0,
                "withdrawals": 0.0,
                "unattributedDifference": 0.0,
                "lossUsd": 0.0,
                "lossPct": 0.0,
                "lossLimitUsd": 0.0,
                "tripped": True,
                "failClosed": True,
                "tripReason": f"V52 PnL API failure: {error}",
                "lastCheckedAt": base.now_ms(),
            }
        self.state["v52StrategyDailyLossLatch"] = next_latch
        self.save()
        return bool(next_latch.get("tripped") or next_latch.get("failClosed"))

    def tick(self) -> None:
        if self.state.get("pendingOrder"):
            self.log("v52-pending-order-review", pending=self.state.get("pendingOrder"))
            return
        self.reset_days()
        kill = self.kill_switch()
        if kill:
            self.flatten_all(str(kill.get("reason") or "KILL_SWITCH")); return
        if self.enforce_daily_loss():
            return
        if self.kill_switch():
            self.flatten_all("DAILY_LOSS"); return
        local = dt.datetime.now(tz=base.NY)
        sec = base.ny_seconds(local)
        market_open = local.weekday() < 5 and base.clock("09:30:00") <= sec <= base.clock("16:00:00")
        market_label = "米国株式市場 09:30-16:00（ニューヨーク時間）" if market_open else "米国株式市場の対象時間外"
        self.write_decision_snapshot(market_open=market_open, market_label=market_label)
        if local.weekday() >= 5:
            return
        if not self.positions() and not (base.clock("09:59:50") <= sec <= base.clock("15:30:30")):
            return
        self.update_history()
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
            checked_at = dt.datetime.now(tz=base.UTC).isoformat().replace("+00:00", "Z")
            self._record_decision_items(slot=V11_SLOT, candidate=candidate, rejections=rejections, checked_at=checked_at)
            self.write_decision_snapshot(market_open=True, market_label="米国株式市場 09:30-16:00（ニューヨーク時間）")
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
            checked_at = dt.datetime.now(tz=base.UTC).isoformat().replace("+00:00", "Z")
            self._record_decision_items(slot=V50_SLOT, candidate=candidate, rejections=rejections, checked_at=checked_at)
            self.write_decision_snapshot(market_open=True, market_label="米国株式市場 09:30-16:00（ニューヨーク時間）")
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

    def _handle_transient_data_error(self, error: base.TransientDataError) -> None:
        now = base.now_ms()
        if self.data_unavailable_since_ms is None:
            self.data_unavailable_since_ms = now
        elapsed = now - self.data_unavailable_since_ms
        self.state["dataUnavailableSinceMs"] = self.data_unavailable_since_ms
        self.state["lastTransientDataCategory"] = error.category
        self.save()
        self.log("v52-transient-data-error", category=error.category, elapsedMs=elapsed, error=str(error))
        if not self.positions() or elapsed < self.exit_data_grace_ms:
            return
        try:
            self.flatten_all("DATA_UNAVAILABLE_FAIL_CLOSED")
        except Exception as flatten_error:
            self.state["manualReviewReason"] = f"Transient data grace expired: {flatten_error}"
            self.save()
            self.stop_requested = True
            return
        self.data_unavailable_since_ms = None
        self.state.pop("dataUnavailableSinceMs", None)
        self.save()
    def run(self, daemon: bool) -> None:
        self.lock.acquire()
        try:
            self.reset_days(); self.reconcile()
            self.log("v52-runner-start", strategyId=STRATEGY_ID, caps={"crypto": self.crypto_gross_cap, "stock": self.stock_gross_cap, "portfolio": self.portfolio_gross_cap, "v11": self.v11_gross_cap, "v50": self.v50_gross_cap})
            while not self.stop_requested:
                started = base.now_ms()
                try:
                    self.tick()
                    if self.data_unavailable_since_ms is not None:
                        self.data_unavailable_since_ms = None
                        self.state.pop("dataUnavailableSinceMs", None)
                        self.save()
                except base.OrderExecutionUnknownError as error:
                    self.state["manualReviewReason"] = f"Order status unknown: {error}"
                    self.save()
                    self.log("v52-order-execution-unknown", error=str(error))
                    self.stop_requested = True
                    raise
                except base.TransientDataError as error:
                    self._handle_transient_data_error(error)
                    if self.stop_requested:
                        raise
                except Exception as error:
                    self.log("v52-tick-error", error=str(error))
                    if self.live:
                        self.activate_kill_switch(f"V52 fatal tick error: {error}"); self.flatten_all("FATAL_TICK_ERROR"); raise
                if not daemon: break
                active = base.clock("09:59:50") <= base.ny_seconds() <= base.clock("15:30:30") or bool(self.positions())
                interval = self.active_interval_ms if active else base.int_env("DISDEX_STOCK_IDLE_INTERVAL_MS", 5000)
                time.sleep(max(0, interval - (base.now_ms() - started)) / 1000.0)
        finally: self.lock.release()


def self_test() -> None:
    assert LIVE_ACK == "I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY"
    assert V50_WINDOWS == ("11:30", "12:30", "13:30")
    assert V50_MIN_ENTRY_BASIS_BPS == 75.0
    from disdex_v13d_v11eq_stock_free_live_engine import reference_health_ready
    market_closed = {"status": "market_closed", "marketOpen": False, "pythConnected": False, "iexConnected": False}
    assert reference_health_ready(market_closed, regular_session=False)
    assert not reference_health_ready(market_closed, regular_session=True)
    connected = {"status": "ok", "marketOpen": True, "pythConnected": True, "iexConnected": True}
    assert reference_health_ready(connected, regular_session=True)

    book = base.Book("ASTER", "AMZNUSDT", 99.9, 10, 100.1, 10, [(99.9, 10)], [(100.1, 10)], 1000, 1000)
    assert base.passive_exit_price(book, "SELL") == book.ask
    assert base.passive_exit_price(book, "BUY") == book.bid
    quote = base.ReferenceQuote("AMZN", 100.0, 1000, 1000, "test")
    assert base.market_data_freshness_reasons(book, quote, 1000)[0] == []
    fallback = base.ReferenceQuote("AMZN", 100.0, 0, 1000, "test", True)
    assert "REFERENCE_TIMESTAMP_FALLBACK" in base.market_data_freshness_reasons(book, fallback, 1000)[0]
    assert base.is_post_only_rejection(base.HttpRequestError("GTX post only", status_code=400, body="GTX"))
    base._HTTP_COOLDOWN_UNTIL.clear()
    base._set_request_cooldown("TRANSIENT_REFERENCE_DATA")
    assert base._request_cooldown_remaining("TRANSIENT_REFERENCE_DATA") > 0
    assert base._request_cooldown_remaining("TRANSIENT_PUBLIC_DATA") == 0
    base._HTTP_COOLDOWN_UNTIL.clear()
    client = object.__new__(base.AsterClient)
    client._rules = {"AMZNUSDT": {"status": "TRADING", "step": 0.001, "minQty": 0.001, "maxQty": 1000.0, "tick": 0.01, "minNotional": 5.0}}
    try:
        client.normalize("AMZNUSDT", 0.01, 100.0, "BUY")
    except RuntimeError:
        pass
    else:
        raise AssertionError("entry below minNotional must be rejected")
    reduced, _ = client.normalize("AMZNUSDT", 0.01, 100.0, "SELL", reduce_only=True, position_quantity=0.01)
    assert reduced == 0.01
    cached_client = object.__new__(base.AsterClient)
    cached_client.public_url = "https://test.invalid"
    cached_client.timeout = 1.0
    cached_client.book_cache_ttl_ms = 10_000
    cached_client._book_cache = {}
    cached_client._book_cache_lock = base.threading.RLock()
    calls = []
    original_http_json = base.http_json
    def fake_http_json(*_args, **_kwargs):
        calls.append(True)
        return {"E": 2000, "bids": [[99.9, 10]], "asks": [[100.1, 10]]}
    base.http_json = fake_http_json
    try:
        cached_client.book("AMZNUSDT")
        cached_client.book("AMZNUSDT")
    finally:
        base.http_json = original_http_json
    assert len(calls) == 1
    engine = object.__new__(V52AsterOnlyEngine)
    engine.crypto_gross_cap = 1.0; engine.stock_gross_cap = 1.5; engine.portfolio_gross_cap = 2.5
    engine.v11_gross_cap = 1.0; engine.v50_gross_cap = 1.0; engine.gross_tolerance = 0.03
    engine.state = {"positions": {V11_SLOT: {}}}; engine.v96_requires_margin = lambda: False
    engine.gross_snapshot = lambda: {"equityUsd": 100.0, "cryptoGross": 1.0, "stockGross": 1.0, "totalGross": 2.0}
    gross, _ = engine.available_slot_gross(V50_SLOT)
    assert gross == 0.5
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
