#!/usr/bin/env python3
"""Unit tests: -1% first touch, after 2h still -1%, MFE<.25%, no future leak."""
from pathlib import Path
import importlib.util,unittest
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('render_watch_rule',HERE/'screen-idle-next-m5-after-pengu-20261024.py')
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
RULE=m.CASES['TOUCH1_WATCH2_MFE0.25']
T=1758000000000
def event(h,gain,peak=.0):
 return {'ts':T+int(h*m.H),'gainClose':gain,'mfeAfter':peak,'fillPrice':100,'gainFillNext':gain}
class Watch(unittest.TestCase):
 def test_no_event_without_touch(self):
  self.assertIsNone(m.stop([event(0,-.7),event(3,-.5)],RULE,T))
 def test_touch_delay_2h(self):
  x=m.stop([event(0,-1.1),event(.5,-1.5),event(1.5,-1.4),event(2,-1.2)],RULE,T)
  self.assertEqual(x['ts'],T+2*m.H)
 def test_touch_recovered_at_2h(self):
  self.assertIsNone(m.stop([event(0,-1.3),event(1,-1.1),event(2,-.5)],RULE,T))
 def test_mfe_above_threshold_prevents_exit(self):
  self.assertIsNone(m.stop([event(0,-1.2),event(.5,-1.3,.251),event(2,-1.8,.251)],RULE,T))
 def test_no_lookahead_later_bar(self):
  v=[event(0,-1.2),event(1,-1.3),event(2,-1.1)]
  a=m.stop(v,RULE,T)
  b=m.stop(v+[event(3,6.0,6.0)],RULE,T)
  self.assertEqual(a,b)
 def test_exit_after_one_hour_not_two(self):
  self.assertIsNone(m.stop([event(0,-1.2),event(1,-1.3)],RULE,T))
if __name__=='__main__':unittest.main()
