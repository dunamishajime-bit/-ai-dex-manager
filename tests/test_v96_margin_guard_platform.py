import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class V96MarginGuardPlatformTests(unittest.TestCase):
    def test_serialized_margin_guard_selftest_imports_on_windows(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "disdex_v96_v52_margin_guard_selftest.py")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn("serialized emergency reduce-only Margin Guard self-test: PASS", result.stdout)


if __name__ == "__main__":
    unittest.main()
