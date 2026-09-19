from __future__ import annotations

import json
import os
import sys
import tempfile
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


    def test_recoverable_data_failure_holds_protected_positions_before_grace_expiry(self):
        with tempfile.TemporaryDirectory(prefix="margin-guard-grace-") as temporary:
            guard = object.__new__(margin_guard.MarginGuard)
            guard.live = True
            guard.mode = "live"
            guard.state_root = Path(temporary)
            guard.state_path = Path(temporary) / "guard-live.json"
            guard.kill_switch_path = Path(temporary) / "kill-switch.json"
            guard.state = {
                "stage": "HEALTHY",
                "ordersAllowed": True,
                "consecutiveFailures": 1,
                "activeManagedPositionCount": 1,
                "ordersSent": False,
                "cancelSent": False,
                "positionChangesSent": False,
            }
            guard.recovery_grace_ms = lambda: 10 * 60_000
            flatten_calls = []
            guard.emergency_flatten_managed = lambda decision: flatten_calls.append(dict(decision)) or {
                "ordersSent": True,
                "cancelSent": True,
                "positionChangesSent": True,
            }

            result = guard.handle_failure(RuntimeError("temporary authenticated API timeout"))
            kill = json.loads(guard.kill_switch_path.read_text(encoding="utf-8"))
            self.assertEqual(kill["action"], margin_guard.SOFT_HOLD_ACTION)
            self.assertTrue(kill["recoverable"])
            self.assertTrue(kill["graceDeadlineAt"])
            self.assertEqual(result["action"], "BLOCK_NEW_ORDERS_KEEP_PROTECTED_POSITIONS_AND_RETRY")
            self.assertTrue(result["recoveryGraceActive"])
            self.assertEqual(flatten_calls, [])
            self.assertFalse(result["ordersSent"])
            self.assertFalse(result["positionChangesSent"])

            self.assertTrue(guard.clear_recoverable_hold_if_owned("recovered"))
            cleared = json.loads(guard.kill_switch_path.read_text(encoding="utf-8"))
            self.assertFalse(cleared["active"])
            self.assertEqual(cleared["action"], margin_guard.SOFT_HOLD_ACTION)

    def test_recoverable_hold_escalates_only_after_grace_expiry(self):
        with tempfile.TemporaryDirectory(prefix="margin-guard-expired-") as temporary:
            guard = object.__new__(margin_guard.MarginGuard)
            guard.live = True
            guard.mode = "live"
            guard.state_root = Path(temporary)
            guard.state_path = Path(temporary) / "guard-live.json"
            guard.kill_switch_path = Path(temporary) / "kill-switch.json"
            guard.state = {
                "stage": "DATA_UNAVAILABLE",
                "ordersAllowed": False,
                "consecutiveFailures": 2,
                "activeManagedPositionCount": 1,
                "ordersSent": False,
                "cancelSent": False,
                "positionChangesSent": False,
            }
            guard.recovery_grace_ms = lambda: 10 * 60_000
            guard.kill_switch_path.write_text(json.dumps({
                "active": True,
                "strategyId": "DISDEX_V35_STRONG_RESERVED_PENGU_V96",
                "combinedStrategyId": "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",
                "action": margin_guard.SOFT_HOLD_ACTION,
                "reason": "temporary failure",
                "operator": margin_guard.MARGIN_GUARD_OPERATOR,
                "activatedAt": "2026-09-19T00:00:00+00:00",
                "recoverable": True,
                "graceStartedAt": "2026-09-19T00:00:00+00:00",
                "graceDeadlineAt": "2026-09-19T00:10:00+00:00",
            }), encoding="utf-8")
            flatten_calls = []
            guard.emergency_flatten_managed = lambda decision: flatten_calls.append(dict(decision)) or {
                "status": "PASS",
                "ordersSent": True,
                "cancelSent": True,
                "positionChangesSent": True,
            }

            result = guard.handle_failure(RuntimeError("still unavailable"))
            kill = json.loads(guard.kill_switch_path.read_text(encoding="utf-8"))
            self.assertEqual(kill["action"], margin_guard.HARD_FLATTEN_ACTION)
            self.assertEqual(kill.get("escalatedFrom"), margin_guard.SOFT_HOLD_ACTION)
            self.assertEqual(len(flatten_calls), 1)
            self.assertTrue(result["ordersSent"])
            self.assertTrue(result["positionChangesSent"])

    def test_hard_margin_stage_still_flattens_immediately(self):
        with tempfile.TemporaryDirectory(prefix="margin-guard-hard-") as temporary:
            guard = object.__new__(margin_guard.MarginGuard)
            guard.live = True
            guard.mode = "live"
            guard.state_root = Path(temporary)
            guard.state_path = Path(temporary) / "guard-live.json"
            guard.kill_switch_path = Path(temporary) / "kill-switch.json"
            guard.state = {
                "stage": "REDUCE",
                "ordersAllowed": False,
                "consecutiveFailures": 0,
                "activeManagedPositionCount": 1,
                "ordersSent": False,
                "cancelSent": False,
                "positionChangesSent": False,
            }
            flatten_calls = []
            guard.emergency_flatten_managed = lambda decision: flatten_calls.append(dict(decision)) or {
                "status": "PASS",
                "ordersSent": True,
                "cancelSent": True,
                "positionChangesSent": True,
            }

            result = guard.handle_failure(RuntimeError("risk data lost after REDUCE"))
            kill = json.loads(guard.kill_switch_path.read_text(encoding="utf-8"))
            self.assertEqual(kill["action"], margin_guard.HARD_FLATTEN_ACTION)
            self.assertEqual(len(flatten_calls), 1)
            self.assertTrue(result["ordersSent"])

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
