"""Synthetic kernel contract tests; do NOT certify the formal 7.41e8 anchor."""
import json
import subprocess
import sys
import unittest
from pathlib import Path

from scripts.research.canonical_integrated_bt.core import (
    ReplayError, replay_synthetic, required_anchor_evidence,
)
from scripts.research.canonical_integrated_bt.source_bundle import inspect_source_bundle


def event(ident, hour, seq, kind, **kw):
    return {
        "event_id": ident,
        "ts": f"2026-01-{1 + hour // 24:02d}T{hour % 24:02d}:00:00Z",
        "seq": seq,
        "kind": kind,
        **kw,
    }


def entry(ident, hour, seq, strategy, route, pid, gross, price="100", symbol="PENGUUSDT", **kw):
    return event(ident, hour, seq, "ENTRY", strategy=strategy, route=route,
                 position_id=pid, symbol=symbol, gross=gross, price=price,
                 leverage="5", side=1, **kw)


def exit_(ident, hour, seq, strategy, pid, price, reason="HARD_STOP", **kw):
    return event(ident, hour, seq, "EXIT", strategy=strategy, position_id=pid,
                 price=price, reason=reason, **kw)


def policy(**override):
    return {
        "initial_capital": "100000",
        "crypto_gross_cap": "2",
        "stock_gross_cap": "1.5",
        "total_gross_cap": "3",
        "pengu_variant": "Q60_DD170_H72",
        **override,
    }


