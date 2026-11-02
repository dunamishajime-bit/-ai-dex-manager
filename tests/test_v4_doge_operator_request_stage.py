import pathlib
import subprocess
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"scripts/ops/deploy/disdex_v4_doge_operator_request_stage.py"
RETIRED="DOGE_PROTECTED_POSITION_PLAN_RETIRED_MANUAL_FLAT"
NEW_SCOPE="REQUIRES_NEW_FLAT_STATE_PLAN_AND_SCOPE"

class DogeOperatorRequestStageTests(unittest.TestCase):
    def test_historical_protected_position_stager_is_permanently_retired(self):
        p=subprocess.run(["python3",str(SCRIPT)],capture_output=True,text=True)
        self.assertNotEqual(p.returncode,0)
        output=p.stderr+p.stdout
        self.assertIn(RETIRED,output)
        self.assertIn(NEW_SCOPE,output)

    def test_retired_stager_cannot_be_reactivated_by_legacy_arguments(self):
        p=subprocess.run([
            "python3",str(SCRIPT),
            "--approval-id","11111111-2222-3333-4444-555555555555",
            "--approval-store","/tmp/legacy-approvals.json",
            "--plan","/tmp/legacy-plan.json",
            "--guard","/tmp/legacy-guard.mjs",
            "--output-dir","/tmp/legacy-output",
        ],capture_output=True,text=True)
        self.assertNotEqual(p.returncode,0)
        output=p.stderr+p.stdout
        self.assertIn(RETIRED,output)
        self.assertIn(NEW_SCOPE,output)
        self.assertNotIn("READY_FOR_EXTERNAL_EXECUTOR",output)

if __name__=="__main__":
    unittest.main()
