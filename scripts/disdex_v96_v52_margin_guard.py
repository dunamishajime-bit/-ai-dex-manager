from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import signal
import time
from pathlib import Path
from typing import Dict, List

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


def verify_managed_configuration(rows: List[dict]) -> Dict[str, dict]:
    by_symbol = {str(row.get("symbol") or "").upper(): row for row in rows}
    result: Dict[str, dict] = {}
    for symbol in MANAGED_SYMBOLS:
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
        return self.client._signed("GET", "/fapi/v4/account", {})

    def positions(self) -> List[dict]:
        return self.client.positions() if self.live else [
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

    def write_state(self, payload: dict) -> None:
        self.state_root.mkdir(parents=True, exist_ok=True)
        base.atomic_write_json(self.state_path, payload)
        self.state = payload

    def activate_shared_kill_switch(self, reason: str, decision: dict) -> None:
        existing = base.read_json(self.kill_switch_path, {}) or {}
        if existing.get("active"):
            return
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

    def evaluate_once(self, *, write_state: bool, allow_kill_switch: bool) -> dict:
        account = self.account_info()
        positions = self.positions()
        configuration = verify_managed_configuration(positions)
        snapshot = build_margin_risk_snapshot(account, positions, MANAGED_SYMBOLS)
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
            self.activate_shared_kill_switch(
                "Margin Guard triggered pre-liquidation managed stop-loss: "
                f"stage={payload['stage']}, marginRatio={payload['maintenanceMarginRatioPct']:.4f}%, "
                f"minimumLiquidationBuffer={payload['minimumLiquidationBufferPct']}",
                payload,
            )
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
            "ordersSent": False,
            "cancelSent": False,
            "positionChangesSent": False,
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
            self.activate_shared_kill_switch(
                "Margin Guard lost authenticated risk data while managed positions were active",
                payload,
            )
        return payload

    def require_healthy(self, *, write_state: bool, allow_kill_switch: bool) -> dict:
        decision = self.evaluate_once(write_state=write_state, allow_kill_switch=allow_kill_switch)
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
    print("V96/V52 adaptive Margin Guard self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("paper", "live"), default="paper")
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--preflight-readonly", action="store_true")
    parser.add_argument("--preorder-check", action="store_true")
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
