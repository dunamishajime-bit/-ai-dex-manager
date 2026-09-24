import unittest

from scripts.research.raw_data.models import Bar, Funding
from scripts.research.raw_data.validate_bundle import validate_bundle


START = 1_700_000_000_000
HOUR = 3_600_000
END = START + 2 * HOUR


def bar(ts: int, close: float = 101.0) -> Bar:
    return Bar("BTCUSDT", ts, 100.0, max(102.0, close), min(99.0, close), close, 10.0)


class RawDataBundleValidationTests(unittest.TestCase):
    def base_bundle(self):
        return {
            "period": {"start_ms": START, "end_ms": END},
            "bars": {"BTCUSDT": [bar(START), bar(START + HOUR)]},
            "funding": {"BTCUSDT": [Funding("BTCUSDT", START + HOUR, 0.0001)]},
        }

    def test_valid_bundle_includes_start_excludes_end(self):
        bundle = self.base_bundle()
        bundle["bars"]["BTCUSDT"].append(bar(END))
        report = validate_bundle(bundle)
        self.assertFalse(report["valid"])
        self.assertEqual(report["post_period_rows"], 1)
        bundle["bars"]["BTCUSDT"] = bundle["bars"]["BTCUSDT"][:-1]
        report = validate_bundle(bundle)
        self.assertTrue(report["valid"], report)
        self.assertEqual(report["duplicate_rows"], 0)
        self.assertEqual(report["invalid_rows"], 0)

    def test_duplicate_timestamps_are_rejected(self):
        bundle = self.base_bundle()
        bundle["bars"]["BTCUSDT"].append(bar(START + HOUR))
        report = validate_bundle(bundle)
        self.assertFalse(report["valid"])
        self.assertEqual(report["duplicate_rows"], 1)

    def test_invalid_ohlc_is_rejected(self):
        bundle = self.base_bundle()
        bundle["bars"]["BTCUSDT"][0] = Bar("BTCUSDT", START, 100, 98, 99, 99.5, 10)
        report = validate_bundle(bundle)
        self.assertFalse(report["valid"])
        self.assertEqual(report["invalid_rows"], 1)

    def test_non_monotonic_rows_are_rejected(self):
        bundle = self.base_bundle()
        bundle["bars"]["BTCUSDT"] = [bar(START + HOUR), bar(START)]
        report = validate_bundle(bundle)
        self.assertFalse(report["valid"])
        self.assertEqual(report["non_monotonic_rows"], 1)

    def test_funding_after_decision_time_is_rejected(self):
        bundle = self.base_bundle()
        bundle["decision_ts_ms"] = START + HOUR
        bundle["funding"]["BTCUSDT"] = [Funding("BTCUSDT", START + 2 * HOUR, 0.0001)]
        report = validate_bundle(bundle)
        self.assertFalse(report["valid"])
        self.assertEqual(report["funding_after_decision"], 1)


if __name__ == "__main__":
    unittest.main()
