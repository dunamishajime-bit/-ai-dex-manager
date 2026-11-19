"""Read-only regression checks for V12's shared Kill Switch issuer contract."""
import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRODUCER = ROOT / "scripts/ops/root/disdex-v12-kill-switch-auto-repair"
CONSUMER = ROOT / "scripts/disdex_v13d_v11eq_stock_live_engine.py"
V96_TS = ROOT / "config/disdexV96Runtime.ts"


class SharedKillSwitchIssuerContractTests(unittest.TestCase):
    def test_shell_syntax(self):
        subprocess.run(["bash", "-n", str(PRODUCER)], check=True)

    def test_issuer_matches_canonical_v96_consumers_without_deactivating(self):
        producer = PRODUCER.read_text()
        consumer = CONSUMER.read_text()
        typescript = V96_TS.read_text()
        canonical = re.search(r'^V96_KILL_SWITCH_STRATEGY_ID = "([^"]+)"', consumer, re.M).group(1)
        ts_id = re.search(r'^export const DISDEX_V96_STRATEGY_ID = "([^"]+)"', typescript, re.M).group(1)
        root_id = re.search(r"^SHARED_KILL_SWITCH_STRATEGY_ID='([^']+)'", producer, re.M).group(1)
        self.assertEqual(canonical, ts_id)
        self.assertEqual(root_id, canonical)
        expression = re.search(r"'(\{active:true, strategyId:\$strategyId,[^']+\})' > \"\$tmp\"", producer)
        self.assertIsNotNone(expression)
        result = subprocess.run(
            ["jq", "-n", "--arg", "strategyId", root_id,
             "--arg", "reason", "read-only-contract-test",
             "--arg", "sourcePath", "/test/not-production.json",
             "--arg", "activatedAt", "2026-11-19T12:00:00Z", expression.group(1)],
            text=True, capture_output=True, check=True,
        )
        payload = json.loads(result.stdout)
        self.assertEqual(payload["strategyId"], canonical)
        self.assertEqual(payload["issuerStrategyId"], "DISDEX_V12_X1_ALL")
        self.assertIs(payload["active"], True)
        # Changing the emergency action needs separate owner approval.
        self.assertEqual(payload["action"], "FLATTEN_MANAGED")
        self.assertEqual(payload["reason"], "read-only-contract-test")


if __name__ == "__main__":
    unittest.main()
