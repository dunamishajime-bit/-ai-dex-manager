import importlib.util
from pathlib import Path
import base64
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/research/verify_bt_live_vps_dependency_bytes.py"
spec=importlib.util.spec_from_file_location("bt_vps_bytes",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class VPSBytesTests(unittest.TestCase):
    def test_newline_normalization(self):
        self.assertEqual(m.classify(b"hello\n",b"hello\r\n"),"NEWLINE_OR_BOM_ONLY")

    def test_content_change(self):
        self.assertEqual(m.classify(b"a",b"b"),"CONTENT_MISMATCH")

    def test_missing_file_blocks(self):
        sha="a"*40
        git={"runners":{"V4":{"files":[{"path":"scripts/a.ts","git_sha256":sha,"git_normalized_sha256":sha}]}}}
        result=m.compare_bytes(git,{"V4":{"scripts/a.ts":None}})
        self.assertFalse(result["all_files_match"])
        self.assertEqual(result["rows"][0]["match_type"],"MISSING_VPS_FILE")

    def test_coverage_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"coverage"):
            m.compare_bytes({"runners":{"V4":{"files":[]}}},{})

    def test_remote_payload_uses_pinned_release(self):
        script=m.remote_payload({"git_commit":"a"*40,"files":[{"path":"lib/a.ts"}]})
        self.assertIn("/home/deploy/disdex-trading/releases",script)
        self.assertNotIn("subprocess",script)


if __name__=="__main__":
    unittest.main()
