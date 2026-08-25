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
V50_RANK2_SLOT = current.V50_RANK2_SLOT
V50_RANK1_REQUESTED_GROSS = current.V50_RANK1_REQUESTED_GROSS
V50_RANK2_REQUESTED_GROSS = current.V50_RANK2_REQUESTED_GROSS
V50_MAX_CONCURRENT_POSITIONS = current.V50_MAX_CONCURRENT_POSITIONS
V50_MAX_DAILY_ENTRIES = current.V50_MAX_DAILY_ENTRIES

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

    def _top2_telemetry(self, window: str) -> dict:
        telemetry = self.state.setdefault("v52Top2Telemetry", {}).setdefault(window, {})
        telemetry.setdefault("transientRetryCount", 0)
        telemetry.setdefault("candidates", [])
        telemetry.setdefault("entries", [])
        telemetry.setdefault("rejections", [])
        return telemetry

    def _record_top2_reject(
        self,
        window: str,
        candidate: dict | None,
        reason: str,
        *,
        available_gross: float | None = None,
        snapshot: dict | None = None,
    ) -> None:
        telemetry = self._top2_telemetry(window)
        row = {
            "candidateRank": candidate.get("candidateRank") if candidate else None,
            "qualifiedRank": candidate.get("qualifiedRank") if candidate else None,
            "symbol": candidate.get("symbol") if candidate else None,
            "requestedGross": (
                V50_RANK1_REQUESTED_GROSS
                if candidate and int(candidate.get("candidateRank") or 1) == 1
                else V50_RANK2_REQUESTED_GROSS
            ),
            "allocatedGross": 0.0,
            "availableGrossBeforeEntry": available_gross,
            "globalGrossBeforeReservation": (snapshot or {}).get("totalGross"),
            "globalGrossAfterReservation": None,
            "activeV50Slots": self.active_v50_slots(),
            "rank2Accepted": False if candidate and int(candidate.get("candidateRank") or 1) == 2 else None,
            "rank2RejectedReason": reason if candidate and int(candidate.get("candidateRank") or 1) == 2 else None,
            "orderBlockedReason": reason,
            "orderSendAttempted": False,
            "orderResult": "REJECTED",
        }
        telemetry["rejections"].append(row)
        self.save()
        self.log("v52-v50-candidate-rejected", window=window, **row)

    def _process_v50_window(self, window: str, rows: dict, sec: int) -> None:
        attempted = self.state.setdefault("v50Attempted", {})
        entry = legacy.base.clock(window + ":00")
        end = entry + V50_ENTRY_WINDOW_SECONDS
        if attempted.get(window) or not (entry <= sec < end):
            return

        telemetry = self._top2_telemetry(window)
        telemetry["decisionWindowEntered"] = True
        telemetry["decisionWindowEnteredAt"] = legacy.base.now_ms()
        if int(self.state.get("v50DailyEntries", 0)) >= V50_MAX_DAILY_ENTRIES:
            attempted[window] = True
            self._record_top2_reject(window, None, "V50_DAILY_ENTRY_CAP")
            return
        if self.active_v50_slots() >= V50_MAX_CONCURRENT_POSITIONS:
            attempted[window] = True
            self._record_top2_reject(window, None, "V50_MAX_CONCURRENT_POSITIONS")
            return

        rank1_capacity, snapshot = self.available_slot_gross(V50_SLOT)
        notional = rank1_capacity * snapshot["equityUsd"]
        candidates, rejections = (
            ([], {"ROUTER": ["NO_GROSS_CAPACITY"]})
            if rank1_capacity <= 0
            else (self.v50_candidates(window, rows, notional, max_candidates=2))
        )
        candidates = [dict(candidate) for candidate in candidates]
        for candidate in candidates:
            candidate["candidateRank"] = int(candidate.get("candidateRank") or 0)
            candidate["qualifiedRank"] = int(candidate.get("qualifiedRank") or candidate["candidateRank"])
        telemetry["candidates"] = [
            {
                "candidateRank": candidate.get("candidateRank"),
                "qualifiedRank": candidate.get("qualifiedRank"),
                "symbol": candidate.get("symbol"),
                "basisBps": candidate.get("basisBps"),
            }
            for candidate in candidates
        ]
        telemetry["activeV50SlotsBeforeEntry"] = self.active_v50_slots()
        telemetry["availableGrossBeforeEntry"] = rank1_capacity
        telemetry["globalGrossBeforeReservation"] = snapshot.get("totalGross")
        self.log(
            "v52-v50-decision",
            window=window,
            candidate=candidates[0] if candidates else None,
            candidates=candidates,
            rejections=rejections,
            allocatedGross=rank1_capacity,
            grossSnapshot=snapshot,
            top2=True,
            ordersSent=False,
        )
        self.log(
            "v52-v50-top2-decision",
            window=window,
            candidates=candidates,
            rejections=rejections,
            activeV50Slots=self.active_v50_slots(),
            requestedGross={"rank1": V50_RANK1_REQUESTED_GROSS, "rank2": V50_RANK2_REQUESTED_GROSS},
            globalGrossCap=self.portfolio_gross_cap,
            stockGrossCap=self.stock_gross_cap,
            ordersSent=False,
        )
        self._record_gate_diagnostics(V50_SLOT, candidates[0] if candidates else None, rejections, window=window)
        action = entry_action(candidates[0] if candidates else None, rejections, sec, end)
        if action == "RETRY_WITHIN_WINDOW":
            telemetry["transientRetryCount"] = int(telemetry.get("transientRetryCount", 0)) + 1
            self._record_retry(V50_SLOT, rejections, window=window)
            self.save()
            return

        # Consume the frozen window before exchange mutation. Every candidate
        # below is from this exact snapshot; no signal is regenerated.
        attempted[window] = True
        self.save()
        for candidate in candidates:
            rank = int(candidate.get("candidateRank") or 0)
            slot = V50_SLOT if rank == 1 else V50_RANK2_SLOT
            requested = V50_RANK1_REQUESTED_GROSS if rank == 1 else V50_RANK2_REQUESTED_GROSS
            available, before = self.available_slot_gross(slot)
            if slot in self.positions():
                self._record_top2_reject(window, candidate, "SLOT_ALREADY_ACTIVE", available_gross=available, snapshot=before)
                continue
            if self.active_v50_slots() >= V50_MAX_CONCURRENT_POSITIONS:
                self._record_top2_reject(window, candidate, "V50_MAX_CONCURRENT_POSITIONS", available_gross=available, snapshot=before)
                continue
            if rank == 2 and available + 1e-12 < V50_RANK2_REQUESTED_GROSS:
                self._record_top2_reject(window, candidate, "INSUFFICIENT_AVAILABLE_GROSS", available_gross=available, snapshot=before)
                continue
            if rank == 1:
                allocated = min(requested, available)
            else:
                allocated = V50_RANK2_REQUESTED_GROSS
            if allocated <= 0:
                self._record_top2_reject(window, candidate, "INSUFFICIENT_AVAILABLE_GROSS", available_gross=available, snapshot=before)
                continue
            self.state["v50DailyEntries"] = int(self.state.get("v50DailyEntries", 0)) + 1
            self.save()
            order_sent_before = len(telemetry["entries"])
            opened = False
            order_blocked = None
            self._last_reservation_telemetry = {}
            try:
                opened = bool(self.open_basis_position(slot, candidate, allocated))
            except Exception as error:
                order_blocked = str(error)
                self.log(
                    "v52-v50-order-error",
                    window=window,
                    slot=slot,
                    candidateRank=rank,
                    symbol=candidate.get("symbol"),
                    orderBlockedReason=order_blocked,
                    orderSendAttempted=False,
                    ordersSent=False,
                )
            reservation = getattr(self, "_last_reservation_telemetry", {})
            order_send_attempted = bool(opened or reservation)
            if not opened and order_blocked is None and not reservation:
                order_blocked = "ACCOUNT_ORDER_LOCK_NOT_ACQUIRED"
            result = "OPENED" if opened else (order_blocked or "REJECTED")
            entry_row = {
                "candidateRank": rank,
                "qualifiedRank": candidate.get("qualifiedRank", rank),
                "symbol": candidate.get("symbol"),
                "requestedGross": requested,
                "allocatedGross": allocated if opened else 0.0,
                "availableGrossBeforeEntry": available,
                "globalGrossBeforeReservation": reservation.get("globalGrossBeforeReservation", before.get("totalGross")),
                "globalGrossAfterReservation": reservation.get("globalGrossAfterReservation"),
                "activeV50Slots": self.active_v50_slots(),
                "rank2Accepted": bool(opened) if rank == 2 else None,
                "rank2RejectedReason": None if opened or rank != 2 else (order_blocked or "ORDER_REJECTED"),
                "orderBlockedReason": order_blocked,
                "orderSendAttempted": order_send_attempted,
                "orderResult": result,
                "attemptIndex": order_sent_before + 1,
            }
            telemetry["entries"].append(entry_row)
            self.save()
            self.log("v52-v50-candidate-result", window=window, top2=True, **entry_row, ordersSent=bool(opened))

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
            if not attempted.get(window) and int(attempts.get(window, 0)) > 0 and sec >= end:
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

        for window in V50_WINDOWS:
            self._process_v50_window(window, rows, sec)


