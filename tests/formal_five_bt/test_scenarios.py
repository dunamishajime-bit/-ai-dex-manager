import unittest

from research.formal_five_bt.scenarios import ExecutionSample, select_execution_conditions


def sample(venue, spread, impact, funding, *, verified=True, ts=100):
    return ExecutionSample(
        venue=venue, source=f"{venue}-source", instrument_id="BTCUSDT", timestamp_ms=ts,
        spread_bps=spread, impact_bps=impact, position_adverse_funding_bps=funding,
        snapshot_verified=verified, sequence_verified=verified, instrument_verified=verified,
    )


class ExecutionScenarioTests(unittest.TestCase):
    def test_normal_proxy_gap_uses_medians_of_valid_alternate_venues(self):
        rows = [sample("ASTER", 2, 0, 0), sample("BINANCE", 4, 1, 1), sample("BYBIT", 6, 2, 2)]
        result = select_execution_conditions(rows, scenario="NORMAL", coverage_path="PROXY_APPLIED",
                                             decision_time_ms=200, aster_data_available=False, initial_gap=True)
        self.assertEqual(result.status, "VERIFIED_PROXY_RESEARCH")
        self.assertEqual(result.execution_cost_bps, 4.0)
        self.assertEqual(result.adverse_funding_bps, 1.5)
        self.assertEqual(result.valid_venues, ("BINANCE", "BYBIT"))

    def test_aster_data_only_skips_initial_gap_without_valid_aster_book(self):
        result = select_execution_conditions([sample("BYBIT", 4, 1, 1)], scenario="SEVERE",
                                              coverage_path="ASTER_DATA_ONLY", decision_time_ms=200,
                                              aster_data_available=False, initial_gap=True)
        self.assertEqual(result.status, "SKIPPED")
        self.assertEqual(result.reason, "ASTER_L2_OR_FUNDING_UNAVAILABLE_IN_INITIAL_GAP")

    def test_normal_prefers_verified_aster_after_gap_but_severe_uses_worst_valid_venues(self):
        rows = [sample("ASTER", 2, 1, 0.5), sample("BINANCE", 10, 3, 1), sample("BYBIT", 6, 2, 4)]
        normal = select_execution_conditions(rows, scenario="NORMAL", coverage_path="PROXY_APPLIED",
                                             decision_time_ms=200, aster_data_available=True, initial_gap=False)
        severe = select_execution_conditions(rows, scenario="SEVERE", coverage_path="PROXY_APPLIED",
                                             decision_time_ms=200, aster_data_available=True, initial_gap=False)
        self.assertEqual(normal.sample.venue, "ASTER")
        self.assertEqual(normal.execution_cost_bps, 2.0)
        self.assertEqual(severe.execution_cost_bps, 8.0)
        self.assertEqual(severe.adverse_funding_bps, 4.0)
        self.assertEqual(severe.execution_cost_source, "BINANCE-source")
        self.assertEqual(severe.funding_source, "BYBIT-source")
        self.assertTrue(severe.cross_venue_stress_available)

    def test_unverified_book_never_enters_cost_selection(self):
        result = select_execution_conditions([sample("ASTER", 0.1, 0, 0, verified=False)],
                                              scenario="NORMAL", coverage_path="ASTER_DATA_ONLY",
                                              decision_time_ms=200, aster_data_available=True, initial_gap=False)
        self.assertEqual(result.status, "NOT_VERIFIABLE")
        self.assertIsNone(result.execution_cost_bps)


if __name__ == "__main__":
    unittest.main()
