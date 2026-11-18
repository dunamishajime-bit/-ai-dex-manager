"""V4 Y06 archive/source cross-period robustness, no leakage or V4 live changes."""
import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_v4_y06_crossperiod_evidence_audit import (
    check_grid,check_online,build,SPLITS,
)
def grid(status,n):
    records=[]
    for i in range(n):
      x={"hours":48+6*i} if "HORIZON" in status else {"trigger":.03+i*.01,"floor":.01}
      for key,number in SPLITS.items():
       base={"n":number,"sum":number*.01,"mean":.01,"wr":.5}
       test={"n":number,"sum":number*.02,"mean":.02,"wr":.55}
       x[key]={"native":copy.deepcopy(base),"candidate":copy.deepcopy(test),
         "deltaSum":number*.01}
       x["trainQualified"]=False;x["robust"]=False
      records.append(x)
    return {"status":status,"route":"REC_Y06_REV_D0_T72",
        "counts":SPLITS.copy(),"robustN":0,"selected":None,
        "method":"Native stop preserved; target-year not read.",
        "grid":records}
def online():
    return {"status":"RESEARCH_ONLY","policies_count":65,
            "positive_train_validation":0,"top_trainval":[],
            "all_policies":[{} for _ in range(65)],
            "method":"closed trade exitTs<=current entryTs"}
def case(bps,n,offset):
    return {"bps":bps,"modeledClosed":n,
      "closedModelEntries":[{"sourceSignalId":str(i)} for i in range(offset,offset+n)]}
class Y06CrossPeriodTests(unittest.TestCase):
 def test_all_horizon_hours_not_promoted(self):
    x=check_grid(grid("V4_Y06_HORIZON_PRETARGET_FORWARD",4),
        "V4_Y06_HORIZON_PRETARGET_FORWARD",4)
    self.assertEqual(x["adoptedCandidates"],0)
 def test_profit_lock_no_candidate_promoted(self):
    x=check_grid(grid("V4_Y06_PROFIT_LOCK_PRETARGET_FORWARD",10),
        "V4_Y06_PROFIT_LOCK_PRETARGET_FORWARD",10)
    self.assertEqual(x["gridSize"],10)
 def test_bad_archive_delta_refused(self):
    x=grid("V4_Y06_HORIZON_PRETARGET_FORWARD",4)
    x["grid"][0]["validation"]["deltaSum"]+=1
    with self.assertRaisesRegex(ValueError,"DELTA_ARITHMETIC_DRIFT"):
      check_grid(x,"V4_Y06_HORIZON_PRETARGET_FORWARD",4)
 def test_target_year_contaminated_method_refused(self):
    x=grid("V4_Y06_HORIZON_PRETARGET_FORWARD",4)
    x["method"]="fit target outcomes"
    with self.assertRaisesRegex(ValueError,"SAFEGUARD_UNKNOWN"):
      check_grid(x,"V4_Y06_HORIZON_PRETARGET_FORWARD",4)
 def test_online_65_candidates_without_train_valid_success(self):
    x=check_online(online())
    self.assertEqual(x["passedTrainAndValidation"],0)
 def test_one_positive_online_threshold_is_not_accepted(self):
    x=online();x["positive_train_validation"]=1
    with self.assertRaisesRegex(ValueError,"NOT_PRETARGET_ROBUST"):
      check_online(x)
 def test_source_cost_cases_can_have_non_subset_and_track_overlap(self):
    a=case(10,119,0);b=case(30,113,7)
    x=build(grid("V4_Y06_HORIZON_PRETARGET_FORWARD",4),
          grid("V4_Y06_PROFIT_LOCK_PRETARGET_FORWARD",10),
          online(),a,b)
    self.assertEqual(x["costCaseAdmittedSignalOverlap"],
        {"both":112,"only10bps":7,"only30bps":1})
    self.assertFalse(x["liveRuntimeEconomicParityCertified"])
    self.assertFalse(x["targetYearUsedToSelectExitThreshold"])
 def test_wrong_cost_case_n_rejected(self):
    a=case(10,119,0);b=case(30,119,0)
    with self.assertRaisesRegex(ValueError,"COST_CASE_COHORT_DRIFT"):
      build(grid("V4_Y06_HORIZON_PRETARGET_FORWARD",4),
        grid("V4_Y06_PROFIT_LOCK_PRETARGET_FORWARD",10),
        online(),a,b)
if __name__=="__main__":unittest.main()
