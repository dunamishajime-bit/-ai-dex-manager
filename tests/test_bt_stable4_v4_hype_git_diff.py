import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

p=Path(__file__).resolve().parents[1]/"scripts/research/audit_bt_stable4_v4_hype_git_diff.py"
s=importlib.util.spec_from_file_location("bt_git_diff",p)
m=importlib.util.module_from_spec(s)
s.loader.exec_module(m)

class DiffTests(unittest.TestCase):
    def test_modified_added_deleted(self):
        with patch.object(m,"git",return_value=b"M\x00scripts/a.ts\x00A\x00lib/b.ts\x00D\x00docs/c.md\x00"):
            rows=m.changed_files(Path("."),"a"*40,"b"*40)
        self.assertEqual([r["status"] for r in rows],["M","A","D"])
    def test_invalid_sha_rejected(self):
        with self.assertRaisesRegex(ValueError,"SHA"):
            m.changed_files(Path("."),"bad","a"*40)
    def test_malformed_diff_rejected(self):
        with patch.object(m,"git",return_value=b"M\x00scripts/a.ts"):
            with self.assertRaisesRegex(ValueError,"Malformed"):
                m.changed_files(Path("."),"a"*40,"b"*40)
    def test_empty_diff(self):
        with patch.object(m,"git",return_value=b""):
            self.assertEqual(m.changed_files(Path("."),"a"*40,"b"*40),[])

if __name__=="__main__":
    unittest.main()
