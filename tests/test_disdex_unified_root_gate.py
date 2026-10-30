"""Root-side preflight and forced-command unit tests (NO server mutations)."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "ops" / "deploy"))
from disdex_unified_root_gate import (
    parse_live_pins, validate_bootstrap_plan, release_marker,
    auxiliary_release_marker,
    assert_regular_secure, assert_private_dir, assert_root_trusted_dir, _atomic_json,
    preflight, PREFIXES, STOP_OWNERS,
    ROOT, RELEASES, DeploymentPaths, RootDeploymentExecutor,
    certify_live_executor,
)
from disdex_deployment_contract import DEPLOYMENT_TARGET, OPERATOR_TARGET, REPO
from disdex_deployment_plan import IDS, SCHEMA, digest
from disdex_unified_forced_command import parse_original, HELPER, READINESS_HELPER, ALLOWED

OLD="7"*40
NEW="c"*40

def plan(scope, r=None):
    p=dict(schema=SCHEMA, repository="dunamishajime-bit/-ai-dex-manager",
           deploymentTarget="professional-dismanager.net",
           operatorTarget="DD1296_FINAL_ALLIN_10BPS", sourceSha=(OLD if scope == "FULL_PROJECT" else NEW),
           scope=scope, runners={i:OLD for i in IDS},
           uiSha=OLD, monitorSha=OLD,
           releaseRoots={
               "runners": "/home/deploy/disdex-trading/releases",
               "ui": "/home/deploy/disdex-trading/ui-releases/current-ui",
               "monitor": "/home/deploy/disdex-trading/monitor-releases/current-monitor",
           },
           ordersEnabled=False)
    if r:
        p["runners"][r]=NEW
    return p

def pins(releases=RELEASES):
    return {"schema":"disdex-runner-pin-manifest/v1","target":DEPLOYMENT_TARGET,
            "runners":{key:{"sha":OLD,
                            "serviceUnit":f"{PREFIXES[key]}@{OLD}.service",
                            "releaseRoot":str(releases / OLD),
                            "evidenceMode":"legacy",
                            "stopOwner":STOP_OWNERS[key]} for key in IDS}}

class RootGateTest(unittest.TestCase):
    def test_live_executor_contract_is_certified_without_granting_live_authority(self):
        report = certify_live_executor()

        self.assertEqual(report["status"], "LIVE_EXECUTOR_CONTRACT_CERTIFIED")
        self.assertEqual(report["scope"], "SHARED_CRYPTO_RISK_ONLY")
        self.assertEqual(report["approvedRunners"], ["SHARED_CRYPTO_RISK"])
        self.assertFalse(report["ordersEnabled"])
        self.assertTrue(report["requiresRoot"])
        self.assertTrue(report["requiresOwnerSignature"])
        self.assertTrue(report["singleUseNonce"])
        self.assertTrue(report["requiresFreshVenueEvidence"])
        self.assertTrue(report["preservesCurrentSymlink"])
        self.assertEqual(report["auditCycles"], 3)
        self.assertEqual(report["productionActivation"], "OWNER_SIGNED_TOKEN_REQUIRED")

    def test_valid_pins(self):
        self.assertEqual(parse_live_pins(pins()),{key:OLD for key in IDS})
    def test_cannot_replace_stop_owner(self):
        m=pins()
        m["runners"]["V12_V4"]["stopOwner"]="OTHER"
        with self.assertRaisesRegex(ValueError,"STOP ownership"):
            parse_live_pins(m)
    def test_cannot_add_runner(self):
        m=pins()
        m["runners"]["EXTRA"]={}
        with self.assertRaisesRegex(ValueError,"unknown runner"):
            parse_live_pins(m)
    def test_cannot_change_service_unit(self):
        m=pins()
        m["runners"]["SHARED_CRYPTO_RISK"]["serviceUnit"]="disdex-shared-crypto-risk@CURRENT.service"
        with self.assertRaisesRegex(ValueError,"service unit"):
            parse_live_pins(m)
    def test_risk_only_does_not_change_peer(self):
        desired=plan("SHARED_CRYPTO_RISK_ONLY","SHARED_CRYPTO_RISK")
        current=plan("FULL_PROJECT")
        self.assertEqual(validate_bootstrap_plan(desired,current,current["runners"],OLD)[1]["changedRunners"],["SHARED_CRYPTO_RISK"])
        desired["runners"]["V52"]=NEW
        with self.assertRaisesRegex(ValueError,"scope exceeds"):
            validate_bootstrap_plan(desired,current,current["runners"],OLD)
    def test_stale_current_pins_rejected(self):
        with self.assertRaisesRegex(ValueError,"stale"):
            validate_bootstrap_plan(plan("SHARED_CRYPTO_RISK_ONLY","SHARED_CRYPTO_RISK"),
                                    plan("FULL_PROJECT"), {"V12_V4":OLD}, OLD)
    def test_current_symlink_mismatch_rejected(self):
        with self.assertRaisesRegex(ValueError,"symlink"):
            validate_bootstrap_plan(plan("SHARED_CRYPTO_RISK_ONLY","SHARED_CRYPTO_RISK"),
                                    plan("FULL_PROJECT"),plan("FULL_PROJECT")["runners"], NEW)
    @unittest.skipIf(os.name == "nt", "Windows ACLs do not expose POSIX root ownership/mode semantics")
    def test_marker_rejects_mismatch(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            r=root / NEW
            r.mkdir()
            (r / ".disdex-release-sha").write_text(OLD)
            with self.assertRaisesRegex(ValueError,"marker"):
                release_marker(NEW,root,root_uid=__import__("os").geteuid())

    @unittest.skipIf(os.name == "nt", "Windows ACLs do not expose POSIX root ownership/mode semantics")
    def test_marker_rejects_external_dependency_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            root = base / "releases"
            release = root / NEW
            release.mkdir(parents=True)
            (release / ".disdex-release-sha").write_text(NEW, encoding="ascii")
            release.chmod(0o755)
            (release / ".disdex-release-sha").chmod(0o444)
            external = base / "shared-node-modules"
            external.mkdir()
            (release / "node_modules").symlink_to(external, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "external dependency"):
                release_marker(NEW, root, root_uid=__import__("os").geteuid())

    @unittest.skipIf(os.name == "nt", "Windows ACLs do not expose POSIX root ownership/mode semantics")
    def test_auxiliary_marker_can_use_a_non_sha_release_directory(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "ui-hp-ranking-rise-fall-737ec0503a"
            root.mkdir()
            (root / ".disdex-release-sha").write_text(NEW, encoding="ascii")
            root.chmod(0o755)
            (root / ".disdex-release-sha").chmod(0o444)
            self.assertEqual(
                auxiliary_release_marker(NEW, root, root_uid=__import__("os").geteuid()),
                root,
            )

    @unittest.skipIf(os.name == "nt", "Windows ACLs do not expose POSIX root ownership/mode semantics")
    def test_auxiliary_marker_rejects_wrong_sha(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "monitor-release"
            root.mkdir()
            (root / ".disdex-release-sha").write_text(OLD, encoding="ascii")
            root.chmod(0o755)
            (root / ".disdex-release-sha").chmod(0o444)
            with self.assertRaisesRegex(ValueError, "marker SHA mismatch"):
                auxiliary_release_marker(NEW, root, root_uid=__import__("os").geteuid())
    @unittest.skipIf(os.name == "nt", "Windows ACLs do not expose POSIX root ownership/mode semantics")
    def test_untrusted_symlink_file(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            p=root / "ok"
            p.write_text("dummy")
            s=root / "bad"
            s.symlink_to(p)
            with self.assertRaisesRegex(ValueError,"type"):
                assert_regular_secure(s,root_uid=__import__("os").geteuid())
    @unittest.skipIf(os.name == "nt", "Windows ACLs do not expose POSIX root ownership/mode semantics")
    def test_private_directory_rejects_writable(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d) / "bad"
            p.mkdir(mode=0o777)
            p.chmod(0o777)
            with self.assertRaisesRegex(ValueError,"root-only"):
                assert_private_dir(p,root_uid=__import__("os").geteuid())
    @unittest.skipIf(os.name == "nt", "Linux root-owned fixture required")
    def test_public_runner_pins_can_be_published_under_trusted_etc_dir(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            directory = root / "etc-disdex"
            directory.mkdir(mode=0o755)
            directory.chmod(0o755)
            target = directory / "runner-pins.json"
            _atomic_json(target, {"schema": "test-pins"}, root_uid=os.geteuid(), private=False)
            self.assertEqual(json.loads(target.read_text())["schema"], "test-pins")
            self.assertEqual(target.stat().st_mode & 0o777, 0o644)

    @unittest.skipIf(os.name == "nt", "Linux root-owned fixture required")
    def test_private_operator_artifact_in_trusted_root_public_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "shared-operator-activation"
            directory.mkdir(mode=0o755)
            directory.chmod(0o755)
            target = directory / "v12-v4-full.json"
            _atomic_json(target, {"approvedSha": "x" * 40},
                         root_uid=os.geteuid(), private=True,
                         trusted_parent=True)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(target.read_text())["approvedSha"], "x" * 40)

    @unittest.skipIf(os.name == "nt", "Linux root-owned fixture required")
    def test_public_pins_reject_writable_parent_and_symlink(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            directory = root / "unsafe"
            directory.mkdir(mode=0o777)
            directory.chmod(0o777)
            target = directory / "runner-pins.json"
            with self.assertRaisesRegex(ValueError, "non-writable directory"):
                _atomic_json(target, {"schema": "unsafe"}, root_uid=os.geteuid(), private=False)
            directory.chmod(0o755)
            ordinary = directory / "original"
            ordinary.write_text("original", encoding="utf8")
            target.symlink_to(ordinary)
            with self.assertRaisesRegex(ValueError, "untrusted file type"):
                _atomic_json(target, {"schema": "unsafe"}, root_uid=os.geteuid(), private=False)
            self.assertEqual(ordinary.read_text(), "original")

    def test_forced_command_exact_readiness_helper_allowed(self):
        self.assertEqual(parse_original(READINESS_HELPER), [READINESS_HELPER])

    def test_forced_command_readiness_helper_rejects_arguments(self):
        with self.assertRaises(ValueError):
            parse_original(READINESS_HELPER + " --execute")

    def test_forced_command_allows_exact_idle_flat_repair_only(self):
        from disdex_unified_forced_command import parse_original, IDLE_FLAT_REPAIR_HELPER
        command=f"{IDLE_FLAT_REPAIR_HELPER} --execute-after-three-signed-gets"
        self.assertEqual(parse_original(command), [IDLE_FLAT_REPAIR_HELPER, "--execute-after-three-signed-gets"])
        for bad in (
            f"{IDLE_FLAT_REPAIR_HELPER}",
            f"{IDLE_FLAT_REPAIR_HELPER} --verify-only",
            f"{IDLE_FLAT_REPAIR_HELPER} --execute-after-three-signed-gets extra",
            f"/bin/sh -c '{command}'",
        ):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_original(bad)

    def test_forced_command_allows_exact_idle_kill_recovery_only(self):
        from disdex_unified_forced_command import parse_original, IDLE_KILL_RECOVERY_HELPER
        command=f"{IDLE_KILL_RECOVERY_HELPER} --execute-after-three-signed-gets"
        self.assertEqual(parse_original(command), [IDLE_KILL_RECOVERY_HELPER, "--execute-after-three-signed-gets"])
        for bad in (
            IDLE_KILL_RECOVERY_HELPER,
            f"{IDLE_KILL_RECOVERY_HELPER} --verify-only",
            f"{IDLE_KILL_RECOVERY_HELPER} --execute-after-three-signed-gets extra",
        ):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_original(bad)

    def test_forced_command_rejects_shell(self):
        with self.assertRaises(ValueError):
            parse_original("/bin/sh -c whoami")
    def test_forced_command_rejects_injected_extra(self):
        args=[HELPER]
        for k in ALLOWED:
            args += [k,"VALUE"]
        args += ["--execute", "--read-approval-stdin", ";", "systemctl", "restart"]
        with self.assertRaises(ValueError):
            parse_original(" ".join(args))
    def test_forced_command_valid(self):
        args=[HELPER]
        for k in ALLOWED:
            args += [k, "VALUE"]
        args += ["--execute", "--read-approval-stdin"]
        self.assertEqual(parse_original(" ".join(args)),args)
    def test_wrong_target_before_files(self):
        args=SimpleNamespace(deployment_target="attacker",operator_target="DD1296_FINAL_ALLIN_10BPS",
                             sha=NEW,scope="SHARED_CRYPTO_RISK_ONLY",route="CODEX_SSH",
                             plan_sha256="d"*64,orders_enabled="false",owner="owner")
        with self.assertRaisesRegex(ValueError,"target"):
            preflight(args,"token")


class FakeSystemd:
    def __init__(self, old_unit, new_unit, *, fail_new_start=False,
                 old_active=True, dormant_old_pid=0):
        self.old_unit = old_unit
        self.new_unit = new_unit
        self.fail_new_start = fail_new_start
        self.active_units = {old_unit: old_active, new_unit: False}
        self.failed_units = {old_unit} if not old_active else set()
        self.dormant_old_pid = dormant_old_pid
        self.masked_units = set()
        self.calls = []

    def active_state(self, unit):
        if self.active_units.get(unit, False):
            return "active"
        return "failed" if unit in self.failed_units else "inactive"

    def main_pid(self, unit):
        if self.active_units.get(unit, False):
            return 4242
        if unit == self.old_unit:
            return self.dormant_old_pid
        return 0

    def is_active(self, unit):
        return bool(self.active_units.get(unit, False))

    def is_masked(self, unit):
        return unit in self.masked_units

    def is_enabled(self, unit):
        return unit == self.old_unit

    def stop(self, unit):
        self.calls.append(("stop", unit))
        self.active_units[unit] = False
        self.failed_units.discard(unit)

    def mask(self, unit):
        self.calls.append(("mask", unit))
        self.masked_units.add(unit)

    def unmask(self, unit):
        self.calls.append(("unmask", unit))
        self.masked_units.discard(unit)

    def start(self, unit):
        self.calls.append(("start", unit))
        if unit == self.new_unit and self.fail_new_start:
            raise RuntimeError("new writer failed to start")
        if unit in self.masked_units:
            raise RuntimeError("masked unit cannot start")
        self.active_units[unit] = True
        self.failed_units.discard(unit)

    def enable(self, unit):
        self.calls.append(("enable", unit))

    def disable(self, unit):
        self.calls.append(("disable", unit))


def _secure_dir(path):
    path.mkdir(parents=True, exist_ok=True)
    path.chmod(0o700)
    return path


def _write_secure_json(path, value, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
    path.chmod(mode)


@unittest.skipIf(os.name == "nt", "root-owned private fixture semantics require Linux CI")
class SharedRiskExecutorTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.root = _secure_dir(base / "unified-deploy")
        self.plans = _secure_dir(self.root / "plans")
        _secure_dir(self.plans / "SHARED_CRYPTO_RISK_ONLY")
        self.activations = _secure_dir(self.root / "activations")
        _secure_dir(self.activations / "SHARED_CRYPTO_RISK_ONLY")
        self.nonce_dir = _secure_dir(self.root / "nonces")
        self.receipts = _secure_dir(self.root / "receipts")
        self.releases = base / "releases"
        self.releases.mkdir()
        self.old = OLD
        self.new = NEW
        self.ui_root = base / "ui-release"
        self.monitor_root = base / "monitor-release"
        for auxiliary_root in (self.ui_root, self.monitor_root):
            auxiliary_root.mkdir()
            (auxiliary_root / ".disdex-release-sha").write_text(self.old, encoding="ascii")
            auxiliary_root.chmod(0o755)
            (auxiliary_root / ".disdex-release-sha").chmod(0o444)
        self.current = base / "current"
        for sha in (self.old, self.new):
            release = self.releases / sha
            release.mkdir()
            (release / ".disdex-release-sha").write_text(sha, encoding="ascii")
            (release / ".disdex-release-sha").chmod(0o400)
        self.current.symlink_to(self.releases / self.old, target_is_directory=True)
        self.pins_path = base / "runner-pins.json"
        self.current_plan_path = self.root / "current-plan.json"
        self.before_venue = self.root / "venue-before.json"
        self.after_venue = self.root / "venue-after.json"
        self.public_key = self.root / "owner-approval-public.pem"
        self.public_key.write_text("test public key", encoding="ascii")
        self.public_key.chmod(0o600)

        current = plan("FULL_PROJECT")
        desired = plan("SHARED_CRYPTO_RISK_ONLY", "SHARED_CRYPTO_RISK")
        for candidate in (current, desired):
            candidate["releaseRoots"] = {
                "runners": str(self.releases),
                "ui": str(self.ui_root),
                "monitor": str(self.monitor_root),
            }
        self.current_plan = current
        self.desired_plan = desired
        self.plan_hash = digest(desired, current)[0]
        self._write_pins(current)
        _write_secure_json(self.current_plan_path, current)
        self.now = 2_000_000_000
        self._write_venue(self.before_venue, self.now - 5)
        self._write_venue(self.after_venue, self.now + 1)
        self._write_activation()

        self.paths = DeploymentPaths(
            root=self.root,
            pins=self.pins_path,
            current_plan=self.current_plan_path,
            current=self.current,
            releases=self.releases,
            nonce_dir=self.nonce_dir,
            public_key=self.public_key,
            activation_dir=self.activations,
            venue_before=self.before_venue,
            venue_after=self.after_venue,
            receipts=self.receipts,
        )
        self.old_unit = f"disdex-shared-crypto-risk@{self.old}.service"
        self.new_unit = f"disdex-shared-crypto-risk@{self.new}.service"

    def tearDown(self):
        self.temp.cleanup()

    def _write_pins(self, current):
        manifest = pins(self.releases)
        _write_secure_json(self.pins_path, manifest)
        _write_secure_json(
            self.plans / "SHARED_CRYPTO_RISK_ONLY" / f"{self.new}.json",
            self.desired_plan,
        )

    def _write_activation(self):
        activation = {
            "schema": "disdex-unified-operator-activation/v1",
            "repository": REPO,
            "deploymentTarget": DEPLOYMENT_TARGET,
            "operatorTarget": OPERATOR_TARGET,
            "scope": "SHARED_CRYPTO_RISK_ONLY",
            "approvedSha": self.new,
            "approvedShaByRunner": self.desired_plan["runners"],
            "approvedRunners": ["SHARED_CRYPTO_RISK"],
            "planSha256": self.plan_hash,
            "ordersEnabled": False,
            "operator": "owner",
            "approvedAt": self.now - 10,
            "expiresAt": self.now + 300,
            "operatorAcknowledgement": "I_ACK_SHARED_RISK_ONLY_NO_ORDERS",
        }
        _write_secure_json(
            self.activations / "SHARED_CRYPTO_RISK_ONLY" / f"{self.new}.json",
            activation,
        )

    def _write_venue(self, path, captured_at):
        _write_secure_json(path, {
            "schema": "disdex-venue-readonly-evidence/v1",
            "venue": "aster",
            "capturedAt": captured_at,
            "expiresAt": captured_at + 300,
            "readOnly": True,
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
            "positionsReconciled": True,
            "protectiveStopsReconciled": True,
            "stopOwnershipReconciled": True,
            "pendingExposureReconciled": True,
            "grossReconciled": True,
            "sharedRiskHealthy": True,
            "sharedRiskDailyLossLimit": 0.075,
            "marginGuardHealthy": True,
            "accountLockHealthy": True,
            "killSwitchHealthy": True,
            "signatureVerified": True,
            "heartbeatVerified": True,
            "tickVerified": True,
            "runnerShaMapVerified": True,
            "unknownStops": 0,
            "partialStops": 0,
            "positionsDigest": "positions-before-after",
            "protectiveOrdersDigest": "stops-before-after",
            "pendingDigest": "pending-before-after",
        })

    def _args(self):
        return SimpleNamespace(
            deployment_target=DEPLOYMENT_TARGET,
            operator_target=OPERATOR_TARGET,
            sha=self.new,
            scope="SHARED_CRYPTO_RISK_ONLY",
            route="CODEX_SSH",
            plan_sha256=self.plan_hash,
            orders_enabled="false",
            owner="owner",
        )

    def _verify(self, token, public_key, repo, sha, scope, operator,
                plan_sha256, now=None, nonce_dir=None, route=None,
                deployment_target=None, operator_target=None,
                orders_enabled=False):
        self.assertEqual(token, "signed-token")
        nonce = "a" * 32
        if nonce_dir is not None:
            fd = os.open(Path(nonce_dir) / nonce,
                         os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
        return {
            "schema": "disdex-owner-deployment-approval/v2",
            "repository": repo,
            "deploymentTarget": deployment_target,
            "operatorTarget": operator_target,
            "route": route,
            "sourceSha": sha,
            "scope": scope,
            "operator": operator,
            "nonce": nonce,
            "planSha256": plan_sha256,
            "ordersEnabled": orders_enabled,
        }

    def _executor(self, systemd):
        def audit_reader(cycle):
            evidence = json.loads(self.after_venue.read_text(encoding="utf-8"))
            evidence["capturedAt"] = self.now + 1 + cycle
            evidence["expiresAt"] = self.now + 301 + cycle
            return evidence

        return RootDeploymentExecutor(
            self.paths,
            root_uid=os.geteuid(),
            systemd=systemd,
            verify_fn=self._verify,
            clock=lambda: self.now,
            sleep_fn=lambda _seconds: None,
            audit_reader=audit_reader,
        )

    def test_shared_risk_cutover_changes_only_writer_and_preserves_current_symlink(self):
        systemd = FakeSystemd(self.old_unit, self.new_unit)
        result = self._executor(systemd).execute(self._args(), "signed-token")

        self.assertEqual(result["status"], "SHARED_RISK_CUTOVER_VERIFIED")
        self.assertEqual(result["ordersSent"], 0)
        self.assertEqual(result["cancelsSent"], 0)
        self.assertEqual(result["positionChangesSent"], 0)
        self.assertEqual(self.current.resolve(), self.releases / self.old)
        self.assertTrue(systemd.is_active(self.new_unit))
        self.assertFalse(systemd.is_active(self.old_unit))
        self.assertEqual(
            systemd.calls,
            [("stop", self.old_unit), ("mask", self.old_unit),
             ("enable", self.new_unit), ("start", self.new_unit)],
        )

    def test_shared_risk_start_failure_rolls_back_writer_and_manifest(self):
        systemd = FakeSystemd(self.old_unit, self.new_unit, fail_new_start=True)
        with self.assertRaisesRegex(RuntimeError, "rolled back"):
            self._executor(systemd).execute(self._args(), "signed-token")
        self.assertTrue(systemd.is_active(self.old_unit))
        self.assertFalse(systemd.is_active(self.new_unit))
        restored = json.loads(self.pins_path.read_text(encoding="utf-8"))
        self.assertEqual(restored["runners"]["SHARED_CRYPTO_RISK"]["sha"], self.old)

    def test_replayed_owner_token_is_rejected_before_mutation(self):
        first = FakeSystemd(self.old_unit, self.new_unit, fail_new_start=True)
        with self.assertRaisesRegex(RuntimeError, "rolled back"):
            self._executor(first).execute(self._args(), "signed-token")
        systemd = FakeSystemd(self.old_unit, self.new_unit)
        with self.assertRaisesRegex(ValueError, "replay"):
            self._executor(systemd).execute(self._args(), "signed-token")
        self.assertEqual(systemd.calls, [])

    def test_stale_or_mutating_venue_evidence_fails_closed(self):
        evidence = json.loads(self.before_venue.read_text(encoding="utf-8"))
        evidence["capturedAt"] = self.now - 301
        _write_secure_json(self.before_venue, evidence)
        with self.assertRaisesRegex(ValueError, "venue evidence"):
            self._executor(FakeSystemd(self.old_unit, self.new_unit)).execute(self._args(), "signed-token")

    def test_non_shared_execution_scope_is_not_silently_mutated(self):
        args = self._args()
        args.scope = "V52"
        with self.assertRaisesRegex(ValueError, "unsupported execution scope"):
            self._executor(FakeSystemd(self.old_unit, self.new_unit)).execute(args, "signed-token")

if __name__=="__main__":
    unittest.main()
