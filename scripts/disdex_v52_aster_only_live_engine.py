from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys

import disdex_v52_aster_only_legacy_engine as legacy
from disdex_strict_portfolio_planner import (
    EPSILON,
    STRICT_CAPS,
    assert_strict_live_configuration,
    plan_v52_stock_capacity,
    self_test as strict_planner_self_test,
    validate_gross_snapshot,
)

base = legacy.base
STRATEGY_ID = legacy.STRATEGY_ID
LIVE_ACK = legacy.LIVE_ACK
STATE_SCHEMA_VERSION = legacy.STATE_SCHEMA_VERSION
V11_SLOT = legacy.V11_SLOT
V50_SLOT = legacy.V50_SLOT
V50_WINDOWS = legacy.V50_WINDOWS
V50_MIN_ENTRY_BASIS_BPS = legacy.V50_MIN_ENTRY_BASIS_BPS
V50_MAX_HOLDING_HOURS = legacy.V50_MAX_HOLDING_HOURS
V50_MAX_DAILY_TRADES = legacy.V50_MAX_DAILY_TRADES
V50_CONVERGENCE_BPS = legacy.V50_CONVERGENCE_BPS
V50_BASIS_STOP_MULTIPLE = legacy.V50_BASIS_STOP_MULTIPLE
V50_MAX_ADVERSE_BASIS_MOVE_BPS = legacy.V50_MAX_ADVERSE_BASIS_MOVE_BPS
V50_MAX_ROUND_TRIP_COST_BPS = legacy.V50_MAX_ROUND_TRIP_COST_BPS
V50_MIN_NET_EDGE_BPS = legacy.V50_MIN_NET_EDGE_BPS
transient_reference_error = legacy.transient_reference_error


