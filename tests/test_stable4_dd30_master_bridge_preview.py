"""STABLE4 DD30 master-control-plane bridge: offline-only evidence contract."""
from __future__ import annotations

import importlib.util
from io import BytesIO
import json
from pathlib import Path
import tarfile
import unittest
import hashlib

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/ops/deploy/stable4_dd30_master_bridge_preview.py"
SPEC = importlib.util.spec_from_file_location("stable4_dd30_preflight_bridge", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
BRIDGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BRIDGE)


class Stable4Dd30MasterBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw, cls.report = BRIDGE.prepare(ROOT)

    def test_commit_lineage_is_two_fixed_sources(self):
        self.assertEqual(cls_candidate := self.report["sourceCommit"], BRIDGE.CANDIDATE_SHA)
        self.assertEqual(self.report["masterCommit"], BRIDGE.CONTROL_SHA)
        self.assertEqual(self.report["formalImmutableGitReleaseCommit"], "NOT_CREATED")
        self.assertEqual(self.report["formalApproval"], "NOT_ISSUED")
        self.assertFalse(self.report["productionInstalled"])
        self.assertEqual(self.report["sourceDetails"]["masterControlPlaneFiles"], 38)

    def test_bundle_hash_and_reproducibility(self):
        self.assertEqual(BRIDGE.sha(self.raw), self.report["bundleSHA256"])
        again, report2 = BRIDGE.prepare(ROOT)
        self.assertEqual(again, self.raw)
        self.assertEqual(report2["bundleSHA256"], self.report["bundleSHA256"])

    def test_runtime_dd30_and_master_owner_approval_are_exact(self):
        with tarfile.open(fileobj=BytesIO(self.raw), mode="r:gz") as z:
            self.assertGreaterEqual(len(z.getmembers()), 900)
            def content(name):
                return z.extractfile(name).read()
            policy = content("config/v12V4AdoptionRiskPolicy.ts")
            self.assertIn(b"V12_V4_MAXIMUM_DRAWDOWN = 0.30", policy)
            self.assertEqual(
                policy.replace(b"\r\n", b"\n"),
                BRIDGE.git(ROOT, "show", BRIDGE.CANDIDATE_SHA +
                           ":config/v12V4AdoptionRiskPolicy.ts").replace(b"\r\n", b"\n"))
            self.assertEqual(
                content("scripts/ops/deploy/disdex_owner_approval.py").replace(b"\r\n", b"\n"),
                BRIDGE.git(ROOT, "show", BRIDGE.CONTROL_SHA +
                    ":scripts/ops/deploy/disdex_owner_approval.py").replace(b"\r\n", b"\n"))
            for path in BRIDGE.REQUIRED:
                self.assertIn(path, z.getnames())
            self.assertNotIn(".github/workflows/disdex-stable4-safety-repair-cutover.yml", z.getnames())
            evidence = json.loads(content("STABLE4_PRELIVE_SOURCE_MANIFEST.json"))
            self.assertFalse(evidence["productionDeploymentReady"])
            self.assertFalse(evidence["liveOrderEnable"])
            self.assertFalse(evidence["ownerDD30ApprovalVerified"])
            self.assertFalse(evidence["formalRootWorkflowRetargeted"])
            self.assertTrue(evidence["requiresNewReviewedCommitAndOwnerPlan"])
            self.assertEqual(evidence["payloadSha256"][
                "config/v12V4AdoptionRiskPolicy.ts"], hashlib.sha256(policy).hexdigest())

    def test_no_unsupported_ref_or_auto_live(self):
        with self.assertRaisesRegex(BRIDGE.PreliveBundleError, "UNREVIEWED_SOURCE_SHA"):
            BRIDGE.prepare(ROOT, candidate_sha="a" * 40)
        self.assertIn("NO_DD30_OWNER_APPROVAL", self.report["blockedReasons"])
        self.assertIn("C731_MARGIN_GUARD_RUNTIME_SCRIPT_MISSING_UNRESOLVED",
                      self.report["blockedReasons"])
        self.assertIn("OLD_Q102_B8D_SYSTEMD_CHDIR_STALE_UNIT_UNRESOLVED",
                      self.report["blockedReasons"])
        self.assertIn("FORMAL_ROOT_CUTOVER_TARGET_STILL_C731_OLD_PLAN",
                      self.report["blockedReasons"])


if __name__ == "__main__":
    unittest.main()
