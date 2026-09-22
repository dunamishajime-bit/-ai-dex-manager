from __future__ import annotations

import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in os.sys.path:
    os.sys.path.insert(0, str(SCRIPTS))

import disdex_margin_guard_state_reconcile as reconcile
import disdex_v96_v52_margin_guard as margin_guard


class MarginGuardStateReconcileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.paths = {
            "v12": self.root / "v12.json",
            "pengu": self.root / "pengu.json",
            "q102": self.root / "q102.json",
            "v52": self.root / "v52.json",
            "fet": self.root / "fet.json",
            "kill": self.root / "kill.json",
            "guard_root": self.root / "margin-risk",
        }
        self.paths["guard_root"].mkdir()
        self.env = {
            "V12_X1_ALL_STATE_PATH": str(self.paths["v12"]),
            "PENGU_DUAL_LS_V2_STATE_PATH": str(self.paths["pengu"]),
            "QUALITY102_CAUSAL_V1_STATE_PATH": str(self.paths["q102"]),
            "DISDEX_V52_ASTER_ONLY_STATE_PATH": str(self.paths["v52"]),
            "FET_BRK48_STATE_PATH": str(self.paths["fet"]),
        }
        self.stock_map = {"AAPL": "AAPLUSDT"}
        self.write_default_states()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, key: str, value: dict):
        path = self.paths[key]
        path.write_text(json.dumps(value), encoding="utf-8")
        os.chmod(path, 0o600)

    def read(self, key: str):
        return json.loads(self.paths[key].read_text(encoding="utf-8"))

    def write_default_states(self):
        self.write("v12", {
            "schema": "v12-x1-all-runner-state/v2",
            "strategyId": "V12_X1.00_ALL",
            "mode": "LIVE",
            "updatedAt": 1,
            "lastReferenceTs": 10_000,
            "activePositions": [{
                "symbol": "LINKUSDT", "side": "LONG", "quantity": 2.0,
            }],
        })
        self.write("pengu", {
            "version": 2,
            "strategyId": "PENGU_DUAL_LS_V2_FINAL",
            "mode": "LIVE",
            "updatedAt": 1,
            "lastSignalReferenceTs": 20_000,
            "position": {"side": -1, "quantity": 3.0},
            "failures": [],
        })
        self.write("q102", {
            "version": 1,
            "strategyId": "QUALITY102_CAUSAL_V1",
            "mode": "LIVE",
            "runtimeCommitSha": "a" * 40,
            "updatedAt": 1,
            "position": {"symbol": "DOGEUSDT", "side": 1, "quantity": 4.0, "entryPrice": 1, "entryTs": 1},
            "failures": [],
        })
        self.write("v52", {
            "schemaVersion": 3,
            "strategyId": "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",
            "updatedAt": 1,
            "positions": {
                "V11_EQ": {
                    "strategy": "V11_EQ",
                    "symbol": "AAPL",
                    "asterOpenSide": "BUY",
                    "asterQty": 5.0,
                },
            },
        })
        self.write("fet", {
            "schema": "fet-brk48-residual-state/v1",
            "strategyId": "FET_BRK48_RESIDUAL",
            "mode": "LIVE",
            "updatedAt": 1,
            "position": {"symbol": "FETUSDT", "side": 1, "quantity": 6.0},
        })

    def fills(self):
        return [
            {"symbol": "LINKUSDT", "side": "SELL", "status": "FILLED", "executedQty": "2"},
            {"symbol": "PENGUUSDT", "side": "BUY", "status": "FILLED", "executedQty": "3"},
            {"symbol": "DOGEUSDT", "side": "SELL", "status": "FILLED", "executedQty": "4"},
            {"symbol": "AAPLUSDT", "side": "SELL", "status": "FILLED", "executedQty": "5"},
            {"symbol": "FETUSDT", "side": "SELL", "status": "FILLED", "executedQty": "6"},
        ]

    def test_all_strategy_states_clear_only_after_exact_fill_evidence(self):
        original_stats = {key: self.paths[key].stat() for key in ("v12", "pengu", "q102", "v52", "fet")}
        result = reconcile.reconcile_emergency_flatten_states(
            self.fills(), env=self.env, stock_symbol_map=self.stock_map, now_ms=30_000
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["modifiedStrategies"], ["V12", "PENGU", "Q102", "V52", "FET"])
        self.assertNotIn("activePositions", self.read("v12"))
        self.assertEqual(self.read("v12")["cooldownUntilTs"], 7_210_000)
        self.assertNotIn("position", self.read("pengu"))
        self.assertEqual(self.read("pengu")["cooldownUntilTs"], 21_620_000)
        self.assertNotIn("position", self.read("q102"))
        self.assertEqual(self.read("v52")["positions"], {})
        for key, before in original_stats.items():
            after = self.paths[key].stat()
            self.assertEqual(after.st_uid, before.st_uid)
            self.assertEqual(after.st_gid, before.st_gid)
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(after.st_mode), 0o600)
        for backup in result["backups"].values():
            self.assertTrue(Path(backup).exists())

    def test_shared_symbol_claims_are_aggregated_before_fill_match(self):
        v12 = self.read("v12")
        v12["activePositions"][0]["quantity"] = 2.0
        self.write("v12", v12)
        q102 = self.read("q102")
        q102["position"] = {"symbol": "LINKUSDT", "side": 1, "quantity": 1.5, "entryPrice": 1, "entryTs": 1}
        self.write("q102", q102)
        self.write("pengu", {"version": 2, "strategyId": "PENGU_DUAL_LS_V2_FINAL", "mode": "LIVE", "updatedAt": 1, "failures": []})
        self.write("v52", {"schemaVersion": 3, "strategyId": "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96", "updatedAt": 1, "positions": {}})
        self.write("fet", {"schema": "fet-brk48-residual-state/v1", "strategyId": "FET_BRK48_RESIDUAL", "mode": "LIVE", "updatedAt": 1})
        result = reconcile.reconcile_emergency_flatten_states(
            [{"symbol": "LINKUSDT", "side": "SELL", "status": "FILLED", "executedQty": "3.5"}],
            env=self.env, stock_symbol_map=self.stock_map, now_ms=40_000,
        )
        self.assertEqual(result["claims"]["LINKUSDT"]["quantity"], 3.5)
        self.assertEqual(set(result["modifiedStrategies"]), {"V12", "Q102"})

    def test_quantity_mismatch_is_fail_closed_and_does_not_mutate_state(self):
        before = {key: self.paths[key].read_bytes() for key in ("v12", "pengu", "q102", "v52", "fet")}
        bad = self.fills()
        bad[0] = {**bad[0], "executedQty": "1.5"}
        with self.assertRaisesRegex(reconcile.EmergencyStateReconcileError, "CLAIM_FILL_QTY_MISMATCH"):
            reconcile.reconcile_emergency_flatten_states(
                bad, env=self.env, stock_symbol_map=self.stock_map, now_ms=50_000
            )
        for key, raw in before.items():
            self.assertEqual(self.paths[key].read_bytes(), raw)

    def test_partial_state_write_failure_rolls_back_prior_writes(self):
        before = {key: self.paths[key].read_bytes() for key in ("v12", "pengu", "q102", "v52", "fet")}
        real_write = reconcile._backup_and_write
        calls = {"count": 0}

        def flaky_write(path, raw, now_ms):
            calls["count"] += 1
            if calls["count"] == 2:
                raise OSError("synthetic second-state write failure")
            return real_write(path, raw, now_ms)

        with patch.object(reconcile, "_backup_and_write", side_effect=flaky_write):
            with self.assertRaisesRegex(
                reconcile.EmergencyStateReconcileError,
                "STATE_RECONCILIATION_WRITE_FAILED_ROLLED_BACK",
            ):
                reconcile.reconcile_emergency_flatten_states(
                    self.fills(), env=self.env, stock_symbol_map=self.stock_map, now_ms=55_000
                )
        for key, raw in before.items():
            self.assertEqual(self.paths[key].read_bytes(), raw)

    def test_pending_order_blocks_reconcile_without_mutation(self):
        v12 = self.read("v12")
        v12["pending"] = {"idempotencyKey": "x"}
        self.write("v12", v12)
        before = self.paths["v12"].read_bytes()
        with self.assertRaisesRegex(reconcile.EmergencyStateReconcileError, "V12_PENDING"):
            reconcile.reconcile_emergency_flatten_states(
                self.fills(), env=self.env, stock_symbol_map=self.stock_map, now_ms=60_000
            )
        self.assertEqual(self.paths["v12"].read_bytes(), before)

    def test_margin_guard_records_fill_evidence_without_mutating_strategy_state(self):
        kill = {
            "active": True,
            "action": "FLATTEN_MANAGED",
            "activatedAt": "2026-09-19T05:00:00Z",
            "reason": "Margin Guard test",
        }
        self.write("kill", kill)
        evidence_path = self.paths["guard_root"] / "emergency-flatten-evidence.json"
        before = {key: self.paths[key].read_bytes() for key in ("v12", "pengu", "q102", "v52", "fet")}
        guard = object.__new__(margin_guard.MarginGuard)
        guard.state_root = self.paths["guard_root"]
        guard.emergency_evidence_path = evidence_path
        guard.kill_switch_path = self.paths["kill"]

        result = guard.record_emergency_flatten_evidence({
            "fillResults": [
                {"symbol": "LINKUSDT", "side": "SELL", "status": "FILLED", "executedQty": "2"},
            ],
            "remainingManagedPositions": [],
        })

        self.assertEqual(result["status"], "FLATTEN_COMPLETE_PENDING_STATE_RECONCILIATION")
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        self.assertEqual(evidence["schemaVersion"], 2)
        self.assertEqual(evidence["status"], "FLATTEN_COMPLETE_PENDING_STATE_RECONCILIATION")
        self.assertEqual(evidence["killActivatedAt"], kill["activatedAt"])
        self.assertEqual(evidence["killReason"], kill["reason"])
        self.assertIsNone(evidence["stateReconciliation"])
        for key, raw in before.items():
            self.assertEqual(self.paths[key].read_bytes(), raw)

    def test_clean_flat_state_and_no_fills_is_idempotent(self):
        self.write("v12", {"schema": "v12-x1-all-runner-state/v2", "strategyId": "V12_X1.00_ALL", "mode": "LIVE", "updatedAt": 1})
        self.write("pengu", {"version": 2, "strategyId": "PENGU_DUAL_LS_V2_FINAL", "mode": "LIVE", "updatedAt": 1, "failures": []})
        self.write("q102", {"version": 1, "strategyId": "QUALITY102_CAUSAL_V1", "mode": "LIVE", "runtimeCommitSha": "a" * 40, "updatedAt": 1, "failures": []})
        self.write("v52", {"schemaVersion": 3, "strategyId": "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96", "updatedAt": 1, "positions": {}})
        self.write("fet", {"schema": "fet-brk48-residual-state/v1", "strategyId": "FET_BRK48_RESIDUAL", "mode": "LIVE", "updatedAt": 1})
        result = reconcile.reconcile_emergency_flatten_states(
            [], env=self.env, stock_symbol_map=self.stock_map, now_ms=70_000
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["modifiedStrategies"], [])


if __name__ == "__main__":
    unittest.main()
