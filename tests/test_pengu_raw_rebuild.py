import unittest

from scripts.research.raw_data.models import Bar
from scripts.research.raw_data.pengu_rebuild import (
    apply_pengu_q60_dd17_h72,
    generate_pengu_candidates,
    normalize_pengu_trade,
)


def pengu_bars(changes: list[float]) -> list[Bar]:
    rows = [Bar("PENGUUSDT", 1_700_000_000_000, 1.0, 1.0, 1.0, 1.0, 100.0)]
    close = 1.0
    for index, change in enumerate(changes, start=1):
        next_close = close * (1.0 + change / 100.0)
        rows.append(Bar("PENGUUSDT", 1_700_000_000_000 + index * 3_600_000, close, max(close, next_close), min(close, next_close), next_close, 100.0))
        close = next_close
    rows.append(Bar("PENGUUSDT", rows[-1].ts_ms + 3_600_000, close, close, close, close, 100.0))
    return rows


class PenguRawRebuildTests(unittest.TestCase):
    def test_combined_filtered_emits_flat_one_gross_candidates(self):
        candidates = generate_pengu_candidates({"PENGUUSDT": pengu_bars([3.0])}, [], "NORMAL")
        self.assertTrue(candidates)
        self.assertTrue(all(candidate["logic"] == "COMBINED_FILTERED" for candidate in candidates))
        self.assertTrue(all(candidate["requestedGross"] == 1.0 for candidate in candidates))
        self.assertTrue(all(candidate["acceptedGross"] == 1.0 for candidate in candidates))
        self.assertEqual(candidates[0]["route"], "BASE_V64_LONG")

    def test_rejected_candidate_does_not_update_governor(self):
        state = {"realizedEquity": 100.0, "peakRealizedEquity": 100.0, "openProtection": {"stop": 0.9}}
        result = apply_pengu_q60_dd17_h72(state, {"accepted": False, "filled": False, "closed": False, "route": "RECOVERY_V8"})
        self.assertEqual(result, state)

    def test_hard_stop_quarantines_only_same_route_for_60_hours(self):
        state = {"realizedEquity": 100.0, "peakRealizedEquity": 100.0, "routeQuarantineUntil": {}}
        exit_ts = 1_700_000_000_000
        result = apply_pengu_q60_dd17_h72(state, {
            "accepted": True, "filled": True, "closed": True, "route": "RECOVERY_V8",
            "exitReason": "HARD_STOP", "exitTs": exit_ts, "pnl": -2.0,
        })
        self.assertEqual(result["routeQuarantineUntil"]["RECOVERY_V8"], exit_ts + 60 * 3_600_000)
        self.assertNotIn("BASE_V64_LONG", result["routeQuarantineUntil"])

    def test_realized_dd_minus_17_holds_new_entries_72_hours(self):
        state = {"realizedEquity": 100.0, "peakRealizedEquity": 100.0, "routeQuarantineUntil": {}}
        exit_ts = 1_700_000_000_000
        result = apply_pengu_q60_dd17_h72(state, {
            "accepted": True, "filled": True, "closed": True, "route": "SHORT_V20",
            "exitReason": "TAKE_PROFIT", "exitTs": exit_ts, "pnl": -17.0,
        })
        self.assertEqual(result["governorHoldUntil"], exit_ts + 72 * 3_600_000)
        self.assertTrue(result["newEntriesPaused"])

    def test_existing_protection_survives_governor_pause(self):
        protection = {"stop": 0.9, "reduceOnly": True}
        state = {"realizedEquity": 100.0, "peakRealizedEquity": 100.0, "openProtection": protection}
        result = apply_pengu_q60_dd17_h72(state, {
            "accepted": True, "filled": True, "closed": True, "route": "BASE_V64_LONG",
            "exitReason": "HARD_STOP", "exitTs": 1_700_000_000_000, "pnl": -20.0,
        })
        self.assertEqual(result["openProtection"], protection)

    def test_normalize_requires_next_bar_fill(self):
        candidate = {"signalTs": 1_700_003_600_000, "acceptedGross": 1.0, "route": "BASE_V64_LONG"}
        trade = normalize_pengu_trade(candidate, {"entryTs": 1_700_007_200_000, "entryPrice": 1.01})
        self.assertEqual(trade["fillSource"], "next-bar")
        self.assertEqual(trade["entryPrice"], 1.01)


if __name__ == "__main__":
    unittest.main()
