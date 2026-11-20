from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
WF=(ROOT/".github/workflows/disdex-v52-f333-owner-approved-cutover.yml").read_text()
HELPER=(ROOT/"scripts/ops/deploy/disdex_v52_owner_approved_f333_cutover.py").read_text()
class WorkflowContractTest(unittest.TestCase):
    def test_source_ci_does_not_wait_for_the_production_mutex(self):
        block=WF.split('concurrency:',1)[1].split('jobs:',1)[0]
        self.assertIn("github.event_name == 'workflow_dispatch'",block)
        self.assertIn("'disdex-unified-production'",block)
        self.assertIn("format('disdex-v52-source-{0}', github.ref)",block)
        self.assertIn('cancel-in-progress: false',block)
    def test_production_is_master_owner_environment_gated(self):
        self.assertIn("github.ref == 'refs/heads/master'",WF)
        self.assertIn("github.actor == 'dunamishajime-bit'",WF)
        self.assertIn("name: disdex-production",WF)
    def test_preflight_precedes_prepare_and_execute(self):
        self.assertLess(WF.index("--preflight-readonly"),WF.index("--prepare-approved"))
        self.assertLess(WF.index("--prepare-approved"),WF.index("--execute-approved"))
    def test_helper_preserves_hold_and_uses_generic_inventory(self):
        self.assertIn("KILL_SWITCH_UNEXPECTEDLY_CLEARED",HELPER)
        self.assertIn("VENUE_INVENTORY_CHANGED_DURING_CUTOVER",HELPER)
        self.assertNotIn("RESIDENT_DOGE_POSITION_MISMATCH",HELPER)
        self.assertNotIn("v12-v4-98ded39746ed3502a4d7b0e26ef9",HELPER)
    def test_exact_candidate_is_bound(self):
        self.assertIn("f33301be4805969333a5c580feaa38b72f825236",HELPER)
        self.assertIn("4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81",HELPER)
if __name__=="__main__":
    unittest.main()
