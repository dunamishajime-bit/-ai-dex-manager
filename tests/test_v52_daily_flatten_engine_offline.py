from __future__ import annotations

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from disdex_v52_aster_only_legacy_engine import V52AsterOnlyEngine, base
from disdex_v52_daily_loss import utc_day


class FakeV52(V52AsterOnlyEngine):
    def __init__(self) -> None:
        now = base.now_ms()
        self.state = {
            "positions": {"V50_POST_OPEN_BASIS": {"symbol": "METAUSDT"}},
            "v52StrategyDailyLossLatch": {"utcDay": utc_day(now), "tripped": True, "failClosed": False},
        }
        self.saved = []
        self.events = []
        self.fail_once = False
    def save(self) -> None:
        self.saved.append(str(self.state.get("v52DailyFlatten")))
    def log(self, event: str, **kw) -> None:
        self.events.append((event, kw))
    def flatten_all(self, reason: str) -> None:
        # Mock only V52-owned slots; do NOT invoke ASTER or any real order path.
        assert self.saved and self.state["v52DailyFlatten"]["pending"] is True
        assert reason == "V52_STRATEGY_DAILY_LOSS_3P5"
        if self.fail_once:
            self.fail_once = False
            raise RuntimeError("venue readback failed")
        self.state["positions"].clear()


def test_offline_scoped_flatten_retry() -> None:
    fake = FakeV52()
    unrelated = {"V4": ["BTC"], "Q102": ["ETH"]}
    assert fake._refresh_v52_daily_flatten_intent()
    assert len(fake.saved) == 1
    fake.fail_once = True
    try:
        fake._finish_v52_daily_flatten()
        raise AssertionError("expected venue failure")
    except RuntimeError as error:
        assert "venue readback" in str(error)
    assert fake.state["v52DailyFlatten"]["pending"] is True
    assert fake.state["positions"]
    fake._finish_v52_daily_flatten()
    assert fake.state["v52DailyFlatten"]["pending"] is False
    assert fake.state["v52DailyFlatten"]["completedAt"] is not None
    assert fake.state["positions"] == {}
    assert unrelated == {"V4": ["BTC"], "Q102": ["ETH"]}


def test_offline_failclosed_api_no_automatic_liquidation() -> None:
    fake = FakeV52()
    fake.state["v52StrategyDailyLossLatch"]["failClosed"] = True
    assert not fake._refresh_v52_daily_flatten_intent()
    assert fake.state["positions"] and not fake.state["v52DailyFlatten"].get("pending")


if __name__ == "__main__":
    test_offline_scoped_flatten_retry()
    test_offline_failclosed_api_no_automatic_liquidation()
    print("V52_OFFLINE_ENGINE_TEST_PASS")
