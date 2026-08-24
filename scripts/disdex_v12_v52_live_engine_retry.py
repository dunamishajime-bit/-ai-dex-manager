from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import signal

import disdex_v12_v52_live_engine as current

legacy = current.legacy
V11_SLOT = current.V11_SLOT
V50_SLOT = current.V50_SLOT
V50_WINDOWS = current.V50_WINDOWS
V50_MIN_ENTRY_BASIS_BPS = current.V50_MIN_ENTRY_BASIS_BPS
V50_MIN_NET_EDGE_BPS = current.V50_MIN_NET_EDGE_BPS

V11_ENTRY_WINDOW_SECONDS = 20
V50_ENTRY_WINDOW_SECONDS = 20

# Retry only transient LIVE microstructure/data-quality rejects. Strategy rejects
# are final for the window so the research signal contract is not widened.
RETRYABLE_ENTRY_REASONS = frozenset({
    "STALE_DATA",
    "SOURCE_CLOCK_MISMATCH",
    "ROUND_TRIP_COST_OVER_60",
    "DEPTH_BELOW_2X",
    "SPREAD_OVER_20",
})

V50_REASON_ALIASES = {
    "BASIS_BELOW_75": f"BASIS_BELOW_{int(V50_MIN_ENTRY_BASIS_BPS)}",
    "NET_EDGE_BELOW_10": f"NET_EDGE_BELOW_{int(V50_MIN_NET_EDGE_BPS)}",
}


def canonicalize_v50_rejections(rejections: dict) -> dict:
    fixed = {}
    for symbol, reasons in (rejections or {}).items():
        values = reasons if isinstance(reasons, (list, tuple)) else [reasons]
        fixed[symbol] = [V50_REASON_ALIASES.get(str(reason), str(reason)) for reason in values]
    return fixed


def has_retryable_path(rejections: dict) -> bool:
    """True when at least one symbol is blocked only by transient LIVE reasons."""
    for reasons in (rejections or {}).values():
        values = [str(reason) for reason in (reasons if isinstance(reasons, (list, tuple)) else [reasons])]
        if values and all(reason in RETRYABLE_ENTRY_REASONS for reason in values):
            return True
    return False


def entry_action(candidate: dict | None, rejections: dict, now_second: int, window_end_second: int) -> str:
    if candidate:
        return "ATTEMPT_ORDER"
    if now_second < window_end_second and has_retryable_path(rejections):
        return "RETRY_WITHIN_WINDOW"
    return "FINAL_REJECT"


