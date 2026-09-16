import datetime as dt
import importlib
import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
v52 = importlib.import_module("disdex_v52_aster_only_legacy_engine")


class V52TelemetryContractTest(unittest.TestCase):
    def test_append_is_day_scoped_and_keeps_required_cost_fields(self):
        state = {}
        row = {
            "timestamp": 1,
            "nyDay": "2026-09-17",
            "strategy": "V50_POST_OPEN_BASIS",
            "symbol": "NVDAUSDT",
            "window": "11:30",
            "direction": "SHORT",
            "signalBasisBps": 72.0,
            "currentBasisBps": 70.0,
            "estimatedRoundTripCostBps": 18.0,
            "makerFeeBps": 0.0,
            "takerFeeBps": 6.0,
            "spreadBps": 4.0,
            "VWAPSlippageBps": 3.0,
            "safetyBufferBps": 5.0,
            "calculatedNetEdgeBps": 32.0,
            "maxRoundTripCostBps": 60.0,
            "minimumNetEdgeBps": 7.5,
            "accepted": True,
            "rejectionReasons": [],
            "grossRequested": 1.0,
            "grossAccepted": 1.0,
            "availableStockGross": 1.5,
            "totalGrossBeforeReservation": 1.0,
            "totalGrossAfterReservation": 2.0,
        }
        v52.append_v52_diagnostic(state, ny_day="2026-09-17", row=row)
        self.assertEqual(state["v52GateDiagnostics"]["nyDay"], "2026-09-17")
        self.assertEqual(state["v52GateDiagnostics"]["acceptedCandidates"], [row])
        for field in (
            "timestamp", "nyDay", "strategy", "symbol", "window", "direction",
            "estimatedRoundTripCostBps", "makerFeeBps", "takerFeeBps", "spreadBps",
            "VWAPSlippageBps", "safetyBufferBps", "calculatedNetEdgeBps",
            "maxRoundTripCostBps", "minimumNetEdgeBps", "accepted", "rejectionReasons",
            "grossRequested", "grossAccepted", "availableStockGross",
            "totalGrossBeforeReservation", "totalGrossAfterReservation",
        ):
            self.assertIn(field, state["v52GateDiagnostics"]["lastDecision"])

        v52.append_v52_diagnostic(state, ny_day="2026-09-18", row={**row, "nyDay": "2026-09-18", "accepted": False, "rejectionReasons": ["BASIS_BELOW_60"]})
        self.assertEqual(state["v52GateDiagnostics"]["nyDay"], "2026-09-18")
        self.assertEqual(len(state["v52GateDiagnostics"]["decisions"]), 1)
        self.assertEqual(state["v52GateDiagnostics"]["rejectionCounters"], {"BASIS_BELOW_60": 1})

    def test_legacy_day_diagnostics_are_reset_without_dropping_positions(self):
        now_ny = dt.datetime.now(tz=v52.base.NY).date().isoformat()
        engine = object.__new__(v52.V52AsterOnlyEngine)
        engine.minimum_entry_usd = 5.0
        engine.max_daily_loss_pct = 3.5
        engine.state = {
            "utcDay": dt.datetime.now(tz=v52.base.UTC).date().isoformat(),
            "v52StrategyDailyLossLatch": {"utcDay": dt.datetime.now(tz=v52.base.UTC).date().isoformat()},
            "nyDay": now_ny,
            "positions": {"V50_POST_OPEN_BASIS": {"symbol": "NVDAUSDT"}},
            "v52GateDiagnostics": {"nyDay": now_ny, "decisions": [{"rejectionReasons": ["BASIS_BELOW_75"]}]},
            "v50Top2Telemetry": {"nyDay": now_ny, "lastDecision": {"rejectionReasons": ["BASIS_BELOW_75"]}},
            "v50DailyEntriesDay": "2026-08-28",
            "v50SignalSnapshotDay": "2026-08-28",
            "v50SignalSnapshots": {"11:30": {"NVDAUSDT": {"timestamp": 1}}},
        }
        engine.save = lambda: None
        engine.reset_days()
        self.assertEqual(engine.state["v52GateDiagnostics"]["nyDay"], now_ny)
        self.assertEqual(engine.state["v52GateDiagnostics"]["decisions"], [])
        self.assertEqual(engine.state["v50Top2Telemetry"]["nyDay"], now_ny)
        self.assertEqual(engine.state["v50DailyEntriesDay"], now_ny)
        self.assertEqual(engine.state["v50SignalSnapshotDay"], now_ny)
        self.assertEqual(engine.state["v50SignalSnapshots"], {})
        self.assertEqual(engine.state["positions"]["V50_POST_OPEN_BASIS"]["symbol"], "NVDAUSDT")

    def test_v50_contract_constants_are_final_and_old_reasons_are_absent(self):
        self.assertEqual(v52.V50_MIN_ENTRY_BASIS_BPS, 60.0)
        self.assertEqual(v52.V50_CONVERGENCE_BPS, 20.0)
        self.assertEqual(v52.V50_BASIS_STOP_MULTIPLE, 1.75)
        self.assertEqual(v52.V50_MIN_NET_EDGE_BPS, 7.5)
        self.assertEqual(v52.V50_MAX_ROUND_TRIP_COST_BPS, 60.0)
        source = Path(v52.__file__).read_text(encoding="utf-8")
        self.assertNotIn("BASIS_BELOW_75", source)
        self.assertNotIn("NET_EDGE_BELOW_10", source)


if __name__ == "__main__":
    unittest.main()
