from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import signal
import time
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Optional, Set, Tuple

import disdex_v13d_v11eq_stock_live_engine as base
from disdex_v96_v52_margin_risk_policy import (
    HEALTHY_POLL_INTERVAL_MS,
    WARNING_POLL_INTERVAL_MS,
    build_margin_risk_snapshot,
    classify_margin_risk,
)
STRATEGY_ID = "DISDEX_V96_V52_SHARED_MARGIN_GUARD"
MANAGED_CRYPTO_SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT")
MANAGED_STOCK_SYMBOLS = tuple(base.ASTER_SYMBOL.values())
MANAGED_SYMBOLS = MANAGED_CRYPTO_SYMBOLS + MANAGED_STOCK_SYMBOLS
REQUIRED_LEVERAGE = 5
REQUIRED_MARGIN_TYPE = "cross"
DEFAULT_V12_STATE_PATH = "/var/lib/disdex/v12-x1-all/runner.json"
DEFAULT_Q102_STATE_PATH = "/var/lib/disdex/quality102-causal-v1/state.json"
EMERGENCY_FLATTEN_ATTEMPTS = 3
EMERGENCY_RECONCILIATION_DELAY_SECONDS = 1.0


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


def _normalized_symbol(value: object, label: str = "symbol") -> str:
    symbol = str(value or "").strip().upper()
    if not symbol or any(char.isspace() for char in symbol):
        raise RuntimeError(f"Margin Guard {label} is invalid: {value}")
    return symbol


def _state_symbols(path: str, expected_strategy_id: str, fields: Iterable[str]) -> Set[str]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except FileNotFoundError:
        return set()
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Margin Guard ownership state unavailable: {path}: {error}") from error
    if not isinstance(raw, dict):
        raise RuntimeError(f"Margin Guard ownership state is not an object: {path}")
    if raw.get("strategyId") != expected_strategy_id:
        raise RuntimeError(
            f"Margin Guard ownership state identity mismatch: {path}: "
            f"expected={expected_strategy_id}, got={raw.get('strategyId')}"
        )
    if str(raw.get("mode") or "").upper() not in {"", "LIVE"}:
        return set()

    symbols: Set[str] = set()

    def collect(value: object, label: str) -> None:
        if value is None:
            return
        values = value if isinstance(value, list) else [value]
        for index, item in enumerate(values):
            if not isinstance(item, dict):
                raise RuntimeError(f"Margin Guard ownership state entry is invalid: {path}:{label}[{index}]")
            if "symbol" in item:
                symbols.add(_normalized_symbol(item.get("symbol"), f"{label}[{index}].symbol"))

    for field in fields:
        collect(raw.get(field), field)
    return symbols


def resolve_managed_symbols(
    requested_symbol: Optional[str] = None,
    env: Optional[Mapping[str, str]] = None,
) -> Tuple[str, ...]:
    environment = os.environ if env is None else env
    symbols = {_normalized_symbol(symbol) for symbol in MANAGED_SYMBOLS}
    if requested_symbol:
        symbols.add(_normalized_symbol(requested_symbol, "requested symbol"))
    symbols.update(_state_symbols(
        str(environment.get("V12_X1_ALL_STATE_PATH") or DEFAULT_V12_STATE_PATH),
        "V12_X1.00_ALL",
        ("activePositions", "active", "pending"),
    ))
    q102_path = str(
        environment.get("QUALITY102_CAUSAL_V1_STATE_PATH")
        or environment.get("DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH")
        or DEFAULT_Q102_STATE_PATH
    )
    symbols.update(_state_symbols(
        q102_path,
        "QUALITY102_CAUSAL_V1",
        ("position", "pending"),
    ))
    return tuple(sorted(symbols))


