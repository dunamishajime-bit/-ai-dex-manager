from __future__ import annotations

import os
import sys
import unittest
from itertools import permutations
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import disdex_v96_v52_margin_guard as margin_guard  # noqa: E402
import disdex_v96_v52_margin_risk_policy as margin_policy  # noqa: E402


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

    def test_cross_position_zero_liquidation_price_uses_valid_account_margin_basis(self):
        account = {
            "totalMaintMargin": "10",
            "totalMarginBalance": "100",
            "totalPositionInitialMargin": "6",
            "totalOpenOrderInitialMargin": "0",
            "availableBalance": "94",
        }
        positions = [{
            "symbol": "PENGUUSDT",
            "positionAmt": "4354",
            "markPrice": "0.00698699",
            "liquidationPrice": "0",
            "leverage": "5",
            "marginType": "cross",
        }]
        snapshot = margin_policy.build_margin_risk_snapshot(account, positions, ["PENGUUSDT"])
        decision = margin_policy.classify_margin_risk(snapshot)
        self.assertEqual(snapshot["activeManagedPositionCount"], 1)
        self.assertIsNone(snapshot["minimumLiquidationBufferPct"])
        self.assertEqual(snapshot["activeManagedPositions"][0]["liquidationPrice"], None)
        self.assertTrue(snapshot["activeManagedPositions"][0]["liquidationPriceAvailable"] is False)
        self.assertEqual(decision["stage"], "HEALTHY")
        self.assertTrue(decision["ordersAllowed"])

    def test_cross_zero_liquidation_uses_account_ratio_for_reduce_decision(self):
        account = {
            "totalMaintMargin": "80",
            "totalMarginBalance": "100",
            "totalPositionInitialMargin": "60",
            "totalOpenOrderInitialMargin": "0",
            "availableBalance": "20",
        }
        positions = [{
            "symbol": "PENGUUSDT",
            "positionAmt": "4354",
            "markPrice": "0.00698699",
            "liquidationPrice": "0",
            "leverage": "5",
            "marginType": "cross",
        }]
        decision = margin_policy.classify_margin_risk(
            margin_policy.build_margin_risk_snapshot(account, positions, ["PENGUUSDT"])
        )
        self.assertEqual(decision["stage"], "CRITICAL")
        self.assertFalse(decision["ordersAllowed"])

    def test_mixed_real_and_zero_liquidation_cross_positions_do_not_compare_none(self):
        account = {
            "totalMaintMargin": "2.160512516071036",
            "totalMarginBalance": "100",
            "totalPositionInitialMargin": "20",
            "totalOpenOrderInitialMargin": "0",
            "availableBalance": "80",
        }
        positions = [
            {
                "symbol": "LTCUSDT",
                "positionAmt": "1.092",
                "markPrice": "58.15",
                "liquidationPrice": "1.556",
                "leverage": "5",
                "marginType": "cross",
            },
            {
                "symbol": "LINKUSDT",
                "positionAmt": "5.07",
                "markPrice": "12.311",
                "liquidationPrice": "0",
                "leverage": "5",
                "marginType": "cross",
            },
        ]
        snapshot = margin_policy.build_margin_risk_snapshot(
            account, positions, ["LTCUSDT", "LINKUSDT"]
        )
        decision = margin_policy.classify_margin_risk(snapshot)
        self.assertEqual(snapshot["activeManagedPositionCount"], 2)
        self.assertAlmostEqual(snapshot["minimumLiquidationBufferPct"], 97.32416165090284, places=9)
        self.assertEqual(snapshot["nearestLiquidationSymbol"], "LTCUSDT")
        link = next(row for row in snapshot["activeManagedPositions"] if row["symbol"] == "LINKUSDT")
        self.assertIsNone(link["liquidationBufferPct"])
        self.assertEqual(link["riskBasis"], "ACCOUNT_MAINTENANCE_MARGIN_RATIO")
        self.assertEqual(decision["stage"], "HEALTHY")
        self.assertTrue(decision["ordersAllowed"])

    def test_mixed_zero_and_real_liquidation_is_order_independent(self):
        account = {
            "totalMaintMargin": "2",
            "totalMarginBalance": "100",
            "totalPositionInitialMargin": "20",
            "totalOpenOrderInitialMargin": "0",
            "availableBalance": "80",
        }
        rows = [
            {
                "symbol": "LINKUSDT",
                "positionAmt": "4.94",
                "markPrice": "12.37",
                "liquidationPrice": "0",
                "leverage": "5",
                "marginType": "cross",
            },
            {
                "symbol": "LTCUSDT",
                "positionAmt": "1.0",
                "markPrice": "58",
                "liquidationPrice": "1.56",
                "leverage": "5",
                "marginType": "cross",
            },
            {
                "symbol": "PENGUUSDT",
                "positionAmt": "4000",
                "markPrice": "0.0078",
                "liquidationPrice": "0",
                "leverage": "5",
                "marginType": "cross",
            },
        ]
        expected = None
        for ordered in permutations(rows):
            snapshot = margin_policy.build_margin_risk_snapshot(
                account, list(ordered), ["LINKUSDT", "LTCUSDT", "PENGUUSDT"]
            )
            self.assertEqual(snapshot["activeManagedPositionCount"], 3)
            self.assertEqual(snapshot["nearestLiquidationSymbol"], "LTCUSDT")
            self.assertEqual(
                sum(1 for row in snapshot["activeManagedPositions"] if row["liquidationBufferPct"] is None),
                2,
            )
            self.assertEqual(margin_policy.classify_margin_risk(snapshot)["stage"], "HEALTHY")
            current = snapshot["minimumLiquidationBufferPct"]
            expected = current if expected is None else expected
            self.assertAlmostEqual(current, expected, places=12)

    def test_zero_liquidation_isolated_or_missing_account_data_remains_fail_closed(self):
        base_row = {
            "symbol": "PENGUUSDT",
            "positionAmt": "4354",
            "markPrice": "0.00698699",
            "liquidationPrice": "0",
            "leverage": "5",
        }
        healthy_account = {
            "totalMaintMargin": "10",
            "totalMarginBalance": "100",
            "totalPositionInitialMargin": "6",
            "totalOpenOrderInitialMargin": "0",
            "availableBalance": "94",
        }
        with self.assertRaises(RuntimeError):
            margin_policy.build_margin_risk_snapshot(healthy_account, [{**base_row, "marginType": "isolated"}], ["PENGUUSDT"])
        with self.assertRaises(RuntimeError):
            margin_policy.build_margin_risk_snapshot({"totalMaintMargin": "10"}, [{**base_row, "marginType": "cross"}], ["PENGUUSDT"])


if __name__ == "__main__":
    unittest.main()
