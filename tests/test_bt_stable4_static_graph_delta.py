import importlib.util
from pathlib import Path
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/research/audit_bt_stable4_static_graph_delta.py"
s=importlib.util.spec_from_file_location("bt_graph_delta",p)
m=importlib.util.module_from_spec(s)
s.loader.exec_module(m)

def graph(files):
    return {"files":[{"path":a,"git_sha256":b} for a,b in files],"unresolved_relative_imports":[]}

class GraphDeltaTests(unittest.TestCase):
    def test_static_graph_detects_modified_added_removed(self):
        old=graph([("lib/signal.ts","1"),("lib/old.ts","2"),("lib/keep.ts","same")])
        new=graph([("lib/signal.ts","3"),("lib/new.ts","4"),("lib/keep.ts","same")])
        result=m.evaluate_graphs(old,new)
        self.assertEqual(result["changed_files_in_static_graph_union"],3)
        self.assertEqual(result["identical_static_files"],1)
        self.assertTrue(result["source_graph_change_requires_trade_reexecution"])
        self.assertEqual(set(row["operation"] for row in result["changed"]),{"MODIFIED","LIVE_ADDED","LIVE_REMOVED"})
    def test_identical_graph_no_delta(self):
        obj=graph([("lib/runner.ts","same")])
        self.assertEqual(m.evaluate_graphs(obj,obj)["changed_files_in_static_graph_union"],0)
    def test_unresolved_dependency_fails_closed(self):
        x=graph([])
        x["unresolved_relative_imports"]=[{"from":"a","import":"b"}]
        with self.assertRaisesRegex(ValueError,"unresolved"):
            m.evaluate_graphs(x,graph([]))
    def test_categories_do_not_certify_economic_effect(self):
        x=m.evaluate_graphs(graph([]),graph([("lib/my-signal.ts","1")]))
        self.assertEqual(x["changed"][0]["review_categories"],["signal_entry"])
        self.assertFalse(x["changed"][0]["economic_effect_proven"])
    def test_duplicate_source_rejected(self):
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            m.evaluate_graphs(graph([("a","1"),("a","1")]),graph([]))
if __name__=="__main__":
    unittest.main()