def self_test() -> None:
    assert V11_ENTRY_WINDOW_SECONDS == 20
    assert V50_ENTRY_WINDOW_SECONDS == 20
    assert V50_MIN_ENTRY_BASIS_BPS == 65.0
    assert V50_MIN_NET_EDGE_BPS == 5.0
    assert V50_RANK1_REQUESTED_GROSS == 1.0
    assert V50_RANK2_REQUESTED_GROSS == 0.5
    assert V50_MAX_CONCURRENT_POSITIONS == 2
    assert V50_MAX_DAILY_ENTRIES == 3

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

    # Offline router contract: two qualified candidates can fill only the two
    # V50 slots; a third slot is never created and an insufficient rank 2
    # budget is rejected without calling the order path.
    def make_fake(rank2_available: float = 0.5, daily_entries: int = 0):
        fake = object.__new__(RetryAwareV52AsterOnlyEngine)
        fake.state = {
            "nyDay": "2026-08-25",
            "v50Attempted": {},
            "v50DailyEntries": daily_entries,
            "v52Top2Telemetry": {},
        }
        fake._fake_positions = {"V12_SENTINEL": {"symbol": "SOL"}}
        fake.positions = lambda: fake._fake_positions
        fake.active_v50_slots = lambda: sum(
            1 for slot in (V50_SLOT, V50_RANK2_SLOT) if slot in fake._fake_positions
        )
        fake.save = lambda: None
        fake.log = lambda *_args, **_kwargs: None
        fake._record_gate_diagnostics = lambda *_args, **_kwargs: None
        fake.portfolio_gross_cap = 2.5
        fake.stock_gross_cap = 1.5
        fake.available_slot_gross = lambda slot: (
            (rank2_available if slot == V50_RANK2_SLOT else 1.0),
            {"equityUsd": 1000.0, "totalGross": 1.0, "stockGross": 0.0},
        )
        fake.v50_candidates = lambda *_args, **_kwargs: (
            [
                {"candidateRank": 1, "qualifiedRank": 1, "symbol": "META", "basisBps": 100.0},
                {"candidateRank": 2, "qualifiedRank": 2, "symbol": "MSFT", "basisBps": 90.0},
            ],
            {},
        )
        def fake_open(slot, candidate, gross):
            fake._fake_positions[slot] = {
                "symbol": candidate["symbol"],
                "targetGross": gross,
            }
            return True
        fake.open_basis_position = fake_open
        return fake

    fake = make_fake()
    fake._process_v50_window("11:30", {}, legacy.base.clock("11:30:00") + 1)
    assert V50_SLOT in fake._fake_positions
    assert V50_RANK2_SLOT in fake._fake_positions
    assert fake.state["v50DailyEntries"] == 2
    assert [row["candidateRank"] for row in fake.state["v52Top2Telemetry"]["11:30"]["entries"]] == [1, 2]
    assert fake._fake_positions["V12_SENTINEL"]["symbol"] == "SOL"

    insufficient = make_fake(rank2_available=0.49)
    insufficient._process_v50_window("11:30", {}, legacy.base.clock("11:30:00") + 1)
    rejects = insufficient.state["v52Top2Telemetry"]["11:30"]["rejections"]
    assert any(row["rank2RejectedReason"] == "INSUFFICIENT_AVAILABLE_GROSS" for row in rejects)
    assert V50_RANK2_SLOT not in insufficient._fake_positions

    full = make_fake()
    full._fake_positions.update({V50_SLOT: {}, V50_RANK2_SLOT: {}})
    full._process_v50_window("11:30", {}, legacy.base.clock("11:30:00") + 1)
    assert len(full._fake_positions) == 3

    daily = make_fake(daily_entries=V50_MAX_DAILY_ENTRIES)
    daily._process_v50_window("11:30", {}, legacy.base.clock("11:30:00") + 1)
    assert daily.state["v50Attempted"]["11:30"] is True
    assert daily.state["v50DailyEntries"] == V50_MAX_DAILY_ENTRIES

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
