"""Synthetic DD window diagnostics: realized trade losses != MTM attribution."""
import csv,json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_native_hype_dd_window_attribution import analyze,directional_adverse

T0="2026-01-01T00:00:00Z"
T1="2026-01-02T00:00:00Z"
def write_rows(path,fields,rows):
 with path.open("w",encoding="utf8",newline="") as f:
  w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
def fixture(root:Path):
 (root/"x_10BPS_SUMMARY.json").write_text(
    json.dumps({"cost_bps_roundtrip":10,"max_hourly_dd_pct":-10.,
        "dd_time_utc":T1}),"utf8")
 write_rows(root/"x_10BPS_EQUITY_30MIN.csv",
            ["utc","compounded_mtm_equity_jpy"],
            [{"utc":T0,"compounded_mtm_equity_jpy":10000},
             {"utc":T1,"compounded_mtm_equity_jpy":9000}])
 write_rows(root/"x_10BPS_FILLS.csv",
            ["trade_id","strategy","symbol","exit_utc","net_pnl_jpy",
             "side","model_entry_price","model_exit_price"],
            [{"trade_id":"v4","strategy":"V4","symbol":"BTCUSDT","exit_utc":T1,
              "net_pnl_jpy":-200,"side":"SHORT","model_entry_price":100,
              "model_exit_price":120},
             {"trade_id":"q","strategy":"Q102","symbol":"AVAXUSDT","exit_utc":T1,
              "net_pnl_jpy":100,"side":"LONG","model_entry_price":100,
              "model_exit_price":110}])
 write_rows(root/"x_10BPS_POSITION_GROSS_SNAPSHOTS.csv",
            ["utc","trade_id","logic","current_gross_x"],
            [{"utc":T0,"trade_id":"id1","logic":"V4","current_gross_x":0.7},
             {"utc":T1,"trade_id":"id2","logic":"Q102","current_gross_x":0.5}])
class DrawdownWindowTests(unittest.TestCase):
 def test_side_direction(self):
  self.assertTrue(directional_adverse("LONG",100,99))
  self.assertTrue(directional_adverse("SHORT",100,101))
  self.assertFalse(directional_adverse("LONG",100,101))
  self.assertFalse(directional_adverse("SHORT",100,99))
 def test_unknown_side_invalid(self):
  with self.assertRaisesRegex(ValueError,"BAD_MODEL_PRICE_OR_DIRECTION"):
   directional_adverse("BOTH",100,99)
 def test_source_equity_dd_and_closed_trade_separated(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);fixture(root)
   result=analyze(root,10)
   self.assertEqual(result["peakEquityJpy"],10000)
   self.assertAlmostEqual(result["maxDdPct"],-10,places=9)
   self.assertEqual(result["closedTradeAttributionByLogic"]["V4"]["negativeNet"],1)
   self.assertEqual(result["closedTradeAttributionByLogic"]["V4"]["adversePriceMoves"],1)
   self.assertEqual(result["closedTradeAttributionByLogic"]["Q102"]["adversePriceMoves"],0)
   self.assertEqual(result["positionGrossAtTrough"]["grossX"],0.5)
 def test_fake_summary_dd_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);fixture(root)
   p=root/"x_10BPS_SUMMARY.json"
   d=json.loads(p.read_text());d["max_hourly_dd_pct"]=-20
   p.write_text(json.dumps(d))
   with self.assertRaisesRegex(ValueError,"DRAWDOWN_PEAK_TROUGH_SOURCE_MISMATCH"):
    analyze(root,10)
 def test_duplicate_fill_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);fixture(root)
   p=root/"x_10BPS_FILLS.csv"
   with p.open("a",encoding="utf8") as f:
    f.write("v4,V4,BTCUSDT,"+T1+",-200,SHORT,100,120\n")
   with self.assertRaisesRegex(ValueError,"DUPLICATE_MODEL_FILL_ID"):
    analyze(root,10)
if __name__=="__main__":unittest.main()
