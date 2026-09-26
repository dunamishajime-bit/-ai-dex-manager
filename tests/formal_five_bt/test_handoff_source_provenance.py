"""Source/runtime SHA alignment is mandatory before any economic backtest."""
from pathlib import Path
import unittest
from research.formal_five_bt.manifest import load_manifest
from research.formal_five_bt.strategies import EXPECTED_RUNTIME_SHA
M=Path(__file__).resolve().parents[2]/"research/formal_five_bt/runtime_source_manifest.json"
PIN="a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"
class HandoffSourceProvenance(unittest.TestCase):
    def test_all_source_references_use_exact_active_commit(self):
        m=load_manifest(M)
        self.assertEqual(m["runtime_sha"],PIN)
        self.assertEqual(m["active_release_id"],PIN)
        self.assertEqual(m["verified_repository_commit"],PIN)
        self.assertEqual(EXPECTED_RUNTIME_SHA,PIN)
        self.assertTrue(all(PIN in unit for unit in m["units"]))
        self.assertGreaterEqual(len(m["files"]),50)
    def test_prior_run_inputs_must_not_be_accepted(self):
        m=load_manifest(M)
        self.assertNotEqual(m["runtime_sha"],"e1b58060d6263a3af7ced51bec854d3e211d2f35")
        for unit in m["units"]:self.assertIn(PIN,unit)
if __name__=="__main__": unittest.main()
