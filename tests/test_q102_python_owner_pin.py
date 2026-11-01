import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.portable_temp import portable_temporary_directory

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from disdex_strict_portfolio_planner import load_quality102_live_state, read_quality102_live_state_document


class Q102PythonOwnerPinTests(unittest.TestCase):
    def test_independent_owner_pin_is_required_and_not_replaced_by_caller_sha(self):
        owner_sha = "b" * 40
        caller_sha = "a" * 40
        state = {
            "version": 1, "strategyId": "QUALITY102_CAUSAL_V1", "mode": "LIVE",
            "runtimeCommitSha": owner_sha, "updatedAt": 2000, "failures": [],
            "position": {"symbol": "FETUSDT", "side": -1, "quantity": 2,
                         "entryPrice": 11, "entryTs": 1000},
        }
        with portable_temporary_directory() as directory:
            path = Path(directory) / "q102.json"
            path.write_text(json.dumps(state), encoding="utf-8")
            with patch.dict(os.environ, {"DISDEX_RUNTIME_COMMIT_SHA": caller_sha,
                                        "DISDEX_Q102_RUNTIME_SHA": owner_sha}, clear=True):
                self.assertEqual(load_quality102_live_state(path, now_ms=3000).runtime_commit_sha, owner_sha)
                for invalid in ("", caller_sha, "not-a-commit"):
                    os.environ["DISDEX_Q102_RUNTIME_SHA"] = invalid
                    with self.assertRaises(RuntimeError):
                        load_quality102_live_state(path, now_ms=3000)
                del os.environ["DISDEX_Q102_RUNTIME_SHA"]
                with self.assertRaises(RuntimeError):
                    load_quality102_live_state(path, now_ms=3000)

    def test_document_and_ownership_are_derived_from_the_same_snapshot(self):
        owner_sha = "b" * 40
        state = {
            "version": 1, "strategyId": "QUALITY102_CAUSAL_V1", "mode": "LIVE",
            "runtimeCommitSha": owner_sha, "updatedAt": 2000, "failures": [],
            "position": {"symbol": "FETUSDT", "side": -1, "quantity": 2,
                         "entryPrice": 11, "entryTs": 1000},
        }
        changed = {**state, "position": {**state["position"], "quantity": 999}}
        with portable_temporary_directory() as directory:
            path = Path(directory) / "q102.json"
            path.write_text(json.dumps(state), encoding="utf-8")
            with patch.dict(os.environ, {"DISDEX_Q102_RUNTIME_SHA": owner_sha}, clear=True):
                with patch.object(Path, "read_text", side_effect=[json.dumps(state), json.dumps(changed)]) as reads:
                    _, raw, owned = read_quality102_live_state_document(path, now_ms=3000)
                self.assertEqual(reads.call_count, 1)
                self.assertEqual(raw["position"]["quantity"], 2)
                self.assertEqual(owned.quantity, 2)

    def test_flat_state_with_pending_entry_is_not_treated_as_empty(self):
        owner_sha = "b" * 40
        state = {
            "version": 1, "strategyId": "QUALITY102_CAUSAL_V1", "mode": "LIVE",
            "runtimeCommitSha": owner_sha, "updatedAt": 2000, "failures": [],
            "pending": {"idempotencyKey": "id", "clientOrderId": "q102-test", "phase": "submitted",
                        "symbol": "FETUSDT", "side": "SELL", "quantity": 2, "reduceOnly": False,
                        "referenceTs": 1000, "createdAt": 1500, "updatedAt": 2000},
        }
        with portable_temporary_directory() as directory:
            path = Path(directory) / "q102.json"
            path.write_text(json.dumps(state), encoding="utf-8")
            with patch.dict(os.environ, {"DISDEX_Q102_RUNTIME_SHA": owner_sha}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "PENDING"):
                    load_quality102_live_state(path, now_ms=3000)

    def test_configured_q102_missing_state_is_not_treated_as_flat(self):
        with portable_temporary_directory() as directory:
            missing = Path(directory) / "missing-q102.json"
            with patch.dict(os.environ, {"DISDEX_Q102_RUNTIME_SHA": "b" * 40}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "STATE.*(MISSING|UNAVAILABLE)"):
                    load_quality102_live_state(missing, now_ms=3000)

    def test_unconfigured_owner_does_not_prove_q102_is_flat(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "STATE_PATH_MISSING"):
                load_quality102_live_state(now_ms=3000)


if __name__ == "__main__":
    unittest.main()
