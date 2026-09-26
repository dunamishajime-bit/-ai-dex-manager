import json
import tempfile
import unittest
from pathlib import Path
from research.formal_five_bt.seven_source import (
    LIVE_FIVE_SHA, SEVEN_RESEARCH_SHA, SEVEN_STRATEGIES,
    SIDE_CAR_FILES, verify_seven_source,
)

class SevenSourceContractTests(unittest.TestCase):
    def test_expected_seven_algorithms_and_exact_frozen_relationship(self):
        self.assertEqual(SEVEN_STRATEGIES, ("V12","PENGU","Q102","FET","V52","HYPE","ZEC"))
        self.assertNotEqual(LIVE_FIVE_SHA,SEVEN_RESEARCH_SHA)
        self.assertIn("lib/hype-zec-long-sleeves.ts",SIDE_CAR_FILES)
    def test_hash_tampering_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            target=root/"snapshot"/"config"/"hypeZecLongPolicy.ts"
            target.parent.mkdir(parents=True)
            target.write_text("bad")
            data={"live_five_runtime_sha":LIVE_FIVE_SHA,"seven_research_source_sha":SEVEN_RESEARCH_SHA,
                "source_commit_parent_sha":LIVE_FIVE_SHA,"actual_vps_seven_live_verified":False,
                "no_order_mutation":True,"files":[{"path":"config/hypeZecLongPolicy.ts",
                    "sha256":"f"*64,"materialized_for_bridge":True}]}
            (root/"source-manifest.json").write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,"SHA256_MISMATCH"):
                verify_seven_source(root)
    def test_live_not_confirmed_cannot_be_promoted_by_a_manifest_field(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/"source-manifest.json").write_text(json.dumps({
                "live_five_runtime_sha":LIVE_FIVE_SHA,"seven_research_source_sha":SEVEN_RESEARCH_SHA,
                "source_commit_parent_sha":LIVE_FIVE_SHA,"actual_vps_seven_live_verified":True,
                "no_order_mutation":True,"files":[]}))
            with self.assertRaisesRegex(ValueError,"PROVENANCE_MISMATCH"):
                verify_seven_source(root)

if __name__=="__main__":unittest.main()
