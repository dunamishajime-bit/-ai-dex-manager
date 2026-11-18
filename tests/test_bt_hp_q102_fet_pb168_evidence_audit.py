"""Offline Q102 FET PB168 pretarget evidence and model data integrity tests."""
import copy,csv,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_q102_fet_pb168_evidence_audit import (
    ROUTE,build,replay_fills,validate_source,
)
def source():
    train={"n":4,"wr":.5,"mean":-.025,"sum":-.1,"pf":.6}
    valid={"n":2,"wr":1.,"mean":.01,"sum":.02,"pf":2.}
    hold={"n":2,"wr":1.,"mean":.02,"sum":.04,"pf":10.}
    return (
      {"status":"Q102_FET_ROUTE_PRETARGET_FREEZE_FORWARD_VETO_ONLY","costBps":30,
       "pretargetSplit":{"train":"2025-03-22..2025-06-30",
          "validation":"2025-07..08","prehold":"2025-09"},
       "audit":{ROUTE:{"splits30":{"train":train,"validation":valid,"prehold":hold},
          "full30":{"n":8,"sum":-.04},"freezePretargetOnly":False}},
       "frozenPretargetOnly":[],"forwardOneShot":{},
       "acceptedAfterForwardVeto":[],"rejectedByForward":[]},
      {"status":"Q102_FET_RET14_GATE_PRETARGET_INDEPENDENT_RECHECK",
       "decision":"DOWNGRADE_REJECT_AS_PRETARGET_CAUSAL",
       "selectionUsesTargetYear":False,"acceptedAsPretargetCausal":False,
       "metrics":{"allPretarget":{"native":{"pf":1.14},"gated":{"pf":1.13}}}}
    )
def model(bps):
    return {"bps":bps,"n":2,"wins":1,"losses":1,"netPnlJpy":0.,
       "modeledRows":[{"entryUtc":"2026-01-01T00:00:00Z"},{"entryUtc":"2026-02-01T00:00:00Z"}]}
def write_csv(path,rows):
    fields=["trade_id","strategy","route","symbol","side","entry_utc",
      "exit_utc","net_pnl_jpy","model_entry_price","model_exit_price",
      "signed_execution_verified","actual_venue_order_id","actual_filled_quantity",
      "exit_model_reason"]
    with path.open("w",encoding="utf8",newline="") as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
def row(id,t="2026-01-01T00:00:00Z"):
    return {"trade_id":id,"strategy":"Q102","route":ROUTE,"symbol":"FETUSDT",
     "side":"LONG","entry_utc":t,"exit_utc":"2026-01-02T00:00:00Z",
     "net_pnl_jpy":-500,"model_entry_price":1.,"model_exit_price":.9,
     "signed_execution_verified":"False","actual_venue_order_id":"",
     "actual_filled_quantity":"","exit_model_reason":"Q102_PROD_HARD_STOP"}
class FetPB168EvidenceTests(unittest.TestCase):
 def test_source_valid_no_freeze(self):
    x=validate_source(*source())
    self.assertFalse(x["pretargFreezeApplied"])
    self.assertFalse(x["ret14PretargGateAccepted"])
 def test_full_sample_mismatch_rejects(self):
    f,r=source();f["audit"][ROUTE]["full30"]["n"]=9
    with self.assertRaisesRegex(ValueError,"FULL_N_SUM_DRIFT"):validate_source(f,r)
 def test_validation_missing_rejects(self):
    f,r=source();f["audit"][ROUTE]["splits30"]["validation"]["n"]=0
    with self.assertRaisesRegex(ValueError,"SPLIT_INCOMPLETE"):validate_source(f,r)
 def test_metrics_sum_mismatch_rejects(self):
    f,r=source();f["audit"][ROUTE]["splits30"]["train"]["sum"]=-.3
    with self.assertRaisesRegex(ValueError,"SPLIT_PNL_IDENTITY"):validate_source(f,r)
 def test_target_policy_inappropriate_promotion_rejects(self):
    f,r=source();r["acceptedAsPretargetCausal"]=True
    with self.assertRaisesRegex(ValueError,"POLICY_SOURCE_CONFLICT"):validate_source(f,r)
 def test_freeze_route_fails_closed(self):
    f,r=source();f["frozenPretargetOnly"].append(ROUTE)
    with self.assertRaisesRegex(ValueError,"FREEZE_EXPECTATION"):validate_source(f,r)
 def test_mismatched_cost_cohorts_rejected(self):
    f,r=source();x=model(10);y=model(30)
    y["modeledRows"][0]["entryUtc"]="2026-03-01T00:00:00Z"
    with self.assertRaisesRegex(ValueError,"COHORT_INCONSISTENT"):build(f,r,x,y)
 def test_valid_cross_cost_audit_research_only(self):
    f,r=source();x=build(f,r,model(10),model(30))
    self.assertFalse(x["liveEconomicParityCertified"])
    self.assertFalse(x["targetYearUsedToSelectRouteOrThreshold"])
 def test_csv_one_model_fill(self):
    with tempfile.TemporaryDirectory() as tmp:
      p=Path(tmp)/"x.csv";write_csv(p,[row("f1")])
      result=replay_fills(p,10)
      self.assertEqual((result["wins"],result["losses"]),(0,1))
      self.assertEqual(result["hardStops"],1)
 def test_csv_duplicate_id_rejects(self):
    with tempfile.TemporaryDirectory() as tmp:
      p=Path(tmp)/"x.csv";write_csv(p,[row("f1"),row("f1")])
      with self.assertRaisesRegex(ValueError,"DUPLICATE"):replay_fills(p,10)
 def test_csv_fake_venue_fill_rejects(self):
    with tempfile.TemporaryDirectory() as tmp:
      p=Path(tmp)/"x.csv";r=row("f1");r["actual_venue_order_id"]="fake"
      write_csv(p,[r])
      with self.assertRaisesRegex(ValueError,"CLAIMS_ACTUAL_VENUE"):replay_fills(p,30)
if __name__=="__main__":unittest.main()
