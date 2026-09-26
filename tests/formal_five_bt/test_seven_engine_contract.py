import json
import tempfile
import unittest
from pathlib import Path
from research.formal_five_bt.engine import _load_signal_rows, _load_signal_scan_manifests, render_report, PERIOD_START, SCENARIOS
from research.formal_five_bt.seven_source import LIVE_FIVE_SHA,SEVEN_RESEARCH_SHA
from research.formal_five_bt.datasets import load_fred_fx

class SevenEngineContractTests(unittest.TestCase):
    def prepare(self,root):
        for sub,strategy in [
            ("baseline-signal-scan","V12"),("baseline-signal-scan","PENGU"),
            ("baseline-signal-scan","FET"),("baseline-signal-scan-q102","Q102"),
        ]:
            p=root/sub/"decisions"/(strategy+".jsonl")
            p.parent.mkdir(parents=True,exist_ok=True);p.write_text("")
        side=root/"baseline-signal-scan-hz"
        (side/"decisions").mkdir(parents=True)
        for name in ("HYPE","ZEC"):
            (side/"decisions"/(name+".jsonl")).write_text(
                json.dumps({"strategy_id":name,"symbol":name+"USDT",
                    "source_runtime_sha":SEVEN_RESEARCH_SHA,
                    "baseline_live_sha":LIVE_FIVE_SHA,
                    "status":"SIGNAL","decision_ts_ms":1780000000000,
                    "signal":{"entryTs":1780000000000,"side":"LONG"}})+"\n")
        manifest={"runtime_sha":LIVE_FIVE_SHA,"sidecar_source_sha":SEVEN_RESEARCH_SHA,
          "strategies":["HYPE","ZEC"],"hype_zec_live_verified":False,
          "signals_are_not_fills":True,"stats":{"HYPE":{},"ZEC":{}}}
        (side/"signal-scan-manifest.json").write_text(json.dumps(manifest))
        return side
    def test_seven_manifest_exposes_separate_code_shas(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.prepare(root)
            rows,hashes=_load_signal_rows(root)
            self.assertEqual(set(rows),{"V12","PENGU","Q102","FET","HYPE","ZEC"})
            self.assertEqual(rows["ZEC"][0]["source_runtime_sha"],SEVEN_RESEARCH_SHA)
            manifests,_=_load_signal_scan_manifests(root)
            self.assertEqual(manifests["baseline-signal-scan-hz"]["runtime_sha"],LIVE_FIVE_SHA)
    def test_seven_manifest_without_provenance_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);side=self.prepare(root)
            p=side/"signal-scan-manifest.json"
            m=json.loads(p.read_text());m["hype_zec_live_verified"]=True
            p.write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError,"SIDECAR_SOURCE_MANIFEST_INVALID"):
                _load_signal_rows(root)
    def test_report_does_not_turn_unknown_Q102_HYPE_ZEC_into_zero(self):
        scenarios = [{"scenario_id": name+"_"+coverage,"status":"NOT_VERIFIABLE",
            "candidate_signals":{"V12":1459,"PENGU":52,"Q102":None,
                "FET":26,"HYPE":None,"ZEC":None},
            "verified_fills":0,"initial_gap_candidate_signals":{"Q102":None}}
            for name,coverage in SCENARIOS]
        meta={"run_id":"test","status":"NOT_VERIFIABLE","runtime_sha":LIVE_FIVE_SHA,
            "audited_release_id":LIVE_FIVE_SHA,"period_start_utc":PERIOD_START.isoformat(),
            "starting_capital_jpy":10000,"monthly_contribution_jpy":10000,
            "monthly_contribution_count":12,"total_contributions_jpy":130000,
            "scenarios":scenarios,"limitations":["TEST_MISSING_COVERAGE"]}
        report=render_report(meta,{"symbols":[],"fx":{
            "observations":0,"status":"NOT_VERIFIABLE"},"l2_archives":[]})
        self.assertIn("unverified: HYPE, Q102, ZEC",report)
        self.assertIn("HYPE: None",report)
    def test_missing_fred_is_not_a_fabricated_zero_or_rate(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d)/"acquisition-manifest.json").write_text(json.dumps({"fred":
                {"status":"NOT_VERIFIABLE_FRED_UNAVAILABLE","observations":0}}))
            rates,issues=load_fred_fx(d)
            self.assertEqual(rates,())
            self.assertTrue(issues)
            self.assertIn("FX_UNAVAILABLE",str([x.code for x in issues]))
if __name__=="__main__":unittest.main()
