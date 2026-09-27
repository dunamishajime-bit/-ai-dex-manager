import copy
import unittest

from research.formal_five_bt.aster_h1_repair import (
    HOUR_MS, MINUTE_MS, reconstruct_aster_h1, valid_h1,
)

HOUR_TS = 1_757_768_400_000


def minute_rows() -> list[list[object]]:
    return [
        [HOUR_TS + i * MINUTE_MS,
         "100" if i == 0 else "101", "103", "99",
         "102" if i == 59 else "101", "10",
         HOUR_TS + (i + 1) * MINUTE_MS - 1, "1000"]
        for i in range(60)
    ]


class NativeM1RepairTests(unittest.TestCase):
    def test_reconstructs_strictly_contiguous_full_hour(self):
        result = reconstruct_aster_h1("BTCUSDT", HOUR_TS, minute_rows())
        self.assertTrue(valid_h1(result))
        self.assertEqual(result["open"], 100)
        self.assertEqual(result["close"], 102)
        self.assertEqual(result["high"], 103)
        self.assertEqual(result["low"], 99)
        self.assertEqual(result["base_volume"], 600)
        self.assertEqual(result["quote_volume"], 60_000)
        self.assertEqual(result["historical_reconstruction"]["count"], 60)

    def test_gaps_wrong_timestamp_and_invalid_candles_fail_closed(self):
        rows = minute_rows()
        with self.assertRaisesRegex(ValueError, "60_NATIVE_M1"):
            reconstruct_aster_h1("BTCUSDT", HOUR_TS, rows[:-1])
        rows[27][0] += MINUTE_MS
        with self.assertRaisesRegex(ValueError, "M1_GAP"):
            reconstruct_aster_h1("BTCUSDT", HOUR_TS, rows)
        rows = minute_rows()
        rows[27][2] = "99"
        with self.assertRaisesRegex(ValueError, "M1_OHLC_INVALID"):
            reconstruct_aster_h1("BTCUSDT", HOUR_TS, rows)

    def test_h1_original_invalid_without_automatic_synthetic_fix(self):
        sample = reconstruct_aster_h1("BTCUSDT", HOUR_TS, minute_rows())
        sample["high"] = 98.
        self.assertFalse(valid_h1(sample))


if __name__ == "__main__":
    unittest.main()
