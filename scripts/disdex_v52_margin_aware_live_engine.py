from __future__ import annotations

import argparse
import json
import os
import signal

import disdex_v52_margin_aware_legacy_engine as previous
from disdex_v52_heartbeat import V52HeartbeatMixin
from disdex_strict_portfolio_planner import (
    EPSILON,
    STRICT_CAPS,
    assert_strict_live_configuration,
    plan_v52_stock_capacity,
    self_test as strict_planner_self_test,
    validate_gross_snapshot,
)

base = previous.base
STRATEGY_ID = previous.STRATEGY_ID
V11_SLOT = previous.V11_SLOT
V50_SLOT = previous.V50_SLOT
HEALTHY_POLL_INTERVAL_MS = previous.HEALTHY_POLL_INTERVAL_MS
WARNING_POLL_INTERVAL_MS = previous.WARNING_POLL_INTERVAL_MS
ACTIVE_LOOP_INTERVAL_MS = previous.ACTIVE_LOOP_INTERVAL_MS
DAILY_LOSS_CHECK_INTERVAL_MS = previous.DAILY_LOSS_CHECK_INTERVAL_MS

STRICT_V12_SYMBOLS = {
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT",
    "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT",
    "AAVEUSDT", "NEARUSDT",
}
STRICT_PENGU_SYMBOLS = {"PENGUUSDT"}
STRICT_CRYPTO_SYMBOLS = STRICT_V12_SYMBOLS | STRICT_PENGU_SYMBOLS
STRICT_STOCK_SYMBOLS = set(base.ASTER_SYMBOL.values())


