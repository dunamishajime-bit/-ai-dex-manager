import hashlib
import json
import pathlib
import subprocess
import tempfile
import time
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"scripts/ops/deploy/disdex_v4_doge_operator_request_stage.py"
PLAN=ROOT/"docs/ops/V4_DOGE_MISSED_TIME_EXIT_OPERATOR_PLAN_20261101.json"
GUARD=ROOT/"lib/v12-v4-doge-missed-time-guard.mjs"

def run(args):
    return subprocess.run(["python3",str(SCRIPT),*args],capture_output=True,text=True)

class DogeOperatorRequestStageTests(unittest.TestCase):
    def test_stage_exact_request_and_reject_duplicate(self):
        with tempfile.TemporaryDirectory() as td:
            td=pathlib.Path(td)
            plan_hash=hashlib.sha256(PLAN.read_bytes()).hexdigest()
            approval_id="11111111-2222-3333-4444-555555555555"
            store=td/"approvals.json"
            store.write_text(json.dumps([{
                "id":approval_id,
                "status":"APPROVED",
                "operation":"V4_DOGE_MISSED_TIME_EXIT",
                "scope":"V12_V4",
                "ordersEnabled":True,
                "targetSha":"53a0be396719f0284af4e11b35c66a4ac7d58f79",
                "planSha256":plan_hash,
                "approvalTokenExpiresAt":(int(time.time())+300)*1000,
            }]))
            out=td/"out"
            args=[
                "--approval-id",approval_id,
                "--approval-store",str(store),
                "--plan",str(PLAN),
                "--guard",str(GUARD),
                "--output-dir",str(out),
            ]
            p=run(args)
            self.assertEqual(p.returncode,0,p.stderr+p.stdout)
            data=json.loads(p.stdout)
            self.assertEqual(data["status"],"DOGE_OPERATOR_REQUEST_STAGED")
            request=json.loads(pathlib.Path(data["requestPath"]).read_text())
            self.assertEqual(request["state"],"READY_FOR_EXTERNAL_EXECUTOR")
            self.assertEqual(request["legId"],"DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000")
            self.assertEqual(request["qty"],226)
            self.assertFalse(request["entryAuthority"])
            self.assertEqual(request["ordersSent"],0)
            self.assertEqual(request["cancelsSent"],0)
            self.assertEqual(request["positionChangesSent"],0)

            p2=run(args)
            self.assertNotEqual(p2.returncode,0)
            self.assertIn("REQUEST_ALREADY_EXISTS",p2.stderr+p2.stdout)

    def test_rejects_expired_or_redeemed_approval(self):
        for patch,reason in [
            ({"approvalTokenExpiresAt":(int(time.time())-1)*1000},"APPROVAL_TOKEN_EXPIRED"),
            ({"redeemedByRunId":"123","approvalTokenExpiresAt":(int(time.time())+300)*1000},"APPROVAL_ALREADY_REDEEMED"),
        ]:
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as td:
                td=pathlib.Path(td)
                plan_hash=hashlib.sha256(PLAN.read_bytes()).hexdigest()
                row={
                    "id":"11111111-2222-3333-4444-555555555555",
                    "status":"APPROVED",
                    "operation":"V4_DOGE_MISSED_TIME_EXIT",
                    "scope":"V12_V4",
                    "ordersEnabled":True,
                    "targetSha":"53a0be396719f0284af4e11b35c66a4ac7d58f79",
                    "planSha256":plan_hash,
                }
                row.update(patch)
                store=td/"approvals.json"
                store.write_text(json.dumps([row]))
                p=run([
                    "--approval-id",row["id"],
                    "--approval-store",str(store),
                    "--plan",str(PLAN),
                    "--guard",str(GUARD),
                    "--output-dir",str(td/"out"),
                ])
                self.assertNotEqual(p.returncode,0)
                self.assertIn(reason,p.stderr+p.stdout)

if __name__=="__main__":
    unittest.main()
