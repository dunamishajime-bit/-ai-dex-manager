"""Fixed user-requested FET gate and gross-caps research tests."""
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from research.formal_five_bt.fet_dual_gate_combo_bt import (
    REQUESTED_CAPS, gate_candidate_stream, gate_reasons,
)
from research.formal_five_bt.portfolio_price_model import _research_risk_cap

HOUR = 3_600_000
START = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
ENTRY = START + 74 * HOUR


def make_history(px: float) -> list[dict]:
    return [
        {
            "event_time_ms": START + i * HOUR,
            "open": px * (1 + i / 1_000),
            "high": px * (1 + i / 1_000) * 1.01,
            "low": px * (1 + i / 1_000) * .99,
            "close": px * (1 + i / 1_000),
            "base_volume": 1_000,
        } for i in range(75)
    ]


class RequestedComboTests(unittest.TestCase):
    def test_requested_caps_leave_pengu_and_other_q102_unchanged(self):
        self.assertEqual(_research_risk_cap({"strategy_id": "Q102", "family": "BRK"}, REQUESTED_CAPS), .75)
        self.assertEqual(_research_risk_cap({"strategy_id": "Q102", "family": "MR"}, REQUESTED_CAPS), .75)
        self.assertEqual(_research_risk_cap({"strategy_id": "Q102", "family": "PB"}, REQUESTED_CAPS), 3.0)
        self.assertEqual(_research_risk_cap({"strategy_id": "FET"}, REQUESTED_CAPS), 1.0)
        self.assertEqual(_research_risk_cap({"strategy_id": "PENGU", "route": "SHORT_V20"}, REQUESTED_CAPS), 1.0)
        self.assertEqual(_research_risk_cap({"strategy_id": "PENGU", "route": "RECOVERY_V8"}, REQUESTED_CAPS), 1.0)

    def test_exact_inequalities_and_no_future_outcome_dependency(self):
        base = {"fet_return_24h": .15, "fet_atr_24h_pct": .02,
                "fet_minus_btc_24h": .03}
        self.assertEqual(gate_reasons(base), [
            "FET_PREENTRY_OVERHEAT_24H_15PCT_ATR_2PCT"])
        self.assertEqual(gate_reasons({**base,"fet_atr_24h_pct":.01999}), [])
        self.assertEqual(gate_reasons({
            **base, "fet_return_24h": .00999, "fet_minus_btc_24h": -1e-10}), [
            "FET_PREENTRY_RELATIVE_WEAK_BTC_AND_FET24H_LT_1PCT"])
        self.assertEqual(gate_reasons({
            **base, "fet_return_24h": .01, "fet_minus_btc_24h": -.01}), [])
        self.assertEqual(gate_reasons({
            **base, "fet_return_24h": .009, "fet_minus_btc_24h": 0}), [])

    def test_retains_original_rows_and_marks_gate_rejects_before_allocation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            klines = root / "data/normalized/aster/klines"
            klines.mkdir(parents=True)
            for symbol, px in (("FETUSDT", .2), ("BTCUSDT", 90000)):
                (klines / f"{symbol}.jsonl").write_text(
                    "".join(json.dumps(row) + "\n" for row in make_history(px)))
            rows = [
                {"strategy_id": "FET", "symbol": "FETUSDT",
                 "entry_ts_ms": ENTRY, "status": "MODELED_CLOSED_TRADE"},
                {"strategy_id": "PENGU", "symbol": "PENGUUSDT",
                 "entry_ts_ms": ENTRY, "status": "MODELED_CLOSED_TRADE"},
            ]
            features = {"fet_return_24h":.2,"fet_atr_24h_pct":.025,
                        "fet_minus_btc_24h": .16}
            with patch("research.formal_five_bt.fet_dual_gate_combo_bt.fet_entry_features",
                       return_value=features):
                dest,audit=gate_candidate_stream(rows,root/"data",root/"out")
            saved=[json.loads(s) for s in (
                dest/"crypto-price-model-candidates.jsonl").read_text().splitlines()]
            self.assertEqual(rows[0]["status"],"MODELED_CLOSED_TRADE")
            self.assertEqual(saved[0]["status"],"FET_RESEARCH_GATE_BLOCKED")
            self.assertEqual(saved[0]["original_candidate_status"],"MODELED_CLOSED_TRADE")
            self.assertEqual(saved[1]["status"],"MODELED_CLOSED_TRADE")
            self.assertEqual(audit[0]["research_gate_decision"],"BLOCK")

    def test_no_lookahead_for_live_feature_generator(self):
        from research.formal_five_bt.fet_entry_audit import fet_entry_features
        fet = {r["event_time_ms"]: r for r in make_history(.2)}
        btc = {r["event_time_ms"]: r for r in make_history(90000)}
        before = fet_entry_features(fet,btc,ENTRY)
        fet[ENTRY]["close"]=100000
        btc[ENTRY]["close"]=.001
        self.assertEqual(fet_entry_features(fet,btc,ENTRY),before)


if __name__ == "__main__":
    unittest.main()
