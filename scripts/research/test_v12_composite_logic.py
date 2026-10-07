import unittest
import v12_composite_logic as m
def feature():
 return dict(trend=1,btc_trend=1,btc_ret6=.01,btc_er24=.5,ret12=.02,ret90=.04,rel24=.01,er24=.6,volume_ratio=1.2,previous_volume_ratio=1.4,distance=1.,previous_distance=1.,previous_rsi=55,close=103.,previous_high=102.,previous_low=100.,previous_close=101.,previous_ema12=100.,previous_ema48=98.,previous_touch=100.,breakout_high=102.,breakout_low=97.,atr=1.)
class RouterTests(unittest.TestCase):
 def test_breakout_requires_all_context_structure(self):
  self.assertIn('BREAKOUT',[r['route'] for r in m.classify(feature())])
 def test_wrong_btc_blocks_trend(self):
  f=feature();f['btc_trend']=-1
  self.assertNotIn('BREAKOUT',[r['route'] for r in m.classify(f)])
 def test_overextended_blocks_chase(self):
  f=feature();f['distance']=2.1
  self.assertNotIn('BREAKOUT',[r['route'] for r in m.classify(f)])
 def test_pullback_needs_touch_and_rebreak(self):
  f=feature();f.update(previous_close=100.4,previous_high=101.,previous_touch=100.1,close=101.2)
  self.assertIn('PULLBACK',[r['route'] for r in m.classify(f)])
 def test_reversal_needs_climax_and_opposite_break(self):
  f=feature();f.update(previous_distance=2.,previous_rsi=70.,close=99.8,btc_ret6=-.01)
  self.assertIn('REVERSAL',[r['route'] for r in m.classify(f)])
 def test_reversal_no_break_no_signal(self):
  f=feature();f.update(previous_distance=2.,previous_rsi=70.,close=100.5,btc_ret6=-.01)
  self.assertNotIn('REVERSAL',[r['route'] for r in m.classify(f)])
 def test_nonfinite_feature_rejected(self):
  f=feature();f['atr']=float('nan');self.assertEqual(m.classify(f),[])
if __name__=='__main__':unittest.main()
