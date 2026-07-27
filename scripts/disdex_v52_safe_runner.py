from __future__ import annotations

import inspect
import sys
import time
from typing import Any

import disdex_v52_aster_only_live_engine as engine
import disdex_v52_execution_safety_patch as safety


def install_postfill_aware_gross_recheck(cls: Any) -> None:
    """Avoid treating an already-filled position as a second proposed entry."""

    original = cls.recheck_entry_conditions

    def recheck(self: Any, candidate: dict, *args: Any, **kwargs: Any):
        pending = self.state.get("pendingOrder") or {}
        if (
            self.live
            and pending.get("action") == "OPEN"
            and safety._finite(candidate.get("expectedGross")) > 0
        ):
            symbol = str(candidate.get("symbol") or "")
            aster_symbol = engine.base.ASTER_SYMBOL.get(symbol)
            actual = (
                safety._finite(
                    self.managed_aster_positions().get(aster_symbol),
                )
                if aster_symbol
                else 0.0
            )
            if abs(actual) > 1e-12:
                postfill_candidate = dict(candidate)
                postfill_candidate["expectedGross"] = 0.0
                result = original(
                    self,
                    postfill_candidate,
                    *args,
                    **kwargs,
                )
                gross_snapshot = self.gross_snapshot()
                self.assert_gross_safe(gross_snapshot)
                result["grossSnapshot"] = gross_snapshot
                result["grossCheckMode"] = "POST_FILL_EXISTING_POSITION"
                self.log(
                    "entry-recheck-post-fill-gross",
                    symbol=symbol,
                    actualPositionQty=actual,
                    grossSnapshot=gross_snapshot,
                )
                return result
        return original(self, candidate, *args, **kwargs)

    cls.recheck_entry_conditions = recheck


def install_unknown_order_safe_run(cls: Any) -> None:
    """Preserve pending state when order/account truth cannot be established."""

    def run(self: Any, daemon: bool) -> None:
        self.lock.acquire()
        try:
            self.reset_days()
            self.reconcile()
            self.log(
                "v52-runner-start",
                strategyId=safety.STRATEGY_ID,
                safetyLayer="V52_EXECUTION_SAFETY_PATCH",
                caps={
                    "crypto": self.crypto_gross_cap,
                    "stock": self.stock_gross_cap,
                    "portfolio": self.portfolio_gross_cap,
                    "v11": self.v11_gross_cap,
                    "v50": self.v50_gross_cap,
                },
            )
            while not self.stop_requested:
                started = engine.base.now_ms()
                try:
                    self.tick()
                    if self.state.pop("transientDataFailure", None) is not None:
                        self.save()
                        self.log("v52-transient-data-recovered")
                except Exception as error:
                    kind = safety._error_kind(error)
                    self.log(
                        "v52-tick-error",
                        error=str(error),
                        errorKind=kind,
                    )
                    if self.live:
                        if (
                            kind in safety.TRANSIENT_KINDS
                            and safety._handle_transient_tick_error(
                                self,
                                error,
                                kind,
                            )
                        ):
                            pass
                        elif kind in {
                            "ORDER_EXECUTION_UNKNOWN",
                            "STATE_RECONCILIATION_FAILURE",
                            "SIGNED_API_FAILURE",
                        }:
                            # Do not clear pending state or submit blind flatten orders
                            # when the exchange/account truth is unknown.
                            self.state["manualReviewReason"] = (
                                f"V52 halted [{kind}]: {error}"
                            )
                            self.save()
                            self.activate_kill_switch(
                                f"V52 manual review required [{kind}]: {error}"
                            )
                            raise
                        else:
                            self.activate_kill_switch(
                                f"V52 fatal tick error [{kind}]: {error}"
                            )
                            self.flatten_all("FATAL_TICK_ERROR")
                            raise
                if not daemon:
                    break
                active = (
                    engine.base.clock("09:59:50")
                    <= engine.base.ny_seconds()
                    <= engine.base.clock("15:30:30")
                    or bool(self.positions())
                )
                interval = (
                    250
                    if active
                    else engine.base.int_env(
                        "DISDEX_STOCK_IDLE_INTERVAL_MS",
                        5000,
                    )
                )
                time.sleep(
                    max(0, interval - (engine.base.now_ms() - started))
                    / 1000.0
                )
        finally:
            self.lock.release()

    cls.run = run


def self_test() -> None:
    assert getattr(
        engine.V52AsterOnlyEngine,
        "_v52_execution_safety_installed",
        False,
    )
    recheck_source = inspect.getsource(
        engine.V52AsterOnlyEngine.recheck_entry_conditions,
    )
    run_source = inspect.getsource(engine.V52AsterOnlyEngine.run)
    assert "POST_FILL_EXISTING_POSITION" in recheck_source
    assert "ORDER_EXECUTION_UNKNOWN" in run_source
    assert "manualReviewReason" in run_source
    print("V52 patched safe runner self-test: PASS")


safety.install_class(engine.V52AsterOnlyEngine)
install_postfill_aware_gross_recheck(engine.V52AsterOnlyEngine)
install_unknown_order_safe_run(engine.V52AsterOnlyEngine)


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
        raise SystemExit(0)
    raise SystemExit(engine.main())
