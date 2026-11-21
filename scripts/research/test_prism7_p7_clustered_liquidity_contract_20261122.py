#!/usr/bin/env python3
"""PRISM VII P7 no-peeking and profile-realism contract checks."""
import csv
import json
import unittest
from collections import Counter
from pathlib import Path
from prism7_p7_clustered_liquidity_synthetic_20261122 import (
    sample_mask,new_market,calc_qualities,PROFILE_NAMES,SEEDS,N,REGIMES
)
from prism7_p6_pengu_causal_structure_state_20261122 import asof_state,H,M5
from prism7_p6b_sparse_market_state_20261122 import asof_sparse
from prism7_synthetic_8_regime_exit_stress_20261122 import START

ROOT=Path(__file__).resolve().parents[1]/"results"

class TestLiquidity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.summary=json.loads((ROOT/"PRISM7_P7_CLUSTERED_LIQUIDITY384_SUMMARY_20261122.json").read_text(encoding="utf-8"))
        with (ROOT/"PRISM7_P7_CLUSTERED_LIQUIDITY384_PATH_LEDGER_20261122.csv").open("r",encoding="utf-8",newline="") as f:
            cls.paths=list(csv.DictReader(f))

    def test_paths_count_and_published_contract(self):
        a=self.summary
        self.assertEqual(a["paths"],384)
        self.assertEqual(a["total_hourly_state_checks"],16128)
        self.assertEqual(a["prefix_invariance_checks"],128)
        self.assertEqual(len(self.paths),384)
        self.assertEqual(Counter(x["mask_profile"] for x in self.paths),
                         {p:96 for p in PROFILE_NAMES})
        self.assertTrue(all(int(x["state_decisions"])==42 for x in self.paths))

    def test_profile_realism_tolerance(self):
        for row in self.summary["mask_quality_vs_real"]:
            self.assertLess(abs(row["source_zero_m5_frac"]-row["sampled_zero_m5_frac"]),.06)
            self.assertLess(abs(row["source_empty_hour_frac"]-row["sampled_empty_hour_frac"]),.05)
            self.assertGreaterEqual(row["sampled_max_zero_M5"],19)

    def test_masks_are_reproducible_and_distinct_from_price_seed(self):
        toy=([False]*15+[True]*7+[False]*8+[True]*18)*100
        assert len(toy)>2*N
        a,idx=sample_mask("PRE_20250801_20250924",toy,REGIMES[0],SEEDS.start)
        b,j=sample_mask("PRE_20250801_20250924",toy,REGIMES[0],SEEDS.start)
        self.assertEqual(a,b)
        self.assertEqual(idx,j)
        self.assertEqual(idx%12,0)
        self.assertEqual(len(a),N)
        pa,ba=new_market(a,REGIMES[0],PROFILE_NAMES[0],SEEDS.start)
        pb,bb=new_market(a,REGIMES[0],PROFILE_NAMES[0],SEEDS.start+1)
        self.assertNotEqual(pa,pb)
        self.assertEqual(sum(float(row[5])==0 for row in pa.values()),sum(not m for m in a))

    def test_no_print_does_not_trade_and_closed_h1_time(self):
        toy=([False]*30+[True]*6)*40
        mask,_=sample_mask(PROFILE_NAMES[0],toy,REGIMES[2],SEEDS.start)
        P,B=new_market(mask,REGIMES[2],PROFILE_NAMES[0],SEEDS.start)
        for i in range(N):
            t=START+i*M5
            self.assertEqual(float(P[t][5])>0,mask[i])
            self.assertEqual(int(P[t][6]),t+M5-1)
            if not mask[i]:
                self.assertEqual(P[t][1],P[t][2])
                self.assertEqual(P[t][2],P[t][3])
                self.assertEqual(P[t][3],P[t][4])

    def test_future_append_and_censoring_never_affects_state(self):
        toy=([False]*14+[True]*12+[False]*10+[True]*12)*30
        mask,_=sample_mask(PROFILE_NAMES[0],toy,REGIMES[0],SEEDS.start)
        P,B=new_market(mask,REGIMES[0],PROFILE_NAMES[0],SEEDS.start)
        t=START+36*H
        future_t=t+8*H
        extra={future_t:[future_t,9,9,9,9,100,future_t+M5-1,900,1,50,450,0]}
        for fn in (asof_state,asof_sparse):
            self.assertEqual(fn(P,B,t),fn({**P,**extra},{**B,**extra},t))
            self.assertEqual(fn(P,B,t),fn({k:v for k,v in P.items() if k<t},
                                          {k:v for k,v in B.items() if k<t},t))

if __name__=="__main__":
    unittest.main(verbosity=2)
