import os
import subprocess
import json
import tempfile
import types
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.ops.deploy.build_v52_q102_preview import build, patch_planner

BASE = "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"


class PreviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = subprocess.check_output(
            ["git", "show", BASE + ":scripts/disdex_strict_portfolio_planner.py"], text=True)

    def test_peer_pin_changes_preserve_existing_identity_and_freshness_checks(self):
        updated = patch_planner(self.source)
        self.assertIn("verify_q102_identity(runtime_sha)", updated)
        q102_section = updated.split("def load_quality102_live_state(", 1)[1].split("def read_quality102_live_state_document(", 1)[0]
        self.assertNotIn('expected_sha = str(os.environ.get("DISDEX_RUNTIME_COMMIT_SHA")', q102_section)
        self.assertIn("QUALITY102_STATE_STALE", updated)
        self.assertIn("QUALITY102_STATE_MISMATCH:identity", updated)
        self.assertIn('verify_peer_identity("FET_BRK48_RESIDUAL"', updated)
        self.assertIn('verify_peer_identity("IDLE_PRIORITY_SHORT"', updated)

    def test_unexpected_source_rejects_instead_of_guessing(self):
        with self.assertRaises(RuntimeError):
            patch_planner(self.source.replace("QUALITY102_STATE_MISMATCH:runtimeCommitSha", "OTHER"))
        with self.assertRaises(RuntimeError):
            patch_planner("unrelated source")

    def test_build_is_nonproduction_and_will_not_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "preview"
            build(output)
            self.assertTrue((output / "PREVIEW_NOT_A_RELEASE.txt").is_file())
            self.assertFalse((output / ".disdex-release-sha").exists())
            with self.assertRaises(FileExistsError):
                build(output)

    def test_actual_planner_uses_q102_verifier_with_distinct_v52_sha(self):
        seen = []
        fake = types.ModuleType("v52_q102_independent_pin")
        fake.verify_q102_identity = lambda sha: seen.append(sha)
        fake.verify_peer_identity = lambda runner, sha: sha
        with patch.dict(sys.modules, {"v52_q102_independent_pin": fake}), \
             patch.dict(os.environ, {"DISDEX_RUNTIME_COMMIT_SHA": "d" * 40}), \
             tempfile.TemporaryDirectory() as tmp:
            # Dataclasses require a registered module for type inspection.
            module = types.ModuleType("preview_planner")
            with patch.dict(sys.modules, {"preview_planner": module}):
                exec(compile(patch_planner(self.source), "preview_planner.py", "exec"), module.__dict__)
                state = Path(tmp) / "state.json"
                state.write_text(json.dumps({"version": 1, "strategyId": "QUALITY102_CAUSAL_V1",
                    "mode": "LIVE", "runtimeCommitSha": "e" * 40, "updatedAt": 1000,
                    "position": None, "failures": []}))
                self.assertIsNone(module.load_quality102_live_state(state, now_ms=1000))
                self.assertEqual(seen, ["e" * 40])
                pending_state = json.loads(state.read_text())
                pending_state["pending"] = {"phase":"submitted"}
                state.write_text(json.dumps(pending_state))
                with self.assertRaisesRegex(RuntimeError, "QUALITY102_PENDING_UNRECONCILED"):
                    module.load_quality102_live_state(state, now_ms=1000)
                pending_state["pending"] = None
                state.write_text(json.dumps(pending_state))
                trusted = json.dumps(pending_state)
                changed = json.dumps(dict(pending_state, runtimeCommitSha="b" * 40))
                with patch.object(Path, "read_text", side_effect=[trusted, changed]) as reads:
                    _, snapshot, owned = module.read_quality102_live_state_document(state, now_ms=1000)
                    self.assertEqual(snapshot["runtimeCommitSha"], "e" * 40)
                    self.assertIsNone(owned)
                    self.assertEqual(reads.call_count, 1)
                fake.verify_q102_identity = lambda sha: (_ for _ in ()).throw(RuntimeError("bad peer"))
                module.verify_q102_identity = fake.verify_q102_identity
                with self.assertRaisesRegex(RuntimeError, "bad peer"):
                    module.load_quality102_live_state(state, now_ms=1000)

    def test_existing_planner_accounts_fet_and_idle_using_each_peer_pin(self):
        seen = []
        fake = types.ModuleType("v52_q102_independent_pin")
        fake.verify_q102_identity = lambda sha: sha
        fake.verify_peer_identity = lambda runner, sha: seen.append((runner, sha)) or sha
        with patch.dict(sys.modules, {"v52_q102_independent_pin": fake}), tempfile.TemporaryDirectory() as tmp:
            module = types.ModuleType("preview_planner_peers")
            with patch.dict(sys.modules, {module.__name__: module}):
                exec(compile(patch_planner(self.source), "preview_planner.py", "exec"), module.__dict__)
                fet = Path(tmp) / "fet.json"
                fet.write_text(json.dumps({"schema":"fet-brk48-residual-state/v1", "strategyId":"FET_BRK48_RESIDUAL",
                    "runtimeCommitSha":"f" * 40, "updatedAt":1500, "pending":None, "manualReview":None,
                    "position":{"symbol":"FETUSDT", "side":1, "quantity":2, "entryPrice":90}}))
                idle = Path(tmp) / "idle.json"
                idle.write_text(json.dumps({"schema":"disdex-idle-priority-state/v2", "runtimeSha":"a" * 40,
                    "pending":None, "manualReview":None, "updatedAt":1500, "positions":[{"symbol":"TAOUSDT",
                    "side":"SHORT", "protectionVerified":True, "quantity":1, "entryPrice":100,
                    "signalTs":1000, "entryTs":1100, "exitTs":100000, "stopPrice":110, "takeProfitPrice":90,
                    "stopClientOrderId":module._idle_protected_entry_client_order_id("STOP","TAOUSDT",1000),
                    "takeProfitClientOrderId":module._idle_protected_entry_client_order_id("TP","TAOUSDT",1000)}]}))
                env = {"DISDEX_RUNTIME_COMMIT_SHA":"d" * 40, "FET_BRK48_STATE_PATH":str(fet),
                       "DISDEX_IDLE_PRIORITY_STATE_PATH":str(idle)}
                with patch.dict(os.environ, env, clear=True):
                    rows = [{"symbol":"FETUSDT","positionAmt":2,"markPrice":100,"entryPrice":90},
                            {"symbol":"TAOUSDT","positionAmt":-1,"markPrice":95,"entryPrice":100}]
                    self.assertEqual(module.quality102_crypto_notional_from_positions(rows, now_ms=2000), 295)
                    self.assertEqual(seen, [("FET_BRK48_RESIDUAL","f"*40), ("IDLE_PRIORITY_SHORT","a"*40)])
                    module.verify_peer_identity = lambda runner, sha: (_ for _ in ()).throw(RuntimeError("bad pin"))
                    with self.assertRaisesRegex(RuntimeError, "FET_STATE_POSITION_MISMATCH"):
                        module.quality102_crypto_notional_from_positions(rows, now_ms=2000)

if __name__ == "__main__":
    unittest.main()
