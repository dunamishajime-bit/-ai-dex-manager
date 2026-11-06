"""Credential-free regression cases for HYPE-only protected-hold cutover."""
import copy
from contextlib import contextmanager
import hashlib
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path, PurePosixPath
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts/ops/deploy"))
import disdex_hype_scoped_root_cutover as h
import disdex_hype_scoped_job as job
from disdex_deployment_plan import canonical, IDS, SCHEMA
from disdex_deployment_contract import REPO, DEPLOYMENT_TARGET, OPERATOR_TARGET


class HypeJobEntrypointTests(unittest.TestCase):
    def test_job_entrypoint_imports_installed_sibling_modules_under_isolated_python(self):
        script = Path(__file__).resolve().parents[1] / "scripts/ops/deploy/disdex_hype_scoped_job.py"
        result = subprocess.run(
            [sys.executable, "-I", str(script), "--help"],
            cwd=script.parents[2], capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--job-id", result.stdout)


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

    def test_exact_interrupted_cutover_is_resumable_but_peer_drift_is_not(self):
        already_applied=copy.deepcopy(self.target)
        self.pins[h.RUNNER]=self.NEW
        self.assertEqual(h.classify_hype_plan(self.target,already_applied,self.pins,self.NEW),"resume")
        already_applied["runners"]["PENGU_V8"]="f"*40
        with self.assertRaises(ValueError):
            h.classify_hype_plan(self.target,already_applied,self.pins,self.NEW)

    def test_candidate_release_must_gate_entries_on_shared_hold_and_emit_real_ticks(self):
        sources={
            "lib/hype-zec-long-runner.ts":(
                'import { readSharedKillSwitch } from "./disdex-shared-kill-switch";\n'
                'private async sharedEntryHold(state, signal) {\n'
                'const kill = await readSharedKillSwitch({DISDEX_SHARED_KILL_SWITCH_FILE: process.env.DISDEX_SHARED_KILL_SWITCH_FILE || "/var/lib/disdex/shared/kill-switch.json"});\n'
                'if (!kill.active) return;\n'
                'const reason = "HYPE_ZEC_SHARED_KILL_SWITCH_ACTIVE"; return {status:"held",message:reason};\n}\n'
                'private async enter(state, signal) {\n'
                'const entryHold = await this.sharedEntryHold(state, signal); if (entryHold) return entryHold;\n'
                'const preOrderHold = await this.sharedEntryHold(state, signal); if (preOrderHold) return preOrderHold;\n'
                'await this.dependencies.executor.executeMarket({});\n}'
            ),
            "lib/disdex-peer-decision-cycle.ts":(
                'import {writeRunnerTickHeartbeat} from "./disdex-runner-tick-heartbeat";\n'
                'HYPE_TREND_LONG: "disdex-hype-long";\n'
                'await writeRunnerTickHeartbeat({runnerId:input.runnerId,newOrdersAllowed:false});'
            ),
            "lib/disdex-runner-tick-heartbeat.ts":(
                'RUNNER_TICK_HEARTBEAT_SCHEMA = "disdex-runner-tick/v1";\n'
                'expectedSha mainPid workingDirectory tickStartedAt tickCompletedAt status newOrdersAllowed ordersSent cancelsSent positionChangesSent'
            ),
            "scripts/disdex-hype-zec-long-live-runner.ts":(
                'import { observePeerDecisionCycle } from "../lib/disdex-peer-decision-cycle";\n'
                'observePeerDecisionCycle({ runnerId: "HYPE_TREND_LONG", operation: () => runner.tick() });'
            ),
        }
        self.assertTrue(h.validate_hype_candidate_sources(
            sources["lib/hype-zec-long-runner.ts"],
            sources["lib/disdex-peer-decision-cycle.ts"],
            sources["lib/disdex-runner-tick-heartbeat.ts"],
            sources["scripts/disdex-hype-zec-long-live-runner.ts"]))
        bad_runner=sources["lib/hype-zec-long-runner.ts"].replace(
            "const preOrderHold = await this.sharedEntryHold(state, signal); if (preOrderHold) return preOrderHold;", "")
        with self.assertRaises(ValueError):
            h.validate_hype_candidate_sources(bad_runner,
                sources["lib/disdex-peer-decision-cycle.ts"],
                sources["lib/disdex-runner-tick-heartbeat.ts"],
                sources["scripts/disdex-hype-zec-long-live-runner.ts"])

    def test_recovery_rejects_a_partial_pin_or_plan_mismatch(self):
        self.pins[h.RUNNER]=self.NEW
        changed=copy.deepcopy(self.target)
        changed["runners"]["FET_BRK48_RESIDUAL"]="f"*40
        with self.assertRaises(ValueError):
            h.classify_hype_plan(self.target,changed,self.pins,self.NEW)

    def test_rollback_preserves_a_real_held_decision_written_after_switch(self):
        baseline={"schema":"disdex-hype-zec-long/v1","runtimeCommitSha":self.NEW,
            "mode":"LIVE","updatedAt":1000,"positions":[],"pending":None,
            "manualReview":None,"failures":[{"message":"prior","occurredAt":900}]}
        current={**baseline,"updatedAt":2000,"lastDecisionTs":1999,
            "lastDecision":{"accepted":False,"reason":"HYPE_ZEC_SHARED_KILL_SWITCH_ACTIVE"},
            "failures":baseline["failures"]+[{"message":"market-data-recovered","occurredAt":1999}]}
        restored=h.rebase_hype_state_for_rollback(current,baseline,h.OLD,self.NEW)
        self.assertEqual(restored["runtimeCommitSha"],h.OLD)
        self.assertEqual(restored["updatedAt"],2000)
        self.assertEqual(restored["lastDecisionTs"],1999)
        self.assertEqual(restored["lastDecision"],current["lastDecision"])
        self.assertEqual(restored["failures"],current["failures"])

    def test_rollback_refuses_exposure_or_unrecognized_state_mutation(self):
        baseline={"schema":"disdex-hype-zec-long/v1","runtimeCommitSha":self.NEW,
            "mode":"LIVE","updatedAt":1000,"positions":[],"pending":None,
            "manualReview":None,"failures":[]}
        for change in ({"positions":[{"symbol":"HYPEUSDT","quantity":1}]},
                       {"pending":{"action":"ENTRY"}},
                       {"manualReview":"unknown"},
                       {"unclassifiedRuntimeField":"changed"}):
            current={**baseline,**change}
            with self.subTest(change=change), self.assertRaises(ValueError):
                h.rebase_hype_state_for_rollback(current,baseline,h.OLD,self.NEW)

    def test_rollback_refuses_truncated_or_rewritten_decision_history(self):
        baseline={"schema":"disdex-hype-zec-long/v1","runtimeCommitSha":self.NEW,
            "mode":"LIVE","updatedAt":1000,"positions":[],"pending":None,
            "manualReview":None,"failures":[{"message":"prior","occurredAt":900}]}
        current={**baseline,"updatedAt":2000,"failures":[]}
        with self.assertRaises(ValueError):
            h.rebase_hype_state_for_rollback(current,baseline,h.OLD,self.NEW)

    def test_rollback_rejects_a_new_accepted_decision(self):
        baseline={"schema":"disdex-hype-zec-long/v1","runtimeCommitSha":self.NEW,
            "mode":"LIVE","updatedAt":1000,"positions":[],"pending":None,
            "manualReview":None,"failures":[],"lastDecisionTs":900,
            "lastDecision":{"accepted":False,"reason":"HOLD"}}
        current={**baseline,"updatedAt":2000,"lastDecisionTs":1999,
            "lastDecision":{"accepted":True,"reason":"CANDIDATE"}}
        with self.assertRaises(ValueError):
            h.rebase_hype_state_for_rollback(current,baseline,h.OLD,self.NEW)

    def test_rollback_accepts_multiple_appends_to_full_failure_ring(self):
        before=[{"message":f"old-{i}","occurredAt":900} for i in range(100)]
        baseline={"schema":"disdex-hype-zec-long/v1","runtimeCommitSha":self.NEW,
            "mode":"LIVE","updatedAt":1000,"positions":[],"pending":None,
            "manualReview":None,"failures":before}
        after=before[2:]+[{"message":"new-1","occurredAt":1500},
                         {"message":"new-2","occurredAt":1600}]
        current={**baseline,"updatedAt":2000,"failures":after}
        restored=h.rebase_hype_state_for_rollback(current,baseline,h.OLD,self.NEW)
        self.assertEqual(restored["failures"],after)
        tampered={**current,"failures":[*after[:-3],{"message":"forged","occurredAt":1700},*after[-2:]]}
        with self.assertRaises(ValueError):
            h.rebase_hype_state_for_rollback(tampered,baseline,h.OLD,self.NEW)

    def test_async_job_requires_fresh_exact_root_session_binding(self):
        auth=self.authority()
        auth.update(repository=REPO,deploymentTarget=DEPLOYMENT_TARGET,operatorTarget=OPERATOR_TARGET,
                    signatureVerified=False)
        row={"schema":job.JOB_SCHEMA,"jobId":auth["nonce"],
            "deploymentTarget":DEPLOYMENT_TARGET,"operatorTarget":OPERATOR_TARGET,
            "sourceSha":self.NEW,"scope":h.RUNNER,"ordersEnabled":True,
            "planSha256":auth["planSha256"],"route":"CODEX_SSH",
            "owner":"codex-ssh","authorization":auth}
        self.assertEqual(job.validate_job_request(row,auth["nonce"],auth["issuedAt"])["jobId"],auth["nonce"])
        for mutate in (
            lambda x:x.update(scope="FULL_PROJECT"),
            lambda x:x.update(ordersEnabled=False),
            lambda x:x["authorization"].update(sourceSha=h.OLD),
            lambda x:x["authorization"].update(planSha256="e"*64),
            lambda x:x["authorization"].update(nonce="b"*32),
        ):
            bad=copy.deepcopy(row);mutate(bad)
            with self.assertRaises(ValueError):
                job.validate_job_request(bad,auth["nonce"],auth["issuedAt"])
        with self.assertRaises(ValueError):
            job.validate_job_request(row,auth["nonce"],auth["expiresAt"])

    def test_async_actions_job_requires_a_bounded_owner_token(self):
        row={"schema":job.JOB_SCHEMA,"jobId":"a"*32,
            "deploymentTarget":DEPLOYMENT_TARGET,"operatorTarget":OPERATOR_TARGET,
            "sourceSha":self.NEW,"scope":h.RUNNER,"ordersEnabled":True,
            "planSha256":"e"*64,"route":"GITHUB_ACTIONS","owner":"owner",
            "approvalToken":"signed-token-placeholder"}
        self.assertEqual(job.validate_job_request(row,row["jobId"],100),row)
        bad={**row,"approvalToken":""}
        with self.assertRaises(ValueError):
            job.validate_job_request(bad,row["jobId"],100)
        bad={**row,"authorization":{"signatureVerified":False}}
        with self.assertRaises(ValueError):
            job.validate_job_request(bad,row["jobId"],100)

    def test_queued_job_waits_for_submitter_lock_without_retrying_transaction_errors(self):
        calls=[]
        @contextmanager
        def lock_factory(*args):
            calls.append("lock")
            if len(calls)==1:
                raise ValueError("another root deployment is in progress")
            yield
        parent=SimpleNamespace(paths=SimpleNamespace(root=Path("/root")),
            execute=lambda args,token:(calls.append("execute") or {"status":"ok"}))
        args=SimpleNamespace(scope=h.RUNNER,orders_enabled="true")
        result=job.execute_after_lock(parent,args,"",lock_factory=lock_factory,
            sleep_fn=lambda _:None,clock_fn=lambda:100,deadline_seconds=10)
        self.assertEqual(result,{"status":"ok"})
        self.assertEqual(calls,["lock","lock","execute"])

    def test_queued_job_does_not_retry_other_lock_or_execution_failures(self):
        attempts=[]
        @contextmanager
        def invalid_lock(*args):
            attempts.append("lock")
            raise ValueError("untrusted deployment lock symlink")
            yield
        parent=SimpleNamespace(paths=SimpleNamespace(root=Path("/root")),
            execute=lambda args,token:None)
        with self.assertRaisesRegex(ValueError,"untrusted deployment lock symlink"):
            args=SimpleNamespace(scope=h.RUNNER,orders_enabled="true")
            job.execute_after_lock(parent,args,"",lock_factory=invalid_lock,
                sleep_fn=lambda _:None,clock_fn=lambda:100,deadline_seconds=10)
        self.assertEqual(attempts,["lock"])

    def test_queued_job_lock_wait_has_a_finite_deadline(self):
        now=[100.0]
        @contextmanager
        def always_busy(*args):
            raise ValueError("another root deployment is in progress")
            yield
        parent=SimpleNamespace(paths=SimpleNamespace(root=Path("/root")),execute=lambda *_:None)
        args=SimpleNamespace(scope=h.RUNNER,orders_enabled="true")
        with self.assertRaisesRegex(ValueError,"HYPE_JOB_DEPLOYMENT_LOCK_TIMEOUT"):
            job.execute_after_lock(parent,args,"",lock_factory=always_busy,
                sleep_fn=lambda elapsed:now.__setitem__(0,now[0]+elapsed),
                clock_fn=lambda:now[0],deadline_seconds=0.5)

    def test_scoped_job_service_is_detached_and_time_bounded(self):
        unit=(Path(__file__).resolve().parents[1]/"ops/systemd/disdex-hype-scoped-cutover@.service").read_text()
        self.assertIn("RuntimeMaxSec=1h10min",unit)
        self.assertIn("ProtectSystem=strict",unit)
        self.assertIn("NoNewPrivileges=yes",unit)
        self.assertIn("StandardOutput=null",unit)
        installer=(Path(__file__).resolve().parents[1]/"scripts/ops/root/install-disdex-hype-scoped-cutover").read_text()
        self.assertIn("flock -xn 9",installer)
        self.assertIn("DISDEX_RELEASE_MARKER_WRITABLE",installer)
        self.assertIn("DISDEX_RELEASE_PATH_NOT_CANONICAL",installer)

    def test_legacy_hype_unit_is_disabled_before_candidate_start(self):
        source=(Path(__file__).resolve().parents[1]/"scripts/ops/deploy/disdex_hype_scoped_root_cutover.py").read_text()
        switch=source.split("    def switch(self):",1)[1].split("    def audit(self):",1)[0]
        self.assertLess(switch.index("self.systemd.disable(self.old_unit)"),
                        switch.index("self.systemd.start(self.new_unit)"))
        self.assertIn("OLD_UNIT_ENABLED_DURING_AUDIT",source)
        self.assertIn("OLD_UNIT_NOT_DISABLED_AT_COMMIT",source)

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
        self.assertEqual(result["scope"],h.RUNNER)
        self.assertEqual(result["deploymentTarget"],DEPLOYMENT_TARGET)
        self.assertEqual(result["repository"],REPO)
        self.assertEqual(result["target"],OPERATOR_TARGET)
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
