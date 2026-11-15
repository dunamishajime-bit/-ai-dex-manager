"""PENGU Short V20 never flips direction and never selects gates using target."""
import copy,csv,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_pengu_v20_time_split_audit import (
    check_pretarget,audit_fills,build,
)
def sources():
    seg=lambda n,mean:{"n":n,"mean":mean,"sum":n*mean,"wr":.5,"pf":1.2}
    train=seg(50,.01);valid=seg(9,-.001);hold=seg(13,-.04);fwd=seg(6,-.008)
    pre={"status":"CAUSAL_PRETARGET_PROXY_TRAIN_VALID_PREHOLD_PLUS_TRUE_FORWARD_FALSIFICATION",
         "route":"SHORT_V20","counts":{"pre":72,"train":50,"valid":9,"prehold":13,
                        "forwardMatched":6},
         "baseline30":{"train":train,"valid":valid,"prehold":hold,"forward":fwd},
         "candidateRuleN":121,"robustN":0,"robust":[],
         "method":"Train only. Target year is never read."}
    red={"status":"RESEARCH_ONLY_SHORT_FIXED_MARKET_REGIME_REDESIGN_V1",
         "policy":{"direction":"SHORT_FIXED","use_market_regime":"ENTRY_ALLOW_BLOCK_ONLY",
                   "target_not_used_for_selection":True},
         "counts":{"pre":72,"target":40},
         "baseline30":{"train":train,"valid":valid,"prehold":hold},
         "selectedPretargetTop":[]}
    decisions=[{"entryTs":i*1000,"allow":False,"rawReturn":.01 if i%2 else -.02}
               for i in range(6)]
    rank={"status":"TRUE_FORWARD_FALSIFICATION_OF_PRETARGET_FROZEN_V20_SHADOW_HEALTH_RANK1",
          "selectionUsesTarget":False,"selectionUsesForward":False,
          "forwardModeledN":6,"decisions":decisions,"params":{"k":12},
          "forward30":{"n":0,"blocked":6},
          "forward10":{"n":0,"blocked":6},
          "forwardBaseline30":{"n":6,"sum":fwd["sum"]}}
    return pre,red,rank
def case(cost):
    return {"bps":cost,"rows":[{"entryUtc":"2025-10-15T16:00:00Z"}]}
def write_fills(p,side):
    row={"trade_id":"P1","strategy":"PENGU","symbol":"PENGUUSDT",
      "side":side,"route":"SHORT_V20",
      "entry_utc":"2025-10-15T16:00:00Z",
      "exit_utc":"2025-10-15T20:00:00Z",
      "net_pnl_jpy":-100,"actual_venue_order_id":"",
      "actual_filled_quantity":"","signed_execution_verified":"False",
      "model_entry_price":100,"model_exit_price":102,"exit_model_reason":"TIME"}
    fields=list(row)
    with p.open("w",encoding="utf8",newline="") as f:
      writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerow(row)
class PenguV20TimeSplitTests(unittest.TestCase):
 def test_pretarget_splits_and_rank1_zero_trades(self):
    x=check_pretarget(*sources())
    self.assertEqual(x["rank1TrueForwardAllBlocked"],6)
    self.assertEqual(x["robustPreTargetFilters"],0)
 def test_target_cannot_be_selection_input(self):
    x=list(sources());x[1]["policy"]["target_not_used_for_selection"]=False
    with self.assertRaisesRegex(ValueError,"SELECTION_POLICY_DRIFT"):
      check_pretarget(*x)
 def test_leaked_forward_selection_rejected(self):
    x=list(sources());x[2]["selectionUsesForward"]=True
    with self.assertRaisesRegex(ValueError,"DATA_SELECTION_CONTAMINATION"):
      check_pretarget(*x)
 def test_future_filter_falsified_no_success_from_zero_trades(self):
    x=list(sources());x[2]["forward30"]["n"]=1
    with self.assertRaisesRegex(ValueError,"FORWARD_BLOCK_COVERAGE_DRIFT"):
      check_pretarget(*x)
 def test_split_sum_fraud_fails(self):
    x=list(sources());x[0]["baseline30"]["train"]["sum"]+=1
    with self.assertRaisesRegex(ValueError,"METRIC_SUM_INCONSISTENT"):
      check_pretarget(*x)
 def test_short_fixed_direction_invalid_long(self):
    with tempfile.TemporaryDirectory() as d:
      p=Path(d)/"fills.csv";write_fills(p,"LONG")
      with self.assertRaisesRegex(ValueError,"DIRECTION_FIXED_INVARIANT"):
        audit_fills(p,10)
 def test_live_venue_order_claim_rejected(self):
    with tempfile.TemporaryDirectory() as d:
      p=Path(d)/"fills.csv";write_fills(p,"SHORT")
      t=p.read_text("utf8").replace(",False,",",True,")
      p.write_text(t,"utf8")
      with self.assertRaisesRegex(ValueError,"MODEL_CLAIMS_LIVE_FILL"):
        audit_fills(p,30)
 def test_cross_cost_entry_sets_must_match(self):
    one=case(10);two=case(30);two["rows"][0]["entryUtc"]="2025-11-01T12:00:00Z"
    with self.assertRaisesRegex(ValueError,"COST_MODEL_V20_COHORT_DRIFT"):
      build(*sources(),one,two)
 def test_allows_research_only_without_promoting_gate(self):
    result=build(*sources(),case(10),case(30))
    self.assertFalse(result["applyRank1ToProduction"])
    self.assertFalse(result["targetYearUsedForGateThresholdSelection"])
    self.assertEqual(result["tradingOrRiskConfigurationChanges"],0)
if __name__=="__main__":unittest.main()
