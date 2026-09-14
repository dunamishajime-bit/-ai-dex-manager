from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import disdex_v96_v52_margin_guard as margin_guard  # noqa: E402


class DynamicManagedSymbolTest(unittest.TestCase):
    def test_active_and_pending_v12_q102_symbols_are_managed_without_hardcoding(self):
        v12_state = ROOT / "tests" / "fixtures" / "v12-dynamic-margin-state.json"
        q102_state = ROOT / "tests" / "fixtures" / "q102-dynamic-margin-state.json"
        with patch.dict(os.environ, {
            "V12_X1_ALL_STATE_PATH": str(v12_state),
            "QUALITY102_CAUSAL_V1_STATE_PATH": str(q102_state),
        }, clear=False):
            managed = margin_guard.resolve_managed_symbols()
            self.assertTrue({"DOGEUSDT", "LINKUSDT", "AVAXUSDT", "AAVEUSDT"}.issubset(set(managed)))
            rows = [
                {"symbol": "DOGEUSDT", "positionAmt": "715", "markPrice": "0.08413", "liquidationPrice": "0.05"},
                {"symbol": "AVAXUSDT", "positionAmt": "2", "markPrice": "25", "liquidationPrice": "15"},
            ]
            active = margin_guard.active_managed_positions(rows, managed)
            self.assertEqual({row["symbol"] for row in active}, {"DOGEUSDT", "AVAXUSDT"})

    def test_requested_dynamic_symbol_is_managed_for_preorder_configuration(self):
        managed = margin_guard.resolve_managed_symbols(requested_symbol="APTUSDT")
        self.assertIn("APTUSDT", managed)


if __name__ == "__main__":
    unittest.main()
