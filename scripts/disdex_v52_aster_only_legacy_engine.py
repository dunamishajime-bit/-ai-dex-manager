from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import math
import os
import shutil
import signal
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import disdex_v11eq_aster_only_live_engine as legacy
from disdex_v52_daily_loss import update_v52_strategy_daily_latch
from disdex_account_order_lock import AccountOrderLock
from disdex_v12_crypto_daily_risk import read_shared_crypto_daily_risk
from disdex_strict_portfolio_planner import (
    STRICT_CAPS,
    quality102_crypto_notional_from_positions,
    read_quality102_live_state_document,
)

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


def transient_reference_error(error: BaseException | str) -> bool:
    """Return true only for reference-validation failures which are safe to retry while flat."""
    message = str(error).lower()
    return any(marker in message for marker in (
        "iex_quote_stale",
        "pyth_quote_stale",
        "cross_source_divergence",
        "reference quote stale",
        "reference quote unavailable",
        "free reference sources are not connected",
        "free reference health did not become ready",
    ))


class V52AsterOnlyEngine(legacy.AsterOnlyStockEngine):
    def __init__(self, mode: str):
        super().__init__(mode)
        self.state_root = Path(os.getenv("DISDEX_V52_ASTER_ONLY_STATE_DIR", str(self.state_root))).resolve()
        self.state_path = self.state_root / f"runner-{mode}.json"
        self.audit_path = self.state_root / f"audit-{mode}.jsonl"
        self.kill_switch_path = Path(os.getenv("DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE", str(self.kill_switch_path))).resolve()
        self.lock = AccountOrderLock(
            os.getenv("DISDEX_ACCOUNT_LOCK_PATH", ".runtime-state/shared/account-order.lock"),
            base.int_env("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000),
            default_owner=f"V52:{mode}:{os.getpid()}",
        )
        self.state = base.read_json(self.state_path, {}) or {}
        self.crypto_gross_cap = base.float_env("DISDEX_V52_CRYPTO_GROSS_CAP", STRICT_CAPS.crypto_gross)
        self.stock_gross_cap = base.float_env("DISDEX_V52_STOCK_GROSS_CAP", 1.5)
        self.portfolio_gross_cap = base.float_env("DISDEX_V52_PORTFOLIO_GROSS_CAP", 2.5)
        self.v11_gross_cap = base.float_env("DISDEX_V52_V11_GROSS_CAP", 1.0)
        self.v50_gross_cap = base.float_env("DISDEX_V52_V50_GROSS_CAP", 1.0)
        # Strict caps are hard limits.  A legacy environment may still carry
        # the old 3% reporting tolerance; never let that value authorize an
        # over-cap order in the strict runner.
        self.gross_tolerance = max(0.0, min(base.float_env("DISDEX_V52_GROSS_TOLERANCE", 1e-9), 1e-6))
        self.minimum_entry_usd = base.float_env("DISDEX_V52_MIN_ENTRY_USD", 5.0)
        self.max_daily_loss_pct = base.float_env("DISDEX_V52_MAX_DAILY_LOSS_PCT", 3.5)
        self.state.setdefault("v52Ledger", {"strategyId": STRATEGY_ID, "trades": []})
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

    def _quality102_aware_crypto_notional(self) -> float:
        if not self.live:
            return 0.0
        return quality102_crypto_notional_from_positions(
            self.aster.positions(),
            known_crypto=frozenset(getattr(legacy, "V96_SYMBOLS", set())),
            known_stock=frozenset(base.ASTER_SYMBOL.values()),
        )

    def _quality102_document(self):
        """Return validated Q102 state while the shared account lock is held."""
        return read_quality102_live_state_document(now_ms=base.now_ms())

    def _quality102_marked_notional(self, document=None) -> float:
        if not self.live:
            return 0.0
        document = document if document is not None else self._quality102_document()
        if document is None:
            return 0.0
        _path, raw, owned = document
        if raw.get("pending") is not None:
            raise RuntimeError("QUALITY102_CAUSAL_V1_PENDING_ORDER_REQUIRES_RECONCILIATION")
        if owned is None:
            return 0.0
        rows = self.aster.positions()
        matches = [row for row in rows if str(row.get("symbol") or "").upper() == owned.symbol]
        if len(matches) != 1:
            raise RuntimeError("QUALITY102_STATE_POSITION_MISMATCH")
        row = matches[0]
        quantity = base.finite(row.get("positionAmt"))
        mark = base.finite(row.get("markPrice") or row.get("entryPrice"))
        if abs(quantity) <= 1e-12 or mark <= 0:
            raise RuntimeError("QUALITY102_POSITION_MALFORMED:markPrice")
        actual_side = 1 if quantity > 0 else -1
        if actual_side != owned.side or abs(abs(quantity) - owned.quantity) > max(1e-8, owned.quantity * 0.02):
            raise RuntimeError("QUALITY102_STATE_POSITION_MISMATCH")
        return abs(quantity) * mark

    def _quality102_manual_review(self, path: Path, raw: dict, pending: dict, message: str) -> None:
        pending["phase"] = "manual_review"
        pending["lastError"] = message
        pending["updatedAt"] = base.now_ms()
        failures = raw.get("failures")
        if not isinstance(failures, list):
            failures = []
        failures.append({"occurredAt": base.now_ms(), "message": message, "idempotencyKey": pending.get("idempotencyKey")})
        raw["failures"] = failures[-100:]
        raw["updatedAt"] = base.now_ms()
        base.atomic_write_json(path, raw)

    def _prepare_quality102_for_stock_entry(self, slot: str, target_gross: float) -> float:
        """Free total Gross for a base Stock entry using Q102 MTM only.

        The caller holds the shared account lock.  The exchange is never
        asked to open a base order until this method has reconciled every Q102
        reduction and a fresh gross snapshot fits the hard caps.
        """
        if not self.live:
            return target_gross
        requested = base.finite(target_gross)
        if requested <= 0:
            return 0.0
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        requested = min(requested, slot_cap, self.stock_gross_cap)
        for _attempt in range(3):
            document = self._quality102_document()
            if document is None:
                return requested
            path, raw, owned = document
            if raw.get("pending") is not None:
                raise RuntimeError("QUALITY102_CAUSAL_V1_PENDING_ORDER_REQUIRES_RECONCILIATION")
            if owned is None:
                return requested
            snapshot = self.gross_snapshot()
            equity = snapshot["equityUsd"]
            q102_notional = self._quality102_marked_notional(document)
            base_total_notional = max(0.0, snapshot["totalGross"] * equity - q102_notional)
            desired_stock_notional = requested * equity
            required_reduce = max(0.0, base_total_notional + q102_notional + desired_stock_notional - self.portfolio_gross_cap * equity)
            if required_reduce <= max(1e-8, equity * self.gross_tolerance):
                final = self.gross_snapshot()
                self.assert_gross_safe(final)
                return requested

            symbol = owned.symbol
            book = self.aster.book(symbol, 20)
            now = base.now_ms()
            if book.event_ms <= 0 or book.received_ms <= 0 or book.event_ms > now + 5_000 or now - book.received_ms > 5_000:
                raise RuntimeError("QUALITY102_CAUSAL_V1_REDUCTION_QUOTE_STALE_OR_INVALID")
            close_side = "SELL" if owned.side > 0 else "BUY"
            mark_price = book.bid if close_side == "SELL" else book.ask
            if not math.isfinite(mark_price) or mark_price <= 0:
                raise RuntimeError("QUALITY102_CAUSAL_V1_REDUCTION_QUOTE_INVALID")
            # A small overage handles book-to-fill movement; the fresh
            # snapshot below decides whether another reduction is necessary.
            reduce_quantity = min(owned.quantity, (required_reduce / mark_price) * 1.002)
            if not (reduce_quantity > 1e-12):
                raise RuntimeError("QUALITY102_CAUSAL_V1_REDUCTION_QUANTITY_ZERO")
            idempotency_key = base.hashlib.sha256(
                f"QUALITY102_CAUSAL_V1|BASE_PRIORITY_MTM|{slot}|{symbol}|{owned.side}|{owned.quantity:.12f}|{book.event_ms}|{requested:.12f}".encode()
            ).hexdigest()
            client_id = f"q102v1-reduce-{idempotency_key}"[:36]
            pending = {
                "idempotencyKey": idempotency_key,
                "clientOrderId": client_id,
                "phase": "planned",
                "symbol": symbol,
                "side": close_side,
                "quantity": reduce_quantity,
                "reduceOnly": True,
                "referenceTs": book.event_ms,
                "createdAt": now,
                "updatedAt": now,
                "expectedPrice": mark_price,
                "reason": f"BASE_PRIORITY_MTM_REDUCTION:{slot}",
            }
            raw["pending"] = pending
            raw["updatedAt"] = now
            base.atomic_write_json(path, raw)
            try:
                pending["phase"] = "submitted"
                pending["updatedAt"] = base.now_ms()
                base.atomic_write_json(path, raw)
                fill = self.aster.place_market(
                    symbol=symbol,
                    side=close_side,
                    quantity=reduce_quantity,
                    expected_price=mark_price,
                    client_id=client_id,
                    reduce_only=True,
                )
            except Exception as error:
                self._quality102_manual_review(path, raw, pending, f"QUALITY102_CAUSAL_V1_REDUCTION_EXECUTION_ERROR:{error}")
                raise RuntimeError("QUALITY102_CAUSAL_V1_REDUCTION_MANUAL_REVIEW") from error
            if (str(fill.symbol).upper() != symbol or str(fill.side).upper() != close_side
                    or str(fill.client_id) != client_id or not math.isfinite(fill.executed_qty)
                    or fill.executed_qty <= 0 or fill.executed_qty > reduce_quantity + 1e-8
                    or str(fill.status).upper() not in {"FILLED", "PARTIALLY_FILLED"}):
                message = "QUALITY102_CAUSAL_V1_REDUCTION_RESULT_IDENTITY_OR_STATUS_INVALID"
                self._quality102_manual_review(path, raw, pending, message)
                raise RuntimeError("QUALITY102_CAUSAL_V1_REDUCTION_MANUAL_REVIEW")

            actual_rows = [row for row in self.aster.positions() if str(row.get("symbol") or "").upper() == symbol and abs(base.finite(row.get("positionAmt"))) > 1e-12]
            expected_remaining = owned.quantity - fill.executed_qty
            if expected_remaining > 1e-12:
                if len(actual_rows) != 1 or abs(abs(base.finite(actual_rows[0].get("positionAmt"))) - expected_remaining) > max(1e-8, expected_remaining * 0.02):
                    message = "QUALITY102_CAUSAL_V1_REDUCTION_POSITION_MISMATCH"
                    self._quality102_manual_review(path, raw, pending, message)
                    raise RuntimeError("QUALITY102_CAUSAL_V1_REDUCTION_MANUAL_REVIEW")
            elif actual_rows:
                message = "QUALITY102_CAUSAL_V1_REDUCTION_NOT_FLAT"
                self._quality102_manual_review(path, raw, pending, message)
                raise RuntimeError("QUALITY102_CAUSAL_V1_REDUCTION_MANUAL_REVIEW")
            execution_price = base.finite(fill.average_price, mark_price)
            if execution_price <= 0:
                message = "QUALITY102_CAUSAL_V1_REDUCTION_EXECUTION_PRICE_INVALID"
                self._quality102_manual_review(path, raw, pending, message)
                raise RuntimeError("QUALITY102_CAUSAL_V1_REDUCTION_MANUAL_REVIEW")
            fee_bps = max(0.0, base.float_env("QUALITY102_LIVE_FEE_BPS_PER_SIDE", 0.0))
            funding_per_day = max(0.0, base.float_env("QUALITY102_LIVE_FUNDING_PER_DAY", 0.0))
            basis = fill.executed_qty * owned.entry_price
            price_return = owned.side * (execution_price / owned.entry_price - 1.0)
            elapsed_days = max(0.0, book.event_ms - owned.entry_ts) / 86_400_000.0
            transaction_cost = basis * 2.0 * fee_bps / 10_000.0
            funding_cost = basis * elapsed_days * funding_per_day
            raw["lastReduction"] = {
                "idempotencyKey": idempotency_key,
                "symbol": symbol,
                "side": owned.side,
                "reducedQuantity": fill.executed_qty,
                "markTs": book.event_ms,
                "markPrice": execution_price,
                "realizedPnl": basis * price_return - transaction_cost - funding_cost,
                "transactionCost": transaction_cost,
                "fundingCost": funding_cost,
                "accounting": "MARK_TO_MARKET_REALIZED_PNL",
            }
            if expected_remaining > 1e-12:
                raw["position"]["quantity"] = abs(base.finite(actual_rows[0].get("positionAmt")))
            else:
                raw.pop("position", None)
            raw.pop("pending", None)
            raw["lastCompletedIdempotencyKey"] = idempotency_key
            raw["lastReconciledAt"] = base.now_ms()
            raw["updatedAt"] = base.now_ms()
            base.atomic_write_json(path, raw)
        raise RuntimeError("QUALITY102_CAUSAL_V1_REDUCTION_RETRY_EXHAUSTED")

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
        crypto_notional = self._quality102_aware_crypto_notional()
        stock_notional = self._actual_stock_notional()
        return {"equityUsd": equity, "cryptoNotionalUsd": crypto_notional, "stockNotionalUsd": stock_notional, "cryptoGross": crypto_notional / equity, "stockGross": stock_notional / equity, "totalGross": (crypto_notional + stock_notional) / equity}

    def available_slot_gross(self, slot: str) -> Tuple[float, dict]:
        snapshot = self.gross_snapshot()
        if slot in self.positions() or self.v96_requires_margin():
            return 0.0, snapshot
        document = self._quality102_document() if self.live else None
        if document is not None and document[1].get("pending") is not None:
            return 0.0, snapshot
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        # Q102 is lower priority than the Stock sleeves.  Give Stock the
        # total-Gross room currently occupied by Q102, then reduce Q102 at
        # order planning time if that room is actually needed.
        q102_notional = self._quality102_marked_notional(document) if self.live else 0.0
        equity = snapshot["equityUsd"]
        total_without_q102 = max(0.0, snapshot["totalGross"] - q102_notional / equity)
        available = min(slot_cap, max(0.0, self.stock_gross_cap - snapshot["stockGross"]), max(0.0, self.portfolio_gross_cap - total_without_q102))
        return max(0.0, available), snapshot

    def assert_gross_safe(self, snapshot: Optional[dict] = None) -> None:
        row = snapshot or self.gross_snapshot()
        for name, value, cap in (("Crypto", row["cryptoGross"], self.crypto_gross_cap), ("Stock", row["stockGross"], self.stock_gross_cap), ("Portfolio", row["totalGross"], self.portfolio_gross_cap)):
            if value > cap + self.gross_tolerance:
                raise RuntimeError(f"{name} Gross exceeds V52 cap: {value:.6f} > {cap:.6f}")

    def reconcile(self, read_only: bool = False) -> None:
        if self.state.get("pendingOrder"):
            raise RuntimeError("Unresolved V52 pending order requires operator review before restart")
        if not self.live:
            return
        document = self._quality102_document()
        if document is not None and document[1].get("pending") is not None:
            raise RuntimeError("QUALITY102_CAUSAL_V1_PENDING_ORDER_REQUIRES_RECONCILIATION")
        actual = self.managed_aster_positions()
        expected: Dict[str, float] = {}
        for position in self.positions().values():
            symbol = base.ASTER_SYMBOL[str(position["symbol"])]
            signed = base.finite(position.get("asterQty")) * (1 if position.get("asterOpenSide") == "BUY" else -1)
            expected[symbol] = expected.get(symbol, 0.0) + signed
        if set(actual) != set(expected):
            if not read_only:
                self.activate_kill_switch("V52 managed Stock symbol reconciliation mismatch")
            raise RuntimeError("V52 managed Stock symbols do not match state")
        for symbol, expected_qty in expected.items():
            actual_qty = base.finite(actual.get(symbol))
            if abs(expected_qty - actual_qty) > max(1e-8, abs(expected_qty) * 0.02):
                if not read_only:
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
        target_gross = self._prepare_quality102_for_stock_entry(slot, target_gross)
        snapshot = self.gross_snapshot()
        self.assert_gross_safe(snapshot)
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        target_gross = min(
            target_gross,
            slot_cap,
            max(0.0, self.stock_gross_cap - snapshot["stockGross"]),
            max(0.0, self.portfolio_gross_cap - snapshot["totalGross"]),
        )
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
        book = self.aster.book(base.ASTER_SYMBOL[symbol], 20)
        price = book.bid if close_side == "SELL" else book.ask
        client = self.client_id(slot, symbol, "CLOSE")
        self._set_pending({"slot": slot, "action": "CLOSE", "symbol": symbol, "side": close_side, "quantity": quantity, "clientId": client})
        initial = self.aster.place_limit(symbol=base.ASTER_SYMBOL[symbol], side=close_side, quantity=quantity, price=price, client_id=client, reduce_only=True, post_only=True)
        fill = initial if not self.live else self.aster.poll_fill(base.ASTER_SYMBOL[symbol], client, quantity, close_side, 2000)
        remaining = max(0.0, quantity - fill.executed_qty)
        if remaining > quantity * 0.01:
            market = self.flatten_aster_leg(symbol, open_side, remaining, reason + "-TAKER")
            if market.fill_ratio < 0.99:
                self.activate_kill_switch(f"{slot} close did not fully complete")
                raise RuntimeError(f"{slot} close incomplete")
        exit_price = fill.average_price or price
        direction = 1.0 if open_side == "BUY" else -1.0
        gross_pnl = (exit_price - base.finite(position.get("asterEntryPrice"))) * quantity * direction
        commission = base.finite(position.get("entryCommission")) + (exit_price * quantity * self.aster_taker_fee_bps / 10000.0)
        self._v52_ledger().append({"strategyId": slot, "symbol": symbol, "side": "LONG" if direction > 0 else "SHORT", "entryAt": position.get("openedAt"), "exitAt": base.now_ms(), "realizedPnl": gross_pnl - commission, "unrealizedPnl": 0.0, "commission": commission, "funding": 0.0, "deposits": 0.0, "withdrawals": 0.0, "unattributedDifference": 0.0, "clientOrderId": client, "tradeId": client, "positionId": position.get("positionId"), "exitReason": reason})
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
            if now - aster.received_ms > base.V11_MAX_DATA_AGE_MS or now - reference.received_ms > base.V11_MAX_DATA_AGE_MS: reasons.append("STALE_DATA")
            if abs(aster.received_ms - reference.received_ms) > base.V11_MAX_SOURCE_CLOCK_DIFF_MS: reasons.append("SOURCE_CLOCK_MISMATCH")
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
        self.reset_days()
        kill = self.kill_switch()
        if kill:
            self.flatten_all(str(kill.get("reason") or "KILL_SWITCH")); return
        if self.enforce_daily_loss():
            return
        if self.live:
            risk_path = os.getenv("DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH", ".runtime-state/shared/crypto-daily-risk.json")
            ok, reason, _ = read_shared_crypto_daily_risk(risk_path)
            if not ok:
                self.log("v52-entry-held-shared-crypto-risk", reason=reason, path=risk_path)
                return
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

    def preflight(self, read_only: bool = False) -> dict:
        if self.live:
            if not base.bool_env("DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED", False): raise RuntimeError("V52 LIVE requires DISDEX_V52_ASTER_ONLY_LIVE_EXECUTION_ENABLED=true")
            if os.getenv("DISDEX_V52_ASTER_ONLY_LIVE_ACKNOWLEDGEMENT") != LIVE_ACK: raise RuntimeError(f"V52 LIVE requires acknowledgement {LIVE_ACK}")
        if read_only:
            if not self.state_root.is_dir():
                raise RuntimeError("V52 state directory missing for read-only preflight")
            if not self.state_path.is_file():
                raise RuntimeError("V52 state file missing for read-only preflight")
        else:
            self.state_root.mkdir(parents=True, exist_ok=True); self.save()
        if self.kill_switch(): raise RuntimeError("Shared Kill Switch is active")
        if self.state.get("pendingOrder"): raise RuntimeError("V52 pending order must be resolved before no-order preflight")
        document = self._quality102_document() if self.live else None
        if document is not None and document[1].get("pending") is not None:
            raise RuntimeError("QUALITY102_CAUSAL_V1_PENDING_ORDER_REQUIRES_RECONCILIATION")
        self.aster.ping(); self.aster.exchange_info()
        missing = [symbol for symbol in base.ASTER_SYMBOL.values() if symbol not in self.aster._rules]
        if missing: raise RuntimeError(f"Aster Stock symbols missing: {missing}")
        from disdex_v13d_v11eq_stock_free_live_engine import reference_health, regular_us_equity_session
        if regular_us_equity_session():
            health = reference_health(self.reference)
            for symbol in base.SYMBOLS:
                quote = self.reference.quote(symbol)
                if base.now_ms() - quote.timestamp_ms > base.V11_MAX_DATA_AGE_MS: raise RuntimeError(f"Reference quote stale for {symbol}")
            reference_health_status = health.get("status")
            reference_freshness_mode = "REQUIRED_DURING_US_REGULAR_SESSION"
        else:
            # IEX does not publish fresh quotes outside the regular session.  Starting
            # the daemon must remain possible; entries remain gated by fresh data when
            # the next regular session begins.
            reference_health_status = "DEFERRED_MARKET_CLOSED"
            reference_freshness_mode = "DEFERRED_MARKET_CLOSED"
        self.reconcile(read_only=read_only)
        snapshot = self.gross_snapshot(); self.assert_gross_safe(snapshot)
        return {"strategyId": STRATEGY_ID, "mode": self.mode, "readOnly": read_only, "schemaVersion": STATE_SCHEMA_VERSION, "asterPing": True, "asterSymbols": list(base.ASTER_SYMBOL.values()), "referenceHealth": reference_health_status, "referenceFreshnessMode": reference_freshness_mode, "positions": self.positions(), "gross": snapshot, "caps": {"crypto": self.crypto_gross_cap, "stock": self.stock_gross_cap, "portfolio": self.portfolio_gross_cap, "v11": self.v11_gross_cap, "v50": self.v50_gross_cap}, "ordersSent": False}

    def run(self, daemon: bool) -> None:
        started_once = False
        while not self.stop_requested:
            started = base.now_ms()
            if not self.lock.acquire():
                self.log("v52-account-lock-busy", accountLockPath=str(self.lock.path))
            else:
                try:
                    if not started_once:
                        self.reset_days(); self.reconcile()
                        self.log("v52-runner-start", strategyId=STRATEGY_ID, caps={"crypto": self.crypto_gross_cap, "stock": self.stock_gross_cap, "portfolio": self.portfolio_gross_cap, "v11": self.v11_gross_cap, "v50": self.v50_gross_cap})
                        started_once = True
                    self.tick()
                except Exception as error:
                    self.log("v52-tick-error", error=str(error))
                    if transient_reference_error(error) and not self.positions():
                        # A stale or disagreeing independent reference is an entry
                        # gate, not an execution fault.  Do not kill the V52 daemon
                        # or consume its narrow entry window; wait for fresh, agreeing
                        # quotes and re-evaluate on the next tick.
                        self.log("v52-entry-held-reference-validation", error=str(error))
                    elif self.live:
                        self.activate_kill_switch(f"V52 fatal tick error: {error}"); self.flatten_all("FATAL_TICK_ERROR"); raise
                finally:
                    # The shared lock coordinates one tick/order plan. Holding it
                    # across daemon sleep would expire the lease and block V12/PENGU.
                    self.lock.release()
            if not daemon: break
            active = base.clock("09:59:50") <= base.ny_seconds() <= base.clock("15:30:30") or bool(self.positions())
            interval = 250 if active else base.int_env("DISDEX_STOCK_IDLE_INTERVAL_MS", 5000)
            time.sleep(max(0, interval - (base.now_ms() - started)) / 1000.0)


def self_test() -> None:
    assert LIVE_ACK == "I_ACCEPT_REAL_MONEY_V96_V52_ASTER_ONLY"
    assert V50_WINDOWS == ("11:30", "12:30", "13:30")
    assert V50_MIN_ENTRY_BASIS_BPS == 75.0
    engine = object.__new__(V52AsterOnlyEngine)
    engine.live = True
    engine.crypto_gross_cap = 1.0; engine.stock_gross_cap = 1.5; engine.portfolio_gross_cap = 2.5
    engine.v11_gross_cap = 1.0; engine.v50_gross_cap = 1.0; engine.gross_tolerance = 0.03
    engine.state = {"positions": {V11_SLOT: {}}}; engine.v96_requires_margin = lambda: False
    engine.gross_snapshot = lambda: {"equityUsd": 100.0, "cryptoGross": 1.0, "stockGross": 1.0, "totalGross": 2.0}
    gross, _ = engine.available_slot_gross(V50_SLOT)
    assert gross == 0.5
    assert transient_reference_error("iex_quote_stale META")
    assert transient_reference_error("cross_source_divergence TSLA")
    assert not transient_reference_error("Managed Stock position reconciliation mismatch")
    print("V52 V11-EQ + V50 Aster-only live engine self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("paper", "live"), default=os.getenv("DISDEX_V52_ASTER_ONLY_RUNNER_MODE", "paper"))
    parser.add_argument("--daemon", action="store_true"); parser.add_argument("--once", action="store_true")
    parser.add_argument("--preflight", action="store_true"); parser.add_argument("--preflight-readonly", action="store_true"); parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test: self_test(); return 0
    runner = V52AsterOnlyEngine(args.mode)
    signal.signal(signal.SIGINT, lambda *_: setattr(runner, "stop_requested", True)); signal.signal(signal.SIGTERM, lambda *_: setattr(runner, "stop_requested", True))
    if args.preflight_readonly: print(json.dumps(runner.preflight(read_only=True), ensure_ascii=False, separators=(",", ":"))); return 0
    if args.preflight: print(json.dumps(runner.preflight(), indent=2, ensure_ascii=False)); return 0
    runner.run(args.daemon); return 0


if __name__ == "__main__":
    raise SystemExit(main())
