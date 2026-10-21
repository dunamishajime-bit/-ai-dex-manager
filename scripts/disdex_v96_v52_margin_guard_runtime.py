from __future__ import annotations

import argparse
import fcntl
import json
import os
import signal
import time
from pathlib import Path
from typing import List

import disdex_v13d_v11eq_stock_live_engine as base
from disdex_v96_v52_margin_guard import (
    EMERGENCY_FLATTEN_ATTEMPTS,
    EMERGENCY_RECONCILIATION_DELAY_SECONDS,
    MANAGED_SYMBOLS,
    MarginGuard,
    active_managed_positions,
    quantity_text_from_position,
)
from disdex_v96_v52_margin_risk_policy import WARNING_POLL_INTERVAL_MS

EMERGENCY_LOCK_WAIT_SECONDS = 25.0


class SerializedMarginGuard(MarginGuard):
    def __init__(self, mode: str):
        super().__init__(mode)
        self.emergency_lock_path = self.state_root / "emergency-flatten.lock"

    def _acquire_emergency_lock(self):
        self.emergency_lock_path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.emergency_lock_path.open("a+")
        deadline = time.monotonic() + EMERGENCY_LOCK_WAIT_SECONDS
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return handle
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    handle.close()
                    raise RuntimeError("Timed out waiting for the serialized emergency-flatten lock")
                time.sleep(0.25)

    def emergency_flatten_managed(self, decision: dict) -> dict:
        if not self.live:
            return super().emergency_flatten_managed(decision)

        lock_handle = self._acquire_emergency_lock()
        try:
            active_positions = active_managed_positions(self.positions())
            if not active_positions:
                return {
                    "status": "CONCURRENT_FLATTEN_ALREADY_COMPLETED",
                    "cancelRequestsSent": 0,
                    "reduceOnlyOrdersSent": 0,
                    "remainingManagedPositions": [],
                    "ordersSent": False,
                    "cancelSent": False,
                    "positionChangesSent": False,
                }

            cancel_requests = 0
            reduce_only_orders = 0
            fill_results: list[dict] = []
            cancellation_errors: list[dict] = []
            order_errors: list[dict] = []
            managed = set(MANAGED_SYMBOLS)

            open_orders = self.client.open_orders()
            symbols_with_orders = sorted({
                str(row.get("symbol") or "").upper()
                for row in open_orders
                if str(row.get("symbol") or "").upper() in managed
            })
            for symbol in symbols_with_orders:
                try:
                    self.client.cancel_all(symbol)
                    cancel_requests += 1
                except Exception as error:
                    cancellation_errors.append({"symbol": symbol, "error": str(error)})

            remaining: List[dict] = []
            sequence = 0
            for attempt in range(1, EMERGENCY_FLATTEN_ATTEMPTS + 1):
                remaining = active_managed_positions(self.positions())
                if not remaining:
                    break
                for row in remaining:
                    sequence += 1
                    symbol = str(row.get("symbol") or "").upper()
                    quantity = base.finite(row.get("positionAmt"))
                    side = "SELL" if quantity > 0 else "BUY"
                    client_id = (
                        f"mg-{attempt}-{sequence}-{symbol.lower()}-{int(time.time() * 1000)}"
                    )[:36]
                    try:
                        raw = self.client._signed("POST", "/fapi/v3/order", {
                            "symbol": symbol,
                            "side": side,
                            "type": "MARKET",
                            "quantity": quantity_text_from_position(row),
                            "positionSide": "BOTH",
                            "reduceOnly": "true",
                            "newClientOrderId": client_id,
                            "newOrderRespType": "RESULT",
                        })
                        reduce_only_orders += 1
                        fill_results.append({
                            "attempt": attempt,
                            "sequence": sequence,
                            "symbol": symbol,
                            "side": side,
                            "clientOrderId": str(raw.get("clientOrderId") or client_id),
                            "orderId": raw.get("orderId"),
                            "status": str(raw.get("status") or "UNKNOWN"),
                            "executedQty": str(raw.get("executedQty") or "0"),
                            "averagePrice": str(raw.get("avgPrice") or "0"),
                        })
                    except Exception as error:
                        order_errors.append({
                            "attempt": attempt,
                            "sequence": sequence,
                            "symbol": symbol,
                            "side": side,
                            "clientOrderId": client_id,
                            "error": str(error),
                        })
                time.sleep(EMERGENCY_RECONCILIATION_DELAY_SECONDS)

            remaining = active_managed_positions(self.positions())
            result = {
                "status": "PASS" if not remaining else "FAILED_REMAINING_POSITIONS",
                "serializedEmergencyAction": True,
                "stage": decision.get("stage"),
                "maintenanceMarginRatioPct": decision.get("maintenanceMarginRatioPct"),
                "minimumLiquidationBufferPct": decision.get("minimumLiquidationBufferPct"),
                "cancelRequestsSent": cancel_requests,
                "reduceOnlyOrdersSent": reduce_only_orders,
                "fillResults": fill_results,
                "cancellationErrors": cancellation_errors,
                "orderErrors": order_errors,
                "remainingManagedPositions": [
                    {
                        "symbol": str(row.get("symbol") or "").upper(),
                        "positionAmt": str(row.get("positionAmt") or "0"),
                        "markPrice": str(row.get("markPrice") or "0"),
                        "liquidationPrice": str(row.get("liquidationPrice") or "0"),
                    }
                    for row in remaining
                ],
                "ordersSent": reduce_only_orders > 0,
                "cancelSent": cancel_requests > 0,
                "positionChangesSent": reduce_only_orders > 0,
            }
            print(json.dumps({
                "event": "serialized-margin-guard-emergency-flatten-result",
                **result,
            }, ensure_ascii=False, separators=(",", ":")), flush=True)
            if remaining:
                raise RuntimeError(
                    "Serialized Margin Guard emergency flatten left managed positions: "
                    + ",".join(str(row.get("symbol") or "") for row in remaining)
                )
            return result
        finally:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
            lock_handle.close()

    def _kill_switch_requests_flatten(self) -> bool:
        row = base.read_json(self.kill_switch_path, {}) or {}
        return row.get("active") is True and row.get("action") == "FLATTEN_MANAGED"

    def _flatten_for_existing_kill_switch(self) -> dict:
        decision = base.read_json(self.state_path, {}) or {
            "stage": "KILL_SWITCH",
            "maintenanceMarginRatioPct": None,
            "minimumLiquidationBufferPct": None,
        }
        return self.emergency_flatten_managed(decision)

    def _wait_without_account_calls(self, interval_ms: int, *, interrupt_on_kill_switch: bool) -> bool:
        """Wait without authenticated API calls.

        Returns True when a newly active local Kill Switch should interrupt a healthy wait.
        """
        deadline = base.now_ms() + max(1_000, int(interval_ms))
        while not self.stop_requested and base.now_ms() < deadline:
            if interrupt_on_kill_switch and self._kill_switch_requests_flatten():
                return True
            remaining_seconds = max(0.0, (deadline - base.now_ms()) / 1000.0)
            time.sleep(min(1.0, remaining_seconds))
        return False

    def run(self, daemon: bool) -> None:
        self.lock.acquire()
        try:
            while not self.stop_requested:
                if self._kill_switch_requests_flatten():
                    try:
                        self._flatten_for_existing_kill_switch()
                    except Exception as error:
                        self.handle_failure(error)
                    if not daemon:
                        break
                    # Kill Switch state is local and latched. Do not tight-loop account APIs
                    # after managed positions have already been reconciled flat.
                    self._wait_without_account_calls(
                        WARNING_POLL_INTERVAL_MS,
                        interrupt_on_kill_switch=False,
                    )
                    continue

                try:
                    decision = self.evaluate_once(write_state=True, allow_kill_switch=True)
                except Exception as error:
                    decision = self.handle_failure(error)
                if not daemon:
                    break
                interval = int(decision.get("pollIntervalMs") or WARNING_POLL_INTERVAL_MS)
                self._wait_without_account_calls(
                    interval,
                    interrupt_on_kill_switch=True,
                )
        finally:
            self.lock.release()


