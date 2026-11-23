"""No real orders: validate root-pin V4 STOP diagnostic and Margin Guard entry."""
from __future__ import annotations

import importlib.util
import json
import pathlib
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts/ops/root/disdex-v4-resident-stop-crosscheck.py"
SPEC = importlib.util.spec_from_file_location("dynamic_v4_stop_crosscheck", SOURCE)
assert SPEC and SPEC.loader
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
RELEASE_SHA = "e788abc82e80f9fc7ab0e1ba83fdb8be267eb513"


class V4StopCrosscheckDynamicPinTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="disdex-stop-pin-")
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.now = int(time.time() * 1000)
        self.pins = self.root / "runner-pins.json"
        self.obs = self.root / "resident-stop-observation.json"
        self.ledger = self.root / "orders.json"
        self.hb = self.root / "heartbeat.json"
        self.write_manifest(RELEASE_SHA)
        self.obs.write_text(json.dumps({
            "schema": "resident-stop-observation/v1", "ok": True,
            "readOnly": True, "checkedAt": self.now,
            "positions": [], "unprotectedCount": 0}))
        self.ledger.write_text(json.dumps({
            "releaseSha": RELEASE_SHA, "state": {"legs": {}}, "protections": {}}))
        self.hb.write_text(json.dumps({
            "runtimeSha": RELEASE_SHA, "expectedSha": RELEASE_SHA,
            "serviceUnit": "disdex-v12-v4@" + RELEASE_SHA + ".service",
            "mode": "LIVE", "safetyState": "HEALTHY", "lastTickAt": self.now}))

    def write_manifest(self, sha, *, root=None, unit=None):
        self.pins.write_text(json.dumps({
            "schema": "disdex-runner-pin-manifest/v2",
            "target": "professional-dismanager.net",
            "operatorTarget": "DD1296_FINAL_ALLIN_10BPS",
            "runners": {"V12_V4": {
                "sha": sha,
                "releaseRoot": root if root is not None else "/home/deploy/disdex-trading/releases/" + sha,
                "serviceUnit": unit if unit is not None else "disdex-v12-v4@" + sha + ".service",
            }},
        }))

    def crosscheck(self):
        return MOD.run(
            now_ms=self.now, obs_path=self.obs, ledger_path=self.ledger,
            hb_path=self.hb, verify_service=False, pin_manifest=self.pins)

    def test_new_pin_is_used_instead_of_hardcoded_old_53a(self):
        out = self.crosscheck()
        self.assertEqual(out["status"], "HEALTHY")
        self.assertEqual(out["v4Sha"], RELEASE_SHA)
        self.assertTrue(out["readOnly"])
        self.assertEqual(out["ordersSent"], 0)
        self.assertEqual(out["cancelsSent"], 0)

    def test_stale_ledger_sha_blocks(self):
        self.ledger.write_text(json.dumps({
            "releaseSha": "53a0be396719f0284af4e11b35c66a4ac7d58f79",
            "state": {"legs": {}}, "protections": {}}))
        with self.assertRaisesRegex(RuntimeError, "V4_LEDGER_RELEASE_MISMATCH"):
            self.crosscheck()

    def test_invalid_manifest_release_path_and_unit_are_rejected(self):
        self.write_manifest(RELEASE_SHA, root="/tmp/malicious")
        with self.assertRaisesRegex(RuntimeError, "V4_ROOT_PIN_RELEASE_ROOT_INVALID"):
            self.crosscheck()
        self.write_manifest(RELEASE_SHA, unit="disdex-v12-v4@wrong.service")
        with self.assertRaisesRegex(RuntimeError, "V4_ROOT_PIN_UNIT_INVALID"):
            self.crosscheck()

    def test_unprotected_venue_observation_never_reports_healthy(self):
        observed=json.loads(self.obs.read_text())
        observed["unprotectedCount"]=1
        self.obs.write_text(json.dumps(observed))
        self.assertEqual(self.crosscheck()["status"], "BLOCKED")

    def test_script_alias_uses_existing_serialized_guard_only(self):
        wrapper=ROOT/"scripts/disdex_v12_v52_margin_guard_runtime.py"
        runtime=ROOT/"scripts/disdex_v96_v52_margin_guard_runtime.py"
        self.assertTrue(wrapper.is_file())
        self.assertTrue(runtime.is_file())
        content=wrapper.read_text(encoding="utf-8")
        self.assertIn("disdex_v96_v52_margin_guard_runtime.py",content)
        self.assertIn('runpy.run_path(str(canonical_guard_script()), run_name="__main__")',content)
        self.assertNotIn("ordersEnabled",content)


if __name__ == "__main__":
    unittest.main()
