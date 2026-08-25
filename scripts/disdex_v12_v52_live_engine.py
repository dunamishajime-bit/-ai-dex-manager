from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import json
import os
import signal
import time

# Expand the legacy V96/V52 shared Margin Guard before importing the
# margin-aware V52 engine. This preserves the deployed V96 implementation while
# giving the post-migration composition the full frozen V12 universe.
import disdex_v96_v52_margin_guard as guard
from disdex_account_order_lock import AccountOrderLock, active_reserved_gross

V12_CRYPTO_SYMBOLS = (
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT",
    "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT",
    "AAVEUSDT", "NEARUSDT", "PENGUUSDT",
)

guard.MANAGED_CRYPTO_SYMBOLS = V12_CRYPTO_SYMBOLS
guard.MANAGED_SYMBOLS = V12_CRYPTO_SYMBOLS + guard.MANAGED_STOCK_SYMBOLS

import disdex_v52_margin_aware_live_engine as legacy  # noqa: E402

legacy.MANAGED_SYMBOLS = guard.MANAGED_SYMBOLS
legacy.verify_managed_configuration = guard.verify_managed_configuration

EPSILON = 1e-12
V50_WINDOWS = legacy.legacy.V50_WINDOWS
V11_SLOT = legacy.V11_SLOT
V50_SLOT = legacy.V50_SLOT
V50_RANK2_SLOT = "V50_POST_OPEN_BASIS_RANK2"
V50_RANK1_REQUESTED_GROSS = legacy.base.float_env("DISDEX_V52_V50_RANK1_REQUESTED_GROSS", 1.0)
V50_RANK2_REQUESTED_GROSS = legacy.base.float_env("DISDEX_V52_V50_RANK2_REQUESTED_GROSS", 0.5)
V50_MAX_CONCURRENT_POSITIONS = legacy.base.int_env("DISDEX_V52_V50_MAX_CONCURRENT_POSITIONS", 2)
V50_MAX_DAILY_ENTRIES = legacy.base.int_env("DISDEX_V52_V50_MAX_DAILY_ENTRIES", 3)

# Research-locked V50 gate profile from PR #189 / Actions run 32774114948.
# Only strategy selectivity is changed here. Reference quality, freshness,
# source-clock, spread, depth, adverse-move, Gross, Margin Guard, daily-loss and
# Kill Switch gates remain unchanged and fail closed.
V50_MIN_ENTRY_BASIS_BPS = 65.0
V50_MIN_NET_EDGE_BPS = 5.0
legacy.legacy.V50_MIN_ENTRY_BASIS_BPS = V50_MIN_ENTRY_BASIS_BPS
legacy.legacy.V50_MIN_NET_EDGE_BPS = V50_MIN_NET_EDGE_BPS


