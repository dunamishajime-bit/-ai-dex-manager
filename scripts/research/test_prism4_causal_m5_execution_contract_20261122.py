#!/usr/bin/env python3
"""Offline fail-closed tests for PRISM IV research M5 as-of contract.

Run:
 python -m unittest scripts/research/test_prism4_causal_m5_execution_contract_20261122.py
or python scripts/research/test_prism4_causal_m5_execution_contract_20261122.py
"""
import importlib.util
import math
import sys
import unittest
from pathlib import Path

NAME="prism4_causal_m5_execution_contract_20261122"
SRC=Path(__file__).with_name(NAME+".py")
spec=importlib.util.spec_from_file_location(NAME,SRC)
mod=importlib.util.module_from_spec(spec)
sys.modules[NAME]=mod
spec.loader.exec_module(mod)
Bar=mod.Bar
EntryDecision=mod.EntryDecision
M=mod.M5_MS


def make_bars(volumes, prices=None):
    if prices is None:prices=[100.0+i for i in range(len(volumes))]
    assert len(volumes)==len(prices)
    return [Bar(i*M,p,p,p,p,float(v)) for i,(p,v) in enumerate(zip(prices,volumes))]


class ResearchAsOfTest(unittest.TestCase):
    def setUp(self):
        self.signal=EntryDecision(0,12*M,"SHORT")

    def test_zero_volume_h1_is_not_assertion_of_impossible_real_order(self):
        bars=make_bars([0]*12)
        self.assertIsNone(mod.native_h1_ohlcv_from_printed_m5(bars))
        native=mod.choose_entry(self.signal,bars,"NATIVE_H1_PRICE",native_h1_open=100)
        self.assertEqual(native.state,"HYPOTHETICAL_PRICE_REFERENCE")
        self.assertEqual(native.reference_price,100)
        confirm=mod.choose_entry(self.signal,bars,"CONFIRMED_NEXT_PRINT")
        self.assertEqual(confirm.state,"EXPIRED_WITHOUT_CONFIRMED_PRINT")
        self.assertIn("NOT_PROVEN_UNFILLABLE",confirm.provenance)

    def test_first_print_model_is_explicitly_ex_post(self):
        bars=make_bars([0,6,4]+[0]*9)
        m=mod.choose_entry(self.signal,bars,"FIRST_PRINT_UPPER_INFORMATION_BOUND")
        self.assertEqual(m.modeled_fill_ts,M)
        self.assertEqual(m.reference_price,101)
        self.assertIn("NOT_ASOF",m.provenance)

    def test_confirmed_model_only_fills_after_completed_positive_volume(self):
        bars=make_bars([0,10,4]+[0]*9)
        m=mod.choose_entry(self.signal,bars,"CONFIRMED_NEXT_PRINT")
        self.assertEqual(m.first_print_ts,M)
        self.assertEqual(m.decision_or_order_ts,2*M)
        self.assertEqual(m.modeled_fill_ts,2*M)
        self.assertEqual(m.reference_price,102)
        self.assertTrue(m.modeled_fill_ts>=m.decision_or_order_ts)

    def test_single_first_print_must_not_be_assumed_filled_in_confirmed_model(self):
        bars=make_bars([0,10]+[0]*10)
        result=mod.choose_entry(self.signal,bars,"CONFIRMED_NEXT_PRINT")
        self.assertEqual(result.state,"EXPIRED_AFTER_CONFIRMATION_WITHOUT_LATER_PRINT")
        self.assertIsNone(result.reference_price)

    def test_asof_result_unchanged_by_future_bar_tampering_after_execution(self):
        a=make_bars([0,10,4]+[0]*9)
        orig=mod.choose_entry(self.signal,a,"CONFIRMED_NEXT_PRINT")
        b=a[:3]+make_bars([100]*9,prices=[1000]*9)
        b=[*b[:3],*[Bar((k+3)*M,z.open,z.high,z.low,z.close,z.volume)
                      for k,z in enumerate(b[3:])]]
        # All later prices are radically altered; the modeled earlier
        # confirmation/entry event must remain unchanged.
        newer=mod.choose_entry(self.signal,b,"CONFIRMED_NEXT_PRINT")
        self.assertEqual(newer.reference_price,orig.reference_price)
        self.assertEqual(newer.modeled_fill_ts,orig.modeled_fill_ts)

    def test_aggregate_ignores_untraded_price_carry_forward(self):
        a=make_bars([0]*12)
        a[3]=Bar(3*M,105,106,103,104,10)
        a[9]=Bar(9*M,110,112,109,111,20)
        self.assertEqual(mod.native_h1_ohlcv_from_printed_m5(a),(105,112,103,111,30))

    def test_missing_m5_history_fails_closed(self):
        a=make_bars([3]*12)
        with self.assertRaisesRegex(ValueError,"INCOMPLETE"):
            mod.choose_entry(self.signal,a[:-1],"CONFIRMED_NEXT_PRINT")

    def test_duplicate_candle_fails_closed(self):
        a=make_bars([3]*12)
        a[3]=a[2]
        with self.assertRaisesRegex(ValueError,"MISSING_OR_DUPLICATE"):
            mod.choose_entry(self.signal,a,"CONFIRMED_NEXT_PRINT")

    def test_invalid_nonfinite_and_negative_volume_fail(self):
        with self.assertRaises(ValueError):Bar(0,100,101,99,100,-1)
        with self.assertRaises(ValueError):Bar(0,100,math.nan,99,100,1)

    def test_no_order_without_full_provenance(self):
        example={"native_pin_parity":True,
                "causal_execution_proven":True,
                "independent_out_of_sample":True,
                "portfolio_costs_both_replayed":True,
                "funding_gross_stop_reconciled":True,
                "fee_10":{"mdd_pct":18,"win_rate_pct":80,"trades":100,"pf":1.4},
                "fee_30":{"mdd_pct":19,"win_rate_pct":80,"trades":100,"pf":1.1}}
        self.assertEqual(mod.guard_strategy_adoption(example)["decision"],"BLOCK")
        example["venue_fill_model_supported"]=True
        example["fee_30"]["mdd_pct"]=22
        self.assertEqual(mod.guard_strategy_adoption(example)["decision"],"BLOCK")
        example["fee_30"]["mdd_pct"]=19
        self.assertEqual(mod.guard_strategy_adoption(example)["decision"],
                         "RESEARCH_GATES_PASSED_OWNER_DEPLOY_STILL_REQUIRED")

    def test_small_sample_wilson_does_not_certify_80pct(self):
        lo,hi=mod.wilson_95(5,11)
        self.assertLess(lo,.5)
        self.assertLess(hi,.8)
        self.assertIsNone(mod.wilson_95(0,0))


if __name__=="__main__":
    unittest.main(verbosity=2)
