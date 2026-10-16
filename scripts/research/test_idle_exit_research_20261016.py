"""Offline causal tests for Idle BTC-rebound and synthetic partial liquidation research.
These tests never open Aster connections or mutate LIVE.
"""
import ast,unittest,pathlib
H=3_600_000
HERE=pathlib.Path(__file__).resolve().parent
FULL=HERE/"idle_btc_rebound_integrated_20261016.py"
PARTIAL=HERE/"idle_partial_synthetic_full8_20261016.py"
def build(path):
 source=ast.parse(path.read_text(encoding="utf8"))
 node=next(x for x in source.body if isinstance(x,ast.FunctionDef) and x.name=="causal_exit")
 book={}
 env={"H":H,"hbar":lambda symbol,t:book.get((symbol,t)),"atr14":lambda s,t:1}
 exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),str(path),"exec"),env)
 return env["causal_exit"],book
def candle(op,hi,lo,cl):return dict(open=op,high=hi,low=lo,close=cl)
def row(strategy="IDLE",symbol="DOTUSDT",side="SHORT",end=4):
 return dict(strategy_id=strategy,symbol=symbol,side=side,entry_price=100,
             exit_price=105,entry_ts_ms=0,exit_ts_ms=end*H,route="FAKE",family=None)
def obs():return dict(changed=0,byStrategy={},byReason={},h1gap=0,noATR=0)

class IdleResearchCausality(unittest.TestCase):
 def setUp(self):
  self.btc,self.book=build(FULL)
  self.partial,self.pbook=build(PARTIAL)
  for b in (self.book,self.pbook):
   b[("DOTUSDT",0)]=candle(100,101,97,98)
   b[("DOTUSDT",H)]=candle(98,102,98,99)
   b[("DOTUSDT",2*H)]=candle(101,102,99,100)
   b[("DOTUSDT",3*H)]=candle(100,102,99,101)
   b[("BTCUSDT",-3*H)]=candle(100,101,99,100)
   b[("BTCUSDT",-2*H)]=candle(100,101,99,100)
   b[("BTCUSDT",0)]=candle(100,101,99,100)
   b[("BTCUSDT",H)]=candle(100,102,99,101)

 def test_btc_exit_waits_until_next_h1_open(self):
  x=self.btc(row(),"idle_btc3",obs())
  self.assertEqual(x["exit_ts_ms"],2*H)
  self.assertAlmostEqual(x["exit_price"],101)
  self.assertEqual(x["exit_reason"],"IDLE_BTC3_PROFIT_REVERSAL_SHADOW")

 def test_btc_extra_slip_buy_to_close_is_adverse(self):
  x=self.btc(row(),"idle_btc3_slip50",obs())
  self.assertAlmostEqual(x["exit_price"],101*1.005)

 def test_btc_no_peak_is_unchanged(self):
  for t in (0,H):
   self.book[("DOTUSDT",t)]=candle(100,101,99,100)
  x=row()
  self.assertEqual(self.btc(x,"idle_btc3",obs()),x)

 def test_btc_excludes_jup_tao_pengu_q102(self):
  for symbol,strategy in (("JUPUSDT","IDLE"),("TAOUSDT","IDLE"),("DOTUSDT","PENGU"),("DOTUSDT","Q102")):
   x=row(strategy,symbol)
   self.assertIs(self.btc(x,"idle_btc3",obs()),x)

 def test_btc_missing_prior_btc_data_fail_closed(self):
  del self.book[("BTCUSDT",-3*H)]
  x=row();o=obs()
  self.assertEqual(self.btc(x,"idle_btc3",o),x)
  self.assertGreaterEqual(o["h1gap"],1)

 def test_btc_cannot_exit_after_original_exit(self):
  x=row(end=H//H)
  self.assertEqual(self.btc(x,"idle_btc3",obs()),x)

 def test_partial_blends_half_not_full(self):
  x=self.partial(row(),"idle_partial1p5_half",obs())
  self.assertAlmostEqual(x["exit_price"],.5*98+.5*105)
  self.assertEqual(x["exit_ts_ms"],4*H)
  self.assertTrue(x["exit_reason"].startswith("IDLE_SYNTHETIC_"))

 def test_partial_no_free_slots_or_early_exit_time(self):
  x=self.partial(row(),"idle_partial1p5_half",obs())
  self.assertEqual(x["exit_ts_ms"],row()["exit_ts_ms"])

 def test_partial_no_trigger_without_completed_close(self):
  self.pbook[("DOTUSDT",0)]=candle(100,105,98,99.9)
  self.pbook[("DOTUSDT",H)]=candle(100,105,98,99.9)
  self.pbook[("DOTUSDT",2*H)]=candle(100,105,98,99.9)
  self.pbook[("DOTUSDT",3*H)]=candle(100,105,98,99.9)
  x=row()
  self.assertEqual(self.partial(x,"idle_partial1p5_half",obs()),x)

 def test_partial_excludes_tao_and_pengu(self):
  for strategy,symbol in (("IDLE","TAOUSDT"),("PENGU","DOTUSDT"),("V12","DOTUSDT"),("Q102","DOTUSDT")):
   x=row(strategy,symbol)
   self.assertIs(self.partial(x,"idle_partial1p5_half",obs()),x)

 def test_partial_slippage_worsens_short_half(self):
  base=self.partial(row(),"idle_partial1p5_half",obs())
  slip=self.partial(row(),"idle_partial1p5_slip50",obs())
  self.assertAlmostEqual(slip["exit_price"]-base["exit_price"],.5*98*.005)

if __name__=="__main__":unittest.main(verbosity=2)
