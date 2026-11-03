import json
import subprocess
import unittest
from pathlib import Path

PREVIEW = "715c45842477bd244c0aa95d49be60285788acea"
REFRESH_HELPERS = "3524e3676848b9260f53164e07257acdda7bcc5c"

def source(path):
    return subprocess.check_output(["git", "show", PREVIEW + ":" + path])

def source_at(commit, path):
    return subprocess.check_output(["git", "show", commit + ":" + path])

class CandidateSourceTest(unittest.TestCase):
    def test_runtime_files_are_exactly_the_reviewed_preview(self):
        manifest = json.loads(source("deploy/v4-staged-overlay/manifest.json"))
        self.assertEqual(manifest["baseSha"], "53a0be396719f0284af4e11b35c66a4ac7d58f79")
        for row in manifest["files"]:
            with self.subTest(target=row["target"]):
                expected = source("deploy/v4-staged-overlay/" + row["source"]).replace(b"\r\n", b"\n")
                actual = Path(row["target"]).read_bytes().replace(b"\r\n", b"\n")
                self.assertEqual(actual, expected)

    def test_supervisor_fixture_is_the_reviewed_integration_version(self):
        expected = source("scripts/ops/root/disdex-runner-health-snapshot-v2.mjs").replace(b"\r\n", b"\n")
        self.assertEqual(Path("tests/fixtures/disdex-runner-health-snapshot-v2.mjs").read_bytes().replace(b"\r\n", b"\n"), expected)

    def test_refresh_helpers_are_exactly_the_reviewed_root_helpers(self):
        for path in (
            "scripts/ops/root/disdex-v4-evidence-refresh-activate",
        ):
            with self.subTest(path=path):
                expected = source_at(REFRESH_HELPERS, path).replace(b"\r\n", b"\n")
                actual = Path(path).read_bytes().replace(b"\r\n", b"\n")
                self.assertEqual(actual, expected)

if __name__ == "__main__":
    unittest.main()