def verify_managed_configuration(rows: List[dict], managed_symbols: Optional[Iterable[str]] = None) -> Dict[str, dict]:
    symbols = tuple(managed_symbols) if managed_symbols is not None else MANAGED_SYMBOLS
    by_symbol = {str(row.get("symbol") or "").upper(): row for row in rows}
    result: Dict[str, dict] = {}
    for symbol in symbols:
        row = by_symbol.get(symbol)
        if row is None:
            raise RuntimeError(f"Margin Guard position-risk row missing: {symbol}")
        leverage = int(base.finite(row.get("leverage")))
        margin_type = normalized_margin_type(row)
        if leverage != REQUIRED_LEVERAGE:
            raise RuntimeError(f"Margin Guard leverage mismatch for {symbol}: expected 5, got {leverage}")
        if margin_type != REQUIRED_MARGIN_TYPE:
            raise RuntimeError(f"Margin Guard margin type mismatch for {symbol}: expected cross, got {margin_type}")
        result[symbol] = {"leverage": leverage, "marginType": margin_type}
    return result


def active_managed_positions(rows: List[dict], managed_symbols: Optional[Iterable[str]] = None) -> List[dict]:
    managed = set(managed_symbols if managed_symbols is not None else MANAGED_SYMBOLS)
    return [
        row
        for row in rows
        if str(row.get("symbol") or "").upper() in managed
        and abs(base.finite(row.get("positionAmt"))) > 1e-12
    ]


def quantity_text_from_position(row: dict) -> str:
    raw = str(row.get("positionAmt") or "").strip()
    if not raw:
        raise RuntimeError(f"Position quantity is missing for {row.get('symbol')}")
    text = raw[1:] if raw.startswith("-") else raw
    if not text or base.finite(text) <= 0:
        raise RuntimeError(f"Position quantity is invalid for {row.get('symbol')}: {raw}")
    return text


