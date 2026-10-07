import unittest
from pengu_m05_forward_observer import merge_observations,summary_metrics,bar_excursions
class ShadowObserverTests(unittest.TestCase):
 def test_candidate_ticks_are_one_independent_candidate(self):
  a={'referenceTs':1000,'route':'SHORT_V20','productionOutcome':'CANDIDATE','wouldBlock':True}
  rows=merge_observations({},[a,a])
  self.assertEqual(len(rows),1)
  b=dict(a,productionOutcome='EXITED',realizedNetAccountReturn=.02)
  rows=merge_observations(rows,[b])
  self.assertEqual(summary_metrics(rows)['all']['n'],1)
 def test_unfilled_or_unresolved_candidates_never_count_as_trade_losses(self):
  rows=merge_observations({},[{'referenceTs':1000,'route':'SHORT_V20','productionOutcome':'BLOCKED','wouldBlock':True}])
  self.assertEqual(summary_metrics(rows)['difference']['n'],0)
 def test_short_excursions_exclude_partial_fill_exit_candles(self):
  h=3600000
  c={'entryFillPrice':100,'entryFillObservedAt':h+100,'exitFillObservedAt':4*h+100,'exitFillPrice':97}
  bars=[[h,100,200,10,99],[2*h,99,101,95,96],[3*h,96,98,94,97],[4*h,97,300,1,97]]
  x=bar_excursions(c,bars,5*h)
  self.assertAlmostEqual(x['mfe_h1_contained'],.06)
  self.assertAlmostEqual(x['mae_h1_contained'],-.01)
 def test_missing_complete_bar_reports_gap(self):
  h=3600000;c={'entryFillPrice':100,'entryFillObservedAt':h,'exitFillObservedAt':4*h,'exitFillPrice':97}
  x=bar_excursions(c,[[h,100,101,95,96]],5*h)
  self.assertEqual(x['excursionCoverage'],'GAP')
if __name__=='__main__':unittest.main()
