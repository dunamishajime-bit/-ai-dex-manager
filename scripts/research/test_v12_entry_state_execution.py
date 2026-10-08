import unittest
import v12_entry_state_logic as m
H=m.H
class Execution(unittest.TestCase):
 def c(self,sg=1,t=0):
  return dict(entry_ts_ms=t,entry_price=100.,atr=1.,structural_stop=99. if sg==1 else 101.,side='LONG' if sg==1 else 'SHORT')
 def bar(self,o=100.,h=100.5,l=99.5,c=100.):return dict(open=o,high=h,low=l,close=c)
 def test_stop_first_ambiguous(self):
  x=m.exit_trade(self.c(),{0:self.bar(h=103,l=98)})
  self.assertEqual(x['exit_price'],99.)
 def test_adverse_gap_long(self):
  x=m.exit_trade(self.c(),{0:self.bar(o=98,h=100,l=97)})
  self.assertEqual(x['exit_price'],98.)
 def test_adverse_gap_short(self):
  x=m.exit_trade(self.c(-1),{0:self.bar(o=103,h=104,l=100)})
  self.assertEqual(x['exit_price'],103.)
 def test_floor_not_fictitious_fill(self):
  a={0:self.bar(),H:self.bar(h=101.5),2*H:self.bar(o=98,h=99,l=97)}
  x=m.exit_trade(self.c(),a)
  self.assertEqual(x['exit_price'],98.)
  self.assertEqual(x['reason'],'STATE_TRAIL_CROSSED_QUOTE')
  self.assertLess(x['unit_gross_return'],0)
 def test_no_preentry_peak(self):
  a={0:self.bar(h=150),H:self.bar(),2*H:self.bar(o=100.),3*H:self.bar()}
  x=m.exit_trade(self.c(t=H),a,hold_override=1)
  self.assertEqual(x['reason'],'STATE_TIME')
 def test_missing_bar_no_manufactured_exit(self):
  self.assertIsNone(m.exit_trade(self.c(),{}))
if __name__=='__main__':unittest.main()
