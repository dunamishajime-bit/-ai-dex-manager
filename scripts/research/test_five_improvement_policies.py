import unittest
from five_improvement_policies import governor_multiplier, earlier_exit
H=3600000
class PoliciesTest(unittest.TestCase):
 def test_governor_requires_distinct_strategies(self):
  loss=[{'ts':8*H,'side':'LONG','strategy':'V12','pnl':-1},{'ts':9*H,'side':'LONG','strategy':'V12','pnl':-1}]
  self.assertEqual(governor_multiplier(loss,10*H,'LONG',2,-.02,.01,6,.6),1)
  loss[1]['strategy']='Q102'
  self.assertEqual(governor_multiplier(loss,10*H,'LONG',2,-.02,.01,6,.6),.6)
 def test_governor_ignores_future_and_expired_losses(self):
  loss=[{'ts':3*H,'side':'LONG','strategy':'V12','pnl':-1},{'ts':11*H,'side':'LONG','strategy':'Q102','pnl':-1}]
  self.assertEqual(governor_multiplier(loss,10*H,'LONG',2,-.02,.01,6,.6),1)
 def test_governor_requires_all_conditions(self):
  loss=[{'ts':8*H,'side':'SHORT','strategy':'V12','pnl':-1},{'ts':9*H,'side':'SHORT','strategy':'PENGU','pnl':-1}]
  for gross,bnow,bprev in [(.9,.02,-.01),(2,.005,-.01),(2,.02,.01),(2,None,-.01)]:
   self.assertEqual(governor_multiplier(loss,10*H,'SHORT',gross,bnow,bprev,6,.75),1)
  self.assertEqual(governor_multiplier(loss,10*H,'SHORT',2,.02,-.01,6,.75),.75)
 def test_trailing_does_not_use_current_high_for_same_bar_stop(self):
  c={'strategy_id':'FET','side':'LONG','entry_ts_ms':0,'exit_ts_ms':3*H,'entry_price':100,'exit_price':108,'exit_reason':'TIME'}
  bars={0:{'open':100,'high':108,'low':99,'close':107},H:{'open':107,'high':108,'low':106,'close':107},2*H:{'open':105,'high':106,'low':104,'close':105},3*H:{'open':108,'high':108,'low':108,'close':108}}
  x=earlier_exit(c,bars,{},'FET_TRAIL_5_2')
  self.assertEqual(x['exit_ts_ms'],2*H+H)
  self.assertEqual(x['exit_price'],105)
 def test_no_policy_preserves_candidate_exactly(self):
  c={'strategy_id':'Q102','side':'LONG','entry_ts_ms':0,'exit_ts_ms':H,'entry_price':100,'exit_price':101,'exit_reason':'TIME'}
  self.assertEqual(earlier_exit(c,{}, {},'BASELINE'),c)
if __name__=='__main__':unittest.main()
