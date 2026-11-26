import datetime as dt

from scripts.disdex_v52_daily_loss import (
    update_v52_strategy_daily_latch,
    update_v52_strategy_daily_flatten,
    complete_v52_strategy_daily_flatten,
)

D = int(dt.datetime(2026, 11, 26, 12, tzinfo=dt.timezone.utc).timestamp() * 1000)
NEXT = D + 86_400_000


def test_daily_loss_exit_lifecycle() -> None:
    real = update_v52_strategy_daily_latch(None, [], -4, 100, D, 3.5, True)
    assert real["tripped"] and not real["failClosed"]
    intent = update_v52_strategy_daily_flatten(None, real, D)
    assert intent["pending"] and intent["tripDay"] == "2026-11-26"
    assert update_v52_strategy_daily_flatten(intent, None, NEXT)["pending"]
    assert update_v52_strategy_daily_flatten(intent, real, D + 1000) == intent
    done = complete_v52_strategy_daily_flatten(intent, NEXT)
    assert done["pending"] is False and done["completedAt"] == NEXT
    assert update_v52_strategy_daily_flatten(done, real, D + 2000) == done
    newer = update_v52_strategy_daily_latch(None, [], -5, 100, NEXT, 3.5, True)
    assert update_v52_strategy_daily_flatten(done, newer, NEXT + 1)["pending"]
    no_data = update_v52_strategy_daily_latch(None, [], 0, 0, D, 3.5, False)
    assert update_v52_strategy_daily_flatten(None, no_data, D) == {}
    assert update_v52_strategy_daily_flatten(None, {"tripped": True, "failClosed": False, "utcDay": "2026-11-25"}, D) == {}


def test_v52_exitAt_and_net_fee_legacy() -> None:
    # The production ledger writes exitAt and realizedPnl AFTER fees.
    old = {"entryAt": D - 10_000, "exitAt": D - 86_405_000, "realizedPnl": -90, "commission": 10}
    today = {"entryAt": D + 1, "exitAt": D + 1000, "realizedPnl": -2, "commission": 1}
    result = update_v52_strategy_daily_latch(None, [old, today], 0, 100, D + 2000, 3.5, True)
    assert not result["tripped"], result
    assert result["realizedPnl"] == -1
    assert result["commission"] == 1
    assert result["lossPct"] == 2.0
    assert update_v52_strategy_daily_latch(None, [{"closedAt": D, "realizedPnl": -4, "commission": 0}], 0, 100, D, 3.5, True)["tripped"]
    assert not update_v52_strategy_daily_latch(None, [{"realizedPnl": -10000}], 0, 100, D, 3.5, True)["tripped"]


if __name__ == "__main__":
    test_daily_loss_exit_lifecycle()
    test_v52_exitAt_and_net_fee_legacy()
    print("V52_OFFLINE_LIFECYCLE_TEST_PASS")
