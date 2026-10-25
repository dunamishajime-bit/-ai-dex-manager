import json
import tempfile
import unittest
from pathlib import Path

from scripts.audit_native_full8_source_locked_baseline import (
    audit_native, event_cashflow, FAMILIES
)


class NativeFull8BaselineIdentityTests(unittest.TestCase):
    def test_partial_exit_funding_and_opening_fee_signs(self):
        self.assertEqual(event_cashflow({"event_type":"MODELED_ENTRY","fee_settlement":0.5}),-0.5)
        self.assertEqual(event_cashflow({"event_type":"FUNDING","cashflow_settlement":-0.2}),-0.2)
        self.assertEqual(event_cashflow({"event_type":"HYPE_PRIORITY_PARTIAL_EXIT","net_cashflow_settlement":1.7}),1.7)
        self.assertEqual(event_cashflow({"event_type":"TASK9_MODELED_STOP_COOLDOWN"}),0)
        with self.assertRaisesRegex(ValueError,"UNKNOWN_NATIVE_EVENT_TYPE"):
            event_cashflow({"event_type":"UNRECOGNIZED"})

    def test_rolling_strategy_score_favors_only_past_wins(self):
        from collections import deque
        from scripts.research_native_full8_frozen_cohort_gross_shadow import causal_multiplier
        self.assertEqual(causal_multiplier(deque()),(1.,50.))
        wins=deque([.01]*30)
        losses=deque([-.01]*30)
        self.assertGreater(causal_multiplier(wins)[0],1.)
        self.assertLess(causal_multiplier(losses)[0],1.)
        self.assertLessEqual(causal_multiplier(wins)[0],1.15)

    def test_native_8_family_reconciliation_and_fail_closed_accounting(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            decisions=[]; trades=[]; events=[]
            for i,strategy in enumerate(sorted(FAMILIES),start=1):
                cid=f"candidate-{i}"
                decisions.append({"candidate_id":cid,"strategy_id":strategy,"symbol":f"S{i}",
                    "side":"LONG","entry_ts_ms":i,"decision":"ACCEPTED_MODELED_ENTRY"})
                trades.append({"candidate_id":cid,"strategy_id":strategy,"symbol":f"S{i}",
                    "side":"LONG","entry_ts_ms":i})
                events.append({"ts_ms":i,"event_type":"MODELED_ENTRY","fee_settlement":0.,
                    "wallet_after_event":100.,"reference_fx_jpy_per_usd":2.,"position_id":i})
                events.append({"ts_ms":100+i,"event_type":"MODELED_EXIT","net_cashflow_settlement":0.,
                    "wallet_after_event":100.,"reference_fx_jpy_per_usd":2.,"position_id":i})
            events.sort(key=lambda x:x["ts_ms"])
            events.insert(0,{"ts_ms":0,"event_type":"MONTHLY_CONTRIBUTION",
                "settlement_cashflow":100.,"wallet_after_event":100.,
                "reference_fx_jpy_per_usd":2.})
            metrics={"final_equity_jpy":200.,"strategy_trades":dict((s,1) for s in FAMILIES),
                "profit_factor":1.,"maximum_mtm_drawdown":0.,"win_rate":.5,"contributed_jpy":200.}
            def write(name,items):
                (root/name).write_text("".join(json.dumps(item)+"\n" for item in items),encoding="utf8")
            write("candidate-decisions.jsonl",decisions)
            write("portfolio-trades.jsonl",trades)
            write("portfolio-events.jsonl",events)
            (root/"metrics.json").write_text(json.dumps(metrics),encoding="utf8")
            out=audit_native(root)
            self.assertEqual(out["acceptedEntries"],8)
            self.assertAlmostEqual(out["replayedFinalEquityJpy"],200.)
            self.assertFalse(out["grossOverlayApplied"])
            self.assertFalse(out["exactNativeLatestSourceShaVerified"])
            metrics["final_equity_jpy"]=201.
            (root/"metrics.json").write_text(json.dumps(metrics),encoding="utf8")
            with self.assertRaisesRegex(ValueError,"NATIVE_EQUITY_FAILED_RECONCILIATION"):
                audit_native(root)


if __name__ == "__main__":
    unittest.main()
