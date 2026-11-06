"""Credential-free regression cases for HYPE-only protected-hold cutover."""
import copy
import hashlib
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path, PurePosixPath
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts/ops/deploy"))
import disdex_hype_scoped_root_cutover as h
from disdex_deployment_plan import canonical, IDS, SCHEMA
from disdex_deployment_contract import REPO, DEPLOYMENT_TARGET, OPERATOR_TARGET


def plan(sha, scope="V12_V4", orders=True):
    p={
        "schema":SCHEMA,"repository":REPO,
        "deploymentTarget":DEPLOYMENT_TARGET,"operatorTarget":OPERATOR_TARGET,
        "sourceSha":sha,"scope":scope,
        "runners":{key:h.OLD for key in IDS},
        "uiSha":h.OLD,"monitorSha":h.OLD,
        "releaseRoots":{"runners":"/home/deploy/disdex-trading/releases",
                        "ui":"/home/deploy/disdex-trading/releases",
                        "monitor":"/home/deploy/disdex-trading/releases"},
        "ordersEnabled":orders,
    }
    return p


class HypeSafetyTests(unittest.TestCase):
    NEW="d6bcc94512a6416189cd92d7203b9ac3b2c98e70"
    def setUp(self):
        self.old=plan(h.OLD)
        self.target=copy.deepcopy(self.old)
        self.target.update(sourceSha=self.NEW,scope=h.RUNNER)
        self.target["runners"][h.RUNNER]=self.NEW
        self.pins=self.old["runners"].copy()

    def test_scope_exact(self):
        self.assertEqual(h.validate_hype_plan(self.target,self.old,self.pins,self.NEW),
                         hashlib.sha256(canonical(self.target)).hexdigest())

    def test_source_sha_mismatch_blocks(self):
        self.target["sourceSha"]=h.OLD
        with self.assertRaises(ValueError):
            h.validate_hype_plan(self.target,self.old,self.pins,self.NEW)

    def test_peer_change_blocks(self):
        self.target["runners"]["PENGU_V8"]=self.NEW
        with self.assertRaises(ValueError):
            h.validate_hype_plan(self.target,self.old,self.pins,self.NEW)

    def test_ui_change_blocks(self):
        self.target["uiSha"]=self.NEW
        with self.assertRaises(ValueError):
            h.validate_hype_plan(self.target,self.old,self.pins,self.NEW)

    def test_current_pin_stale_blocks(self):
        self.pins["FET_BRK48_RESIDUAL"]=self.NEW
        with self.assertRaises(ValueError):
            h.validate_hype_plan(self.target,self.old,self.pins,self.NEW)

    def test_noop_blocked(self):
        self.target["runners"][h.RUNNER]=h.OLD
        with self.assertRaises(ValueError):
            h.validate_hype_plan(self.target,self.old,self.pins,self.NEW)

    def test_permission_false_blocked(self):
        self.target["ordersEnabled"]=False
        with self.assertRaises(ValueError):
            h.validate_hype_plan(self.target,self.old,self.pins,self.NEW)

    def test_flat_valid(self):
        self.assertEqual(h.validate_flat_hype_state({
            "schema":"disdex-hype-zec-long/v1","mode":"LIVE",
            "runtimeCommitSha":h.OLD,"updatedAt":1,"failures":[]},h.OLD)["failures"], [])

    def test_flat_pending_blocks(self):
        row={"schema":"disdex-hype-zec-long/v1","mode":"LIVE",
             "runtimeCommitSha":h.OLD,"updatedAt":1,"pending":{"action":"ENTRY"},"failures":[]}
        with self.assertRaises(ValueError):
            h.validate_flat_hype_state(row,h.OLD)

    def test_flat_manual_blocks(self):
        row={"schema":"disdex-hype-zec-long/v1","mode":"LIVE",
             "runtimeCommitSha":h.OLD,"updatedAt":1,"manualReview":"unknown","failures":[]}
        with self.assertRaises(ValueError):
            h.validate_flat_hype_state(row,h.OLD)

    def test_flat_position_blocks(self):
        row={"schema":"disdex-hype-zec-long/v1","mode":"LIVE",
             "runtimeCommitSha":h.OLD,"updatedAt":1,"positions":[{"qty":1}],"failures":[]}
        with self.assertRaises(ValueError):
            h.validate_flat_hype_state(row,h.OLD)

    def test_hold_required(self):
        h.valid_hold({"active":True,"action":"HOLD_PROTECTED","scope":"GLOBAL"})
        for row in ({"active":False,"action":"HOLD_PROTECTED","scope":"GLOBAL"},
                    {"active":True,"action":"ALLOW","scope":"GLOBAL"},
                    {"active":True,"action":"HOLD_PROTECTED","scope":"HYPE"}):
            with self.assertRaises(ValueError):
                h.valid_hold(row)

    def test_env_foreign_pins_preserved(self):
        raw=("DISDEX_RELEASE_SHA="+h.OLD+
             "\nDISDEX_HYPE_ZEC_RUNTIME_SHA="+h.OLD+
             "\nDISDEX_FET_RUNTIME_SHA="+h.OLD+
             "\nDISDEX_HYPE_ZEC_CORE_PREEMPT_SCRIPT=/releases/"+h.OLD+"/x\n")
        final=h._runtime_env(raw.encode(),h.OLD,self.NEW,Path("/releases")/self.NEW).decode()
        self.assertIn("DISDEX_FET_RUNTIME_SHA="+h.OLD,final)
        self.assertIn("DISDEX_HYPE_ZEC_RUNTIME_SHA="+self.NEW,final)
        self.assertIn("DISDEX_HYPE_ZEC_CORE_PREEMPT_SCRIPT=/releases/"+self.NEW+"/x",final)
        self.assertIn("DISDEX_HYPE_ZEC_SYMBOLS=HYPEUSDT",final)

    def test_env_rejects_credentials(self):
        with self.assertRaises(ValueError):
            h._runtime_env(b"MY_API_SECRET=abc\n",h.OLD,self.NEW,Path("/releases")/self.NEW)

    def test_env_rejects_duplicates(self):
        with self.assertRaises(ValueError):
            h._runtime_env(b"A=1\nA=2\n",h.OLD,self.NEW,Path("/releases")/self.NEW)

    def test_env_deduplicates_identical_legacy_paths(self):
        raw=b"FET_BRK48_STATE_PATH=/var/lib/disdex/fet/state.json\nFET_BRK48_STATE_PATH=/var/lib/disdex/fet/state.json\n"
        out=h._runtime_env(raw,h.OLD,self.NEW,PurePosixPath("/releases")/self.NEW).decode()
        self.assertEqual(out.count("FET_BRK48_STATE_PATH="),1)


    def authority(self):
        t=int(time.time())
        return dict(schema="disdex-codex-ssh-root-auth/v1",route="CODEX_SSH",
            sourceSha=self.NEW,scope=h.RUNNER,operator="codex-ssh",
            ordersEnabled=True,authorizationMethod="ROOT_SSH_SESSION",
            issuedAt=t,expiresAt=t+300,nonce="a"*32,
            planSha256=hashlib.sha256(canonical(self.target)).hexdigest())

    def test_activation_exact(self):
        a=self.authority()
        result=h.build_activation(self.target,a,"d"*64,a["issuedAt"])
        self.assertEqual(result["approvedRunners"],[h.RUNNER])
        self.assertEqual(result["authorizesKillClearance"],False)
        self.assertEqual(result["ordersEnabled"],True)
        self.assertEqual(result["formalCertification"],False)
        self.assertNotIn("PENGU_V8",result["approvedShaByRunner"])

    def test_activation_replay_or_expiry(self):
        a=self.authority()
        with self.assertRaises(ValueError):
            h.build_activation(self.target,a,"d"*64,a["expiresAt"])
        a["sourceSha"]=h.OLD
        with self.assertRaises(ValueError):
            h.build_activation(self.target,a,"d"*64,a["issuedAt"])

    def tick(self):
        now=int(time.time()*1000)
        return dict(schema="disdex-runner-tick/v1",runnerId=h.RUNNER,
          runtimeSha=self.NEW,expectedSha=self.NEW,
          serviceUnit=h.SERVICE+"@"+self.NEW+".service",
          workingDirectory="/releases/"+self.NEW,mainPid=1234,
          newOrdersAllowed=False,tickStartedAt=now-30,
          tickCompletedAt=now,status="held",reason="HYPE_ZEC_SHARED_KILL_SWITCH_ACTIVE",
          ordersSent=0,cancelsSent=0,positionChangesSent=0)

    def test_tick_valid(self):
        row=self.tick()
        self.assertEqual(h.validate_hype_tick(row,sha=self.NEW,pid=1234,
                         release=PurePosixPath("/releases")/self.NEW),row["tickCompletedAt"])

    def test_tick_requires_pid_sha_and_hold(self):
        for change in ({"mainPid":12},{"runtimeSha":h.OLD},
                       {"newOrdersAllowed":True},{"status":"manual-review"},
                       {"ordersSent":1},{"workingDirectory":"/fake"}):
            row=self.tick();row.update(change)
            with self.assertRaises(ValueError,msg=str(change)):
                h.validate_hype_tick(row,sha=self.NEW,pid=1234,
                                     release=PurePosixPath("/releases")/self.NEW)

    def test_tick_stale_or_duplicate(self):
        row=self.tick()
        with self.assertRaises(ValueError):
            h.validate_hype_tick(row,sha=self.NEW,pid=1234,
                release=PurePosixPath("/releases")/self.NEW,previous=row["tickCompletedAt"])
        row["tickCompletedAt"]-=180000
        with self.assertRaises(ValueError):
            h.validate_hype_tick(row,sha=self.NEW,pid=1234,
                                 release=PurePosixPath("/releases")/self.NEW)


if __name__=="__main__":
    unittest.main()
