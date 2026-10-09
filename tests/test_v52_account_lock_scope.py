from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT))

import disdex_v52_aster_only_legacy_engine as v52  # noqa: E402


class FakeAccountLock:
    def __init__(self) -> None:
        self.path = ROOT / ".test-v52-account-lock"
        self.held = False
        self.events: list[str] = []

    def acquire(self) -> bool:
        assert not self.held, "the runner must not acquire the shared lock twice"
        self.held = True
        self.events.append("acquire")
        return True

    def release(self) -> None:
        assert self.held
        self.held = False
        self.events.append("release")


def test_v52_releases_shared_lock_before_daemon_sleep() -> None:
    engine = object.__new__(v52.V52AsterOnlyEngine)
    lock = FakeAccountLock()
    engine.lock = lock
    engine._upstream_fail_closed_hold = False
    engine.stop_requested = False
    engine.live = False
    engine.crypto_gross_cap = 3.0
    engine.stock_gross_cap = 1.5
    engine.portfolio_gross_cap = 3.5
    engine.v11_gross_cap = 1.5
    engine.v50_gross_cap = 1.0
    engine.log = lambda *_args, **_kwargs: None
    engine.reset_days = lambda: lock.events.append("reset")
    engine.reconcile = lambda: lock.events.append("reconcile")
    engine.positions = lambda: {}

    def tick(_prepared: dict) -> None:
        lock.events.append("tick")
        engine.stop_requested = True

    engine.tick = tick

    original_sleep = v52.time.sleep
    original_clock = v52.base.clock
    original_ny_seconds = v52.base.ny_seconds
    try:
        v52.time.sleep = lambda _seconds: (assert_not_held(lock), lock.events.append("sleep"))
        v52.base.clock = lambda _value: 0
        v52.base.ny_seconds = lambda: 1
        engine.run(daemon=True)
    finally:
        v52.time.sleep = original_sleep
        v52.base.clock = original_clock
        v52.base.ny_seconds = original_ny_seconds

    assert lock.events[:5] == ["acquire", "reset", "reconcile", "tick", "release"]
    assert lock.events[-1] == "sleep"
    assert not lock.held
    print("V52_ACCOUNT_LOCK_SCOPE_SELFTEST_PASS")


def assert_not_held(lock: FakeAccountLock) -> None:
    assert not lock.held, "shared account lock must be released while daemon sleeps"


def test_market_closed_position_guard_does_not_take_order_lock() -> None:
    from unittest.mock import patch
    engine = object.__new__(v52.V52AsterOnlyEngine)
    lock = FakeAccountLock()
    engine.lock = lock
    engine._upstream_fail_closed_hold = False
    engine.stop_requested = False
    engine.live = False
    position = {"strategy": v52.V50_SLOT, "symbol": "TSLA", "asterQty": 0.38}
    engine.state = {"positions": {v52.V50_SLOT: position}}
    engine.current_local_time = lambda: v52.dt.datetime(2026, 10, 9, 0, 0, tzinfo=v52.base.NY)
    engine.kill_switch = lambda: {"action": "HOLD_PROTECTED", "active": True}
    engine.log = lambda *_args, **_kwargs: None
    checks = []
    engine.reset_days = lambda: checks.append("reset")
    engine.enforce_daily_loss = lambda: checks.append("daily_loss") or False
    engine.books_and_refs = lambda: (_ for _ in ()).throw(AssertionError("closed session quote fetch"))
    engine.manage_positions = lambda _rows: (_ for _ in ()).throw(AssertionError("closed session quote exit"))
    intervals = []
    def sleep(seconds):
        assert_not_held(lock)
        intervals.append(seconds)
        if len(intervals) == 2:
            engine.stop_requested = True
    with patch.object(v52, "regular_us_equity_session", return_value=False), patch.object(v52.time, "sleep", side_effect=sleep):
        engine.run(daemon=True)
    assert checks == ["reset", "daily_loss", "reset", "daily_loss"]
    assert not lock.events, "read-only closed-session guard must not acquire account order lease"
    assert all(seconds >= 4 for seconds in intervals)
    assert engine.state["positions"] == {v52.V50_SLOT: position}

def test_closed_session_emergency_flatten_still_requires_lock() -> None:
    from unittest.mock import patch
    engine = object.__new__(v52.V52AsterOnlyEngine)
    engine.state = {"positions": {v52.V50_SLOT: {"symbol": "TSLA", "asterQty": 0.38}}}
    engine.current_local_time = lambda: v52.dt.datetime(2026, 10, 9, 0, 0, tzinfo=v52.base.NY)
    engine.kill_switch = lambda: {"action": "FLATTEN_MANAGED", "active": True}
    engine._kill_flatten_completed = lambda _kill: False
    with patch.object(v52, "regular_us_equity_session", return_value=False):
        prepared = engine.prepare_tick_inputs()
    assert not prepared["skipWithoutLock"], "actual emergency mutation must remain serialized"

if __name__ == "__main__":
    test_v52_releases_shared_lock_before_daemon_sleep()
    test_market_closed_position_guard_does_not_take_order_lock()
    test_closed_session_emergency_flatten_still_requires_lock()
    print("V52_MARKET_CLOSED_LOCK_SCOPE_SELFTEST_PASS")
