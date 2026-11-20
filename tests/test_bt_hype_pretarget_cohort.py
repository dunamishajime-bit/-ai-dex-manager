import importlib.util
from pathlib import Path
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/research/audit_bt_hype_pretarget_cohort.py"
spec=importlib.util.spec_from_file_location("bt_hype_pretarget",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def fixture():
    return {"status":"RESEARCH_ONLY_HYPE_WSIG_FIXED_ENTRY_M5_EXIT_PRETARGET_SELECTION",
            "selectionUsesTarget":False, "entryCounts":{"TARGET":1},
            "topPretargetDiagnostics":[{"params":m.EXPECTED_PARAMS,
             "targetRows":[{"entryTs":1761998400000}]}]}
class CohortTests(unittest.TestCase):
    def test_cohort_is_study_only(self):
        source=fixture()
        self.assertEqual(len(m.source_dates(source)),1)
        self.assertFalse(source["selectionUsesTarget"])
    def test_target_leakage_flag_rejected(self):
        source=fixture()
        source["selectionUsesTarget"]=True
        with self.assertRaisesRegex(ValueError,"LEAKAGE"):
            m.source_dates(source)
    def test_duplicates_are_rejected(self):
        source=fixture()
        source["topPretargetDiagnostics"][0]["targetRows"].append(source["topPretargetDiagnostics"][0]["targetRows"][0])
        source["entryCounts"]["TARGET"]=2
        with self.assertRaisesRegex(ValueError,"DUPLICATE"):
            m.source_dates(source)
    def test_source_candidate_equals_portfolio_decisions(self):
        target=["a","b"]
        rows=[{"utc":"a","decision":"BLOCK"},{"utc":"b","decision":"MODEL_ENTER"}]
        result=m.compare(target,rows,["a","b","c"])
        self.assertEqual(result["missing_candidate_timestamps"],["c"])
        self.assertFalse(result["research_cohort_selection_exclusion_reason_verified"])
    def test_missing_portfolio_decision_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"DO_NOT_EQUAL"):
            m.compare(["a","b"],[{"utc":"a","decision":"BLOCK"}],["a","b"])
    def test_extra_decision_fails_closed(self):
        with self.assertRaisesRegex(ValueError,"DO_NOT_EQUAL"):
            m.compare(["a"],[{"utc":"a","decision":"BLOCK"},{"utc":"b","decision":"BLOCK"}],["a","b"])

if __name__=="__main__":
    unittest.main()
