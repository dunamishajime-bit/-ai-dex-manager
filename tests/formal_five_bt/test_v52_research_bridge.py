"""Fail-closed provenance tests for isolated V52 hourly research selection."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from research.formal_five_bt.v52_price_only_scan import MODEL_ID
from research.formal_five_bt.v52_research_bridge import load_price_only_research

SHA = "e1b58060d6263a3af7ced51bec854d3e211d2f35"


def build(root: Path, *, sha=SHA, selected=1):
    destination = root / "decisions"
    destination.mkdir(parents=True, exist_ok=True)
    rows = []
    for i, symbol in enumerate(("AMZN", "NVDA")):
        is_selected = i < selected
        rows.append({
            "strategy_id": "V52", "decision_model": MODEL_ID,
            "source_runtime_sha": sha, "route": "V50_POST_OPEN_BASIS",
            "decision_ts_ms": 1781548200000,
            "equity_reference_symbol": symbol,
            "symbol": symbol + "USDT", "window_ny": "11:30",
            "side": "SHORT", "entry_basis_bps": 100.0,
            "aster_entry_reference_price_usd": 101,
            "yahoo_entry_reference_price_usd": 100,
            "assumed_round_trip_cost_bps": 11,
            "shared_allocation_status": "NOT_EVALUATED",
            "historical_aster_fill_verified": False,
            "realized_pnl_usdt": None,
            "status": ("PRICE_ONLY_MODEL_SELECTED_UNALLOCATED"
                       if is_selected else "PRICE_ONLY_MODEL_NOT_TOP_RANK"),
        })
    raw = "".join(json.dumps(x) + "\n" for x in rows).encode()
    (destination / "V52-hourly-price-model.jsonl").write_bytes(raw)
    counts = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    manifest = {
        "model": MODEL_ID, "status": "RESEARCH_PRICE_ONLY_NOT_LIVE_PARITY",
        "runtime_sha": sha, "counts": counts,
        "decision_output": {
            "relative_path": "decisions/V52-hourly-price-model.jsonl",
            "rows": len(rows), "sha256": hashlib.sha256(raw).hexdigest()
        }
    }
    (root / "price-only-scan-manifest.json").write_text(json.dumps(manifest))
    return rows, manifest


class ResearchBridgeTests(unittest.TestCase):
    def test_valid_research_candidate_is_distinct_from_live_signal_and_fill(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            build(root)
            rows, info = load_price_only_research(root, SHA)
            self.assertEqual(info["selection_count"], 1)
            self.assertEqual(len(rows), 1)
            self.assertTrue(rows[0]["research_candidate"])
            self.assertFalse(rows[0]["candidate_signal"])
            self.assertFalse(rows[0]["fill_verified"])
            self.assertIsNone(rows[0]["realized_pnl_usdt"])
            self.assertEqual(rows[0]["status"], "RESEARCH_CANDIDATE_UNALLOCATED")

    def test_tampered_decision_data_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            build(root)
            p = root / "decisions/V52-hourly-price-model.jsonl"
            p.write_bytes(p.read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "HASH_MISMATCH"):
                load_price_only_research(root, SHA)

    def test_wrong_runtime_sha_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            build(root)
            with self.assertRaisesRegex(ValueError, "RUNTIME_MISMATCH"):
                load_price_only_research(root, "0" * 40)

    def test_duplicate_selected_same_window_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            build(root, selected=2)
            with self.assertRaisesRegex(ValueError, "MULTIPLE_SELECTED"):
                load_price_only_research(root, SHA)

    def test_invalid_row_live_fill_assertion_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            rows, manifest = build(root)
            rows[0]["historical_aster_fill_verified"] = True
            raw = "".join(json.dumps(x) + "\n" for x in rows).encode()
            (root / "decisions/V52-hourly-price-model.jsonl").write_bytes(raw)
            manifest["decision_output"]["sha256"] = hashlib.sha256(raw).hexdigest()
            (root / "price-only-scan-manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "SELECTED_ROW_UNVERIFIED"):
                load_price_only_research(root, SHA)


if __name__ == "__main__":
    unittest.main()
