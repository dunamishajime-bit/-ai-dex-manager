import unittest
import v12_composite_logic as m
H=3600000
class ExitTests(unittest.TestCase):
 def setUp(self):
  self.c=dict(symbol='TEST',side='LONG',entry_ts_ms=0,entry_price=100.,atr=1.,route='BREAKOUT',maxHoldHours=8)
  self.bs={t*H:dict(open=100.,high=100.2,low=99.8,close=100.) for t in range(10)}
 def test_stop_first_when_both_levels_reached(self):
  self.bs[0].update(low=98.,high=104.)
  x=m.exit_trade(self.c,self.bs);self.assertEqual(x['reason'],'COMPOSITE_STOP');self.assertAlmostEqual(x['exit_price'],98.8)
 def test_gap_fills_at_worse_open(self):
  self.bs[0].update(open=97.5,low=97.,high=98.)
  x=m.exit_trade(self.c,self.bs);self.assertEqual(x['exit_price'],97.5)
 def test_crossed_armed_floor_uses_fresh_quote(self):
  self.bs[0].update(high=102.,close=101.);self.bs[H].update(open=101.,high=102.,low=100.8,close=101.)
  self.bs[2*H]['open']=100.5
  x=m.exit_trade(self.c,self.bs);self.assertEqual(x['reason'],'COMPOSITE_TRAIL_CROSSED_QUOTE');self.assertEqual(x['exit_price'],100.5);self.assertEqual(x['exit_ts_ms'],2*H)
 def test_trail_not_armed_by_small_profit(self):
  self.bs[0]['high']=101.4
  x=m.exit_trade(self.c,self.bs,no_momentum=True);self.assertEqual(x['reason'],'COMPOSITE_TIME')
 def test_failure_exit_next_quote_after_elapsed_gate(self):
  self.bs[H].update(high=100.6,close=100.6);self.bs[5*H].update(low=99.5,close=99.6);self.bs[6*H]['open']=99.5
  x=m.exit_trade(self.c,self.bs);self.assertEqual(x['reason'],'COMPOSITE_MOMENTUM_FAILURE');self.assertEqual(x['exit_price'],99.5);self.assertEqual(x['exit_ts_ms'],6*H)
 def test_crossed_profit_floor_may_exit_at_loss(self):
  self.bs[0].update(high=102.,close=101.);self.bs[H].update(open=101.,high=102.,low=100.8,close=101.)
  self.bs[2*H]['open']=99.8
  x=m.exit_trade(self.c,self.bs);self.assertEqual(x['exit_price'],99.8);self.assertLess(x['unit_gross_return'],0)
 def test_short_gap_fills_at_adverse_open(self):
  self.c['side']='SHORT';self.bs[0].update(open=102.,high=103.,low=101.)
  x=m.exit_trade(self.c,self.bs);self.assertEqual(x['exit_price'],102.)
if __name__=='__main__':unittest.main()
