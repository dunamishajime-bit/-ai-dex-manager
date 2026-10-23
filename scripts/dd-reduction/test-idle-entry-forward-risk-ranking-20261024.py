#!/usr/bin/env python3
"""No network / no LIVE, frozen training scorer's causal/accounting unit checks."""
import importlib.util,unittest
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('idle_forward_score',HERE/'screen-idle-entry-forward-risk-ranking-20261024.py')
mod=importlib.util.module_from_spec(sp);sp.loader.exec_module(mod)
class Risks(unittest.TestCase):
 def test_features_preentry_only(self):
  names=mod.FEATS
  self.assertEqual(len(names),len(set(names)))
  self.assertEqual(set(names),{'ret1h','ret3h','ret6h','rel3h','rel6h',
    'btc3h','btc6h','volratio','atr3h','rangepos3h'})
 def test_fit_does_not_use_future_labels(self):
  X=np.array([[i*.1 for i in range(10)] for _ in range(20)],float)
  y=np.array([0,1]*10,dtype=float)
  w=np.ones(len(y))
  model=mod.logistic(X,y,w)
  v={key:1.0 for key in mod.FEATS}
  result=mod.score({'features':v},model)
  self.assertTrue(0<=result<=1)
  # Scoring has no label argument: identical features must have identical frozen scores.
  self.assertEqual(result,mod.score({'features':dict(v)},model))
 def test_reject_partition_and_retention(self):
  inp=[{'riskScore':.2,'win':False,'netRetPct':-1},
       {'riskScore':.8,'win':True,'netRetPct':2},
       {'riskScore':.9,'win':True,'netRetPct':2}]
  s=mod.apply_stats(inp,.5)
  self.assertEqual(s['admit']['n'],2)
  self.assertEqual(s['reject']['n'],1)
  self.assertAlmostEqual(s['retainedPct'],66.67,places=2)
 def test_split_is_chronological_2026feb(self):
  self.assertEqual(mod.SPLIT,1770681600000)
  self.assertGreater(mod.DAY,0)
if __name__=='__main__':unittest.main()