class MarginAwareV52AsterOnlyEngine(previous.MarginAwareV52AsterOnlyEngine):
    """Margin-aware V52 with strict BT #33404708902 gross parity enforced before every entry."""

    def __init__(self, mode: str):
        # Defaults are canonical for this strict release. Explicit legacy values
        # are not rewritten; they fail closed in assert_strict_live_configuration.
        os.environ.setdefault("DISDEX_V52_CRYPTO_GROSS_CAP", str(STRICT_CAPS.crypto_gross))
        os.environ.setdefault("DISDEX_V52_STOCK_GROSS_CAP", str(STRICT_CAPS.stock_gross))
        os.environ.setdefault("DISDEX_V52_PORTFOLIO_GROSS_CAP", str(STRICT_CAPS.total_gross))
        super().__init__(mode)
        self.crypto_gross_cap = STRICT_CAPS.crypto_gross
        self.stock_gross_cap = STRICT_CAPS.stock_gross
        self.portfolio_gross_cap = STRICT_CAPS.total_gross
        if self.live:
            assert_strict_live_configuration()

    def _assert_policy_configuration(self) -> None:
        for actual, expected, label in (
            (self.crypto_gross_cap, STRICT_CAPS.crypto_gross, "Crypto sleeve Gross"),
            (self.stock_gross_cap, STRICT_CAPS.stock_gross, "Stock sleeve Gross"),
            (self.portfolio_gross_cap, STRICT_CAPS.total_gross, "combined Portfolio Gross"),
        ):
            if abs(actual - expected) > EPSILON:
                raise RuntimeError(f"V52 strict {label} must be {expected}")
        if self.maximum_concurrent_stock_positions != 2:
            raise RuntimeError("V52 maximum concurrent Stock positions must be exactly 2")
        if self.required_initial_leverage != 5:
            raise RuntimeError("V52 managed-symbol leverage must be exactly 5x")
        if not 0 < self.maximum_initial_margin_fraction <= 0.70 + EPSILON:
            raise RuntimeError("Maximum initial-margin fraction must be no greater than 0.70")
        if not 0.20 - EPSILON <= self.minimum_available_balance_fraction < 1:
            raise RuntimeError("Minimum available-balance fraction must be at least 0.20")
        if self.minimum_second_stock_gross < 0.25 - EPSILON:
            raise RuntimeError("Second Stock position minimum Gross must be at least 0.25")

    def gross_snapshot_from_rows(self, account: dict, rows: list[dict]) -> dict:
        equity = base.finite(account.get("totalMarginBalance"))
        if equity <= 0:
            raise RuntimeError("Aster totalMarginBalance must be positive")
        crypto_notional = 0.0
        stock_notional = 0.0
        unknown_nonzero: list[str] = []
        for row in rows:
            symbol = str(row.get("symbol") or "").upper()
            quantity = abs(base.finite(row.get("positionAmt")))
            if quantity <= 1e-12:
                continue
            mark = base.finite(row.get("markPrice") or row.get("entryPrice"))
            if mark <= 0:
                raise RuntimeError(f"STRICT_PORTFOLIO_INVALID_MARK:{symbol}")
            notional = quantity * mark
            if symbol in STRICT_CRYPTO_SYMBOLS:
                crypto_notional += notional
            elif symbol in STRICT_STOCK_SYMBOLS:
                stock_notional += notional
            else:
                unknown_nonzero.append(symbol or "<missing>")
        if unknown_nonzero:
            raise RuntimeError("STRICT_PORTFOLIO_UNKNOWN_NONZERO_POSITION:" + ",".join(sorted(set(unknown_nonzero))))
        snapshot = {
            "equityUsd": equity,
            "cryptoNotionalUsd": crypto_notional,
            "stockNotionalUsd": stock_notional,
            "cryptoGross": crypto_notional / equity,
            "stockGross": stock_notional / equity,
            "totalGross": (crypto_notional + stock_notional) / equity,
        }
        validate_gross_snapshot(snapshot)
        return snapshot

    def available_slot_gross(self, slot: str):
        available, snapshot = super().available_slot_gross(slot)
        strict_snapshot = {
            "equityUsd": snapshot["equityUsd"],
            "cryptoGross": snapshot["cryptoGross"],
            "stockGross": snapshot["stockGross"],
            "totalGross": snapshot["totalGross"],
        }
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        strict_plan = plan_v52_stock_capacity(strict_snapshot, available, slot_cap)
        accepted = min(max(0.0, available), strict_plan["acceptedGross"])
        return accepted, {**snapshot, "strictPortfolioPlan": strict_plan}

    def open_basis_position(self, slot: str, candidate: dict, target_gross: float) -> bool:
        if self.live:
            decision = self.fresh_order_risk_check()
            if not decision.get("ordersAllowed"):
                self.log("v52-strict-final-preorder-margin-blocked", slot=slot, marginRisk=decision)
                return False
            snapshot = decision["gross"]
        else:
            snapshot = self.gross_snapshot()
        validate_gross_snapshot(snapshot)
        slot_cap = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
        strict_plan = plan_v52_stock_capacity(snapshot, target_gross, slot_cap)
        if strict_plan["status"] != "planned" or target_gross > strict_plan["acceptedGross"] + EPSILON:
            self.log(
                "v52-strict-final-preorder-capacity-blocked",
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
            gross = checks.get("marginGuard", {}).get("gross") or checks.get("gross")
            strict_snapshot = validate_gross_snapshot(gross)
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
            self._publish_v52_heartbeat(
                outcome[0],
                "preflight",
                str(checks.get("referenceHealth") or outcome[2] or "preflight"),
            )
            return checks
        except Exception as error:
            outcome = getattr(self, "_heartbeat_outcome", None)
            safety_state = (
                outcome[0]
                if outcome is not None and outcome[0] not in {"LIVE", "WAITING"}
                else ("FAIL_CLOSED" if self.live else "UNKNOWN")
            )
            self._publish_v52_heartbeat(safety_state, "preflight-error", str(error))
            raise

    def run(self, daemon: bool) -> None:
        self._reset_heartbeat_cycle()
        try:
            super().run(daemon)
        except Exception as error:
            outcome = getattr(self, "_heartbeat_outcome", None)
            if outcome is None or outcome[0] in {"LIVE", "WAITING"}:
                outcome = (
                    "FAIL_CLOSED" if self.live else "UNKNOWN",
                    "run-error",
                    str(error),
                )
            self._publish_v52_heartbeat(outcome[0], "run-error", str(error))
            raise
        finally:
            self._publish_stopped_heartbeat()


def _assert_margin_aware_entrypoint_mro() -> None:
    mro = MarginAwareV52AsterOnlyEngine.__mro__
    if mro.count(V52HeartbeatMixin) != 1:
        raise AssertionError("V52 margin-aware entrypoint must contain exactly one heartbeat mixin")
    if not issubclass(MarginAwareV52AsterOnlyEngine, V52HeartbeatMixin):
        raise AssertionError("V52 margin-aware entrypoint must inherit heartbeat behavior")


def self_test() -> None:
    _assert_margin_aware_entrypoint_mro()
    resolved_run_owner = next(
        (owner for owner in MarginAwareV52AsterOnlyEngine.__mro__ if "run" in owner.__dict__),
        None,
    )
    assert resolved_run_owner is MarginAwareV52AsterOnlyEngine
    assert MarginAwareV52AsterOnlyEngine.run is not previous.MarginAwareV52AsterOnlyEngine.run
    print("V52_MARGIN_AWARE_ENTRYPOINT_MRO_SELFTEST_PASS")
    strict_planner_self_test()
    engine = object.__new__(MarginAwareV52AsterOnlyEngine)
    engine.crypto_gross_cap = 2.0
    engine.stock_gross_cap = 1.5
    engine.portfolio_gross_cap = 2.5
    engine.maximum_concurrent_stock_positions = 2
    engine.required_initial_leverage = 5
    engine.maximum_initial_margin_fraction = 0.70
    engine.minimum_available_balance_fraction = 0.20
    engine.minimum_second_stock_gross = 0.25
    engine._assert_policy_configuration()
    snapshot = engine.gross_snapshot_from_rows(
        {"totalMarginBalance": "100"},
        [
            {"symbol": "LINKUSDT", "positionAmt": "1", "markPrice": "100"},
            {"symbol": "METAUSDT", "positionAmt": "0.5", "markPrice": "100"},
        ],
    )
    assert abs(snapshot["cryptoGross"] - 1.0) < EPSILON
    assert abs(snapshot["stockGross"] - 0.5) < EPSILON
    try:
        engine.gross_snapshot_from_rows(
            {"totalMarginBalance": "100"},
            [{"symbol": "UNKNOWNUSDT", "positionAmt": "1", "markPrice": "1"}],
        )
        raise AssertionError("Unknown nonzero positions must fail closed")
    except RuntimeError as error:
        assert "UNKNOWN_NONZERO_POSITION" in str(error)

    class _NoopLock:
        def acquire(self) -> None:
            return None

        def release(self) -> None:
            return None

    stop_engine = object.__new__(MarginAwareV52AsterOnlyEngine)
    stop_engine.live = True
    stop_engine.stop_requested = True
    stop_engine.lock = _NoopLock()
    stop_engine.reset_days = lambda: None
    stop_engine.reconcile = lambda: None
    stop_engine.log = lambda *args, **kwargs: None
    stop_engine._heartbeat_outcome = ("LIVE", "tick", "normal tick")
    stop_events: list[tuple[str, str, str]] = []
    stop_engine._publish_v52_heartbeat = lambda state, decision, reason: stop_events.append((state, decision, reason))
    stop_engine._reset_heartbeat_cycle = lambda: setattr(
        stop_engine,
        "_heartbeat_outcome",
        ("LIVE", "tick", "normal tick"),
    )
    MarginAwareV52AsterOnlyEngine.run(stop_engine, True)
    assert stop_events == [("WAITING", "stopped", "stop requested")]

    tick_engine = object.__new__(MarginAwareV52AsterOnlyEngine)
    tick_engine.live = True
    tick_engine.stop_requested = False
    tick_engine.lock = _NoopLock()
    tick_engine.reset_days = lambda: None
    tick_engine.reconcile = lambda: None
    tick_engine.log = lambda *args, **kwargs: None
    tick_events: list[tuple[str, str, str]] = []
    tick_engine._publish_v52_heartbeat = lambda state, decision, reason: tick_events.append((state, decision, reason))
    tick_engine.tick = lambda: tick_engine._publish_v52_heartbeat("LIVE", "tick", "normal tick")
    MarginAwareV52AsterOnlyEngine.run(tick_engine, False)
    assert ("LIVE", "tick", "normal tick") in tick_events

    preflight_engine = object.__new__(MarginAwareV52AsterOnlyEngine)
    preflight_engine.live = True
    preflight_events: list[tuple[str, str, str]] = []
    preflight_engine._publish_v52_heartbeat = lambda state, decision, reason: preflight_events.append(
        (state, decision, reason)
    )
    preflight_engine._reset_heartbeat_cycle = lambda: setattr(
        preflight_engine,
        "_heartbeat_outcome",
        ("LIVE", "tick", "normal tick"),
    )
    previous_preflight = previous.MarginAwareV52AsterOnlyEngine.preflight

    def injected_margin_preflight(self, read_only: bool = False) -> dict:
        raise RuntimeError("injected margin preflight failure")

    previous.MarginAwareV52AsterOnlyEngine.preflight = injected_margin_preflight
    try:
        try:
            MarginAwareV52AsterOnlyEngine.preflight(preflight_engine)
        except RuntimeError as error:
            assert str(error) == "injected margin preflight failure"
        else:
            raise AssertionError("Injected margin preflight must fail")
    finally:
        previous.MarginAwareV52AsterOnlyEngine.preflight = previous_preflight
    assert preflight_events == [("FAIL_CLOSED", "preflight-error", "injected margin preflight failure")]
    print("V52_STRICT_MARGIN_AWARE_SELFTEST_PASS")


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
    runner = MarginAwareV52AsterOnlyEngine(args.mode)
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
