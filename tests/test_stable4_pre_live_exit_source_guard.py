"""Read-only source guard tests. No external network or order client."""
from __future__ import annotations

import copy
import importlib.util
from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "scripts/ops/stable4_pre_live_exit_source_guard.py"
SPEC = importlib.util.spec_from_file_location("stable4_exit_guard", GUARD)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
MANIFEST = json.loads((ROOT / "docs/production/stable4-exit-safety-candidate-source-manifest-20261123.json").read_text(encoding="utf8"))


class Stable4ExitGuardTest(unittest.TestCase):
    def test_exact_sources_and_exit_anchors_pass(self):
        x = module.assert_pre_live_source(ROOT)
        self.assertGreaterEqual(x["sourceFilesHashVerified"], 16)
        self.assertFalse(x["liveOrderAuthorization"])
        self.assertEqual(x["economicBtRuntimeParity"], "NOT_CERTIFIED")

    def test_one_modified_v4_sha_fails_closed(self):
        x = copy.deepcopy(MANIFEST)
        x["expectedSourceNormalizedSha256"]["lib/v12-v4-runner-engine.ts"] = "0" * 64
        with self.assertRaisesRegex(AssertionError, "STABLE4_PINNED_SOURCE_CHANGED"):
            module.assert_pre_live_source(ROOT, x)

    def test_unauthorized_live_flag_fails_closed(self):
        x = copy.deepcopy(MANIFEST)
        x["liveOrderAuthorizationGranted"] = True
        with self.assertRaisesRegex(AssertionError, "AUTHORITY_MUST_REMAIN_FALSE"):
            module.assert_pre_live_source(ROOT, x)

    def test_uncertified_economic_parity_cannot_be_claimed(self):
        x = copy.deepcopy(MANIFEST)
        x["stable4EconomicParityVersusResearchBtFullyCertified"] = True
        with self.assertRaisesRegex(AssertionError, "ECONOMIC_PARITY_UNPROVEN"):
            module.assert_pre_live_source(ROOT, x)


if __name__ == "__main__":
    unittest.main()
