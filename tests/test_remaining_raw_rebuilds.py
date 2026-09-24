import unittest

from scripts.research.raw_data.fet_rebuild import generate_fet_candidates
from scripts.research.raw_data.models import Bar
from scripts.research.raw_data.q102_rebuild import generate_q102_candidates
from scripts.research.raw_data.v52_rebuild import generate_v52_candidates


def crypto_rows(symbol: str, moves: list[float]) -> list[Bar]:
    rows = [Bar(symbol, 1_700_000_000_000, 100, 100, 100, 100, 1)]
    close = 100.0
    for index, move in enumerate(moves, 1):
        next_close = close * (1 + move / 100)
        rows.append(Bar(symbol, 1_700_000_000_000 + index * 3_600_000, close, max(close, next_close), min(close, next_close), next_close, 1))
        close = next_close
    rows.append(Bar(symbol, rows[-1].ts_ms + 3_600_000, close, close, close, close, 1))
    return rows


class RemainingRawRebuildTests(unittest.TestCase):
    def test_q102_is_causal_one_slot_and_rejects_fixed_replay(self):
        bundle = {
            "bars": {"BTCUSDT": crypto_rows("BTCUSDT", [2.0, 1.0]), "ETHUSDT": crypto_rows("ETHUSDT", [1.5, 0.5])},
            "contracts": {"Q102": {"selector": "CAUSAL_V4", "maximumPositions": 1, "maximumGross": 3.0}},
        }
        candidates = generate_q102_candidates(bundle, "NORMAL")
        self.assertEqual(len(candidates), 2)
        self.assertTrue(all(candidate["selector"] == "CAUSAL_V4" for candidate in candidates))
        self.assertTrue(all(candidate["maximumPositions"] == 1 for candidate in candidates))
        self.assertTrue(all(candidate["featureSourceTs"] == candidate["signalTs"] for candidate in candidates))
        bundle["fixedCsvPlayback"] = True
        with self.assertRaisesRegex(ValueError, "FIXED_REPLAY_FORBIDDEN"):
            generate_q102_candidates(bundle, "NORMAL")

    def test_fet_needs_48h_breakout_72h_volume_and_correct_entry_hour(self):
        from datetime import datetime, timezone
        hour = 3_600_000
        start = 1_700_000_000_000 // hour * hour
        signal_index = next(i for i in range(72, 80)
                            if datetime.fromtimestamp((start + (i + 1) * hour) / 1000, timezone.utc).hour % 4 == 1)
        rows = [
            Bar("FETUSDT", start + i * hour, 100, 100, 100, 100, 100)
            for i in range(signal_index)
        ]
        rows.append(Bar("FETUSDT", start + signal_index * hour, 100, 104, 100, 103, 200))
        rows.append(Bar("FETUSDT", start + (signal_index + 1) * hour, 103, 104, 102, 103, 100))
        candidates = generate_fet_candidates({"bars": {"FETUSDT": rows}}, "SEVERE")
        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(candidate["strategyId"], "FET_BRK48_RESIDUAL")
        self.assertEqual(candidate["requestedGross"], 2.25)
        self.assertTrue(candidate["preemptible"])
        self.assertEqual(candidate["prior48hHigh"], 100)
        self.assertGreaterEqual(candidate["volumeRatio"], 1.2)
        self.assertEqual(candidate["maxHoldHours"], 24)
        self.assertEqual(candidate["entryTs"] - candidate["signalTs"], hour)

        rows[signal_index] = Bar("FETUSDT", start + signal_index * hour, 100, 104, 100, 103, 100)
        self.assertEqual(generate_fet_candidates({"bars": {"FETUSDT": rows}}, "SEVERE"), [])

    def test_v11_identity_is_preserved(self):
        row = {"ts_ms": 1_700_000_000_000, "strategy": "V11_EQ", "symbol": "STOCK", "basis_bps": 100, "convergence_bps": 20, "net_edge_bps": 10, "spread_bps": 10, "estimated_round_trip_cost_bps": 20}
        candidates = generate_v52_candidates({"STOCK": [row]}, "NORMAL")
        self.assertEqual(candidates[0]["strategy"], "V11_EQ")
        self.assertEqual(candidates[0]["signalFamily"], "V11")

    def test_v52_current_thresholds_and_cost_gate(self):
        good = {"ts_ms": 1_700_000_000_000, "strategy": "V50_POST_OPEN_BASIS", "symbol": "STOCK", "basis_bps": 60, "convergence_bps": 20, "net_edge_bps": 7.5, "spread_bps": 20, "estimated_round_trip_cost_bps": 60}
        bad_cost = dict(good, estimated_round_trip_cost_bps=60.01)
        candidates = generate_v52_candidates({"STOCK": [good, bad_cost]}, "NORMAL")
        self.assertEqual(len(candidates), 2)
        self.assertTrue(candidates[0]["accepted"])
        self.assertEqual(candidates[1]["rejectionReason"], "ROUND_TRIP_COST_ABOVE_60BPS")
        self.assertEqual(candidates[0]["thresholds"], {"basisBps": 60, "convergenceBps": 20, "stopMultiple": 1.75, "netEdgeBps": 7.5, "maxCostBps": 60, "maxSpreadBps": 20})

    def test_v52_spread_gate_fails_closed(self):
        row = {"ts_ms": 1_700_000_000_000, "strategy": "V50_POST_OPEN_BASIS", "symbol": "STOCK", "basis_bps": 100, "convergence_bps": 20, "net_edge_bps": 10, "spread_bps": 20.01, "estimated_round_trip_cost_bps": 20}
        candidate = generate_v52_candidates({"STOCK": [row]}, "NORMAL")[0]
        self.assertFalse(candidate["accepted"])
        self.assertEqual(candidate["rejectionReason"], "SPREAD_ABOVE_20BPS")


if __name__ == "__main__":
    unittest.main()
