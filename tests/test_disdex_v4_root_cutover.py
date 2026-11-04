"""V4 Actions scoped cutover: local contract and Linux transaction tests."""
from pathlib import Path
import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "scripts" / "ops" / "deploy"))

from test_disdex_unified_root_gate import (
    SharedRiskExecutorTest, FakeSystemd, _secure_dir, _write_secure_json,
    OLD, NEW, plan,
)
from disdex_deployment_contract import DEPLOYMENT_TARGET, OPERATOR_TARGET, REPO
from disdex_unified_root_gate import preflight
from disdex_deployment_plan import digest
from disdex_v4_root_cutover import (
    V4RootExecutor, V4_SCOPE, V4_ACK, validate_v4_activation, runtime_activation,
)

class V4DecisionAuditTest(unittest.TestCase):
    def setUp(self):
        self.now=2_000_000_000_000
        self.sha=NEW
        self.release="/home/deploy/disdex-trading/releases/"+NEW
        self.identity=dict(runnerId="V12_V4",runtimeSha=NEW,expectedSha=NEW,
            serviceUnit=f"disdex-v12-v4@{NEW}.service",mainPid=4242,workingDirectory=self.release)
        self.tick=dict(self.identity,schema="disdex-runner-tick/v1",
            tickStartedAt=self.now-2000,tickCompletedAt=self.now-1000,
            status="observing",reason="NO_SIGNAL",newOrdersAllowed=False)
        self.health=dict(self.identity,schema="disdex-v12-v4-runner-heartbeat/v1",
            releaseSha=NEW,mode="LIVE",liveEnabled=True,limitedLive=False,
            safetyState="HEALTHY",lastTickAt=self.now-1000,heartbeatAt=self.now-500,
            orderEnabled=False,ordersAllowed=False)

    def validate(self,**changes):
        from disdex_v4_root_cutover import validate_v4_decision_cycle
        args=dict(sha=NEW,pid=4242,release=self.release,now_ms=self.now,
            started_after_ms=self.now-3000,previous_tick=None)
        args.update(changes)
        return validate_v4_decision_cycle(self.health,self.tick,**args)

    def test_healthy_no_signal_is_a_real_cycle_without_test_order(self):
        self.assertEqual(self.validate()["tickCompletedAt"],self.now-1000)

    def test_repeated_or_pre_cutover_tick_is_not_a_new_cycle(self):
        for changes in [dict(previous_tick=self.now-1000),dict(started_after_ms=self.now-1000)]:
            with self.subTest(changes=changes),self.assertRaisesRegex(ValueError,"TICK"):
                self.validate(**changes)

    def test_wrong_schema_sha_pid_cwd_or_service_fails(self):
        for target in [self.tick,self.health]:
            original=dict(target)
            for field,value in [("schema","disdex-runner-tick-heartbeat/v1"),
                ("runtimeSha",OLD),("expectedSha",OLD),("mainPid",4243),
                ("workingDirectory","/tmp/other"),("serviceUnit",f"other@{NEW}.service")]:
                with self.subTest(field=field,target=target is self.tick):
                    target[field]=value
                    with self.assertRaises(ValueError):self.validate()
                    target.clear();target.update(original)

    def test_stale_future_malformed_and_partial_publication_fails(self):
        for target,field,value in [(self.tick,"tickStartedAt",True),
            (self.tick,"tickStartedAt",self.now),
            (self.tick,"tickCompletedAt",self.now+2000),
            (self.health,"heartbeatAt",self.now+2000),
            (self.health,"heartbeatAt",self.now-180001),
            (self.health,"lastTickAt",self.now-1001)]:
            original=target[field];target[field]=value
            with self.subTest(field=field,value=value),self.assertRaises(ValueError):self.validate()
            target[field]=original
        with self.assertRaises(ValueError):self.validate(now_ms=self.now+180001)

    def test_monitor_canary_or_blocked_cycle_cannot_certify_live(self):
        for field,value in [("mode","MONITOR_ONLY"),("limitedLive",True),
            ("liveEnabled",False),("safetyState","BLOCKED")]:
            original=self.health[field];self.health[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):self.validate()
            self.health[field]=original


