"""Synthetic fail-closed checks for paired native-HYPE integrated source replay."""
import sys,copy,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_native_hype_integrated_compare import compare,FAMILIES

def model(*,native:bool)->dict:
    return {"entriesByLogic":{name:1 for name in FAMILIES},
        "hypeSelectedCount":6 if native else 5,
        "hypeSelected":{"modeledNetPnlJpy":-300 if native else 100},
        "summary":{"maxDdPct":-40 if native else -20,
                   "winRatePct":61 if native else 64,
                   "finalJpy":7000 if native else 10000},
        "blockedByReason":{"DAILY_LOSS_7P5_GATE":122 if native else 60}}
class ControlledNativeHypeDiffTests(unittest.TestCase):
 def test_diff_is_not_live_certification(self):
    a={"10":model(native=False),"30":model(native=False)}
    b={"10":model(native=True),"30":model(native=True)}
    x=compare(a,b,78)
    self.assertEqual(x["status"],"RESEARCH_SENSITIVITY_DD_WORSE_NOT_PRODUCTION_PARITY")
    self.assertEqual(x["models"]["10"]["delta"]["maxDdPctPoints"],-20)
    self.assertEqual(x["models"]["10"]["delta"]["sharedDailyLossGateBlocks"],62)
    self.assertFalse(x["allLiveLogicPinsEconomicParityCertified"])
    self.assertEqual(x["productionMutations"],0)
 def test_missing_cost_case_fails(self):
    with self.assertRaisesRegex(ValueError,"INCOMPLETE_COST_CASE_COMPARISON"):
        compare({"10":model(native=False)},{"10":model(native=True)},78)
 def test_native_count_not_really_78_fails(self):
    with self.assertRaisesRegex(ValueError,"NATIVE_HYPE_CANDIDATE_COUNT_INVALID"):
        compare({"10":model(native=False),"30":model(native=False)},
                {"10":model(native=True),"30":model(native=True)},77)
 def test_strategy_population_difference_fails(self):
    a={"10":model(native=False),"30":model(native=False)}
    b={"10":model(native=True),"30":model(native=True)}
    b["10"]["entriesByLogic"].pop("FET")
    with self.assertRaisesRegex(ValueError,"FAMILY_COVERAGE_DRIFT"):compare(a,b,78)
 def test_cannot_accept_more_hype_than_native_signals(self):
    a={"10":model(native=False),"30":model(native=False)}
    b={"10":model(native=True),"30":model(native=True)}
    b["10"]["hypeSelectedCount"]=90
    with self.assertRaisesRegex(ValueError,"HYPE_SELECTED_MORE_THAN_SIGNAL_POOL"):
        compare(a,b,78)

if __name__=="__main__":unittest.main()
