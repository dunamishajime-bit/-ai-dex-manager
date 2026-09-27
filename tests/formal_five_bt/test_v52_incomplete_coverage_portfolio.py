"""A closed V52 subsample does not certify missing selected Yahoo sessions."""
import json
from pathlib import Path
import tempfile
import unittest

from research.formal_five_bt.portfolio_price_model import run_portfolio_model


class V52IncompleteSelectionTests(unittest.TestCase):
    def run_skip(self, reason):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate_root = root / "candidates"
            candidate_root.mkdir()
            (candidate_root / "crypto-price-model-candidates.jsonl").write_text("")
            v52_root = root / "v52"
            v52_root.mkdir()
            skipped = {
                "status": "SKIPPED_CANDIDATE",
                "symbol": "NVDAUSDT",
                "decision_ts_ms": 1754796600000,
                "reason": reason,
            }
            (v52_root / "v52-model-ledger.jsonl").write_text(json.dumps(skipped) + "\n")
            (v52_root / "v52-model-summary.json").write_text(json.dumps({
                "status": "RESEARCH_PRICE_MODEL_CLOSED_SAMPLE",
                "unresolved_exit_trades": 0,
                "selected_unallocated_candidates": 1,
                "modeled_entries": 0,
                "modeled_closed_trades": 0,
            }))
            return run_portfolio_model(root / "data", candidate_root,
                                       root / "out", v52_ledger_root=v52_root)

    def test_missing_selected_reference_prices_invalidate_annual_status(self):
        for reason in ("YAHOO_SESSION_COVERAGE_INCOMPLETE",
                       "ENTRY_PRICE_CHAIN_UNVERIFIED",
                       "PREVIOUS_EXIT_UNVERIFIED_SAME_SESSION"):
            with self.subTest(reason=reason):
                result = self.run_skip(reason)
                self.assertEqual(result["status"], "INCOMPLETE_ALL_FIVE_PRICE_MODEL")
                self.assertFalse(result["v52_model_complete"])
                self.assertEqual(result["v52_missing_market_data_selected_candidates_excluded"], 1)
                self.assertEqual(result["v52_skipped_candidates"], 1)

    def test_occupied_v52_slot_is_allocation_rejection_not_data_gap(self):
        result = self.run_skip("SINGLE_V50_SLOT_ALREADY_OPEN")
        self.assertEqual(result["status"], "ALL_FIVE_H1_PRICE_MODEL_NOT_FORMAL_L2_VERIFIED")
        self.assertTrue(result["v52_model_complete"])
        self.assertEqual(result["v52_missing_market_data_selected_candidates_excluded"], 0)


if __name__ == "__main__":
    unittest.main()
