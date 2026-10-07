"""Synthetic causal/gap regression tests for the research-only V12 exit adapter."""
import unittest,copy,tempfile
from pathlib import Path
import run_wr60_new_model as w
class ExitAdapterTests(unittest.TestCase):
 def setUp(self):
  self.c={'symbol':'TEST','entry_price':100.,'atr':1.,'side':'LONG','entry_ts_ms':0,'maxHoldHours':2}
  self.b={0:{'open':100.,'high':101.,'low':99.,'close':100.},w.H:{'open':100.,'high':101.,'low':99.,'close':99.},2*w.H:{'open':98.,'high':99.,'low':97.,'close':98.}}
 def test_crossed_replacement_uses_quote_not_stop(self):
  t=w.simulate_v12(self.c,self.b,{})
  self.assertEqual(t['exit_price'],98.);self.assertEqual(t['reason'],'TRAILING_CROSSED_BEFORE_REPLACEMENT')
 def test_unreached_activation_does_not_trail(self):
  self.assertEqual(w.simulate_v12(self.c,self.b,{'arm':2,'trail':1})['reason'],'TIME_EXIT')
 def test_gap_through_hard_stop_uses_worse_open(self):
  self.b[0]={'open':96.,'high':100.,'low':95.,'close':99.}
  self.assertEqual(w.simulate_v12(self.c,self.b,{})['exit_price'],96.)
 def test_both_stop_and_tp_touch_stop_first(self):
  self.b[0]={'open':100.,'high':105.,'low':97.,'close':100.}
  t=w.simulate_v12(self.c,self.b,{})
  self.assertEqual(t['reason'],'STOP');self.assertEqual(t['exit_price'],97.523)
 def test_entry_filter_uses_route_not_outcome(self):
  original=w.OUT
  with tempfile.TemporaryDirectory() as d:
   w.OUT=Path(d)
   try:
    rows=[{'strategy_id':'Q102','family':'MR'},{'strategy_id':'V12','symbol':'TEST','side':'LONG','entry_ts_ms':0},{'strategy_id':'PENGU'}]
    self.assertEqual(w.filter_candidates(rows,'Q_MR_OFF'),rows[1:])
   finally:w.OUT=original
 def test_closed_price_never_uses_entry_bar_close(self):
  original=w.bars
  w.bars={'TEST':{0:{'close':100.},w.H:{'close':999.}}}
  try:self.assertEqual(w.closed_price('TEST',w.H),100.)
  finally:w.bars=original
 def test_tighter_stop_is_applied_without_resizing(self):
  self.b[0]={'open':100.,'high':100.5,'low':99.2,'close':100.}
  self.assertEqual(w.simulate_v12(self.c,self.b,{'stop':.75})['exit_price'],99.25)
 def test_stop_has_half_percent_floor(self):
  self.c['atr']=.1;self.b[0]={'open':100.,'high':100.02,'low':99.4,'close':99.8}
  self.assertEqual(w.simulate_v12(self.c,self.b,{'stop':.75})['exit_price'],99.5)
 def test_short_gap_is_adverse(self):
  self.c['side']='SHORT';self.b[0]={'open':104.,'high':105.,'low':100.,'close':104.}
  self.assertEqual(w.simulate_v12(self.c,self.b,{})['exit_price'],104.)
if __name__=='__main__':unittest.main()
