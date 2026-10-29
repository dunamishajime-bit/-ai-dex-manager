"""Root-side preflight and forced-command unit tests (NO server mutations)."""
import json
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
    assert_regular_secure, assert_private_dir, preflight, PREFIXES, STOP_OWNERS,
    ROOT, RELEASES
)
from disdex_deployment_plan import IDS, SCHEMA
from disdex_unified_forced_command import parse_original, HELPER, ALLOWED

OLD="7"*40
NEW="c"*40

def plan(scope, r=None):
    p=dict(schema=SCHEMA, repository="dunamishajime-bit/-ai-dex-manager",
           deploymentTarget="professional-dismanager.net",
           operatorTarget="DD1296_FINAL_ALLIN_10BPS", sourceSha=NEW,
           scope=scope, runners={i:OLD for i in IDS},
           uiSha=OLD, monitorSha=OLD, ordersEnabled=False)
    if r:
        p["runners"][r]=NEW
    return p

def pins():
    return {"schema":"disdex-runner-pin-manifest/v1","target":"test",
            "runners":{key:{"sha":OLD,
                            "serviceUnit":f"{PREFIXES[key]}@{OLD}.service",
                            "releaseRoot":str(RELEASES / OLD),
                            "evidenceMode":"legacy",
                            "stopOwner":STOP_OWNERS[key]} for key in IDS}}

class RootGateTest(unittest.TestCase):
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
    def test_marker_rejects_mismatch(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            r=root / NEW
            r.mkdir()
            (r / ".disdex-release-sha").write_text(OLD)
            with self.assertRaisesRegex(ValueError,"marker"):
                release_marker(NEW,root,root_uid=__import__("os").geteuid())
    def test_untrusted_symlink_file(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            p=root / "ok"
            p.write_text("dummy")
            s=root / "bad"
            s.symlink_to(p)
            with self.assertRaisesRegex(ValueError,"type"):
                assert_regular_secure(s,root_uid=__import__("os").geteuid())
    def test_private_directory_rejects_writable(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d) / "bad"
            p.mkdir(mode=0o777)
            p.chmod(0o777)
            with self.assertRaisesRegex(ValueError,"root-only"):
                assert_private_dir(p,root_uid=__import__("os").geteuid())
    def test_forced_command_rejects_shell(self):
        with self.assertRaises(ValueError):
            parse_original("/bin/sh -c whoami")
    def test_forced_command_rejects_injected_extra(self):
        args=[HELPER]
        for k in ALLOWED:
            args += [k,"VALUE"]
        args += ["--read-approval-stdin", ";", "systemctl", "restart"]
        with self.assertRaises(ValueError):
            parse_original(" ".join(args))
    def test_forced_command_valid(self):
        args=[HELPER]
        for k in ALLOWED:
            args += [k, "VALUE"]
        args += ["--read-approval-stdin"]
        self.assertEqual(parse_original(" ".join(args)),args)
    def test_wrong_target_before_files(self):
        args=SimpleNamespace(deployment_target="attacker",operator_target="DD1296_FINAL_ALLIN_10BPS",
                             sha=NEW,scope="SHARED_CRYPTO_RISK_ONLY",route="CODEX_SSH",
                             plan_sha256="d"*64,orders_enabled="false",owner="owner")
        with self.assertRaisesRegex(ValueError,"target"):
            preflight(args,"token")

if __name__=="__main__":
    unittest.main()
