import datetime as dt
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT))

import disdex_v52_aster_only_legacy_engine as v52  # noqa: E402


class V52MarketClosedGateTest(unittest.TestCase):
    def make_engine(self, local: dt.datetime):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine.live = False
        engine.state = {}
        engine.stop_requested = False
        engine.reset_days = Mock()
        engine.kill_switch = Mock(return_value=None)
        engine.enforce_daily_loss = Mock(return_value=False)
        engine.update_history = Mock()
        engine.current_local_time = Mock(return_value=local)
        engine.positions = Mock(return_value={})
        engine.books_and_refs = Mock()
        engine.log = Mock()
        return engine

    def test_exchange_holiday_defers_before_reference_fetch(self):
        labor_day = dt.datetime(2026, 9, 7, 10, 30, tzinfo=dt.timezone.utc)
        engine = self.make_engine(labor_day)

        engine.tick()

        engine.books_and_refs.assert_not_called()
        engine.log.assert_any_call(
            "v52-market-closed",
            market="US_EQUITY",
            localDate="2026-09-07",
            localTime=labor_day.isoformat(),
            referenceFetch="deferred",
            newOrdersAllowed=False,
        )


if __name__ == "__main__":
    unittest.main()
