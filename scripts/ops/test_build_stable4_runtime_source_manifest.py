"""Source-only regression checks for explicit immutable Stable4 manifest pinning."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/ops/build_stable4_runtime_source_manifest.py"

def command(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          cwd=ROOT, text=True, capture_output=True, check=False)

class Stable4RuntimeManifestTests(unittest.TestCase):
    def test_source_sha_is_required_and_rejects_inexact_values(self):
        for args in [(), ("--source-sha", "HEAD"),
                     ("--source-sha", "a" * 39),
                     ("--source-sha", "A" * 40),
                     ("--source-sha", "a" * 40 + "--archive=/tmp/unsafe.tar")]:
            with self.subTest(args=args):
                result = command(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(result.stdout.startswith("{"))

    def test_manifest_uses_the_explicit_reviewed_commit_and_real_blob(self):
        sha = subprocess.check_output(["git", "rev-parse", "HEAD"],
                                      cwd=ROOT, text=True).strip()
        result = command("--source-sha", sha)
        self.assertEqual(result.returncode, 0, result.stderr[-1600:])
        row = json.loads(result.stdout)
        self.assertEqual(row["sourceSha"], sha)
        self.assertEqual(row["scope"], "REVIEW_ONLY")
        self.assertIs(row["ordersEnabled"], False)
        self.assertIs(row["credentialsIncluded"], False)
        self.assertIs(row["nodeModulesIncluded"], False)
        self.assertTrue(row["files"])
        by_path = {record["path"]: record for record in row["files"]}
        self.assertEqual(len(by_path), len(row["files"]))
        probe = "scripts/v12-v4-production-runner.ts"
        original = subprocess.check_output(["git", "show", sha + ":" + probe], cwd=ROOT)
        self.assertEqual(by_path[probe]["sha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(by_path[probe]["size"], len(original))
        for root_tool in ("disdex_stable4_h48_root_patch.py",
                          "disdex_pending_composite_upgrade.py",
                          "disdex_stable4_q102_bootstrap_seal.py"):
            self.assertIn("scripts/ops/root/" + root_tool, by_path)
        for required_data in ("docs/implementation/v12-v4-v2-full-year-priority.json",
                              "docs/research/V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json"):
            self.assertIn(required_data, by_path)

if __name__ == "__main__":
    unittest.main()
