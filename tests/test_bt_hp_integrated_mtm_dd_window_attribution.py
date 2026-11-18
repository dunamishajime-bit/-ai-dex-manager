"""Synthetic correctness checks for modeled MTM maximum DD and loss route tags."""
import csv,math,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_integrated_mtm_dd_window_attribution import (
    adverse,summarize_pnl,check_net_pnl_model,num,positions_at,window,
)
class DdWindowAttributionTests(unittest.TestCase):
 def test_short_worsening_price_classed_adverse(self):
    self.assertTrue(adverse("SHORT",100,105))
    self.assertFalse(adverse("SHORT",100,90))
 def test_long_falling_price_classed_adverse(self):
    self.assertTrue(adverse("LONG",100,90))
    self.assertFalse(adverse("LONG",100,110))
 def test_invalid_direction_price_rejected(self):
    for bad in (("SHORT",0,100),("HEDGE",10,9),("LONG",100,-1)):
      with self.subTest(bad=bad),self.assertRaisesRegex(ValueError,"MODEL_DIRECTION_OR_PRICE_INVALID"):
       adverse(*bad)
 def test_nonnumeric_or_nonfinite_model_pnl_rejected(self):
    for val in ("inf","nan","-inf"):
      with self.subTest(val=val),self.assertRaisesRegex(ValueError,"MODEL_FINITE_NUMBER_REQUIRED"):
       num(val)
 def test_closed_window_losses_counted_without_fabricated_trade(self):
    d=summarize_pnl([
      {"modelNetJpy":-10,"adverseDirection":True},
      {"modelNetJpy":20,"adverseDirection":False},
      {"modelNetJpy":-2,"adverseDirection":False},
    ])
    self.assertEqual((d["closedModeledFills"],d["wins"],d["losses"],d["adversePriceDirection"]),(3,1,2,1))
    self.assertEqual(d["modeledNetJpy"],8)
 def test_gross_fees_and_funding_reconcile_net(self):
    row={"net_pnl_jpy":97,"pnl_before_cost_jpy":120,
        "entry_fee_jpy":15,"exit_fee_jpy":10,"funding_model_jpy":2}
    self.assertEqual(check_net_pnl_model(row),97)
 def test_gross_fees_and_funding_drift_rejected(self):
    row={"net_pnl_jpy":100,"pnl_before_cost_jpy":120,
        "entry_fee_jpy":15,"exit_fee_jpy":10,"funding_model_jpy":2}
    with self.assertRaisesRegex(ValueError,"NET_PNL_IDENTITY_BROKEN"):
      check_net_pnl_model(row)
 def test_endpoint_unrealized_signed_long_and_short(self):
    with tempfile.TemporaryDirectory() as t:
      p=Path(t)/"positions.csv"
      row={"utc":"2026-08-05T07:00:00Z","trade_id":"t1","logic":"Q102","symbol":"DOGEUSDT",
          "side":"SHORT","current_notional_jpy":120,"entry_price":100,"mark_price":120,
          "account_equity_jpy":1000,"current_gross_x":.12}
      with p.open("w",encoding="utf8",newline="") as h:
       w=csv.DictWriter(h,fieldnames=list(row));w.writeheader();w.writerow(row)
       row["utc"]="2026-09-22T11:00:00Z";row["trade_id"]="t2"
       row["side"]="LONG";w.writerow(row)
      out=positions_at(p,"2026-08-05T07:00:00Z","2026-09-22T11:00:00Z")
      self.assertAlmostEqual(out["2026-08-05T07:00:00Z"][0]["modeledUnrealizedJpy"],-20)
      self.assertAlmostEqual(out["2026-09-22T11:00:00Z"][0]["modeledUnrealizedJpy"],20)
 def test_short_grid_cannot_pretend_to_be_one_year(self):
    with tempfile.TemporaryDirectory() as d:
      p=Path(d)/"eq.csv"
      with p.open("w",encoding="utf8",newline="") as h:
       w=csv.DictWriter(h,fieldnames=["utc","compounded_mtm_equity_jpy","wallet_cash_jpy"])
       w.writeheader()
       w.writerow({"utc":"2025-10-01T00:00:00Z","compounded_mtm_equity_jpy":10000,"wallet_cash_jpy":10000})
       w.writerow({"utc":"2026-10-01T00:00:00Z","compounded_mtm_equity_jpy":100,"wallet_cash_jpy":100})
      with self.assertRaisesRegex(ValueError,"WINDOW_INCOMPLETE"):
       window(p,{"max_hourly_dd_pct":-99,"dd_time_utc":"2026-10-01T00:00:00Z"})
if __name__=="__main__":unittest.main()
