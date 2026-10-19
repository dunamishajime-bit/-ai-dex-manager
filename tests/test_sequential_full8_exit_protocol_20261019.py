import json,unittest,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))
import long_short_sequential_full8_bt_20261019 as S

class Fixture:
 def __init__(self,bars):self.bars=bars
 def getdata(self,sym):return self.bars,[x[0] for x in self.bars]

class StagewiseTwoAxisInvariants(unittest.TestCase):
 def setUp(self):
  self.prev=S.R
  self.prev_obs=S.EXT_OBS
  S.EXT_OBS={x["id"]:{"preempted":0,"by_outcome":{"original_win":0,"original_loss":0}} for x in [S.ARM1,S.EARLY1]}
  self.t=1_800_000_000_000
  self.base={
    "symbol":"DOGEUSDT","strategy_id":"V12","side":"SHORT",
    "entry_price":100.,"entry_ts_ms":self.t,
    "exit_ts_ms":self.t+4*300_000,"exit_price":98.,
    "accepted_gross":1.,"unit_price_return":.02}
 def tearDown(self):
  S.R=self.prev
  S.EXT_OBS=self.prev_obs
 def test_profit_floor_armed_only_after_first_completed_candle(self):
  # First candle reached +2% favorable on close while high crossed STOP:
  # cannot use its high to fill stop that did not yet exist.
  bars=[
   (self.t,100.,102.,97.,97.9,100.),
   (self.t+300_000,97.9,100.,97.,99.,100.),
   (self.t+600_000,99.,100.,97.,98.,100.),
   (self.t+900_000,98.,99.,97.,98.,100.)
  ];S.R=Fixture(bars)
  d=S.projected_exit(self.base,S.ARM1)
  self.assertEqual(d["exit_ts_ms"],self.t+600_000)
  self.assertIn("V12_SHORT_PROFIT",d["exit_reason"])
 def test_earliest_original_exit_wins_over_new_stop_same_bar(self):
  bars=[(self.t,100.,103.,99.,101.,100.)]
  S.R=Fixture(bars)
  tr={**self.base,"exit_ts_ms":self.t+300_000}
  self.assertIs(S.projected_exit(tr,S.EARLY1),tr)
 def test_short_initial_stop_can_curb_loss(self):
  bars=[(self.t,100.,103.,99.,102.,100.),(self.t+300_000,102.,103.,98.,100.,100.),
        (self.t+600_000,100.,101.,98.,98.,100.),(self.t+900_000,98.,100.,96.,97.,100.)]
  S.R=Fixture(bars)
  x=S.projected_exit(self.base,S.EARLY1)
  self.assertNotEqual(x,self.base)
  self.assertEqual(x["exit_ts_ms"],self.t+300_000)
  self.assertLess(x["unit_price_return"],0)
 def test_gap_fails_without_lookahead(self):
  bars=[(self.t,100.,100.5,99.,100.,100.),(self.t+600_000,100.,104.,99.,103.,100.)]
  S.R=Fixture(bars)
  self.assertIs(S.projected_exit(self.base,S.EARLY1),self.base)
 def test_wrong_side_not_eligible(self):
  self.assertFalse(S.eligibility({**self.base,"side":"LONG"},S.ARM1))
  self.assertTrue(S.eligibility(self.base,S.ARM1))
 def test_latest_control_10_and_30_cost_archives_exist(self):
  for c in (10,30):
   path=S.REPORT/f"SEQUENTIAL_LATEST_20261017_BASELINE_{c}BPS.json"
   self.assertTrue(path.is_file())
   got=json.loads(path.read_text("utf8"))
   self.assertAlmostEqual(got["full8_final_jpy"],S.ORIG[c]["final_jpy"],places=3)
   self.assertAlmostEqual(got["full8_max_dd_pct"],S.ORIG[c]["max_dd_pct"],places=3)
 def test_V12_short_proposals_rejected_by_dd_cost_stress(self):
  file=S.REPORT/"SEQUENTIAL_FULL8_ACCEPTED_CHAIN_20261019.json"
  data=json.loads(file.read_text("utf8"))
  stage=data["stages"][0]
  self.assertEqual(stage["stage"],"S01")
  self.assertIsNone(stage["selected_research_candidate"])
  self.assertTrue(all(not p["accept_dd"] for p in stage["trials"]))
 def test_HYPE_initial_loss_floor_reduces_negative_with_flat_dd(self):
  file=S.REPORT/"SEQUENTIAL_SIDE_LOSS_METRICS_20261019.json"
  data=json.loads(file.read_text("utf8"))["values"]
  option=data["S02_HYPE_LONG_INITIAL_WALLET_1P5"]
  baseline=data["LATEST_20261017_BASELINE"]
  for c in (10,30):
   a=option[str(c)]["HYPE_LONG_LONG"]
   b=baseline[str(c)]["HYPE_LONG_LONG"]
   self.assertLess(a["losses"] if "losses" in a else 1_000,b["losses"]+1)
   self.assertGreater(a["sum_negative_wallet_contributions_pp"],b["sum_negative_wallet_contributions_pp"])
if __name__=="__main__":unittest.main(verbosity=2)