class V52AsterOnlyEngine(legacy.V52AsterOnlyEngine):
    """V52 legacy execution/reconciliation with the strict BT #33404708902 planner gate."""

    def __init__(self, mode: str):
        super().__init__(mode)
        self.crypto_gross_cap = STRICT_CAPS.crypto_gross
        self.stock_gross_cap = STRICT_CAPS.stock_gross
        self.portfolio_gross_cap = STRICT_CAPS.total_gross
        if self.live:
            assert_strict_live_configuration()

    def assert_gross_safe(self, snapshot=None) -> None:
        row = snapshot or self.gross_snapshot()
        validate_gross_snapshot(row)

    def _v12_dynamic_marked_gross(self, snapshot: dict) -> float:
        if not self.live:
            return 0.0
        state_path = os.getenv("V12_X1_ALL_STATE_PATH", "/var/lib/disdex/v12-x1-all/runner.json")
        raw = base.read_json(state_path, None)
        if raw is None:
            return 0.0
        if not isinstance(raw, dict) or raw.get("strategyId") != "V12_X1.00_ALL":
            raise RuntimeError("V12_DYNAMIC_STATE_IDENTITY_INVALID")
        if raw.get("pending") is not None:
            raise RuntimeError("V12_DYNAMIC_STATE_PENDING_REQUIRES_RECONCILIATION")
        state_rows = raw.get("activePositions")
        if state_rows is None:
            state_rows = [raw["active"]] if isinstance(raw.get("active"), dict) else []
        if not isinstance(state_rows, list):
            raise RuntimeError("V12_DYNAMIC_STATE_ACTIVE_POSITIONS_INVALID")
        venue_rows = self.aster.positions()
        dynamic_notional = 0.0
        for state_row in state_rows:
            if not isinstance(state_row, dict):
                raise RuntimeError("V12_DYNAMIC_STATE_POSITION_INVALID")
            dynamic_qty = max(0.0, base.finite(state_row.get("dynamicQuantity")))
            if dynamic_qty <= EPSILON:
                continue
            symbol = str(state_row.get("symbol") or "").upper()
            total_qty = max(0.0, base.finite(state_row.get("quantity")))
            base_qty = max(0.0, base.finite(state_row.get("baseQuantity")))
            if not symbol or total_qty <= 0 or abs(base_qty + dynamic_qty - total_qty) > max(1e-8, total_qty * 0.001):
                raise RuntimeError("V12_DYNAMIC_STATE_QUANTITY_INVALID")
            matches = [
                row for row in venue_rows
                if str(row.get("symbol") or "").upper() == symbol
                and abs(base.finite(row.get("positionAmt"))) > EPSILON
            ]
            if len(matches) != 1:
                raise RuntimeError(f"V12_DYNAMIC_VENUE_POSITION_MISMATCH:{symbol}")
            actual_qty = abs(base.finite(matches[0].get("positionAmt")))
            if abs(actual_qty - total_qty) > max(1e-8, total_qty * 0.02):
                raise RuntimeError(f"V12_DYNAMIC_VENUE_QUANTITY_MISMATCH:{symbol}")
            mark = base.finite(matches[0].get("markPrice") or matches[0].get("entryPrice"))
            if mark <= 0:
                raise RuntimeError(f"V12_DYNAMIC_VENUE_MARK_INVALID:{symbol}")
            dynamic_notional += dynamic_qty * mark
        equity = base.finite(snapshot.get("equityUsd"))
        if equity <= 0:
            raise RuntimeError("V12_DYNAMIC_EQUITY_INVALID")
        return max(0.0, dynamic_notional / equity)

    def available_slot_gross(self, slot: str):
        available, snapshot = super().available_slot_gross(slot)
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        reclaimable = self._v12_dynamic_marked_gross(snapshot)
        planning_snapshot = {
            **snapshot,
            "cryptoGross": max(0.0, snapshot["cryptoGross"] - reclaimable),
            "totalGross": max(0.0, snapshot["totalGross"] - reclaimable),
        }
        provisional = min(
            slot_cap,
            max(0.0, self.stock_gross_cap - snapshot["stockGross"]),
            max(0.0, self.portfolio_gross_cap - planning_snapshot["totalGross"]),
        )
        strict_plan = plan_v52_stock_capacity(planning_snapshot, provisional, slot_cap)
        accepted = min(max(0.0, provisional), strict_plan["acceptedGross"])
        return accepted, {
            **snapshot,
            "v12DynamicReclaimGross": reclaimable,
            "strictPortfolioPlanningGross": planning_snapshot,
            "strictPortfolioPlan": strict_plan,
        }

    def _prepare_v12_dynamic_for_stock_entry(self, slot: str, target_gross: float) -> float:
        if not self.live:
            return target_gross
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        requested = min(max(0.0, base.finite(target_gross)), slot_cap)
        if requested <= EPSILON:
            return 0.0
        for attempt in range(3):
            snapshot = self.gross_snapshot()
            requested = min(
                requested,
                max(0.0, self.stock_gross_cap - snapshot["stockGross"]),
            )
            required = max(
                0.0,
                snapshot["totalGross"] + requested - self.portfolio_gross_cap,
            )
            if required <= max(EPSILON, self.gross_tolerance):
                return requested
            reclaimable = self._v12_dynamic_marked_gross(snapshot)
            if reclaimable <= max(EPSILON, self.gross_tolerance):
                return min(
                    requested,
                    max(0.0, self.portfolio_gross_cap - snapshot["totalGross"]),
                )
            trim_gross = min(required, reclaimable)
            tsx = os.getenv("DISDEX_TSX_BIN") or os.path.join(
                os.getcwd(), "node_modules", ".bin", "tsx"
            )
            script = os.getenv(
                "DISDEX_V12_DYNAMIC_TRIM_SCRIPT",
                "scripts/disdex-v12-dynamic-residual-trim.ts",
            )
            cause = f"V52_CORE|{slot}|{base.now_ms()}|{attempt}|{requested:.12f}"
            state_path = os.getenv("V12_X1_ALL_STATE_PATH", "/var/lib/disdex/v12-x1-all/runner.json")
            result = subprocess.run(
                [
                    tsx,
                    script,
                    "--caller",
                    "V52_CORE",
                    "--shared-lock-held",
                    "true",
                    "--gross",
                    f"{trim_gross:.12f}",
                    "--equity",
                    f"{snapshot['equityUsd']:.12f}",
                    "--cause",
                    cause,
                    "--state-path",
                    state_path,
                ],
                cwd=os.getcwd(),
                env=os.environ.copy(),
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
            if result.returncode != 0 or not lines:
                detail = result.stderr.strip() or result.stdout.strip() or "no-output"
                raise RuntimeError(f"V12_DYNAMIC_TRIM_HELPER_FAILED:rc={result.returncode}:{detail}")
            try:
                payload = json.loads(lines[-1])
            except json.JSONDecodeError as error:
                raise RuntimeError("V12_DYNAMIC_TRIM_HELPER_INVALID_JSON") from error
            if payload.get("status") == "blocked":
                raise RuntimeError(
                    f"V12_DYNAMIC_TRIM_HELPER_BLOCKED:{payload.get('message')}"
                )
            if payload.get("status") != "reduced" or base.finite(payload.get("trimmedGross")) <= EPSILON:
                break
            self.log(
                "v52-v12-dynamic-reduced-for-stock",
                slot=slot,
                attempt=attempt,
                requestedGross=requested,
                trim=payload,
            )
        final = self.gross_snapshot()
        return min(
            requested,
            max(0.0, self.stock_gross_cap - final["stockGross"]),
            max(0.0, self.portfolio_gross_cap - final["totalGross"]),
        )

    def require_fresh_preorder_margin_guard(self) -> None:
        if not self.live:
            return
        if not base.bool_env("DISDEX_V96_V52_PREORDER_MARGIN_GUARD_ENABLED", False):
            raise RuntimeError("V52 LIVE requires fresh pre-order Margin Guard")
        python = os.getenv("DISDEX_PYTHON_BIN") or sys.executable or "python3"
        script = os.getenv("DISDEX_V96_V52_MARGIN_GUARD_SCRIPT") or "scripts/disdex_v96_v52_margin_guard_runtime.py"
        result = subprocess.run(
            [python, script, "--mode", "live", "--preorder-check"],
            cwd=os.getcwd(),
            env=os.environ.copy(),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"V52 fresh pre-order Margin Guard failed: rc={result.returncode} stderr={result.stderr.strip()}")
        lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        if not lines:
            raise RuntimeError("V52 fresh pre-order Margin Guard returned no result")
        try:
            decision = json.loads(lines[-1])
        except json.JSONDecodeError as error:
            raise RuntimeError("V52 fresh pre-order Margin Guard returned invalid JSON") from error
        if decision.get("stage") != "HEALTHY" or decision.get("ordersAllowed") is not True:
            raise RuntimeError(f"V52 fresh pre-order Margin Guard blocked exposure: {decision}")

    def open_basis_position(self, slot: str, candidate: dict, target_gross: float) -> bool:
        if self.live:
            target_gross = self._prepare_quality102_for_stock_entry(slot, target_gross)
            target_gross = self._prepare_v12_dynamic_for_stock_entry(slot, target_gross)
        snapshot = self.gross_snapshot()
        self.assert_gross_safe(snapshot)
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        strict_plan = plan_v52_stock_capacity(snapshot, target_gross, slot_cap)
        if strict_plan["status"] != "planned" or target_gross > strict_plan["acceptedGross"] + EPSILON:
            self.log(
                "v52-strict-portfolio-capacity-blocked",
                slot=slot,
                requestedGross=target_gross,
                strictPortfolioPlan=strict_plan,
            )
            return False
        self.require_fresh_preorder_margin_guard()
        return super().open_basis_position(slot, candidate, target_gross)

    def preflight(self, read_only: bool = False) -> dict:
        checks = super().preflight(read_only=read_only)
        if self.live:
            assert_strict_live_configuration()
        strict_snapshot = validate_gross_snapshot(checks["gross"])
        checks.update({
            "strictPortfolioPlannerActive": True,
            "strictPortfolioGross": strict_snapshot,
            "strictPortfolioCaps": {
                "v12": STRICT_CAPS.v12_gross,
                "pengu": STRICT_CAPS.pengu_gross,
                "stock": STRICT_CAPS.stock_gross,
                "crypto": STRICT_CAPS.crypto_gross,
                "portfolio": STRICT_CAPS.total_gross,
            },
            "quality102LiveSelectorParity": False,
            "quality102LiveBlockedFailClosed": True,
        })
        return checks


def self_test() -> None:
    strict_planner_self_test()
    assert STRICT_CAPS.v12_base_gross == 1.5
    assert STRICT_CAPS.v12_gross == 2.0
    assert STRICT_CAPS.crypto_gross == 3.0
    assert STRICT_CAPS.stock_gross == 1.98
    assert STRICT_CAPS.stock_slot_gross == 1.64
    assert STRICT_CAPS.total_gross == 3.5
    engine = object.__new__(V52AsterOnlyEngine)
    engine.crypto_gross_cap = 3.0
    engine.stock_gross_cap = 1.98
    engine.portfolio_gross_cap = 3.5
    engine.v11_gross_cap = 1.64
    engine.v50_gross_cap = 1.64
    engine.gross_tolerance = 1e-6
    engine.live = False
    engine.state = {"positions": {}}
    engine.v96_requires_margin = lambda: False
    engine.positions = lambda: {}
    engine.gross_snapshot = lambda: {
        "equityUsd": 100.0,
        "cryptoNotionalUsd": 125.0,
        "stockNotionalUsd": 50.0,
        "cryptoGross": 1.25,
        "stockGross": 0.50,
        "totalGross": 1.75,
    }
    gross, snapshot = engine.available_slot_gross(V11_SLOT)
    assert abs(gross - 1.48) < EPSILON
    assert snapshot["strictPortfolioPlan"]["strictPortfolioPlannerActive"] is True

    engine.live = True
    engine._quality102_document = lambda: None
    engine._v12_dynamic_marked_gross = lambda _snapshot: 0.40
    engine.gross_snapshot = lambda: {
        "equityUsd": 100.0,
        "cryptoNotionalUsd": 290.0,
        "stockNotionalUsd": 50.0,
        "cryptoGross": 2.90,
        "stockGross": 0.50,
        "totalGross": 3.40,
    }
    reclaimed, reclaimed_snapshot = engine.available_slot_gross(V11_SLOT)
    assert abs(reclaimed - 0.50) < EPSILON
    assert abs(reclaimed_snapshot["v12DynamicReclaimGross"] - 0.40) < EPSILON

    assert transient_reference_error("iex_quote_stale META")
    assert not transient_reference_error("Managed Stock position reconciliation mismatch")
    print("V52_STRICT_ASTER_ONLY_SELFTEST_PASS")


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
    runner = V52AsterOnlyEngine(args.mode)
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
