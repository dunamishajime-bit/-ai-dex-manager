import unittest
import v12_entry_state_logic as m
H=3600000
def frame(t=0):
 return dict(now=t,open=100.,high=102.,low=99.9,close=101.8,prev_close=100.,prev_high=100.5,prev_low=99.5,atr=1.,level_high=101.,level_low=98.,volume_ratio=1.4,clv_long=.9,clv_short=.1,compression=.7,previous_er=.2,btc6=.01,rel6=.01,ret6=.018,cross=1,body_atr=1.8)
class Tests(unittest.TestCase):
 def test_new_breakout_arms_but_cannot_retest_same_bar(self):
  out,state=m.step(None,frame())
  self.assertIn('COMPRESSION',[c['route'] for c in out]);self.assertNotIn('RETEST',[c['route'] for c in out]);self.assertEqual(state['armed_at'],0)
 def test_retest_uses_later_closed_bar(self):
  _,st=m.step(None,frame());self.assertIsNotNone(st);f=frame(2*H);f.update(high=102.,low=101.1,close=101.7,prev_close=101.5,cross=0,level_high=102.5,clv_long=.7)
  out,_=m.step(st,f);self.assertIn('RETEST',[c['route'] for c in out])
 def test_expired_setup_cannot_fire(self):
  _,st=m.step(None,frame());self.assertIsNotNone(st);f=frame(10*H);f.update(high=102.,low=101.1,close=101.7,prev_close=101.5,cross=0,level_high=102.5)
  out,_=m.step(st,f);self.assertNotIn('RETEST',[c['route'] for c in out])
 def test_failed_break_flips_only_after_confirmation(self):
  _,st=m.step(None,frame());self.assertIsNotNone(st);f=frame(2*H);f.update(high=101.2,low=99.,close=100.,prev_low=100.5,btc6=-.01,clv_short=.8,cross=0,level_high=103.,level_low=98.)
  out,_=m.step(st,f);r=next(c for c in out if c['route']=='FAILED_BREAK');self.assertEqual(r['sg'],-1)
 def test_btc_adverse_blocks_turn(self):
  f=frame();f['btc6']=-.02
  out,_=m.step(None,f);self.assertNotIn('FIRST_TURN',[c['route'] for c in out])
 def test_missing_or_nonfinite_frame_no_signal(self):
  f=frame();f['atr']=float('nan')
  out,_=m.step(None,f);self.assertEqual(out,[])
if __name__=='__main__':unittest.main()
