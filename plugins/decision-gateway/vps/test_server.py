import importlib.util
import os
import pathlib
import unittest

os.environ["DG_TOKEN"] = "x" * 64

SERVER = pathlib.Path(__file__).with_name("server.py")
spec = importlib.util.spec_from_file_location("dg_server", SERVER)
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class VpsServerTests(unittest.TestCase):
    def test_initialize(self):
        out = server.handle_rpc({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26"}
        })
        self.assertEqual(out["result"]["serverInfo"]["name"], "disdex-decision-gateway")

    def test_tools_list(self):
        out = server.handle_rpc({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        names = {x["name"] for x in out["result"]["tools"]}
        self.assertEqual(names, {"decision_reduce", "decision_judge", "decision_pipeline"})

    def test_judge_tool(self):
        value = server.run_tool("decision_judge", {
            "payload": {"checks": [{"name": "sha", "status": True, "hard": True}]}
        })
        self.assertEqual(value["verdict"], "PASS")
        self.assertEqual(value["route"], "LOCAL_ONLY")

    def test_pipeline_reduces(self):
        evidence = "\n".join(["noise"] * 500 + ["FATAL request timeout"] + ["noise"] * 500)
        value = server.run_tool("decision_pipeline", {
            "payload": {"checks": [{"name": "runtime", "status": True, "hard": True}]},
            "evidence": evidence,
            "max_lines": 20
        })
        self.assertEqual(value["verdict"], "PASS")
        self.assertLess(value["reduction"]["selected_lines"], value["reduction"]["original_lines"])

if __name__ == "__main__":
    unittest.main()
