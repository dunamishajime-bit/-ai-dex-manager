"""Synthetic coverage checks; absence of eighth named strategy fails closed."""
import copy,csv,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_family_scope_audit import assess,read_entries

SHA="a"*40
FAMILIES=["V4","Q102","PENGU","V52","HYPE","FET","IDLE"]
def case(labels):
    return {"entries":{s:1 for s in labels},
       "pins":{s:[SHA] for s in labels},"routeCounts":{s:1 for s in labels},
       "total":len(labels)}
class FamilyCoverageTests(unittest.TestCase):
    def test_seven_named_families_does_not_certify_eight(self):
        a=assess(case(FAMILIES),case(FAMILIES),8)
        self.assertEqual(a["status"],"NAMED_STRATEGY_SCOPE_NOT_PROVEN")
        self.assertEqual(a["distinctModeledLogicLabels"],7)
        self.assertFalse(a["liveEconomicParityCertified"])
    def test_eight_labels_still_not_economic_parity(self):
        labels=FAMILIES+["EIGHTH_HYPOTHETICAL"]
        a=assess(case(labels),case(labels),8)
        self.assertEqual(a["status"],"NAMED_LABEL_COUNT_MATCH_ONLY_ECONOMIC_PARITY_UNVERIFIED")
        self.assertTrue(a["requiresOperatorVsIndependentStrategyManifest"])
        self.assertFalse(a["liveEconomicParityCertified"])
    def test_cost_case_distinct_label_set_rejected(self):
        with self.assertRaisesRegex(ValueError,"COST_CASE_FAMILY_SET_DRIFT"):
            assess(case(FAMILIES),case(FAMILIES[:-1]+["OTHER"]),8)
    def test_pin_drift_rejected(self):
        b=case(FAMILIES);b["pins"]["V4"]=["b"*40]
        with self.assertRaisesRegex(ValueError,"COST_CASE_FAMILY_PIN_DRIFT"):
            assess(case(FAMILIES),b,8)
    def test_empty_scope_rejected(self):
        with self.assertRaisesRegex(ValueError,"EXPECTED_SCOPE_INVALID"):
            assess(case(FAMILIES),case(FAMILIES),0)
    def test_duplicate_model_admission_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            f=Path(temp)/"x.csv"
            rows=[{"logic":"HYPE","trade_id":"one","utc":"2026-02-21T12:00:00Z",
                   "route":"HYPE_LONG","symbol":"HYPEUSDT","source_runtime_sha":SHA}]*2
            with f.open("w",encoding="utf8",newline="") as h:
                w=csv.DictWriter(h,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
            with self.assertRaisesRegex(ValueError,"DUPLICATE"):read_entries(f)
    def test_truncated_sha_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            f=Path(temp)/"x.csv"
            rows=[{"logic":"HYPE","trade_id":"one","utc":"2026-02-21T12:00:00Z",
                   "route":"HYPE_LONG","symbol":"HYPEUSDT","source_runtime_sha":"a"*8}]
            with f.open("w",encoding="utf8",newline="") as h:
                w=csv.DictWriter(h,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
            with self.assertRaisesRegex(ValueError,"SOURCE_SHA_NOT_FULL_PIN"):read_entries(f)
if __name__=="__main__":unittest.main()
