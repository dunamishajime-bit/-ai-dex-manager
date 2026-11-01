import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "ops" / "root" / "disdex_runner_pin_render.py"
SPEC = importlib.util.spec_from_file_location("runner_pin_render", SCRIPT)
mod = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(mod)

MANIFEST = ROOT / "config" / "disdex-runner-pins-DD1296_FINAL_ALLIN_10BPS.json"

class RunnerPinRenderTests(unittest.TestCase):
    def test_render_uses_independent_runner_sha_values(self):
        raw = json.loads(MANIFEST.read_text())
        rendered = mod.render(mod.validate(raw))
        health = rendered["health-snapshot.env"]
        watchdog = rendered["watchdog.env"]
        v52 = rendered["v52-current.env"]
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_V52_EXPECTED_SHA=4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81", health)
        self.assertIn("DISDEX_HEALTH_SNAPSHOT_Q102_EXPECTED_SHA=ef1ab178e26a7bf5bddb6473467765edba242e1d", health)
        self.assertIn("DISDEX_WATCHDOG_V52_SERVICE_UNIT=disdex-v52-aster-only@4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81.service", watchdog)
        self.assertIn("DISDEX_V52_RUNTIME_SHA=4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81", v52)
        self.assertNotIn("DISDEX_HEALTH_SNAPSHOT_Q102_EXPECTED_SHA=7688ed7c93a1918d8b44837339b7da5584a868f5", health)

    def test_validation_rejects_cross_runner_sha_reuse_and_wrong_unit(self):
        raw = json.loads(MANIFEST.read_text())
        bad = json.loads(json.dumps(raw))
        bad["runners"]["V52"]["serviceUnit"] = bad["runners"]["FET_BRK48_RESIDUAL"]["serviceUnit"]
        with self.assertRaises(RuntimeError):
            mod.validate(bad)
        bad = json.loads(json.dumps(raw))
        bad["runners"]["QUALITY102_CAUSAL_V1"]["releaseRoot"] = bad["runners"]["FET_BRK48_RESIDUAL"]["releaseRoot"]
        with self.assertRaises(RuntimeError):
            mod.validate(bad)

if __name__ == "__main__":
    unittest.main()
