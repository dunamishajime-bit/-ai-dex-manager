import importlib.util
import pathlib
import unittest

SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "decision_gateway.py"
spec = importlib.util.spec_from_file_location("decision_gateway", SCRIPT)
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)

class GatewayTests(unittest.TestCase):
    def test_pass_stays_local(self):
        out = gateway.judge({"checks":[{"name":"sha","status":True,"hard":True}]})
        self.assertEqual(out["verdict"], "PASS")
        self.assertEqual(out["route"], "LOCAL_ONLY")

    def test_hard_fail_stays_local(self):
        out = gateway.judge({"risk":"high","checks":[{"name":"kill","status":False,"hard":True}]})
        self.assertEqual(out["verdict"], "FAIL")
        self.assertEqual(out["route"], "LOCAL_ONLY")

    def test_conflict_escalates(self):
        out = gateway.judge({"conflicts":["two SHAs observed"],"checks":[]})
        self.assertEqual(out["verdict"], "NEED_SOL")
        self.assertEqual(out["route"], "SOL_RECOMMENDED")

    def test_unknown_gathers_evidence(self):
        out = gateway.judge({"checks":[{"name":"margin","status":None,"hard":True}]})
        self.assertEqual(out["verdict"], "UNKNOWN")
        self.assertIn("margin", out["missing_evidence"])

    def test_reducer_keeps_failure(self):
        text = "\n".join(["noise"] * 300 + ["FATAL request timeout after 10000ms"] + ["noise"] * 300)
        out = gateway.reduce_text(text, max_lines=20, context=1)
        self.assertLess(out["selected_lines"], out["original_lines"])
        self.assertIn("FATAL request timeout", out["compact_text"])

if __name__ == "__main__":
    unittest.main()
