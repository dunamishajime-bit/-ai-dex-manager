"""Allowlisted, reproducible source-diff contract tests."""
import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_release_source_diff import compare

class SourceDiffTests(unittest.TestCase):
    def setUp(self):
        d=tempfile.TemporaryDirectory();self.addCleanup(d.cleanup)
        self.old=Path(d.name)/"historical";self.live=Path(d.name)/"current"
        self.old.mkdir();self.live.mkdir()
    def put(self,root,path,text):
        p=root/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(text)
    def test_identical_source_not_economic_parity(self):
        data=b"export const gate=1;\n"
        for root in (self.old,self.live):self.put(root,"lib/v12-v4-four-rule-policy.ts",data)
        result=compare("V4",self.old,self.live)
        self.assertEqual(result["status"],"SOURCE_SEGMENT_SAME_ONLY_UNVERIFIED")
        self.assertFalse(result["economicParityCertified"])
        self.assertEqual(result["counts"]["SAME_NORMALIZED_SOURCE"],1)
    def test_crlf_is_ignored(self):
        self.put(self.old,"lib/hype-zec-long-signal.ts",b"const x=1;\r\n")
        self.put(self.live,"lib/hype-zec-long-signal.ts",b"const x=1;\n")
        self.assertEqual(compare("HYPE",self.old,self.live)["counts"]["SOURCE_DIFF"],0)
    def test_modified_safety_gate_detected(self):
        self.put(self.old,"lib/hype-zec-long-runner.ts",b"return true;\n")
        self.put(self.live,"lib/hype-zec-long-runner.ts",b"return false;\n")
        r=compare("HYPE",self.old,self.live)
        self.assertEqual(r["counts"]["SOURCE_DIFF"],1)
        self.assertEqual(r["files"][0]["addedLines"],1)
        self.assertFalse(r["economicParityCertified"])
    def test_new_runtime_file_not_silently_ignored(self):
        self.put(self.old,"lib/v12-v4-v2-shadow.ts",b"old")
        self.put(self.live,"lib/v12-v4-v2-shadow.ts",b"old")
        self.put(self.live,"lib/v12-v4-account-freshness.ts",b"new")
        result=compare("V4",self.old,self.live)
        self.assertEqual(result["counts"]["MISSING_OLD"],1)
    def test_old_file_missing_from_current_detected(self):
        self.put(self.old,"scripts/disdex-hype-zec-core-preempt.ts",b"before")
        self.assertEqual(compare("HYPE",self.old,self.live)["counts"]["MISSING_LIVE"],1)
    def test_secret_env_not_scanned(self):
        self.put(self.old,"lib/hype-zec-long-signal.ts",b"signal")
        self.put(self.live,"lib/hype-zec-long-signal.ts",b"signal")
        self.put(self.old,"config/.aster.env",b"old-secrets")
        self.put(self.live,"config/.aster.env",b"new-secrets")
        result=compare("HYPE",self.old,self.live)
        self.assertEqual(len(result["files"]),1)
    def test_missing_economic_code_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"NO_ALLOWLISTED"):compare("V4",self.old,self.live)
    def test_absent_release_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"SOURCE_RELEASE_NOT_PRESENT"):compare("HYPE",self.old,self.live/"not-found")

if __name__=="__main__":unittest.main()