def self_test() -> None:
    assert EMERGENCY_LOCK_WAIT_SECONDS < 30
    guard = object.__new__(SerializedMarginGuard)
    assert isinstance(guard, MarginGuard)
    assert hasattr(SerializedMarginGuard, "_wait_without_account_calls")
    print("V96/V52 serialized Margin Guard runtime self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("paper", "live"), default="paper")
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--emergency-once", action="store_true")
    parser.add_argument("--preflight-readonly", action="store_true")
    parser.add_argument("--preorder-check", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    guard = SerializedMarginGuard(args.mode)
    signal.signal(signal.SIGINT, lambda *_: setattr(guard, "stop_requested", True))
    signal.signal(signal.SIGTERM, lambda *_: setattr(guard, "stop_requested", True))
    if args.emergency_once:
        if not guard._kill_switch_requests_flatten():
            print(json.dumps({
                "status": "NO_ACTIVE_FLATTEN_KILL_SWITCH",
                "ordersSent": False,
                "cancelSent": False,
                "positionChangesSent": False,
            }, separators=(",", ":")))
            return 0
        result = guard._flatten_for_existing_kill_switch()
        print(json.dumps({
            "status": "EMERGENCY_FLATTEN_ONCE_COMPLETE",
            **result,
        }, ensure_ascii=False, separators=(",", ":")))
        return 0
    if args.preflight_readonly:
        print(json.dumps(
            guard.require_healthy(write_state=False, allow_kill_switch=False),
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        return 0
    if args.preorder_check:
        print(json.dumps(
            guard.require_healthy(write_state=True, allow_kill_switch=True),
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        return 0
    guard.run(args.daemon and not args.once)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