class CanonicalKernelStarterTests(unittest.TestCase):
    def test_summary_only_bundle_is_not_formal_source(self):
        manifest = Path("tests/fixtures/canonical-integrated-bt/summary-only.json")
        result = inspect_source_bundle(manifest)
        self.assertEqual(result["status"], "BLOCKED_MISSING_CANONICAL_SOURCE")
        self.assertEqual(result["reason"], "SOURCE_BUNDLE_KIND_NOT_FORMAL")

    def test_missing_event_ledger_is_fail_closed(self):
        manifest = Path("tests/fixtures/canonical-integrated-bt/missing-ledger.json")
        result = inspect_source_bundle(manifest)
        self.assertEqual(result["status"], "BLOCKED_MISSING_CANONICAL_SOURCE")
        self.assertEqual(result["reason"], "SOURCE_BUNDLE_EVENT_LEDGER_FILES_MISSING")
        self.assertEqual(result["missing_event_ledgers"], ["global"])

    def test_hash_mismatch_is_not_accepted_as_formal_input(self):
        manifest = Path("tests/fixtures/canonical-integrated-bt/hash-mismatch.json")
        result = inspect_source_bundle(manifest)
        self.assertEqual(result["status"], "BLOCKED_MISSING_CANONICAL_SOURCE")
        self.assertEqual(result["reason"], "SOURCE_BUNDLE_FILE_VERIFICATION_FAILED")
        self.assertEqual(result["hash_mismatches"], ["v12"])

    def test_manifest_fail_closed_and_no_formal_result(self):
        p = Path("scripts/research/canonical_integrated_bt/anchor-source-manifest.json")
        manifest = json.loads(p.read_text(encoding="utf-8"))
        missing = required_anchor_evidence(manifest)
        self.assertIn("original_run_id", missing)
        self.assertIn("strategy_source_shas.FET", missing)
        result = subprocess.run([sys.executable, "-m", "scripts.research.canonical_integrated_bt",
                                 "--mode", "compare"], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)["status"], "BLOCKED_MISSING_CANONICAL_SOURCE")
        self.assertIsNone(json.loads(result.stdout)["formal_results"])

    def test_same_route_q60_not_global(self):
        events = [
            entry("e1", 0, 0, "PENGU", "BASE_V64_LONG", "p1", "1"),
            exit_("x1", 1, 0, "PENGU", "p1", "95"),
            entry("e2", 2, 0, "PENGU", "BASE_V64_LONG", "p2", "1"),
            entry("e3", 2, 1, "PENGU", "RECOVERY_V8", "p3", "1"),
        ]
        r = replay_synthetic(events, policy())
        self.assertEqual(r["counts"]["PENGU.entries"], 2)
        self.assertEqual(r["counts"]["PENGU.closed"], 1)
        self.assertEqual(r["rejected"], [{"event_id": "e2", "reason": "PENGU_SAME_ROUTE_Q60"}])
        self.assertEqual(r["open_positions"], ["p3"])
        self.assertTrue(r["status"].startswith("SYNTHETIC"))

    def test_dd17_h72_uses_actual_accepted_close(self):
        events = [
            entry("e1", 0, 0, "PENGU", "BASE_V64_LONG", "p1", "1"),
            exit_("x1", 1, 0, "PENGU", "p1", "80"),
            entry("e2", 2, 0, "PENGU", "RECOVERY_V8", "p2", "1"),
            entry("e3", 74, 0, "PENGU", "RECOVERY_V8", "p3", "1"),
        ]
        r = replay_synthetic(events, policy())
        self.assertEqual(r["rejected"], [{"event_id": "e2", "reason": "PENGU_REALIZED_DD_H72"}])
        self.assertEqual(r["counts"]["PENGU.entries"], 2)
        self.assertEqual(r["counts"]["PENGU.closed"], 1)
        self.assertEqual(r["pengu_realized_equity"], "0.8")
        self.assertTrue(r["pengu_pause_until"].endswith("2026-01-04T01:00:00+00:00"))

    def test_rejected_candidate_never_updates_quarantine_or_realized_equity(self):
        events = [
            entry("e1", 0, 0, "V12", "RANK1", "v1", "2", symbol="BTCUSDT"),
            entry("e2", 1, 0, "PENGU", "BASE_V64_LONG", "p1", "1"),
        ]
        r = replay_synthetic(events, policy())
        self.assertEqual(r["rejected"], [{"event_id": "e2", "reason": "SHARED_GROSS_CAP"}])
        self.assertEqual(r["pengu_realized_equity"], "1")
        self.assertFalse(r["pengu_route_quarantine"])
        self.assertEqual(r["counts"].get("PENGU.entries", 0), 0)

    def test_shared_gross_partial_release_then_fet_accept(self):
        events = [
            entry("e1", 0, 0, "V12", "RANK1", "v1", "1.5", symbol="BTCUSDT"),
            entry("e2", 1, 0, "FET", "BRK48", "f1", "1", symbol="FETUSDT"),
            exit_("x1", 2, 0, "V12", "v1", "100", reason="TAKE_PROFIT", fraction="0.3333333333333333333333333333"),
            entry("e3", 3, 0, "FET", "BRK48", "f2", "1", symbol="FETUSDT"),
        ]
        r = replay_synthetic(events, policy())
        self.assertEqual(r["rejected"], [{"event_id": "e2", "reason": "SHARED_GROSS_CAP"}])
        self.assertEqual(r["counts"].get("FET.entries"), 1)
        self.assertEqual(r["open_positions"], ["f2", "v1"])

    def test_reservations_count_before_fill_and_are_consumed_once(self):
        events = [
            event("r1", 0, 0, "RESERVE", strategy="V12", reservation_id="r-v12", gross="1.5"),
            entry("e1", 1, 0, "PENGU", "BASE_V64_LONG", "p1", "1"),
            entry("e2", 2, 0, "V12", "RANK1", "v1", "1.5",
                  symbol="BTCUSDT", reservation_id="r-v12"),
        ]
        r = replay_synthetic(events, policy())
        self.assertEqual(r["rejected"], [{"event_id": "e1", "reason": "SHARED_GROSS_CAP"}])
        self.assertEqual(r["open_reservations"], [])
        self.assertEqual(r["counts"].get("V12.entries"), 1)

    def test_entry_fees_affect_realized_governor(self):
        r = replay_synthetic([
            entry("e1", 0, 0, "PENGU", "BASE_V64_LONG", "p1", "1", fee_rate="0.01"),
            exit_("x1", 1, 0, "PENGU", "p1", "100", reason="MAX_HOLD", fee_rate="0.01"),
        ], policy())
        self.assertEqual(r["pengu_realized_equity"], "0.98")

    def test_duplicate_and_non_utc_are_rejected(self):
        e = entry("e1", 0, 0, "PENGU", "BASE_V64_LONG", "p1", "1")
        with self.assertRaisesRegex(ReplayError, "DUPLICATE_EVENT_ID"):
            replay_synthetic([e, e], policy())
        with self.assertRaisesRegex(ReplayError, "TIMESTAMP_NOT_UTC"):
            replay_synthetic([{**e, "ts": "2026-01-01T00:00:00+09:00"}], policy())

    def test_deterministic_input_reordering(self):
        events = [
            entry("e1", 0, 0, "PENGU", "BASE_V64_LONG", "p1", "1"),
            exit_("x1", 1, 0, "PENGU", "p1", "105", reason="TAKE_PROFIT"),
            entry("e2", 2, 0, "PENGU", "RECOVERY_V8", "p2", "1"),
        ]
        self.assertEqual(replay_synthetic(events, policy()), replay_synthetic(list(reversed(events)), policy()))


if __name__ == "__main__":
    unittest.main()
