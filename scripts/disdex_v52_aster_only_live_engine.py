from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import signal
from pathlib import Path

import disdex_v52_aster_only_legacy_engine as legacy
from disdex_runner_heartbeat import publish_heartbeat
from disdex_v52_heartbeat import V52HeartbeatMixin
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


class V52AsterOnlyEngine(V52HeartbeatMixin, legacy.V52AsterOnlyEngine):
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

    def available_slot_gross(self, slot: str):
        available, snapshot = super().available_slot_gross(slot)
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        strict_plan = plan_v52_stock_capacity(snapshot, available, slot_cap)
        accepted = min(max(0.0, available), strict_plan["acceptedGross"])
        return accepted, {**snapshot, "strictPortfolioPlan": strict_plan}

    def open_basis_position(self, slot: str, candidate: dict, target_gross: float) -> bool:
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
        return super().open_basis_position(slot, candidate, target_gross)

    def preflight(self, read_only: bool = False) -> dict:
        self._reset_heartbeat_cycle()
        try:
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
            outcome = self._heartbeat_after_tick()
            self._publish_v52_heartbeat(outcome[0], "preflight", str(checks.get("referenceHealth") or outcome[2] or "preflight"))
            return checks
        except Exception as error:
            outcome = getattr(self, "_heartbeat_outcome", None) or ("FAIL_CLOSED" if self.live else "UNKNOWN", "preflight-error", str(error))
            self._publish_v52_heartbeat(outcome[0], "preflight-error", outcome[2] or str(error))
            raise

def self_test() -> None:
    strict_planner_self_test()
    assert STRICT_CAPS.crypto_gross == 2.0
    assert STRICT_CAPS.stock_gross == 1.5
    assert STRICT_CAPS.total_gross == 2.5
    engine = object.__new__(V52AsterOnlyEngine)
    engine.crypto_gross_cap = 2.0
    engine.stock_gross_cap = 1.5
    engine.portfolio_gross_cap = 2.5
    engine.v11_gross_cap = 1.0
    engine.v50_gross_cap = 1.0
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
    assert abs(gross - 0.75) < EPSILON
    assert snapshot["strictPortfolioPlan"]["strictPortfolioPlannerActive"] is True
    assert transient_reference_error("iex_quote_stale META")
    assert not transient_reference_error("Managed Stock position reconciliation mismatch")
    blocked_target = Path(__file__).resolve() / "heartbeat.json"
    heartbeat_parent = blocked_target.parent
    temp_pattern = f".{blocked_target.name}.*.tmp"
    temp_files_before = set(heartbeat_parent.glob(temp_pattern))
    previous_path = os.environ.get("DISDEX_RUNNER_HEARTBEAT_PATH")
    os.environ["DISDEX_RUNNER_HEARTBEAT_PATH"] = str(blocked_target)
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            assert publish_heartbeat(
                runner_id="V52",
                mode="LIVE",
                live_enabled=True,
                safety_state="FAIL_CLOSED",
                last_decision="self-test",
                reason="health write failure must be best effort",
            ) is False
        assert set(heartbeat_parent.glob(temp_pattern)) == temp_files_before
    finally:
        if previous_path is None:
            os.environ.pop("DISDEX_RUNNER_HEARTBEAT_PATH", None)
        else:
            os.environ["DISDEX_RUNNER_HEARTBEAT_PATH"] = previous_path
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
