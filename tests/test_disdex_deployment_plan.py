import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "ops" / "deploy"))
from disdex_deployment_plan import IDS, SCHEMA, REPO, digest

OLD = "7" * 40
NEW = "c" * 40

def plan(scope, runner=None):
    obj = dict(schema=SCHEMA, repository=REPO,
        deploymentTarget="professional-dismanager.net",
        operatorTarget="DD1296_FINAL_ALLIN_10BPS",
        sourceSha=NEW, scope=scope, runners={k: OLD for k in IDS},
        uiSha=OLD, monitorSha=OLD,
        releaseRoots={
            "runners": "/home/deploy/disdex-trading/releases",
            "ui": "/home/deploy/disdex-trading/ui-releases/current-ui",
            "monitor": "/home/deploy/disdex-trading/monitor-releases/current-monitor",
        },
        ordersEnabled=False)
    if runner:
        obj["runners"][runner] = NEW
    return obj

class PlanTests(unittest.TestCase):
    def test_accepts_explicit_auxiliary_release_roots(self):
        current = plan("FULL_PROJECT")
        desired = plan("SHARED_CRYPTO_RISK_ONLY", "SHARED_CRYPTO_RISK")
        roots = {
            "runners": "/home/deploy/disdex-trading/releases",
            "ui": "/home/deploy/disdex-trading/ui-releases/ui-hp-ranking-rise-fall-737ec0503a",
            "monitor": "/home/deploy/disdex-trading/releases/139e8879fae2d6e161cad67584685307d4c63a7c",
        }
        current["releaseRoots"] = roots
        desired["releaseRoots"] = roots

        plan_hash, changes = digest(desired, current)

        self.assertEqual(len(plan_hash), 64)
        self.assertEqual(changes["changedRunners"], ["SHARED_CRYPTO_RISK"])
        self.assertFalse(changes["releaseRootsChanged"])

    def test_shared_risk_alone(self):
        current = plan("FULL_PROJECT")
        desired = plan("SHARED_CRYPTO_RISK_ONLY", "SHARED_CRYPTO_RISK")
        h, changed = digest(desired, current)
        self.assertEqual(len(h), 64)
        self.assertEqual(changed["changedRunners"], ["SHARED_CRYPTO_RISK"])

    def test_q102_alone(self):
        current = plan("FULL_PROJECT")
        wanted = plan("QUALITY102_CAUSAL_V1", "QUALITY102_CAUSAL_V1")
        self.assertEqual(digest(wanted, current)[1]["changedRunners"], ["QUALITY102_CAUSAL_V1"])

    def test_order_permission_is_explicit_for_order_capable_scope(self):
        current = plan("FULL_PROJECT")
        wanted = plan("V12_V4", "V12_V4")
        wanted["ordersEnabled"] = True
        self.assertTrue(digest(wanted, current)[1]["ordersEnabled"])

    def test_shared_risk_cannot_enable_orders(self):
        current = plan("FULL_PROJECT")
        wanted = plan("SHARED_CRYPTO_RISK_ONLY", "SHARED_CRYPTO_RISK")
        wanted["ordersEnabled"] = True
        with self.assertRaisesRegex(ValueError, "order permission"):
            digest(wanted, current)

    def test_shared_risk_forbids_peer_update(self):
        current = plan("FULL_PROJECT")
        wanted = plan("SHARED_CRYPTO_RISK_ONLY", "SHARED_CRYPTO_RISK")
        wanted["runners"]["V12_V4"] = NEW
        with self.assertRaisesRegex(ValueError, "scope exceeds"):
            digest(wanted, current)

    def test_shared_risk_forbids_monitor_update(self):
        current = plan("FULL_PROJECT")
        wanted = plan("SHARED_CRYPTO_RISK_ONLY", "SHARED_CRYPTO_RISK")
        wanted["monitorSha"] = NEW
        with self.assertRaisesRegex(ValueError, "scope exceeds"):
            digest(wanted, current)

    def test_shared_risk_forbids_release_root_update(self):
        current = plan("FULL_PROJECT")
        wanted = plan("SHARED_CRYPTO_RISK_ONLY", "SHARED_CRYPTO_RISK")
        wanted["releaseRoots"]["monitor"] = "/home/deploy/disdex-trading/monitor-releases/next"
        with self.assertRaisesRegex(ValueError, "scope exceeds"):
            digest(wanted, current)

    def test_release_root_paths_are_canonical_absolute_paths(self):
        current = plan("FULL_PROJECT")
        wanted = plan("SHARED_CRYPTO_RISK_ONLY", "SHARED_CRYPTO_RISK")
        wanted["releaseRoots"]["ui"] = "/home/deploy/disdex-trading/ui-releases/../next"
        with self.assertRaisesRegex(ValueError, "invalid immutable release root"):
            digest(wanted, current)

    def test_hp_only(self):
        current = plan("FULL_PROJECT")
        wanted = plan("HP_ONLY")
        wanted["uiSha"] = NEW
        self.assertTrue(digest(wanted, current)[1]["uiChanged"])
        wanted["runners"]["V52"] = NEW
        with self.assertRaisesRegex(ValueError, "HP-only"):
            digest(wanted, current)

    def test_monitor_only(self):
        current = plan("FULL_PROJECT")
        wanted = plan("API_MONITORS")
        wanted["monitorSha"] = NEW
        self.assertTrue(digest(wanted, current)[1]["monitorChanged"])
        wanted["uiSha"] = NEW
        with self.assertRaisesRegex(ValueError, "monitor-only"):
            digest(wanted, current)

    def test_v4_refresh_scope_cannot_be_used_as_a_runner_deployment_plan(self):
        current = plan("FULL_PROJECT")
        wanted = plan("V4_EVIDENCE_REFRESH_ONLY")
        wanted["runners"]["V12_V4"] = NEW
        with self.assertRaisesRegex(ValueError, "refresh-only scope"):
            digest(wanted, current)

    def test_full_project(self):
        current = plan("FULL_PROJECT")
        wanted = plan("FULL_PROJECT", "SHARED_CRYPTO_RISK")
        wanted["uiSha"] = NEW
        wanted["monitorSha"] = NEW
        self.assertEqual(digest(wanted, current)[1]["exactScope"], "FULL_PROJECT")

    def test_noop_rejected(self):
        current = plan("FULL_PROJECT")
        wanted = plan("V12_V4")
        with self.assertRaisesRegex(ValueError, "no deployment differences"):
            digest(wanted, current)

    def test_unknown_runner_rejected(self):
        current = plan("FULL_PROJECT")
        wanted = plan("FULL_PROJECT", "SHARED_CRYPTO_RISK")
        wanted["runners"]["UNKNOWN"] = NEW
        with self.assertRaisesRegex(ValueError, "runner map"):
            digest(wanted, current)

    def test_wrong_target_rejected(self):
        current = plan("FULL_PROJECT")
        wanted = plan("FULL_PROJECT", "SHARED_CRYPTO_RISK")
        wanted["operatorTarget"] = "someone-else"
        with self.assertRaisesRegex(ValueError, "target"):
            digest(wanted, current)

if __name__ == "__main__":
    unittest.main()
