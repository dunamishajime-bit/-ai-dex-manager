from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "disdex-stable4-order-disable-quiesce.yml"


class Stable4OrderDisableWorkflowTests(unittest.TestCase):
    def test_workflow_binds_exact_monitor_only_contract(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("ALL_RUNNERS_MONITOR_REFRESH", source)
        self.assertIn("FULL_PROJECT", source)
        self.assertIn("ordersEnabled", source)
        self.assertIn("--orders-enabled false", source)
        self.assertIn("disdex-production", source)
        self.assertIn("professional-dismanager.net", source)
        self.assertIn("b8d681f048b087f07e0dcfb743cc14ec3a796b27", source)
        self.assertIn("542b30ea87fa0e6ea9d27dd63fecc00181e95d4040a544aa9004fed579f4d68f", source)

    def test_workflow_uses_root_ssh_and_no_mutation_commands(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("DISDEX_VPS_ROOT_PRIVATE_KEY", source)
        self.assertIn("disdex_order_disable_quiesce.py", source)
        self.assertIn("--preflight-readonly", source)
        self.assertIn("--execute-approved", source)
        self.assertNotIn("createOrder", source)
        self.assertNotIn("cancelOrder", source)
        self.assertNotIn("orders.create", source)
        self.assertNotIn("systemctl start", source)
        self.assertNotIn("systemctl restart", source)

    def test_workflow_cleans_ephemeral_material(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("if: always()", source)
        self.assertIn("rm -rf", source)
        self.assertIn("ORDERS_SENT=0", source)
        self.assertIn("CANCELS_SENT=0", source)
        self.assertIn("POSITION_CHANGES_SENT=0", source)


if __name__ == "__main__":
    unittest.main()
