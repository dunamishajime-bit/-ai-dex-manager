import datetime as dt
import unittest

from scripts.disdex_stock_reference_health import reference_payload_is_ready
from scripts.disdex_us_equity_calendar import is_us_equity_market_holiday, regular_us_equity_session


class StockReferenceCalendarTest(unittest.TestCase):
    def test_labor_day_is_not_a_regular_session(self):
        labor_day = dt.datetime(2026, 9, 7, 10, 0, tzinfo=dt.timezone.utc)
        self.assertTrue(is_us_equity_market_holiday(labor_day.date()))
        self.assertFalse(regular_us_equity_session(labor_day))

    def test_open_monday_is_a_regular_session(self):
        open_monday = dt.datetime(2026, 9, 14, 14, 0, tzinfo=dt.timezone.utc)
        self.assertFalse(is_us_equity_market_holiday(open_monday.date()))
        self.assertTrue(regular_us_equity_session(open_monday))

    def test_fixed_holiday_and_weekend(self):
        christmas = dt.datetime(2026, 12, 25, 15, 0, tzinfo=dt.timezone.utc)
        saturday = dt.datetime(2026, 9, 12, 15, 0, tzinfo=dt.timezone.utc)
        self.assertTrue(is_us_equity_market_holiday(christmas.date()))
        self.assertFalse(regular_us_equity_session(saturday))


class StockReferenceHealthContractTest(unittest.TestCase):
    symbols = ("AMZN", "META", "MSFT", "NVDA", "TSLA")

    def test_pyth_iex_ready_contract(self):
        payload = {"status": "ok", "pythConnected": True, "iexConnected": True, "freshnessReady": True}
        self.assertTrue(reference_payload_is_ready(payload, require_fresh=True, required_symbols=self.symbols))

    def test_alpaca_connected_contract_is_accepted_only_with_all_symbols_when_open(self):
        payload = {
            "status": "ok",
            "connected": True,
            "symbols": {symbol: {"ageMs": 100} for symbol in self.symbols},
        }
        self.assertTrue(reference_payload_is_ready(payload, require_fresh=True, required_symbols=self.symbols))

    def test_alpaca_holiday_contract_can_defer_quotes(self):
        payload = {"status": "ok", "connected": True, "symbols": {}}
        self.assertTrue(reference_payload_is_ready(payload, require_fresh=False, required_symbols=self.symbols))

    def test_missing_connection_or_symbol_fails_closed(self):
        self.assertFalse(reference_payload_is_ready({"status": "ok", "connected": False}, require_fresh=False, required_symbols=self.symbols))
        payload = {"status": "ok", "connected": True, "symbols": {"NVDA": {"ageMs": 100}}}
        self.assertFalse(reference_payload_is_ready(payload, require_fresh=True, required_symbols=self.symbols))


if __name__ == "__main__":
    unittest.main()
