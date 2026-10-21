#!/usr/bin/env python3
"""Regression tests: Task9 native allocator capture, no fabricated STOPs."""
from __future__ import annotations

import importlib.util
import pathlib
import unittest


DIR = pathlib.Path(__file__).resolve().parent
spec_capture = importlib.util.spec_from_file_location(
    "task9_legacy_capture_for_tests", DIR / "task9_legacy_evidence_capture.py")
capture = importlib.util.module_from_spec(spec_capture)
spec_capture.loader.exec_module(capture)
spec_verify = importlib.util.spec_from_file_location(
    "task9_native_parity_for_tests", DIR / "verify-task9-native-full8-parity.py")
audit = importlib.util.module_from_spec(spec_verify)
spec_verify.loader.exec_module(audit)


def original_source():
    return '''
def allocation_example():
    v12_last_stop_ts_by_symbol: dict[str, int] = defaultdict(int)
    v12_cooldown_by_symbol: dict[str, int] = defaultdict(int)
    def record_decision(candidate, status, reason, ts, **details):
        candidate_decisions.append({
            "candidate_id": candidate.get("candidate_id"),
        })
    def finalize_position(pid, ts, exit_price, reason):
        if position["strategy_id"] == "V12":
            v12_cooldown_by_symbol[(str(position.get("route") or "CORE"),symbol)] = ts + hours * HOUR
    for candidate in rows:
                if strategy == "V12" and ts < v12_cooldown_by_symbol[(str(candidate.get("route") or "CORE"),candidate["symbol"])]:
            record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SYMBOL_COOLDOWN", ts)
    curve = []
        curve.append((ts, equity))
    return {
        "scenario_id": scenario_id,
    }
def save_rows():
    for scenario_id in scenario_configs:
        trade_rows = result.pop("trade_rows")
        (scenario_dir / "portfolio-trades.jsonl").write_text(
            json.dumps(trade_rows))
'''


class TestNativeCapture(unittest.TestCase):
    def test_hooks_use_only_causal_accepted_stop(self):
        result = capture.instrument(original_source())
        self.assertIn('status == "ACCEPTED_MODELED_ENTRY"', result)
        self.assertIn('CAUSAL_HYPOTHETICAL_REJECTED_AT_T', result)
        self.assertIn('task9_stop_cooldown_by_symbol_side', result)
        self.assertIn('RESEARCH_INITIAL_ADVERSE_STOP_V12_SHORT_PCT2P5_12H_MFE1P0_R12', result)
        self.assertIn('V12:TASK9_ADVERSE_SIDE_COOLDOWN', result)
        self.assertIn('"task9_mtm_trace": task9_mtm_trace', result)
        self.assertIn('task9-mtm.jsonl', result)
        self.assertIn('source_venue_signed', result)

    def test_cumulative_long_is_opt_in_and_side_scoped(self):
        default = capture.instrument(original_source())
        cumulative = capture.instrument(original_source(), enable_v12_long=True)
        marker = 'RESEARCH_INITIAL_ADVERSE_STOP_V12_LONG_PCT2P0_12H_MFE1P0_R12'
        self.assertNotIn(marker, default)
        self.assertIn(marker, cumulative)
        self.assertIn('task9_stop_cooldown_by_symbol_side[k]', cumulative)
        self.assertIn('(candidate["symbol"], candidate["side"])', cumulative)

    def test_capture_rejects_missing_source_anchor(self):
        text = original_source().replace('candidate_decisions.append({', 'candidate_decisions.append(((')
        with self.assertRaisesRegex(RuntimeError, "DECISION_CAPTURE_ANCHOR_DRIFT"):
            capture.instrument(text)

    def test_capture_rejects_doubled_stop_cooldown_anchor(self):
        text = original_source().replace(
            '    curve = []', '    curve = []\n    curve = []')
        with self.assertRaisesRegex(RuntimeError, "TASK9_MTM_CAPTURE_ANCHOR_DRIFT"):
            capture.instrument(text)

    def test_capture_rejects_repeated_source_registration(self):
        text = original_source() + original_source()
        with self.assertRaisesRegex(RuntimeError, "DECISION_CAPTURE_ANCHOR_DRIFT"):
            capture.instrument(text)

    def test_financial_comparator_rejects_drift(self):
        audit.close(222818966.87803495, 222818966.87803495, "baseline")
        with self.assertRaisesRegex(RuntimeError, "TASK9_NATIVE_PARITY_FAILURE"):
            audit.close(200, 201, "different wallet")
        with self.assertRaisesRegex(RuntimeError, "TASK9_NATIVE_PARITY_FAILURE"):
            audit.close(-14.79, -14.78, "different DD")

    def test_hard_stop_uses_explicit_source_not_execution_inference(self):
        result = capture.instrument(original_source())
        self.assertIn('quantity_actual_fill', result)
        self.assertIn('source_venue_signed', result)
        self.assertIn('task9_stop_cooldown_by_symbol_side[k]', result)
        self.assertNotIn('PENGU:TASK9_ADVERSE_SIDE_COOLDOWN', result)


if __name__ == "__main__":
    unittest.main()