class V4DecisionWaitTest(V4DecisionAuditTest):
    def setUp(self):
        super().setUp()
        self.release=str(Path(self.release))
        self.tick["workingDirectory"]=self.release
        self.health["workingDirectory"]=self.release

    def wait(self, health, tick, *, units=None, reads=None, commandline=None):
        from disdex_v4_root_cutover import await_v4_decision_cycle
        from unittest.mock import Mock
        systemd=Mock()
        systemd.active_state.return_value="active"
        systemd.main_pid.return_value=4242
        systemd._state.side_effect=lambda unit,prop: "0" if prop=="NRestarts" else self.release
        if units:units(systemd)
        if commandline is None:
            commandline=["/usr/bin/node","--import",str(Path(self.release)/"node_modules/tsx/dist/loader.mjs"),
                         str(Path(self.release)/"scripts/v12-v4-production-runner.ts"),"--daemon"]
        commandline_bytes="\0".join(commandline).encode()+b"\0"
        times=iter([0,1,2,3,4,5,6])
        def reader(path,**kwargs):
            if reads is not None:return next(reads)
            return health if path.name=="heartbeat.json" else tick
        with patch("disdex_v4_venue_witness._secure_json",side_effect=reader), \
             patch.object(Path,"stat",return_value=SimpleNamespace(st_uid=0)), \
             patch.object(Path,"lstat",return_value=SimpleNamespace(st_uid=0)), \
             patch.object(Path,"resolve",return_value=Path(self.release)), \
             patch.object(Path,"read_bytes",return_value=commandline_bytes):
            return await_v4_decision_cycle(systemd,sha=NEW,release=Path(self.release),pid=4242,
                started_after_ms=self.now-3000,previous_tick=None,sleeper=lambda _:None,
                clock=lambda:self.now/1000,monotonic=lambda:next(times),timeout=4)

    def test_actual_reader_accepts_completed_matching_cycle(self):
        self.assertEqual(self.wait(self.health,self.tick)["tickCompletedAt"],self.now-1000)

    def test_same_release_recovery_waits_for_new_process_tick_not_the_retained_old_marker(self):
        old_health=dict(self.health,mainPid=4241,lastTickAt=self.now-5000)
        old_tick=dict(self.tick,mainPid=4241,tickStartedAt=self.now-6000,tickCompletedAt=self.now-5000)
        rows=iter([old_health,old_tick,self.health,self.tick])
        self.assertEqual(self.wait(self.health,self.tick,reads=rows)['tickCompletedAt'],self.now-1000)

    def test_repeated_old_sha_or_partial_publication_has_bounded_timeout(self):
        for health,tick in [(self.health,dict(self.tick,runtimeSha=OLD)),
                             (dict(self.health,lastTickAt=self.now-999),self.tick)]:
            with self.subTest(health=health),self.assertRaisesRegex(RuntimeError,"TIMEOUT"):
                self.wait(health,tick)

    def test_actual_command_must_use_same_release_loader_and_runner(self):
        for command in [["/usr/bin/node","/tmp/other.ts"],
            ["/usr/bin/node","--import",f"/releases/{OLD}/loader.mjs",
             str(Path(self.release)/"scripts/v12-v4-production-runner.ts"),"--daemon"]]:
            with self.subTest(command=command),self.assertRaisesRegex(RuntimeError,"EXECUTABLE"):
                self.wait(self.health,self.tick,commandline=command)

    def test_pid_restart_or_effective_cwd_change_is_rejected(self):
        for mutation in [lambda s:setattr(s.main_pid,"return_value",4243),
                         lambda s:setattr(s._state,"side_effect",lambda unit,prop:"1" if prop=="NRestarts" else self.release),
                         lambda s:setattr(s._state,"side_effect",lambda unit,prop:"0" if prop=="NRestarts" else "/tmp/other")]:
            with self.subTest(mutation=mutation),self.assertRaises(RuntimeError):
                self.wait(self.health,self.tick,units=mutation)


