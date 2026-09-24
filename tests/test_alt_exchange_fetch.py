import unittest
from pathlib import Path

from scripts.research.raw_data.binance_fetch import (
    parse_binance_funding_rows,
    parse_binance_kline_rows,
)
from scripts.research.raw_data.stock_fetch import load_yahoo_chart_json
from scripts.research.raw_data.models import Bar, Funding


START = 1_700_000_000_000


class AlternateExchangeFetchTests(unittest.TestCase):
    def test_binance_klines_are_normalized_without_exchange_fields(self):
        payload = [[START, "100", "102", "99", "101", "12", START + 3_599_999, "0", 10, "0", "0", "0"]]
        self.assertEqual(
            parse_binance_kline_rows("BTCUSDT", payload),
            [Bar("BTCUSDT", START, 100.0, 102.0, 99.0, 101.0, 12.0)],
        )

    def test_binance_funding_is_normalized(self):
        payload = [{"symbol": "BTCUSDT", "fundingTime": START, "fundingRate": "0.0001"}]
        self.assertEqual(
            parse_binance_funding_rows("BTCUSDT", payload),
            [Funding("BTCUSDT", START, 0.0001)],
        )

    def test_malformed_kline_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_binance_kline_rows("BTCUSDT", [[START, "100", "102"]])

    def test_yahoo_chart_json_is_normalized_to_bars(self):
        path = Path(__file__).parent / "fixtures" / "yahoo-chart-valid.json"
        self.assertEqual(
            load_yahoo_chart_json(path, "AMZN", START, START + 2 * 3_600_000),
            [
                Bar("AMZN", START, 10.0, 11.0, 9.0, 10.5, 100.0),
                Bar("AMZN", START + 3_600_000, 11.0, 12.0, 10.0, 11.5, 200.0),
            ],
        )

    def test_yahoo_chart_json_rejects_misaligned_series(self):
        path = Path(__file__).parent / "fixtures" / "yahoo-chart-misaligned.json"
        with self.assertRaises(ValueError):
            load_yahoo_chart_json(path, "AMZN", START, START + 3_600_000)

    def test_yahoo_chart_json_skips_all_null_market_closed_row(self):
        path = Path(__file__).parent / "fixtures" / "yahoo-chart-all-null-row.json"
        self.assertEqual(
            load_yahoo_chart_json(path, "AMZN", START, START + 2 * 3_600_000),
            [Bar("AMZN", START, 10.0, 11.0, 9.0, 10.5, 100.0)],
        )


if __name__ == "__main__":
    unittest.main()
