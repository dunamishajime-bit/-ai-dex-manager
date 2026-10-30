"""V4 Actions scoped cutover: local contract and Linux transaction tests."""
from pathlib import Path
import json
import os
import sys
import unittest
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "scripts" / "ops" / "deploy"))

from test_disdex_unified_root_gate import (
    SharedRiskExecutorTest, FakeSystemd, _secure_dir, _write_secure_json,
    OLD, NEW, plan,
)
from disdex_deployment_contract import DEPLOYMENT_TARGET, OPERATOR_TARGET, REPO
from disdex_deployment_plan import digest
from disdex_v4_root_cutover import (
    V4RootExecutor, V4_SCOPE, V4_ACK, validate_v4_activation, runtime_activation,
)

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
        return V4RootExecutor(self.fx._executor(sysd),runtime_approval=self.runtime)

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

    def test_failed_start_rolls_back_without_unprotected_window(self):
        old_approval={"approvedSha":OLD}
        _write_secure_json(self.runtime,old_approval)
        sysd=FakeSystemd(self.old_unit,self.new_unit,fail_new_start=True)
        with self.assertRaisesRegex(RuntimeError,"rolled back"):
            self._executor(sysd).execute(self._args(),"signed-token")
        self.assertTrue(sysd.is_active(self.old_unit))
        self.assertFalse(sysd.is_active(self.new_unit))
        self.assertEqual(json.loads(self.runtime.read_text()),old_approval)
        self.assertEqual(json.loads(self.fx.pins_path.read_text())["runners"][V4_SCOPE]["sha"],OLD)
        self.assertEqual(self.fx.current.resolve(),self.fx.releases/OLD)

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