class V4ApprovalTest(unittest.TestCase):
    def setUp(self):
        self.args = SimpleNamespace(sha=NEW, owner="owner")
        self.desired = plan(V4_SCOPE, V4_SCOPE)
        self.desired["ordersEnabled"] = True
        self.digest = "d" * 64
        self.now = 2_000_000_000
        self.activation = {
            "schema": "disdex-unified-operator-activation/v1",
            "repository": REPO,
            "deploymentTarget": DEPLOYMENT_TARGET,
            "operatorTarget": OPERATOR_TARGET,
            "scope": V4_SCOPE,
            "approvedSha": NEW,
            "approvedShaByRunner": self.desired["runners"],
            "approvedRunners": [V4_SCOPE],
            "planSha256": self.digest,
            "ordersEnabled": True,
            "operator": "owner",
            "approvedAt": self.now - 10,
            "expiresAt": self.now + 300,
            "operatorAcknowledgement": V4_ACK,
        }

    def test_exact_v4_grant_accepted(self):
        x = validate_v4_activation(
            self.activation, self.args, self.desired, self.digest, self.now)
        self.assertIs(x, self.activation)
        rt = runtime_activation(x, NEW)
        self.assertEqual(rt["approvedRunners"], [V4_SCOPE])
        self.assertEqual(rt["approvedShaByRunner"][V4_SCOPE], NEW)
        self.assertTrue(rt["ordersEnabled"])

    def test_missing_exact_scope_fails(self):
        for field, wrong in [
            ("scope", "FULL_PROJECT"), ("ordersEnabled", False),
            ("approvedSha", OLD), ("planSha256", "b"*64),
            ("operatorAcknowledgement", "I_APPROVE"), ("approvedRunners", ["V52"]),
            ("approvedShaByRunner", {V4_SCOPE: NEW}),
            ("expiresAt", self.now-1),
        ]:
            with self.subTest(field=field):
                x=dict(self.activation)
                x[field] = wrong
                with self.assertRaises(ValueError):
                    validate_v4_activation(x, self.args, self.desired, self.digest, self.now)

    def test_extra_field_and_stale_grant_fail(self):
        x=dict(self.activation, ordersEnabled2=True)
        with self.assertRaisesRegex(ValueError, "schema"):
            validate_v4_activation(x, self.args, self.desired, self.digest, self.now)
        x=dict(self.activation, approvedAt=self.now-4001, expiresAt=self.now+200)
        with self.assertRaisesRegex(ValueError, "freshness"):
            validate_v4_activation(x, self.args, self.desired, self.digest, self.now)


