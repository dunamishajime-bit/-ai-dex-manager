#!/usr/bin/env python3
"""Independent PRISM VII research contract regression checks; no orders."""
from __future__ import annotations

import csv
import json
import unittest
from pathlib import Path

from prism7_synthetic_8_regime_exit_stress_20261122 import (
    make_market, REGIMES, START, N, M5, ATR_RATIO,
)
from prism7_native53_exit_hypothesis_replay_20261122 import decide, RULES

ROOT=Path(__file__).resolve().parents[1]
R=ROOT/"results"


class ResearchContract(unittest.TestCase):
    def test_synthetic_is_deterministic_and_h1_consistent(self):
        a,b,n=make_market("DOWN_THEN_SQUEEZE",2026112201)
        c,d,m=make_market("DOWN_THEN_SQUEEZE",2026112201)
        self.assertEqual(a,c)
        self.assertEqual(b,d)
        self.assertEqual(n,m)
        self.assertEqual(len(a),N)

    def test_decision_cannot_see_future_append(self):
        for regime in REGIMES:
            candles,btc,n=make_market(regime,2026112201)
            future={START+(N+i)*M5:[START+(N+i)*M5,
                    1,1,1,1,100,START+(N+i+1)*M5-1,100,1,50,50,0]
                    for i in range(20)}
            for rule in RULES:
                normal=decide(candles,1.,ATR_RATIO,START,START+N*M5,rule)
                expanded=decide({**candles,**future},1.,ATR_RATIO,START,START+N*M5,rule)
                self.assertEqual(normal,expanded)
                if normal is not None:
                    self.assertLessEqual(normal["signal_close_ts"],normal["execution_print_ts"])
                    self.assertLess(normal["execution_print_ts"],START+N*M5)
                    self.assertGreater(normal["execution_proxy_open"],0)

    def test_zero_print_bars_are_never_hypothetical_exit_fills(self):
        candles,_,n=make_market("ILLIQUID_ZERO_PRINT",2026112201)
        self.assertGreater(n,300)
        for rule in RULES:
            hit=decide(candles,1.,ATR_RATIO,START,START+N*M5,rule)
            if hit is not None:
                self.assertGreater(candles[hit["execution_print_ts"]][5],0)
                self.assertGreaterEqual(hit["execution_print_ts"],hit["signal_close_ts"])

    def test_native53_cost_and_source_invariants(self):
        source=json.loads((R/"PRISM7_NATIVE53_P73_CAUSAL_EXIT_SUMMARY_20261122.json").read_text(encoding="utf-8"))
        self.assertEqual(source["n_original_candidate_intents"],53)
        self.assertEqual(source["source_53_native_parity"],"PASS")
        self.assertEqual(len(source["results"]),len(RULES)*6+6)
        n=[r for r in source["results"] if r["rule"]=="NATIVE" and r["fee_bps"]==30 and r["extra_slip_bps"]==0]
        self.assertEqual(len(n),1)
        self.assertEqual(n[0]["wins"],29)
        self.assertAlmostEqual(n[0]["mean_net_pct"],1.000655,places=5)
        # Additional simulated slippage must never improve total net returns.
        for rule in RULES:
            rows=[r for r in source["results"] if r["rule"]==rule and r["fee_bps"]==30]
            fees={r["extra_slip_bps"]:r for r in rows}
            self.assertGreaterEqual(fees[0]["mean_net_pct"],fees[10]["mean_net_pct"]-1e-6)
            self.assertGreaterEqual(fees[10]["mean_net_pct"],fees[25]["mean_net_pct"]-1e-6)
            for r in rows:self.assertEqual(r["n"],53)

    def test_synthetic_scope_is_not_native_pengu(self):
        data=json.loads((R/"PRISM7_P74_8REGIME_SYNTHETIC_EXIT_STRESS_20261122.json").read_text(encoding="utf-8"))
        self.assertEqual(data["generated_paths"],320)
        self.assertEqual(data["closed_m5_prefix_invariance_checks"],32)
        self.assertEqual(data["strategy_signal_condition"],"FORCED_SHORT_EACH_PATH_NOT_NATIVE_PENGU")
        self.assertEqual(data["native_exit_substitute"],"FORCED_HOLD_72H_NOT_PINNED_STOP")

    def test_loss_event_taxonomy_and_oracle_limits(self):
        d=json.loads((R/"PRISM7_NATIVE53_EVENT_ATTRIBUTION_20261122.json").read_text(encoding="utf-8"))
        self.assertEqual(d["native_intents"],53)
        self.assertEqual(d["native_winners"],29)
        self.assertEqual(d["m5_full_life_vs_anatomy_mfe_max_abs_pct"],0)
        self.assertEqual(d["m5_full_life_vs_anatomy_mae_max_abs_pct"],0)
        oracle=json.loads((R/"PRISM7_NATIVE53_FUTURE_DOWNSWING_ORACLE_SUMMARY_20261122.json").read_text(encoding="utf-8"))
        family=oracle["cohorts"]["NO_FAVORABLE_ONE_PERCENT"]
        self.assertEqual(family["n"],11)
        self.assertEqual(family["oracle_close_to_close_ge3pct"],4)


if __name__=="__main__":
    unittest.main(verbosity=2)