class MarginGuard:
    def __init__(self, mode: str):
        self.mode = mode
        self.live = mode == "live"
        combined_root = Path(os.getenv(
            "DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT",
            ".runtime-state/disdex-v13d-v11eq-v96",
        )).resolve()
        self.state_root = Path(os.getenv(
            "DISDEX_V96_V52_MARGIN_GUARD_STATE_DIR",
            str(combined_root / "margin-risk"),
        )).resolve()
        self.state_path = self.state_root / f"guard-{mode}.json"
        self.emergency_evidence_path = self.state_root / "emergency-flatten-evidence.json"
        self.kill_switch_path = Path(os.getenv(
            "DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE",
            str(combined_root / "kill-switch.json"),
        )).resolve()
        self.lock = base.FileLock(
            self.state_root / f"guard-{mode}.lock",
            base.int_env("DISDEX_MARGIN_GUARD_LOCK_STALE_MS", 15 * 60_000),
        )
        self.client = base.AsterClient(self.live)
        self.stop_requested = False
        self.state = base.read_json(self.state_path, {}) or {}

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
        return self.client._signed("GET", "/fapi/v3/account", {})

    def managed_symbols(self, requested_symbol: Optional[str] = None) -> Tuple[str, ...]:
        return resolve_managed_symbols(requested_symbol=requested_symbol)

    def positions(self, managed_symbols: Optional[Iterable[str]] = None) -> List[dict]:
        return self.client.positions() if self.live else [
            {
                "symbol": symbol,
                "positionAmt": "0",
                "markPrice": "1",
                "liquidationPrice": "0",
                "leverage": "5",
                "marginType": "cross",
            }
            for symbol in (managed_symbols if managed_symbols is not None else self.managed_symbols())
        ]

    def write_state(self, payload: dict) -> None:
        self.state_root.mkdir(parents=True, exist_ok=True)
        base.atomic_write_shared_json(self.state_path, payload)
        self.state = payload

    def _write_emergency_evidence(self, payload: dict) -> None:
        self.state_root.mkdir(parents=True, exist_ok=True)
        base.atomic_write_shared_json(self.emergency_evidence_path, payload)

    def record_emergency_flatten_evidence(self, result: dict) -> dict:
        kill = base.read_json(self.kill_switch_path, {}) or {}
        activated_at = str(kill.get("activatedAt") or "")
        reason = str(kill.get("reason") or "")
        current_fills = list(result.get("fillResults") or [])
        remaining = list(result.get("remainingManagedPositions") or [])
        evidence = base.read_json(self.emergency_evidence_path, {}) or {}
        same_kill = (
            str(evidence.get("killActivatedAt") or "") == activated_at
            and str(evidence.get("killReason") or "") == reason
        )

        if current_fills:
            status = (
                "FLATTEN_COMPLETE_PENDING_STATE_RECONCILIATION"
                if not remaining
                else "FLATTEN_INCOMPLETE"
            )
            evidence = {
                "schemaVersion": 2,
                "strategyId": STRATEGY_ID,
                "status": status,
                "recordedAt": base.now_ms(),
                "killActivatedAt": activated_at,
                "killReason": reason,
                "fillResults": current_fills,
                "remainingManagedPositions": remaining,
                "stateReconciliation": None,
            }
            self._write_emergency_evidence(evidence)
            print(json.dumps({
                "event": "margin-guard-emergency-evidence",
                "status": status,
                "fillCount": len(current_fills),
                "remainingManagedPositionCount": len(remaining),
                "ordersSent": False,
                "cancelSent": False,
                "positionChangesSent": False,
            }, separators=(",", ":")), flush=True)
            return {
                "status": status,
                "fillCount": len(current_fills),
                "remainingManagedPositionCount": len(remaining),
            }

        if same_kill:
            reconciled = evidence.get("stateReconciliation")
            if evidence.get("status") == "RECONCILED" and isinstance(reconciled, dict):
                return reconciled
            return {
                "status": str(evidence.get("status") or "PENDING_STATE_RECONCILIATION"),
                "fillCount": len(evidence.get("fillResults") or []),
                "remainingManagedPositionCount": len(evidence.get("remainingManagedPositions") or []),
            }

        return {
            "status": "NO_EMERGENCY_FILL_EVIDENCE",
            "fillCount": 0,
            "remainingManagedPositionCount": 0,
        }

    def activate_shared_kill_switch(self, reason: str, decision: dict) -> bool:
        existing = base.read_json(self.kill_switch_path, {}) or {}
        if existing.get("active"):
            return False
        payload = {
            "active": True,
            "strategyId": "DISDEX_V35_STRONG_RESERVED_PENGU_V96",
            "combinedStrategyId": "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",
            "action": "FLATTEN_MANAGED",
            "reason": reason,
            "operator": "disdex-v96-v52-margin-guard",
            "activatedAt": dt.datetime.now(tz=dt.timezone.utc).isoformat(),
            "marginRisk": {
                "stage": decision.get("stage"),
                "maintenanceMarginRatioPct": decision.get("maintenanceMarginRatioPct"),
                "minimumLiquidationBufferPct": decision.get("minimumLiquidationBufferPct"),
                "nearestLiquidationSymbol": decision.get("nearestLiquidationSymbol"),
            },
        }
        self.kill_switch_path.parent.mkdir(parents=True, exist_ok=True)
        base.atomic_write_json(self.kill_switch_path, payload)
        print(json.dumps({
            "event": "margin-guard-shared-kill-switch-activated",
            "reason": reason,
            "ordersSent": False,
            "cancelSent": False,
            "positionChangesSent": False,
            **payload["marginRisk"],
        }, separators=(",", ":")), flush=True)
        return True

    def emergency_flatten_managed(self, decision: dict) -> dict:
        if not self.live:
            return {
                "status": "PAPER_NO_EXTERNAL_ACTION",
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

        managed_symbols = self.managed_symbols()
        managed = set(managed_symbols)
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
        for attempt in range(1, EMERGENCY_FLATTEN_ATTEMPTS + 1):
            remaining = active_managed_positions(self.positions(managed_symbols), managed_symbols)
            if not remaining:
                break
            for row in remaining:
                symbol = str(row.get("symbol") or "").upper()
                quantity = base.finite(row.get("positionAmt"))
                side = "SELL" if quantity > 0 else "BUY"
                client_id = f"margin-guard-{symbol.lower()}-{int(time.time())}"[:36]
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
                        "symbol": symbol,
                        "side": side,
                        "error": str(error),
                    })
            time.sleep(EMERGENCY_RECONCILIATION_DELAY_SECONDS)

        remaining = active_managed_positions(self.positions(managed_symbols), managed_symbols)
        result = {
            "status": "PASS" if not remaining else "FAILED_REMAINING_POSITIONS",
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
            "event": "margin-guard-emergency-flatten-result",
            **result,
        }, ensure_ascii=False, separators=(",", ":")), flush=True)
        if remaining:
            raise RuntimeError(
                "Margin Guard emergency reduce-only flatten did not clear every managed position: "
                + ",".join(str(row.get("symbol") or "") for row in remaining)
            )
        result["emergencyEvidence"] = self.record_emergency_flatten_evidence(result)
        return result

    def evaluate_once(self, *, write_state: bool, allow_kill_switch: bool, requested_symbol: Optional[str] = None) -> dict:
        managed_symbols = self.managed_symbols(requested_symbol)
        account = self.account_info()
        positions = self.positions(managed_symbols)
        configuration = verify_managed_configuration(positions, managed_symbols)
        snapshot = build_margin_risk_snapshot(account, positions, managed_symbols)
        decision = classify_margin_risk(snapshot, str(self.state.get("stage") or "HEALTHY"))
        now = base.now_ms()
        payload = {
            "schemaVersion": 1,
            "strategyId": STRATEGY_ID,
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
        if write_state:
            self.write_state(payload)
        print(json.dumps({
            "event": "margin-guard-check",
            "stage": payload["stage"],
            "ordersAllowed": payload["ordersAllowed"],
            "pollIntervalMs": payload["pollIntervalMs"],
            "maintenanceMarginRatioPct": payload["maintenanceMarginRatioPct"],
            "minimumLiquidationBufferPct": payload["minimumLiquidationBufferPct"],
            "nearestLiquidationSymbol": payload["nearestLiquidationSymbol"],
            "activeManagedPositionCount": payload["activeManagedPositionCount"],
            "readOnly": not write_state,
            "ordersSent": False,
            "cancelSent": False,
            "positionChangesSent": False,
        }, separators=(",", ":")), flush=True)
        if allow_kill_switch and payload["stage"] in {"REDUCE", "CRITICAL"}:
            reason = (
                "Margin Guard triggered pre-liquidation managed stop-loss: "
                f"stage={payload['stage']}, marginRatio={payload['maintenanceMarginRatioPct']:.4f}%, "
                f"minimumLiquidationBuffer={payload['minimumLiquidationBufferPct']}"
            )
            self.activate_shared_kill_switch(reason, payload)
            emergency = self.emergency_flatten_managed(payload)
            payload["emergencyFlatten"] = emergency
            payload["ordersSent"] = emergency["ordersSent"]
            payload["cancelSent"] = emergency["cancelSent"]
            payload["positionChangesSent"] = emergency["positionChangesSent"]
            payload["checkedAt"] = base.now_ms()
            payload["nextCheckAt"] = payload["checkedAt"] + WARNING_POLL_INTERVAL_MS
            if write_state:
                self.write_state(payload)
        return payload

    def handle_failure(self, error: Exception) -> dict:
        now = base.now_ms()
        failures = int(self.state.get("consecutiveFailures") or 0) + 1
        active_count = int(self.state.get("activeManagedPositionCount") or 0)
        previous_stage = str(self.state.get("stage") or "DATA_UNAVAILABLE")
        payload = {
            **self.state,
            "schemaVersion": 1,
            "strategyId": STRATEGY_ID,
            "mode": self.mode,
            "stage": "DATA_UNAVAILABLE",
            "ordersAllowed": False,
            "action": "BLOCK_NEW_ORDERS_AND_RETRY_1M",
            "pollIntervalMs": WARNING_POLL_INTERVAL_MS,
            "checkedAt": now,
            "nextCheckAt": now + WARNING_POLL_INTERVAL_MS,
            "consecutiveFailures": failures,
            "lastError": str(error),
            "ordersSent": bool(self.state.get("ordersSent")),
            "cancelSent": bool(self.state.get("cancelSent")),
            "positionChangesSent": bool(self.state.get("positionChangesSent")),
        }
        self.write_state(payload)
        print(json.dumps({
            "event": "margin-guard-data-unavailable",
            "error": str(error),
            "consecutiveFailures": failures,
            "previousStage": previous_stage,
            "activeManagedPositionCount": active_count,
            "ordersAllowed": False,
        }, separators=(",", ":")), flush=True)
        if active_count > 0 and (failures >= 2 or previous_stage in {"WARNING", "REDUCE", "CRITICAL"}):
            reason = "Margin Guard lost authenticated risk data while managed positions were active"
            self.activate_shared_kill_switch(reason, payload)
            try:
                emergency = self.emergency_flatten_managed(payload)
                payload["emergencyFlatten"] = emergency
                payload["ordersSent"] = emergency["ordersSent"]
                payload["cancelSent"] = emergency["cancelSent"]
                payload["positionChangesSent"] = emergency["positionChangesSent"]
                self.write_state(payload)
            except Exception as flatten_error:
                payload["emergencyFlattenError"] = str(flatten_error)
                self.write_state(payload)
        return payload

    def require_healthy(self, *, write_state: bool, allow_kill_switch: bool, requested_symbol: Optional[str] = None) -> dict:
        decision = self.evaluate_once(write_state=write_state, allow_kill_switch=allow_kill_switch, requested_symbol=requested_symbol)
        if decision["stage"] != "HEALTHY":
            raise RuntimeError(
                f"Margin Guard requires HEALTHY account risk, got {decision['stage']}"
            )
        return decision

    def run(self, daemon: bool) -> None:
        self.lock.acquire()
        try:
            while not self.stop_requested:
                try:
                    decision = self.evaluate_once(write_state=True, allow_kill_switch=True)
                except Exception as error:
                    decision = self.handle_failure(error)
                if not daemon:
                    break
                interval = int(decision.get("pollIntervalMs") or WARNING_POLL_INTERVAL_MS)
                deadline = base.now_ms() + interval
                while not self.stop_requested and base.now_ms() < deadline:
                    time.sleep(min(1.0, max(0.0, (deadline - base.now_ms()) / 1000.0)))
        finally:
            self.lock.release()


def self_test() -> None:
    rows = [
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
    checked = verify_managed_configuration(rows)
    assert len(checked) == len(MANAGED_SYMBOLS)
    assert HEALTHY_POLL_INTERVAL_MS == 300_000
    assert WARNING_POLL_INTERVAL_MS == 60_000
    assert "DOGEUSDT" in resolve_managed_symbols(requested_symbol="DOGEUSDT")
    assert quantity_text_from_position({"symbol": "BTCUSDT", "positionAmt": "-0.123000"}) == "0.123000"
    assert len(active_managed_positions([
        {"symbol": "BTCUSDT", "positionAmt": "1"},
        {"symbol": "OTHER", "positionAmt": "1"},
        {"symbol": "ETHUSDT", "positionAmt": "0"},
    ])) == 1
    print("V96/V52 adaptive Margin Guard self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("paper", "live"), default="paper")
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--preflight-readonly", action="store_true")
    parser.add_argument("--preorder-check", action="store_true")
    parser.add_argument("--symbol")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    guard = MarginGuard(args.mode)
    signal.signal(signal.SIGINT, lambda *_: setattr(guard, "stop_requested", True))
    signal.signal(signal.SIGTERM, lambda *_: setattr(guard, "stop_requested", True))
    if args.preflight_readonly:
        print(json.dumps(
            guard.require_healthy(write_state=False, allow_kill_switch=False, requested_symbol=args.symbol),
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        return 0
    if args.preorder_check:
        print(json.dumps(
            guard.require_healthy(write_state=True, allow_kill_switch=True, requested_symbol=args.symbol),
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        return 0
    guard.run(args.daemon and not args.once)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
