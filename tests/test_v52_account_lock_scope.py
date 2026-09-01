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
    engine.stop_requested = False
    engine.live = False
    engine.crypto_gross_cap = 2.0
    engine.stock_gross_cap = 1.5
    engine.portfolio_gross_cap = 2.5
    engine.v11_gross_cap = 1.5
    engine.v50_gross_cap = 1.0
    engine.log = lambda *_args, **_kwargs: None
    engine.reset_days = lambda: lock.events.append("reset")
    engine.reconcile = lambda: lock.events.append("reconcile")
    engine.positions = lambda: {}

    def tick() -> None:
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


if __name__ == "__main__":
    test_v52_releases_shared_lock_before_daemon_sleep()
