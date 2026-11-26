"""STABLE4 DD30 integrated release: source/authority regression, no order IO."""
from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/ops/deploy/stable4_dd30_integrated_source_gate.py"
SPEC = importlib.util.spec_from_file_location("integrated_dd30_gate", SCRIPT)
assert SPEC and SPEC.loader
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
MANIFEST = json.loads((
    ROOT / "docs/production/STABLE4_DD30_INTEGRATED_SOURCE_MANIFEST_20261123.json").read_text(encoding="utf8"))


class IntegratedStable4Dd30GuardTests(unittest.TestCase):
    def test_all_critical_sources_and_master_goal_are_verified(self):
        out = MOD.verify(ROOT)
        self.assertEqual(out["integratedFilesVerified"], len(MOD.REQUIRED_TOKENS))
        self.assertEqual(out["v4Dd30EntryHold"], "PASS")
        self.assertEqual(out["ownerGoalApprovalCode"], "PRESERVED")
        self.assertFalse(out["productionInstalled"])
        self.assertFalse(out["liveOrderAuthorization"])
        self.assertEqual(out["oldC731Cutover"], "BLOCKED_REQUIRES_NEW_EXACT_SHA_GOAL_PLAN")

    def test_change_in_critical_venue_or_stop_api_rejected(self):
        data = copy.deepcopy(MANIFEST)
        data["sourceSha256"]["lib/v12-v4-runner-engine.ts"] = "0" * 64
        with self.assertRaisesRegex(AssertionError, "INTEGRATED_SOURCE_SHA_MISMATCH"):
            MOD.verify(ROOT, data)

    def test_new_h48_and_q102_v52_sources_cannot_be_swapped(self):
        new_sources = (
            "lib/disdex-quality102-causal-v4-signal.ts",
            "lib/disdex-quality102-highvol-d126.ts",
            "lib/disdex-runner-cumulative-dd.ts",
            "lib/v12-v4-production-lifecycle.ts",
            "lib/v12-v4-shared-reservations.ts",
            "lib/hype-h48-native-stop8-coordinator.ts",
            "lib/hype-h48-stop8-root-authority.ts",
            "scripts/disdex_v52_aster_only_legacy_engine.py",
            "scripts/disdex_v52_daily_loss.py",
            "scripts/ops/deploy/disdex_h48_stop8_formal_issue.py",
        )
        for path in new_sources:
            data = copy.deepcopy(MANIFEST)
            self.assertIn(path, data["sourceSha256"])
            data["sourceSha256"][path] = "0" * 64
            with self.subTest(path=path), self.assertRaisesRegex(
                    AssertionError, "INTEGRATED_SOURCE_SHA_MISMATCH"):
                MOD.verify(ROOT, data)

    def test_wrong_dd21_or_dd30_hard_limit_claim_rejected(self):
        for patch in (
            {"v4DdEntryHold": .21},
            {"portfolioDrawdownGuaranteedBelow30": True},
        ):
            data = copy.deepcopy(MANIFEST)
            data.update(patch)
            with self.assertRaisesRegex(AssertionError, "DD30_SCOPE_INVALID"):
                MOD.verify(ROOT, data)

    def test_old_owner_approval_cannot_be_reused(self):
        for patch in (
            {"ownerApprovalVerified": True},
            {"formalCutoverComplete": True},
            {"oldC731FormalCutoverMayBeUsed": True},
        ):
            data = copy.deepcopy(MANIFEST)
            data.update(patch)
            with self.assertRaises(AssertionError):
                MOD.verify(ROOT, data)

    def test_no_order_authority_can_be_claimed_by_source_gate(self):
        data = copy.deepcopy(MANIFEST)
        data["liveOrderAuthority"] = True
        with self.assertRaisesRegex(AssertionError, "UNVERIFIED_LIVE_AUTHORITY_FORBIDDEN"):
            MOD.verify(ROOT, data)


if __name__ == "__main__":
    unittest.main()
