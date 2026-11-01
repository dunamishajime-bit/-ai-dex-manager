import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "scripts" / "ops" / "deploy" / "disdex_deployment_approval_store.py"
SHA = "a" * 40
PLAN = "b" * 64


class DeploymentApprovalStoreHelperTests(unittest.TestCase):
    def run_helper(self, store: Path, *, plan: str = PLAN):
        return subprocess.run(
            [
                sys.executable, str(HELPER), "create-pending",
                "--store", str(store),
                "--operation", "V12_V4_LIVE",
                "--scope", "V12_V4",
                "--orders-enabled", "false",
                "--target-sha", SHA,
                "--plan-sha256", plan,
                "--actor", "synthetic-owner",
                "--comment-id", "123456",
            ],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_create_and_reuse_are_serialized_and_revisioned(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Path(directory) / "deploy-approvals.json"
            first = self.run_helper(store)
            self.assertEqual(first.returncode, 0, first.stderr)
            rows = json.loads(store.read_text(encoding="utf-8"))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["status"], "PENDING")
            self.assertRegex(rows[0]["storeRevision"], r"^[0-9a-f-]{36}$")
            first_id = rows[0]["id"]

            second = self.run_helper(store)
            self.assertEqual(second.returncode, 0, second.stderr)
            rows2 = json.loads(store.read_text(encoding="utf-8"))
            self.assertEqual(len(rows2), 1)
            self.assertEqual(rows2[0]["id"], first_id)
            self.assertIn("APPROVAL_REQUEST_REUSED=TRUE", second.stdout)

    def test_corrupt_store_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Path(directory) / "deploy-approvals.json"
            store.write_text("{corrupt", encoding="utf-8")
            result = self.run_helper(store)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(store.read_text(encoding="utf-8"), "{corrupt")

    def test_scope_or_plan_change_creates_distinct_request(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Path(directory) / "deploy-approvals.json"
            self.assertEqual(self.run_helper(store).returncode, 0)
            result = self.run_helper(store, plan="c" * 64)
            self.assertEqual(result.returncode, 0, result.stderr)
            rows = json.loads(store.read_text(encoding="utf-8"))
            self.assertEqual(len(rows), 2)
            self.assertEqual({row["planSha256"] for row in rows}, {PLAN, "c" * 64})


if __name__ == "__main__":
    unittest.main()