class V12AwareV52AsterOnlyEngine(legacy.MarginAwareV52AsterOnlyEngine):
    """V52 stock sleeve for the V12 + PENGU V2 crypto composition.

    Capacity is based on actual Aster positions across every frozen V12 symbol,
    PENGU and the five stock symbols. The legacy V96 state no longer receives
    margin priority after migration.

    The daemon singleton lock is local. The cross-language account-order lock is
    held only around exchange-mutating critical sections. Owner IDs encode the
    shared arbitration priority: P1 for reduce-only/flatten and P2 for new V52
    stock exposure. New exposure is reserved in the shared lock before the
    inherited V52 code persists ``pendingOrder`` and sends the order.

    V52 has its own 3.5% strategy daily-loss latch. The V12+PENGU shared crypto
    daily-risk file is intentionally not an entry prerequisite for V52 stock
    signal evaluation. Combined account Gross and Margin Guard checks remain
    mandatory immediately before every exposure-increasing V52 order.
    """

    def __init__(self, mode: str):
        super().__init__(mode)
        # Replace the inherited account lock with the same protocol configured
        # for V52 durable crash recovery. The inherited state schema uses
        # ``pendingOrder`` and strategyId=legacy.STRATEGY_ID.
        self.account_order_lock = AccountOrderLock(
            os.getenv("DISDEX_ACCOUNT_LOCK_PATH", ".runtime-state/shared/account-order.lock"),
            legacy.base.int_env("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000),
            recovery_owner_prefix="V52:",
            recovery_state_strategy_id=legacy.STRATEGY_ID,
            recovery_reservation_strategy_prefix="V52:",
            pending_state_path=self.state_path,
        )
        self.lock = legacy.base.FileLock(
            self.state_root / f"runner-{mode}.lock",
            legacy.base.int_env("DISDEX_STOCK_LOCK_STALE_MS", 15 * 60_000),
        )
        self._account_critical_depth = 0

    def reset_days(self) -> None:
        super().reset_days()
        ny_day = str(self.state.get("nyDay") or "")
        entry_day = self.state.get("v50DailyEntriesDay")
        if entry_day != ny_day:
            self.state["v50DailyEntriesDay"] = ny_day
            # An absent day marker is an old-state migration; preserve the
            # already-counted attempts once. A known prior day always resets.
            self.state["v50DailyEntries"] = (
                min(V50_MAX_DAILY_ENTRIES, int(self.state.get("v50CompletedTrades", 0)))
                if entry_day is None
                else 0
            )
            self.save()
        else:
            self.state.setdefault("v50DailyEntries", int(self.state.get("v50CompletedTrades", 0)))

    def active_v50_slots(self) -> int:
        positions = self.positions()
        return sum(1 for slot in (V50_SLOT, V50_RANK2_SLOT) if slot in positions)

    def available_slot_gross(self, slot: str):
        available, snapshot = super().available_slot_gross(slot)
        if slot == V50_RANK2_SLOT:
            return min(available, V50_RANK2_REQUESTED_GROSS), snapshot
        return available, snapshot

    def v50_candidates(self, window: str, rows: dict, notional: float, max_candidates: int = 2):
        """Evaluate one frozen V50 signal snapshot and return ranked candidates.

        This deliberately mirrors the existing V50 gates. The only addition is
        returning the qualified ranking so rank 2 can be admitted as a separate
        P2 exposure. No signal is regenerated after the window snapshot.
        """
        signal = (self.state.get("v50SignalBasis") or {}).get(window) or {}
        if not signal:
            return [], {"ROUTER": ["MISSING_V50_SIGNAL_SNAPSHOT"]}

        eligible = []
        rejections = {}
        now = legacy.base.now_ms()
        active_symbols = {str(position.get("symbol")) for position in self.positions().values()}
        stock = legacy.legacy
        for symbol, (aster, _xyz, reference) in rows.items():
            basis = (aster.mid / reference.price - 1.0) * 10_000.0
            signal_basis = legacy.base.finite(signal.get(symbol), 0.0)
            side = "SELL" if basis > 0 else "BUY"
            exit_action = "BUY" if side == "SELL" else "SELL"
            cost, detail = self.estimate_v11_cost(aster, exit_action, notional)
            adverse = max(0.0, abs(basis) - abs(signal_basis))
            reasons = []
            if symbol in active_symbols:
                reasons.append("SAME_SYMBOL_ACTIVE")
            if abs(basis) < V50_MIN_ENTRY_BASIS_BPS:
                reasons.append("BASIS_BELOW_65")
            if signal_basis * basis <= 0:
                reasons.append("SIGN_CHANGED")
            if adverse > stock.V50_MAX_ADVERSE_BASIS_MOVE_BPS:
                reasons.append("ADVERSE_BASIS_MOVE")
            if now - aster.received_ms > legacy.base.V11_MAX_DATA_AGE_MS or now - reference.received_ms > legacy.base.V11_MAX_DATA_AGE_MS:
                reasons.append("STALE_DATA")
            if abs(aster.received_ms - reference.received_ms) > legacy.base.V11_MAX_SOURCE_CLOCK_DIFF_MS:
                reasons.append("SOURCE_CLOCK_MISMATCH")
            if cost > stock.V50_MAX_ROUND_TRIP_COST_BPS:
                reasons.append("ROUND_TRIP_COST_OVER_60")
            if abs(basis) - stock.V50_CONVERGENCE_BPS - cost < V50_MIN_NET_EDGE_BPS:
                reasons.append("NET_EDGE_BELOW_5")
            if aster.depth_usd(exit_action) < 2.0 * notional:
                reasons.append("DEPTH_BELOW_2X")
            if aster.spread_bps > legacy.base.V11_MAX_SPREAD_BPS:
                reasons.append("SPREAD_OVER_20")
            rejections[symbol] = reasons
            if not reasons:
                eligible.append({
                    "symbol": symbol,
                    "basisBps": basis,
                    "signalBasisBps": signal_basis,
                    "side": side,
                    "entryPrice": aster.bid if side == "BUY" else aster.ask,
                    "estimatedRoundTripCostBps": cost,
                    "adverseBasisMoveBps": adverse,
                    "costDetail": detail,
                    "route": f"POST_{window.replace(':', '')}",
                })

        eligible.sort(key=lambda row: (-abs(row["basisBps"]), row["symbol"]))
        ranked = []
        for rank, candidate in enumerate(eligible[:max_candidates], start=1):
            ranked.append({**candidate, "candidateRank": rank, "qualifiedRank": rank})
        return ranked, rejections

    def v50_candidate(self, window: str, rows: dict, notional: float):
        candidates, rejections = self.v50_candidates(window, rows, notional, max_candidates=2)
        return (candidates[0] if candidates else None), rejections

    def capture_v50_signal(self, window: str, rows: dict) -> None:
        super().capture_v50_signal(window, rows)
        telemetry = self.state.setdefault("v52Top2Telemetry", {}).setdefault(window, {})
        telemetry.update({
            "signalCaptureAttempted": True,
            "signalCaptureSucceeded": bool((self.state.get("v50SignalBasis") or {}).get(window)),
            "signalCapturedAt": legacy.base.now_ms(),
            "effectiveMinimumBasisBps": V50_MIN_ENTRY_BASIS_BPS,
            "effectiveMinimumNetEdgeBps": V50_MIN_NET_EDGE_BPS,
        })
        self.save()

    @contextlib.contextmanager
    def _account_critical(self, priority: int, wait_seconds: float, required: bool):
        if self._account_critical_depth > 0:
            self._account_critical_depth += 1
            try:
                yield True
            finally:
                self._account_critical_depth -= 1
            return

        deadline = time.monotonic() + max(0.0, wait_seconds)
        acquired = False
        owner_id = f"V52:P{priority}:{self.mode}:{os.getpid()}:{time.time_ns()}"
        while True:
            if self.account_order_lock.acquire(owner_id=owner_id):
                acquired = True
                break
            if time.monotonic() >= deadline:
                if required:
                    raise RuntimeError(f"V52_SHARED_ACCOUNT_ORDER_LOCK_TIMEOUT:P{priority}")
                yield False
                return
            time.sleep(0.05)

        self._account_critical_depth = 1
        try:
            yield True
        finally:
            self._account_critical_depth = 0
            if acquired:
                self.account_order_lock.release()

    def _record_gate_diagnostics(
        self,
        strategy: str,
        candidate: dict | None,
        rejections: dict,
        *,
        window: str | None = None,
    ) -> None:
        """Persist daily V52 rejection counters without changing any gate result."""
        ny_day = str(self.state.get("nyDay") or dt.datetime.now(tz=legacy.base.NY).date().isoformat())
        diagnostics = self.state.get("v52GateDiagnostics")
        if not isinstance(diagnostics, dict) or diagnostics.get("nyDay") != ny_day:
            diagnostics = {
                "nyDay": ny_day,
                "decisions": 0,
                "acceptedCandidates": 0,
                "rejections": {},
                "byStrategy": {},
            }

        diagnostics["decisions"] = int(diagnostics.get("decisions", 0)) + 1
        if candidate:
            diagnostics["acceptedCandidates"] = int(diagnostics.get("acceptedCandidates", 0)) + 1

        rejection_counts = diagnostics.setdefault("rejections", {})
        strategy_counts = diagnostics.setdefault("byStrategy", {}).setdefault(
            strategy,
            {"decisions": 0, "acceptedCandidates": 0, "rejections": {}},
        )
        strategy_counts["decisions"] = int(strategy_counts.get("decisions", 0)) + 1
        if candidate:
            strategy_counts["acceptedCandidates"] = int(strategy_counts.get("acceptedCandidates", 0)) + 1

        strategy_rejections = strategy_counts.setdefault("rejections", {})
        for symbol, reasons in (rejections or {}).items():
            values = reasons if isinstance(reasons, (list, tuple)) else [reasons]
            for raw_reason in values:
                reason = str(raw_reason or "UNKNOWN_REJECTION")
                rejection_counts[reason] = int(rejection_counts.get(reason, 0)) + 1
                strategy_rejections[reason] = int(strategy_rejections.get(reason, 0)) + 1

        candidate_summary = None
        if candidate:
            candidate_summary = {
                "symbol": candidate.get("symbol"),
                "route": candidate.get("route"),
                "basisBps": candidate.get("basisBps"),
                "signalBasisBps": candidate.get("signalBasisBps"),
            }
        diagnostics["lastDecision"] = {
            "at": legacy.base.now_ms(),
            "strategy": strategy,
            "window": window,
            "candidate": candidate_summary,
        }
        self.state["v52GateDiagnostics"] = diagnostics
        self.save()
        self.log(
            "v52-gate-diagnostics",
            strategy=strategy,
            window=window,
            candidate=candidate_summary,
            dailyDecisions=diagnostics["decisions"],
            dailyAcceptedCandidates=diagnostics["acceptedCandidates"],
            dailyRejections=dict(sorted(rejection_counts.items())),
            v50MinimumEntryBasisBps=V50_MIN_ENTRY_BASIS_BPS,
            v50MinimumNetEdgeBps=V50_MIN_NET_EDGE_BPS,
            ordersSent=False,
        )

    def gross_snapshot(self) -> dict:
        """Use authenticated full-universe positions for the final V52 gross check."""
        if not self.live:
            return super().gross_snapshot()
        return self.gross_snapshot_from_rows(self.account_info(), self.aster.positions())

    def open_basis_position(self, slot: str, candidate: dict, target_gross: float) -> bool:
        # New stock exposure is P2. If a simultaneous P1 close/protection action
        # wins arbitration, ordinary contention skips this entry instead of
        # becoming a fatal tick / Kill Switch event.
        with self._account_critical(priority=2, wait_seconds=1.0, required=False) as acquired:
            if not acquired:
                self.log("v52-entry-skipped-account-priority", slot=slot, priority=2, ordersSent=False)
                return False

            equity = self.portfolio_equity()
            if not equity > 0:
                raise RuntimeError("V52_ACCOUNT_EQUITY_INVALID_BEFORE_RESERVATION")
            snapshot = self.gross_snapshot()
            lock_document = self.account_order_lock._owned()
            active_reservations = [
                row for row in lock_document.get("reservations", [])
                if row.get("status") == "RESERVED"
            ]
            reserved_gross = active_reserved_gross(lock_document)
            reserved_stock_gross = sum(
                legacy.base.finite(row.get("gross"))
                for row in active_reservations
                if str(row.get("strategyId") or "").startswith("V52:")
            )
            pending = self.state.get("pendingOrder")
            pending_gross = legacy.base.finite(pending.get("targetGross")) if isinstance(pending, dict) else 0.0
            global_before = snapshot["totalGross"] + reserved_gross + pending_gross
            stock_before = snapshot["stockGross"] + reserved_stock_gross + pending_gross
            global_after = global_before + float(target_gross)
            stock_after = stock_before + float(target_gross)
            self._last_reservation_telemetry = {
                "globalGrossBeforeReservation": global_before,
                "globalGrossAfterReservation": global_after,
                "stockGrossBeforeReservation": stock_before,
                "stockGrossAfterReservation": stock_after,
                "currentReservedGross": reserved_gross,
                "pendingReservations": pending_gross,
            }
            if pending_gross > EPSILON:
                self.log(
                    "v52-order-blocked",
                    slot=slot,
                    symbol=candidate.get("symbol"),
                    reason="UNRESOLVED_PENDING_ORDER",
                    orderBlockedReason="UNRESOLVED_PENDING_ORDER",
                    orderSendAttempted=False,
                    **self._last_reservation_telemetry,
                )
                return False
            if global_after > self.portfolio_gross_cap + self.gross_tolerance:
                self.log(
                    "v52-order-blocked",
                    slot=slot,
                    symbol=candidate.get("symbol"),
                    reason="INSUFFICIENT_AVAILABLE_GROSS",
                    orderBlockedReason="INSUFFICIENT_AVAILABLE_GROSS",
                    orderSendAttempted=False,
                    **self._last_reservation_telemetry,
                )
                return False
            if stock_after > self.stock_gross_cap + self.gross_tolerance:
                self.log(
                    "v52-order-blocked",
                    slot=slot,
                    symbol=candidate.get("symbol"),
                    reason="INSUFFICIENT_AVAILABLE_STOCK_GROSS",
                    orderBlockedReason="INSUFFICIENT_AVAILABLE_STOCK_GROSS",
                    orderSendAttempted=False,
                    **self._last_reservation_telemetry,
                )
                return False
            symbol = str(candidate.get("symbol") or "").upper()
            open_side = str(candidate.get("side") or "").upper()
            reservation_side = "LONG" if open_side == "BUY" else "SHORT" if open_side == "SELL" else ""
            if not symbol or not reservation_side:
                raise RuntimeError("V52_RESERVATION_INPUT_INVALID")
            reservation = self.account_order_lock.reserve(
                f"V52:{slot}",
                symbol,
                reservation_side,
                float(target_gross),
                float(target_gross) * float(equity),
            )
            try:
                # Inherited path now executes while the reservation is visible:
                # fresh gross/margin check -> durable pendingOrder -> send ->
                # result/reconcile. A hard crash leaves both lock+reservation and
                # pending evidence for dead-PID recovery.
                opened = super().open_basis_position(slot, candidate, target_gross)
                if opened and slot == V50_RANK2_SLOT:
                    position = self.positions().get(slot)
                    if position:
                        local = dt.datetime.now(tz=legacy.base.NY)
                        next_checkpoint = local.replace(minute=30, second=0, microsecond=0) + dt.timedelta(hours=1)
                        maximum_exit = min(
                            local + dt.timedelta(hours=legacy.legacy.V50_MAX_HOLDING_HOURS),
                            local.replace(hour=15, minute=30, second=0, microsecond=0),
                        )
                        position.update({
                            "checksCompleted": 0,
                            "nextCheckpointAt": int(next_checkpoint.timestamp() * 1000),
                            "maximumExitAt": int(maximum_exit.timestamp() * 1000),
                            "candidateRank": candidate.get("candidateRank", 2),
                            "qualifiedRank": candidate.get("qualifiedRank", 2),
                        })
                        self.save()
                return opened
            finally:
                # On a live Python exception (not a hard crash), release the
                # reservation before releasing the enclosing account lock.
                try:
                    self.account_order_lock.release_reservation(reservation["reservationId"])
                except Exception as error:
                    self.log("v52-reservation-release-failed", slot=slot, error=str(error))
                    raise

    def close_slot(self, slot: str, reason: str) -> None:
        # Risk-reducing exits are highest priority and retry boundedly rather
        # than yielding to a new exposure request. No positive-gross reservation
        # is needed for reduce-only work.
        with self._account_critical(priority=1, wait_seconds=30.0, required=True):
            was_active = slot in self.positions()
            result = super().close_slot(slot, reason)
            if was_active and slot == V50_RANK2_SLOT and slot not in self.positions():
                self.state["v50CompletedTrades"] = int(self.state.get("v50CompletedTrades", 0)) + 1
                self.save()
            return result

    def flatten_all(self, reason: str) -> None:
        # Keep cancellation + all reduce-only close operations serialized as one
        # P1 critical section. close_slot() is re-entrant here.
        with self._account_critical(priority=1, wait_seconds=30.0, required=True):
            return super().flatten_all(reason)

    def v96_requires_margin(self) -> bool:
        return False

    def manage_positions(self, rows: dict) -> None:
        super().manage_positions(rows)
        rank2 = self.positions().get(V50_RANK2_SLOT)
        if not rank2:
            return
        now = legacy.base.now_ms()
        next_checkpoint = int(rank2.get("nextCheckpointAt") or 0)
        if now < next_checkpoint:
            return
        if now > next_checkpoint + 5 * 60_000:
            self.close_slot(V50_RANK2_SLOT, "MISSED_CHECKPOINT_FAIL_CLOSED")
            return
        symbol = str(rank2["symbol"])
        if symbol not in rows:
            self.close_slot(V50_RANK2_SLOT, "MISSING_REFERENCE_FAIL_CLOSED")
            return
        aster, _xyz, reference = rows[symbol]
        basis = (aster.mid / reference.price - 1.0) * 10_000.0
        entry = legacy.base.finite(rank2["entryBasisBps"])
        if abs(basis) <= legacy.legacy.V50_CONVERGENCE_BPS or basis * entry <= 0:
            self.close_slot(V50_RANK2_SLOT, "BASIS_CONVERGED")
            return
        if abs(basis) >= legacy.legacy.V50_BASIS_STOP_MULTIPLE * abs(entry):
            self.close_slot(V50_RANK2_SLOT, "BASIS_STOP")
            return
        checks = int(rank2.get("checksCompleted", 0)) + 1
        if checks >= legacy.legacy.V50_MAX_HOLDING_HOURS or now >= int(rank2.get("maximumExitAt") or 0) or legacy.base.ny_seconds() >= legacy.base.clock("15:30:00"):
            self.close_slot(V50_RANK2_SLOT, "TIME_3H")
            return
        rank2["checksCompleted"] = checks
        rank2["nextCheckpointAt"] = next_checkpoint + 60 * 60_000
        self.save()
        self.log("v50-checkpoint-hold", slot=V50_RANK2_SLOT, symbol=symbol, basisBps=basis, checksCompleted=checks)

    def gross_snapshot_from_rows(self, account: dict, rows: list[dict]) -> dict:
        equity = legacy.base.finite(account.get("totalMarginBalance"))
        if equity <= 0:
            raise RuntimeError("Aster totalMarginBalance must be positive")
        crypto_symbols = set(V12_CRYPTO_SYMBOLS)
        stock_symbols = set(legacy.base.ASTER_SYMBOL.values())
        crypto_notional = 0.0
        stock_notional = 0.0
        for row in rows:
            symbol = str(row.get("symbol") or "").upper()
            quantity = abs(legacy.base.finite(row.get("positionAmt")))
            price = legacy.base.finite(row.get("markPrice") or row.get("entryPrice"))
            if quantity <= EPSILON:
                continue
            notional = quantity * price
            if symbol in crypto_symbols:
                crypto_notional += notional
            elif symbol in stock_symbols:
                stock_notional += notional
            else:
                raise RuntimeError(f"Unknown non-flat Aster symbol requires manual review: {symbol}")
        return {
            "equityUsd": equity,
            "cryptoNotionalUsd": crypto_notional,
            "stockNotionalUsd": stock_notional,
            "cryptoGross": crypto_notional / equity,
            "stockGross": stock_notional / equity,
            "totalGross": (crypto_notional + stock_notional) / equity,
        }

    def tick(self) -> None:
        """Evaluate V52 on its stock-risk contract and preserve every signal gate.

        The inherited V52 implementation incorrectly returned before market-data
        and signal evaluation whenever the V12+PENGU shared *crypto* daily-risk
        file was missing, stale or tripped. That file covers only V12 and PENGU.
        V52 keeps its own daily-loss latch, the shared Kill Switch, full-universe
        gross checks and the fresh Margin Guard at order time.
        """
        self.reset_days()
        kill = self.kill_switch()
        if kill:
            self.flatten_all(str(kill.get("reason") or "KILL_SWITCH"))
            return
        if self.enforce_daily_loss():
            latch = self.state.get("v52StrategyDailyLossLatch") or {}
            self.log(
                "v52-entry-held-v52-daily-risk",
                reason=latch.get("tripReason") or "V52_DAILY_RISK_BLOCKED",
                failClosed=bool(latch.get("failClosed")),
                ordersSent=False,
            )
            return
        if self.kill_switch():
            self.flatten_all("DAILY_LOSS")
            return

        self.update_history()
        local = dt.datetime.now(tz=legacy.base.NY)
        if local.weekday() >= 5:
            return
        sec = legacy.base.ny_seconds(local)
        if not self.positions() and not (legacy.base.clock("09:59:50") <= sec <= legacy.base.clock("15:30:30")):
            return

        rows = self.books_and_refs()
        self._record_reference_active()
        if self.v96_requires_margin():
            if self.positions():
                self.flatten_all("V96_MARGIN_PRIORITY")
            return

        if not self.state.get("v11SignalBasis") and legacy.base.clock("09:59:55") <= sec <= legacy.base.clock("10:00:20"):
            self.record_v11_signal(rows)
        for window in V50_WINDOWS:
            entry = legacy.base.clock(window + ":00")
            if entry - 10 <= sec < entry:
                self.capture_v50_signal(window, rows)

        self.manage_positions(rows)

        if not self.state.get("v11Attempted") and legacy.base.clock("10:30:00") <= sec <= legacy.base.clock("10:30:20"):
            self.state["v11Attempted"] = True
            self.save()
            gross, snapshot = self.available_slot_gross(V11_SLOT)
            self.v11_notional = gross * snapshot["equityUsd"]
            candidate, rejections = (
                (None, {"ROUTER": ["NO_GROSS_CAPACITY"]})
                if gross <= 0
                else self.v11_candidates(rows)
            )
            self.log(
                "v52-v11-decision",
                candidate=candidate,
                rejections=rejections,
                allocatedGross=gross,
                grossSnapshot=snapshot,
            )
            self._record_gate_diagnostics(V11_SLOT, candidate, rejections)
            if candidate:
                self.open_basis_position(V11_SLOT, candidate, gross)

        attempted = self.state.setdefault("v50Attempted", {})
        for window in V50_WINDOWS:
            entry = legacy.base.clock(window + ":00")
            if attempted.get(window) or not (entry <= sec <= entry + 20):
                continue
            attempted[window] = True
            self.save()
            if int(self.state.get("v50CompletedTrades", 0)) >= legacy.legacy.V50_MAX_DAILY_TRADES or V50_SLOT in self.positions():
                continue
            gross, snapshot = self.available_slot_gross(V50_SLOT)
            notional = gross * snapshot["equityUsd"]
            candidate, rejections = (
                (None, {"ROUTER": ["NO_GROSS_CAPACITY"]})
                if gross <= 0
                else self.v50_candidate(window, rows, notional)
            )
            self.log(
                "v52-v50-decision",
                window=window,
                candidate=candidate,
                rejections=rejections,
                allocatedGross=gross,
                grossSnapshot=snapshot,
            )
            self._record_gate_diagnostics(V50_SLOT, candidate, rejections, window=window)
            if candidate:
                self.open_basis_position(V50_SLOT, candidate, gross)


def self_test() -> None:
    engine = object.__new__(V12AwareV52AsterOnlyEngine)
    account = {"totalMarginBalance": "1000"}
    rows = [
        {"symbol": "LINKUSDT", "positionAmt": "2", "markPrice": "20"},
        {"symbol": "PENGUUSDT", "positionAmt": "100", "markPrice": "0.10"},
        {"symbol": "METAUSDT", "positionAmt": "1", "markPrice": "500"},
        {"symbol": "UNKNOWNUSDT", "positionAmt": "0", "markPrice": "1"},
    ]
    snapshot = engine.gross_snapshot_from_rows(account, rows)
    assert abs(snapshot["cryptoNotionalUsd"] - 50.0) < EPSILON
    assert abs(snapshot["stockNotionalUsd"] - 500.0) < EPSILON
    assert abs(snapshot["totalGross"] - 0.55) < EPSILON
    assert engine.v96_requires_margin() is False
    assert V50_MIN_ENTRY_BASIS_BPS == 65.0
    assert V50_MIN_NET_EDGE_BPS == 5.0
    assert V50_RANK1_REQUESTED_GROSS == 1.0
    assert V50_RANK2_REQUESTED_GROSS == 0.5
    assert V50_MAX_CONCURRENT_POSITIONS == 2
    assert V50_MAX_DAILY_ENTRIES == 3
    assert legacy.legacy.V50_MIN_ENTRY_BASIS_BPS == 65.0
    assert legacy.legacy.V50_MIN_NET_EDGE_BPS == 5.0
    try:
        engine.gross_snapshot_from_rows(account, rows + [{"symbol": "UNKNOWNUSDT", "positionAmt": "1", "markPrice": "1"}])
    except RuntimeError as error:
        assert "Unknown non-flat Aster symbol" in str(error)
    else:
        raise AssertionError("Unknown non-flat symbols must fail closed")

    class FakeAster:
        def positions(self):
            return rows

    engine.live = True
    engine.aster = FakeAster()
    engine.account_info = lambda: account
    live_snapshot = engine.gross_snapshot()
    assert abs(live_snapshot["cryptoNotionalUsd"] - 50.0) < EPSILON
    assert abs(live_snapshot["stockNotionalUsd"] - 500.0) < EPSILON

    class FakeAccountLock:
        def __init__(self):
            self.acquires: list[str] = []
            self.releases = 0

        def acquire(self, owner_id=None):
            self.acquires.append(str(owner_id))
            return True

        def release(self):
            self.releases += 1

    fake = FakeAccountLock()
    engine.mode = "paper"
    engine.account_order_lock = fake
    engine._account_critical_depth = 0
    with engine._account_critical(priority=1, wait_seconds=0, required=True):
        with engine._account_critical(priority=1, wait_seconds=0, required=True):
            assert engine._account_critical_depth == 2
    assert len(fake.acquires) == 1
    assert ":P1:" in fake.acquires[0]
    assert fake.releases == 1
    assert engine._account_critical_depth == 0

    diagnostics_log = []
    engine.state = {"nyDay": "2026-08-24"}
    engine.save = lambda: None
    engine.log = lambda event, **payload: diagnostics_log.append((event, payload))
    engine._record_gate_diagnostics(
        V50_SLOT,
        None,
        {"META": ["SPREAD_OVER_20", "DEPTH_BELOW_2X"], "MSFT": ["SPREAD_OVER_20"]},
        window="11:30",
    )
    diag = engine.state["v52GateDiagnostics"]
    assert diag["decisions"] == 1
    assert diag["acceptedCandidates"] == 0
    assert diag["rejections"]["SPREAD_OVER_20"] == 2
    assert diag["rejections"]["DEPTH_BELOW_2X"] == 1
    assert diagnostics_log[-1][0] == "v52-gate-diagnostics"

    # A missing/stale V12+PENGU crypto-risk document must no longer stop V52
    # before V52 market-data/signal processing. This is an offline no-order test.
    progress = {"history": 0}
    engine.live = True
    engine.state = {}
    engine.reset_days = lambda: None
    engine.kill_switch = lambda: None
    engine.flatten_all = lambda _reason: None
    engine.enforce_daily_loss = lambda: False
    engine.update_history = lambda: progress.__setitem__("history", progress["history"] + 1)
    engine.positions = lambda: {}
    engine.tick()
    assert progress["history"] == 1

    assert len(V12_CRYPTO_SYMBOLS) == 15
    assert V50_WINDOWS == ("11:30", "12:30", "13:30")
    print("V12-aware V52 live engine self-test: PASS")


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
    runner = V12AwareV52AsterOnlyEngine(args.mode)
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
