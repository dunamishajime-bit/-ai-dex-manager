import subprocess
import unittest
from pathlib import Path
from scripts.ops.deploy.build_v52_q102_preview import BASE, patch_planner


class CandidateSourceTest(unittest.TestCase):
    def test_release_candidate_is_exactly_the_reviewed_baseline_patch(self):
        original = subprocess.check_output(["git", "show", BASE + ":scripts/disdex_strict_portfolio_planner.py"], text=True)
        candidate = Path("scripts/disdex_strict_portfolio_planner.py").read_text(encoding="utf8")
        self.assertEqual(candidate, patch_planner(original))

if __name__ == "__main__":
    unittest.main()
