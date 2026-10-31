import sys
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"/"ops"/"deploy"))
import disdex_v4_static_evidence as m

SHA="a"*40

class StaticEvidenceContractTest(unittest.TestCase):
    def test_certification_is_candidate_bound_and_requires_all_commands(self):
        writes={}
        with patch.object(m,"_assert_release",return_value=Path("/candidate")), \
             patch.object(m.Path,"is_file",return_value=True), \
             patch.object(m,"_run",side_effect=[
                 {"sha256":"1"*64,"returnCode":0},
                 {"sha256":"2"*64,"returnCode":0},
                 {"sha256":"3"*64,"returnCode":0},
             ]), \
             patch.object(m,"_atomic",side_effect=lambda path,value:writes.__setitem__(path.name,value)):
            result=m.certify(SHA)
        self.assertEqual(result["status"],"V4_STATIC_EVIDENCE_CERTIFIED")
        self.assertEqual(result["candidateSha"],SHA)
        self.assertEqual(writes["route-source-parity.json"]["candidateSha"],SHA)
        self.assertEqual(writes["route-source-parity.json"]["routeCount"],41)
        self.assertTrue(writes["route-source-parity.json"]["sourceParity"])
        self.assertEqual(writes["v4-execution-tests.json"]["testPasses"],3)
        self.assertEqual(writes["v4-execution-tests.json"]["failCount"],0)
        self.assertTrue(writes["v4-execution-tests.json"]["typecheck"])

    def test_bad_candidate_sha_is_rejected_before_tests(self):
        with patch.object(m.os,"geteuid",return_value=0,create=True):
            with self.assertRaisesRegex(ValueError,"SHA_INVALID"):
                m._assert_release("latest")

if __name__=="__main__":
    unittest.main()
