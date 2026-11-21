#!/usr/bin/env python3
"""Non-optimizing regression of P6/P6B evidence & synthetic causal contract."""
import csv
import json
import unittest
from pathlib import Path
from prism7_p6_pengu_causal_structure_state_20261122 import asof_state,H
from prism7_p6b_sparse_market_state_20261122 import asof_sparse
from prism7_synthetic_8_regime_exit_stress_20261122 import make_market,START,REGIMES,SEEDS,M5

ROOT=Path(__file__).resolve().parents[1]/"results"

class Contract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p6=json.loads((ROOT/"PRISM7_P6_REAL53_SYNTH320_STRUCTURE_STATE_SUMMARY_20261122.json").read_text(encoding="utf-8"))
        cls.p6b=json.loads((ROOT/"PRISM7_P6B_NATIVE53_SYNTH320_SPARSE_SUMMARY_20261122.json").read_text(encoding="utf-8"))
        def read(name):
            with (ROOT/name).open("r",encoding="utf-8-sig",newline="") as f:
                return list(csv.DictReader(f))
        cls.native_old=read("PRISM7_P6_NATIVE53_STRUCTURE_STATES_20261122.csv")
        cls.native_new=read("PRISM7_P6B_NATIVE53_SPARSE_STATES_20261122.csv")
        cls.paths_old=read("PRISM7_P6_SYNTHETIC320_PATH_STATES_20261122.csv")
        cls.paths_new=read("PRISM7_P6B_SYNTHETIC320_PATH_STATES_20261122.csv")

    def test_original_53_identity_and_outcomes_unchanged(self):
        self.assertEqual(len(self.native_old),53)
        self.assertEqual(len(self.native_new),53)
        for old,new in zip(self.native_old,self.native_new):
            for field in ("period","id","original_entry_ts","native_profitable30","native_net30_pct","source_diagnostic_category"):
                self.assertEqual(old[field],new[field])
        self.assertEqual(sum(x["native_profitable30"]=="1" for x in self.native_new),29)
        self.assertEqual(sum(x["source_diagnostic_category"]=="NO_FAVORABLE_ONE_PERCENT"
                             for x in self.native_new),11)

    def test_original_classifier_coverage(self):
        from collections import Counter
        self.assertEqual(Counter(x["state"] for x in self.native_old),{
            "SELLER_CONTINUATION":3,"TRANSITION_OR_CONFLICT":15,
            "DATA_INSUFFICIENT":35})
        self.assertEqual(Counter(x["state"] for x in self.native_new),{
            "SELLER_CONTINUATION":7,"BUYER_ABSORPTION_REVERSAL":1,
            "TRANSITION_OR_CONFLICT":43,"DATA_INSUFFICIENT":2})

    def test_synthetic_scope(self):
        self.assertEqual(len(self.paths_old),320)
        self.assertEqual(len(self.paths_new),320)
        for before,after in zip(self.paths_old,self.paths_new):
            self.assertEqual((before["regime"],before["seed"]),(after["regime"],after["seed"]))
            self.assertEqual(int(before["total_states"]) if "total_states" in before else int(before["n_observed_hourly_states"]),42)
            self.assertEqual(int(after["total_states"]),42)
        self.assertEqual(self.p6["synthetic_hourly_states"],13440)
        self.assertEqual(self.p6b["synthetic_hourly_checks"],13440)

    def test_quality_proof_and_no_venue_claims(self):
        self.assertEqual(self.p6["source_pin"],self.p6b["source_pin"])
        self.assertEqual(self.p6b["native_winner_parity"],29)
        self.assertEqual(len(self.p6b["btc_quarantine"]),1)
        self.assertEqual(self.p6b["btc_quarantine"][0]["ts"],1757771400000)
        self.assertEqual(self.p6b["native_prefix_invariance_count"],53)

    def test_sparse_future_append_invariance_across_regimes(self):
        for regime in REGIMES:
            P,B,_=make_market(regime,SEEDS.start)
            t=START+36*H
            a=asof_sparse(P,B,t)
            z=asof_state(P,B,t)
            future_t=t+6*H
            extra={future_t:[future_t,100,100,100,100,250,future_t+M5-1,25000,1,125,12500,0]}
            self.assertEqual(a,asof_sparse({**P,**extra},{**B,**extra},t))
            self.assertEqual(z,asof_state({**P,**extra},{**B,**extra},t))
            self.assertEqual(a,asof_sparse({k:v for k,v in P.items() if k<t},
                                          {k:v for k,v in B.items() if k<t},t))

    def test_sparse_zero_volume_missing_print_does_not_count_as_trade(self):
        P,B,z=make_market("ILLIQUID_ZERO_PRINT",SEEDS.start)
        self.assertGreater(z,300)
        t=START+36*H
        baseline=asof_sparse(P,B,t)
        no_print_ts=t-M5
        P_mut=dict(P)
        P_mut[no_print_ts]=[
            no_print_ts,9e9,9e9,1e-5,9e9,0,
            no_print_ts+M5-1,0,0,0,0,0
        ]
        # With no trades, large synthetic prices MUST not enter the decision.
        if P[no_print_ts][5]==0:
            self.assertEqual(baseline,asof_sparse(P_mut,B,t))

if __name__=="__main__":
    unittest.main(verbosity=2)