@unittest.skipIf(os.name == "nt", "Linux root-style file/permission fixture required")
class V4CutoverTransactionTest(unittest.TestCase):
    def setUp(self):
        self.fx=SharedRiskExecutorTest("test_shared_risk_cutover_changes_only_writer_and_preserves_current_symlink")
        self.fx.setUp()
        x=self.fx
        x.desired_plan = plan(V4_SCOPE, V4_SCOPE)
        x.desired_plan["ordersEnabled"] = True
        x.desired_plan["releaseRoots"] = x.current_plan["releaseRoots"]
        x.plan_hash=digest(x.desired_plan,x.current_plan)[0]
        _secure_dir(x.plans / V4_SCOPE)
        _write_secure_json(x.plans / V4_SCOPE / (NEW+".json"), x.desired_plan)
        _secure_dir(x.activations / V4_SCOPE)
        self.runtime_dir=_secure_dir(x.root / "runtime-approvals")
        self.runtime=self.runtime_dir / "v12-v4-full.json"
        self.now=x.now
        grant={
            "schema": "disdex-unified-operator-activation/v1",
            "repository": REPO, "deploymentTarget": DEPLOYMENT_TARGET,
            "operatorTarget": OPERATOR_TARGET, "scope": V4_SCOPE,
            "approvedSha": NEW, "approvedShaByRunner": x.desired_plan["runners"],
            "approvedRunners": [V4_SCOPE], "planSha256": x.plan_hash,
            "ordersEnabled": True, "operator": "owner",
            "approvedAt": self.now-5, "expiresAt": self.now+300,
            "operatorAcknowledgement": V4_ACK,
        }
        _write_secure_json(x.activations / V4_SCOPE / (NEW+".json"), grant)
        self.grant_file=x.activations / V4_SCOPE / (NEW+".json")
        release=x.releases/NEW
        for name in (
            "node_modules/tsx/dist/cli.mjs",
            "scripts/v12-v4-production-runner.ts",
            "scripts/ops/root/disdex-live-operator-activation-gate.mjs",
        ):
            path=release/name; path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text("test fixture",encoding="ascii")
        readiness=release/"docs/production/v12-v4-implementation-readiness.json"
        readiness.parent.mkdir(parents=True,exist_ok=True)
        readiness.write_text(json.dumps({"implementationStatus":"READY",
            "blockers":["OPERATOR_LIVE_ACTIVATION_REQUIRED"]}),encoding="utf8")
        self.old_unit=f"disdex-v12-v4@{OLD}.service"
        self.new_unit=f"disdex-v12-v4@{NEW}.service"

    def tearDown(self):
        self.fx.tearDown()

    def _args(self):
        return SimpleNamespace(
            deployment_target=DEPLOYMENT_TARGET,
            operator_target=OPERATOR_TARGET, sha=NEW, scope=V4_SCOPE,
            route="GITHUB_ACTIONS", plan_sha256=self.fx.plan_hash,
            orders_enabled="true", owner="owner")

    def _executor(self, sysd):
        calls={"after":0}
        def witness(*, sha, expected_pins, phase, **kwargs):
            if phase=="before":
                value=json.loads(self.fx.before_venue.read_text("utf8"))
                value["peerStopApprovalsVerified"] = sorted(kwargs.get("peer_stop_approvals", {}))
                return value
            calls["after"]+=1
            value=json.loads(self.fx.after_venue.read_text("utf8"))
            value["capturedAt"]=self.now+calls["after"]
            value["expiresAt"]=self.now+300+calls["after"]
            value["peerStopApprovalsVerified"] = sorted(kwargs.get("peer_stop_approvals", {}))
            return value
        def decision(systemd, *, previous_tick, started_after_ms, **kwargs):
            completed = (previous_tick or started_after_ms) + 60000
            return dict(tickStartedAt=completed-1000,tickCompletedAt=completed,
                        mainPid=systemd.main_pid(self.new_unit))
        return V4RootExecutor(
            self.fx._executor(sysd), runtime_approval=self.runtime,
            witness_collector=witness, sleeper=lambda _: None, decision_observer=decision)

    def test_v4_preflight_accepts_legacy_writable_current_but_certifies_new_release(self):
        # Legacy current/peer releases predate the root-owned immutable boundary.
        # V4 migration must freeze their SHA map without requiring an in-place
        # ownership rewrite; the newly introduced V4 candidate remains strict.
        old_marker=self.fx.releases/OLD/".disdex-release-sha"
        old_marker.chmod(0o600)
        args=self._args()
        token_payload={
            "deploymentTarget":DEPLOYMENT_TARGET,
            "operatorTarget":OPERATOR_TARGET,
            "nonce":"a"*32,
        }
        with patch("disdex_unified_root_gate.verify", return_value=token_payload):
            result=preflight(
                args,"signed-token",
                root=self.fx.root,pins_path=self.fx.pins_path,
                current=self.fx.current,releases=self.fx.releases,
                root_uid=os.geteuid(),
            )
        self.assertEqual(result["status"],"READONLY_PREFLIGHT_PASS_NOT_LIVE")
        self.assertEqual(result["changedRunners"],[V4_SCOPE])
        self.assertTrue((self.fx.releases/NEW/".disdex-release-sha").is_file())

    def test_only_v4_changes_and_receipt_validated(self):
        sysd=FakeSystemd(self.old_unit,self.new_unit)
        result=self._executor(sysd).execute(self._args(),"signed-token")
        self.assertEqual(result["status"],"V4_LIVE_CUTOVER_VERIFIED")
        self.assertEqual(len(result["auditCycles"]),3)
        self.assertEqual(result["ordersSent"],0)
        self.assertEqual(result["cancelsSent"],0)
        self.assertEqual(result["positionChangesSent"],0)
        self.assertTrue(sysd.is_active(self.new_unit))
        self.assertFalse(sysd.is_active(self.old_unit))
        pins=json.loads(self.fx.pins_path.read_text("utf8"))
        self.assertEqual(pins["runners"][V4_SCOPE]["sha"],NEW)
        self.assertEqual(pins["runners"]["V52"]["sha"],OLD)
        self.assertEqual(self.fx.current.resolve(),self.fx.releases/OLD)
        self.assertEqual(json.loads(self.runtime.read_text())["approvedSha"],NEW)

    def test_failed_pid_zero_recovery_does_not_require_old_v4_heartbeat_in_before_proof(self):
        evidence=json.loads(self.fx.before_venue.read_text("utf8"))
        evidence["heartbeatVerified"]=False
        evidence["tickVerified"]=False
        _write_secure_json(self.fx.before_venue,evidence)
        sysd=FakeSystemd(self.old_unit,self.new_unit,old_active=False)
        result=self._executor(sysd).execute(self._args(),"signed-token")
        self.assertEqual(result["status"],"V4_LIVE_CUTOVER_VERIFIED")
        self.assertTrue(sysd.is_active(self.new_unit))

    def test_post_start_audit_still_requires_new_v4_heartbeat_and_tick(self):
        evidence=json.loads(self.fx.after_venue.read_text("utf8"))
        evidence["heartbeatVerified"]=False
        _write_secure_json(self.fx.after_venue,evidence)
        sysd=FakeSystemd(self.old_unit,self.new_unit,old_active=False)
        with self.assertRaisesRegex(RuntimeError,"recovery required"):
            self._executor(sysd).execute(self._args(),"signed-token")
        self.assertFalse(sysd.is_active(self.new_unit))

    def test_failed_pid_zero_old_v4_can_recover_directly_to_new_live(self):
        sysd=FakeSystemd(self.old_unit,self.new_unit,old_active=False)
        result=self._executor(sysd).execute(self._args(),"signed-token")
        self.assertEqual(result["status"],"V4_LIVE_CUTOVER_VERIFIED")
        self.assertFalse(sysd.is_active(self.old_unit))
        self.assertTrue(sysd.is_active(self.new_unit))
        self.assertNotIn(("stop",self.old_unit),sysd.calls)

    def test_dormant_old_with_nonzero_pid_is_blocked_before_mutation(self):
        sysd=FakeSystemd(self.old_unit,self.new_unit,old_active=False,dormant_old_pid=42)
        with self.assertRaisesRegex(ValueError,"PID 0"):
            self._executor(sysd).execute(self._args(),"signed-token")
        self.assertEqual(sysd.calls,[])

    def test_failed_candidate_from_failed_baseline_does_not_resurrect_old_v4(self):
        sysd=FakeSystemd(self.old_unit,self.new_unit,old_active=False,fail_new_start=True)
        with self.assertRaisesRegex(RuntimeError,"recovery required"):
            self._executor(sysd).execute(self._args(),"signed-token")
        self.assertFalse(sysd.is_active(self.old_unit))
        self.assertFalse(sysd.is_active(self.new_unit))
        self.assertNotIn(("start",self.old_unit),sysd.calls)

    def test_failed_start_does_not_copy_old_approval_or_restart_ambiguous_old_code(self):
        old_approval={"approvedSha":OLD}
        _write_secure_json(self.runtime,old_approval)
        sysd=FakeSystemd(self.old_unit,self.new_unit,fail_new_start=True)
        with self.assertRaisesRegex(RuntimeError,"recovery required"):
            self._executor(sysd).execute(self._args(),"signed-token")
        self.assertFalse(sysd.is_active(self.old_unit))
        self.assertFalse(sysd.is_active(self.new_unit))
        self.assertTrue(sysd.is_masked(self.new_unit))
        self.assertEqual(json.loads(self.runtime.read_text())["approvedSha"],NEW)
        self.assertEqual(json.loads(self.fx.pins_path.read_text())["runners"][V4_SCOPE]["sha"],NEW)
        self.assertEqual(self.fx.current.resolve(),self.fx.releases/OLD)

    def test_failed_live_audit_never_restarts_old_code_over_possible_new_ownership(self):
        sysd=FakeSystemd(self.old_unit,self.new_unit)
        executor=self._executor(sysd)
        def failure(*args,**kwargs):raise RuntimeError("SIGNED_READ_UNAVAILABLE")
        executor.decision_observer=failure
        with self.assertRaises(RuntimeError):executor.execute(self._args(),"signed-token")
        self.assertNotIn(("start",self.old_unit),sysd.calls)
        self.assertFalse(sysd.is_active(self.new_unit))
        self.assertTrue(sysd.is_masked(self.new_unit))
        self.assertEqual(json.loads(self.fx.pins_path.read_text())["runners"][V4_SCOPE]["sha"],NEW)
        journal=json.loads((executor.common.paths.journal or self.fx.root/"transaction.json").read_text())
        self.assertEqual(journal["phase"],"RECOVERY_REQUIRED_PROTECTED")
        self.assertFalse(journal["oldSourceRestartAuthorized"])

    def test_repeated_decision_tick_cannot_be_three_audit_cycles(self):
        sysd=FakeSystemd(self.old_unit,self.new_unit)
        executor=self._executor(sysd)
        executor.decision_observer=lambda *args,**kwargs:dict(tickCompletedAt=self.now*1000+1000)
        with self.assertRaisesRegex(RuntimeError,"did not advance"):
            executor.execute(self._args(),"signed-token")
        self.assertFalse(sysd.is_active(self.new_unit))
        self.assertFalse(list(self.fx.receipts.glob("v12_v4-*.json")))

    def test_missing_real_tick_times_out_without_live_receipt(self):
        sysd=FakeSystemd(self.old_unit,self.new_unit)
        executor=self._executor(sysd)
        def timeout(*args,**kwargs):
            raise RuntimeError("V4_REAL_DECISION_CYCLE_TIMEOUT")
        executor.decision_observer=timeout
        with self.assertRaisesRegex(RuntimeError,"REAL_DECISION_CYCLE_TIMEOUT"):
            executor.execute(self._args(),"signed-token")
        self.assertFalse(sysd.is_active(self.new_unit))
        self.assertFalse(list(self.fx.receipts.glob("v12_v4-*.json")))

    def test_expired_activation_never_stops_old(self):
        d=json.loads(self.grant_file.read_text("utf8"))
        d["expiresAt"]=self.now-1
        _write_secure_json(self.grant_file,d)
        sysd=FakeSystemd(self.old_unit,self.new_unit)
        with self.assertRaisesRegex(ValueError,"freshness"):
            self._executor(sysd).execute(self._args(),"signed-token")
        self.assertEqual(sysd.calls,[])

    def test_stale_venue_never_stops_old(self):
        d=json.loads(self.fx.before_venue.read_text("utf8"))
        d["capturedAt"]=self.now-301
        _write_secure_json(self.fx.before_venue,d)
        sysd=FakeSystemd(self.old_unit,self.new_unit)
        with self.assertRaisesRegex(ValueError,"venue evidence"):
            self._executor(sysd).execute(self._args(),"signed-token")
        self.assertEqual(sysd.calls,[])

    def test_missing_runtime_executable_never_stops_old(self):
        (self.fx.releases/NEW/"node_modules/tsx/dist/cli.mjs").unlink()
        sysd=FakeSystemd(self.old_unit,self.new_unit)
        with self.assertRaisesRegex(ValueError,"missing local runtime"):
            self._executor(sysd).execute(self._args(),"signed-token")
        self.assertEqual(sysd.calls,[])

    def test_orders_disabled_is_never_treated_as_live(self):
        a=self._args();a.orders_enabled="false"
        sysd=FakeSystemd(self.old_unit,self.new_unit)
        with self.assertRaisesRegex(ValueError,"ordersEnabled"):
            self._executor(sysd).execute(a,"signed-token")
        self.assertEqual(sysd.calls,[])

    def test_codex_ssh_route_uses_root_ssh_authority_without_owner_token(self):
        args = self._args()
        args.route = "CODEX_SSH"
        args.owner = "codex-ssh"
        args._codex_ssh_authenticated = True
        systemd = FakeSystemd(self.old_unit, self.new_unit)
        result = self._executor(systemd).execute(args, "")
        self.assertEqual(result["status"], "V4_LIVE_CUTOVER_VERIFIED")
        self.assertEqual(result["route"], "CODEX_SSH")
        self.assertEqual(result["ordersSent"], 0)