class RetryAwareV52AsterOnlyEngine(current.V12AwareV52AsterOnlyEngine):
    """Current V52 LIVE engine with fail-closed transient retry semantics.

    Signal capture times, entry windows, strategy thresholds and every safety
    gate are unchanged. The only behavioral change is that a transient
    microstructure reject does not consume the whole 20-second entry window on
    the first tick. The daemon may re-evaluate on its normal ~2-second loop until
    the existing window closes. Once an order-capable candidate exists, the
    window is consumed before any exchange-mutating path is entered, preventing
    duplicate sends.
    """

    def _retry_state(self) -> dict:
        ny_day = str(self.state.get("nyDay") or dt.datetime.now(tz=legacy.base.NY).date().isoformat())
        row = self.state.get("v52EntryRetry")
        if not isinstance(row, dict) or row.get("nyDay") != ny_day:
            row = {"nyDay": ny_day, "v11Attempts": 0, "v50Attempts": {}}
            self.state["v52EntryRetry"] = row
            self.save()
        return row

    def _record_retry(self, strategy: str, rejections: dict, *, window: str | None = None) -> None:
        state = self._retry_state()
        if strategy == V11_SLOT:
            state["v11Attempts"] = int(state.get("v11Attempts", 0)) + 1
            attempt = state["v11Attempts"]
        else:
            attempts = state.setdefault("v50Attempts", {})
            attempts[window] = int(attempts.get(window, 0)) + 1
            attempt = attempts[window]
        self.save()
        self.log(
            "v52-entry-window-retry",
            strategy=strategy,
            window=window,
            retryAttempt=attempt,
            retryableReasons=sorted(RETRYABLE_ENTRY_REASONS),
            observedRejections=rejections,
            ordersSent=False,
        )

    def v50_candidate(self, window: str, rows: dict, notional: float):
        signal = (self.state.get("v50SignalBasis") or {}).get(window) or {}
        if not signal:
            return None, {"ROUTER": ["MISSING_V50_SIGNAL_SNAPSHOT"]}
        candidate, rejections = super().v50_candidate(window, rows, notional)
        return candidate, canonicalize_v50_rejections(rejections)

    def _finalize_expired_retry_windows(self, sec: int) -> None:
        retry_state = self._retry_state()
        changed = False
        if not self.state.get("v11Attempted") and int(retry_state.get("v11Attempts", 0)) > 0:
            v11_end = legacy.base.clock("10:30:00") + V11_ENTRY_WINDOW_SECONDS
            if sec > v11_end:
                self.state["v11Attempted"] = True
                changed = True
                self.log("v52-entry-window-expired", strategy=V11_SLOT, ordersSent=False)

        attempted = self.state.setdefault("v50Attempted", {})
        attempts = retry_state.setdefault("v50Attempts", {})
        for window in V50_WINDOWS:
            end = legacy.base.clock(window + ":00") + V50_ENTRY_WINDOW_SECONDS
            if not attempted.get(window) and int(attempts.get(window, 0)) > 0 and sec > end:
                attempted[window] = True
                changed = True
                self.log("v52-entry-window-expired", strategy=V50_SLOT, window=window, ordersSent=False)
        if changed:
            self.save()

    def tick(self) -> None:
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
        self._finalize_expired_retry_windows(sec)

        v11_start = legacy.base.clock("10:30:00")
        v11_end = v11_start + V11_ENTRY_WINDOW_SECONDS
        if not self.state.get("v11Attempted") and v11_start <= sec <= v11_end:
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
            action = entry_action(candidate, rejections, sec, v11_end)
            if action == "RETRY_WITHIN_WINDOW":
                self._record_retry(V11_SLOT, rejections)
            else:
                # Consume the window before any order-capable path to preserve
                # exactly-once exchange intent even if fill/reconcile later fails.
                self.state["v11Attempted"] = True
                self.save()
                if candidate:
                    self.open_basis_position(V11_SLOT, candidate, gross)

        attempted = self.state.setdefault("v50Attempted", {})
        for window in V50_WINDOWS:
            entry = legacy.base.clock(window + ":00")
            end = entry + V50_ENTRY_WINDOW_SECONDS
            if attempted.get(window) or not (entry <= sec <= end):
                continue
            if int(self.state.get("v50CompletedTrades", 0)) >= legacy.legacy.V50_MAX_DAILY_TRADES or V50_SLOT in self.positions():
                attempted[window] = True
                self.save()
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
            action = entry_action(candidate, rejections, sec, end)
            if action == "RETRY_WITHIN_WINDOW":
                self._record_retry(V50_SLOT, rejections, window=window)
                continue
            attempted[window] = True
            self.save()
            if candidate:
                self.open_basis_position(V50_SLOT, candidate, gross)


def self_test() -> None:
    assert V11_ENTRY_WINDOW_SECONDS == 20
    assert V50_ENTRY_WINDOW_SECONDS == 20
    assert V50_MIN_ENTRY_BASIS_BPS == 65.0
    assert V50_MIN_NET_EDGE_BPS == 5.0

    fixed = canonicalize_v50_rejections({
        "META": ["BASIS_BELOW_75", "NET_EDGE_BELOW_10", "SPREAD_OVER_20"],
    })
    assert fixed == {"META": ["BASIS_BELOW_65", "NET_EDGE_BELOW_5", "SPREAD_OVER_20"]}

    assert has_retryable_path({"META": ["SPREAD_OVER_20"]})
    assert has_retryable_path({"META": ["DEPTH_BELOW_2X", "ROUND_TRIP_COST_OVER_60"]})
    assert not has_retryable_path({"META": ["BASIS_BELOW_65"]})
    assert not has_retryable_path({"META": ["BASIS_BELOW_65", "SPREAD_OVER_20"]})
    assert entry_action(None, {"META": ["SPREAD_OVER_20"]}, 100, 120) == "RETRY_WITHIN_WINDOW"
    assert entry_action(None, {"META": ["SPREAD_OVER_20"]}, 120, 120) == "FINAL_REJECT"
    assert entry_action(None, {"META": ["BASIS_BELOW_65"]}, 100, 120) == "FINAL_REJECT"
    assert entry_action({"symbol": "META"}, {}, 100, 120) == "ATTEMPT_ORDER"

    engine = object.__new__(RetryAwareV52AsterOnlyEngine)
    engine.state = {"v50SignalBasis": {}}
    candidate, rejections = engine.v50_candidate("11:30", {}, 100.0)
    assert candidate is None
    assert rejections == {"ROUTER": ["MISSING_V50_SIGNAL_SNAPSHOT"]}

    print("V52 LIVE entry-window retry self-test: PASS")


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
    runner = RetryAwareV52AsterOnlyEngine(args.mode)
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
