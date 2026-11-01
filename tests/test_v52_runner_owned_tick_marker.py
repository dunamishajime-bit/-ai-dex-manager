import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
v52 = importlib.import_module("disdex_v52_aster_only_live_engine")

SHA = "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
ROOT_PATH = f"/home/deploy/disdex-trading/releases/{SHA}"
UNIT = f"disdex-v52-aster-only@{SHA}.service"
NOW = 1_793_573_600_000

class V52RunnerOwnedTickTests(unittest.TestCase):
    def test_tick_marker_contract_is_exact(self):
        marker = v52.build_v52_tick_marker(
            runtime_sha=SHA,
            service_unit=UNIT,
            main_pid=512995,
            working_directory=ROOT_PATH,
            tick_completed_at=NOW,
            outcome="NO_SIGNAL",
            new_orders_allowed=True,
        )
        self.assertEqual(marker["schema"], "disdex-runner-tick/v1")
        self.assertEqual(marker["runnerId"], "V52")
        self.assertEqual(marker["runtimeSha"], SHA)
        self.assertEqual(marker["expectedSha"], SHA)
        self.assertEqual(marker["serviceUnit"], UNIT)
        self.assertEqual(marker["mainPid"], 512995)
        self.assertEqual(marker["workingDirectory"], ROOT_PATH)
        self.assertEqual(marker["tickCompletedAt"], NOW)
        self.assertEqual(marker["outcome"], "NO_SIGNAL")
        self.assertIs(marker["newOrdersAllowed"], True)

    def test_invalid_identity_is_rejected(self):
        base = dict(
            runtime_sha=SHA,
            service_unit=UNIT,
            main_pid=512995,
            working_directory=ROOT_PATH,
            tick_completed_at=NOW,
            outcome="NO_SIGNAL",
            new_orders_allowed=False,
        )
        for field, value in (
            ("runtime_sha", "bad"),
            ("service_unit", "wrong.service"),
            ("main_pid", 0),
            ("working_directory", "/wrong"),
            ("tick_completed_at", 0),
        ):
            with self.subTest(field=field):
                candidate = dict(base)
                candidate[field] = value
                with self.assertRaises(RuntimeError):
                    v52.build_v52_tick_marker(**candidate)

    def test_atomic_writer_replaces_regular_file(self):
        marker = v52.build_v52_tick_marker(
            runtime_sha=SHA,
            service_unit=UNIT,
            main_pid=512995,
            working_directory=ROOT_PATH,
            tick_completed_at=NOW,
            outcome="MARKET_CLOSED",
            new_orders_allowed=False,
        )
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "v52.json"
            v52.write_v52_tick_marker(path, marker)
            loaded = json.loads(path.read_text())
            self.assertEqual(loaded, marker)
            leftovers = [p for p in Path(td).iterdir() if p.name != "v52.json"]
            self.assertEqual(leftovers, [])


    def test_failed_decision_cycle_never_publishes_tick(self):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        published = []
        engine._refresh_idle_admission_heartbeat = lambda: None
        engine._publish_runner_tick = lambda outcome: published.append(outcome)

        with patch.object(v52.legacy.V52AsterOnlyEngine, "tick", side_effect=RuntimeError("boom")):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                engine.tick({})
        self.assertEqual(published, [])

        with patch.object(v52.legacy.V52AsterOnlyEngine, "idle_tick", side_effect=RuntimeError("locked")):
            with self.assertRaisesRegex(RuntimeError, "locked"):
                engine.idle_tick({"skipWithoutLock": True})
        self.assertEqual(published, [])

    def test_successful_cycles_publish_after_parent_returns(self):
        engine = object.__new__(v52.V52AsterOnlyEngine)
        published = []
        engine._refresh_idle_admission_heartbeat = lambda: None
        engine._publish_runner_tick = lambda outcome: published.append(outcome)
        with patch.object(v52.legacy.V52AsterOnlyEngine, "tick", return_value=None):
            engine.tick({})
        with patch.object(v52.legacy.V52AsterOnlyEngine, "idle_tick", return_value=None):
            engine.idle_tick({"skipWithoutLock": True})
        self.assertEqual(published, ["DECISION_CYCLE_COMPLETED", "MARKET_CLOSED_OR_NO_ACTION"])

if __name__ == "__main__":
    unittest.main()
