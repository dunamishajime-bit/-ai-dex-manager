import unittest

from scripts.research.raw_data.models import Bar
from scripts.research.raw_data.v12_rebuild import generate_v12_candidates, normalize_v12_trade


CONTRACT = {
    "top_n": 3,
    "rank3_gross": 0.10,
    "rank3_minimum_score": 0.70,
    "per_position_gross_cap": 1.0,
    "aggregate_gross_cap": 2.0,
}


def bars(symbol: str, returns: list[float]) -> list[Bar]:
    result = [Bar(symbol, 1_700_000_000_000, 100.0, 100.0, 100.0, 100.0, 1.0)]
    close = 100.0
    for index, change in enumerate(returns, start=1):
        next_close = close * (1.0 + change / 100.0)
        result.append(Bar(symbol, 1_700_000_000_000 + index * 3_600_000, close, max(close, next_close), min(close, next_close), next_close, 1.0))
        close = next_close
    result.append(Bar(symbol, result[-1].ts_ms + 3_600_000, close, close, close, close, 1.0))
    return result


class V12RawRebuildTests(unittest.TestCase):
    def test_top3_rank3_score_and_maximum_positions(self):
        raw = {
            "AAAUSDT": bars("AAAUSDT", [1.20]),
            "BBBUSDT": bars("BBBUSDT", [1.10]),
            "CCCUSDT": bars("CCCUSDT", [0.70]),
            "DDDUSDT": bars("DDDUSDT", [2.00]),
        }
        candidates = generate_v12_candidates(raw, CONTRACT, "NORMAL")
        at_signal = [candidate for candidate in candidates if candidate["signalTs"] == 1_700_003_600_000]
        self.assertEqual(len(at_signal), 3)
        self.assertEqual([candidate["rank"] for candidate in at_signal], [1, 2, 3])
        self.assertEqual(at_signal[-1]["requestedGross"], 0.10)
        self.assertGreaterEqual(at_signal[-1]["score"], 0.70)
        self.assertNotIn("CCCUSDT", [candidate["symbol"] for candidate in at_signal])

    def test_rank3_below_score_threshold_is_excluded(self):
        raw = {
            "AAAUSDT": bars("AAAUSDT", [1.20]),
            "BBBUSDT": bars("BBBUSDT", [1.10]),
            "CCCUSDT": bars("CCCUSDT", [0.69]),
        }
        candidates = generate_v12_candidates(raw, CONTRACT, "SEVERE")
        self.assertEqual(len(candidates), 2)
        self.assertNotIn("CCCUSDT", [candidate["symbol"] for candidate in candidates])

    def test_aggregate_reservation_blocks_rank3_when_base_cap_is_full(self):
        raw = {symbol: bars(symbol, [change]) for symbol, change in {
            "AAAUSDT": 1.20, "BBBUSDT": 1.10, "CCCUSDT": 0.70,
        }.items()}
        candidates = generate_v12_candidates(raw, CONTRACT, "NORMAL")
        rank3 = next(candidate for candidate in candidates if candidate["rank"] == 3)
        self.assertEqual(rank3["acceptedGross"], 0.0)
        self.assertEqual(rank3["rejectionReason"], "AGGREGATE_GROSS_CAP")

    def test_normalization_requires_next_bar_fill(self):
        candidate = {
            "positionId": "v12:AAAUSDT:1700003600000",
            "strategyId": "V12_X1.00_ALL",
            "symbol": "AAAUSDT",
            "side": "LONG",
            "signalTs": 1_700_003_600_000,
            "entryTs": 1_700_007_200_000,
            "requestedGross": 1.0,
            "acceptedGross": 1.0,
        }
        trade = normalize_v12_trade(candidate, {"entryTs": 1_700_007_200_000, "entryPrice": 101.25})
        self.assertEqual(trade["entryTs"], 1_700_007_200_000)
        self.assertEqual(trade["entryPrice"], 101.25)
        self.assertNotEqual(trade["entryTs"], trade["signalTs"])

    def test_later_bar_cannot_change_earlier_signal_score(self):
        raw = {
            "AAAUSDT": bars("AAAUSDT", [0.80, 50.0]),
            "BBBUSDT": bars("BBBUSDT", [0.70, 0.0]),
        }
        candidates = generate_v12_candidates(raw, CONTRACT, "NORMAL")
        earlier = [candidate for candidate in candidates if candidate["signalTs"] == 1_700_003_600_000]
        aaa = next(candidate for candidate in earlier if candidate["symbol"] == "AAAUSDT")
        self.assertAlmostEqual(aaa["score"], 0.80, places=8)


if __name__ == "__main__":
    unittest.main()
