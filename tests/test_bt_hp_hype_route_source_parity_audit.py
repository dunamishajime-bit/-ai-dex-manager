"""Synthetic regression cases for HYPE route source provenance audit."""
import sys,unittest,tempfile,copy,csv
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_hype_route_source_parity_audit import audit,entries,load_sources,LEGACY_ROUTE,REQUIRED

SHA="a"*40
RESEARCH_SHA="b"*40
SOURCE_FILES={name:{"sha256":"c"*64,"bytes":300} for name in REQUIRED}
WRAPPER=LEGACY_ROUTE+" HYPE_REDESIGN_TIME48_NEXTOPEN 0.004297852251518686 0.02047426596091347 0.026202553353817715"
CASE={("2026-02-21T12:00:00Z",LEGACY_ROUTE,RESEARCH_SHA):{
 "entryTimeUtc":"2026-02-21T12:00:00Z","route":LEGACY_ROUTE,
 "modelEntryGrossX":1.0,"sourceRuntimeSha":RESEARCH_SHA}}

def source_fixture():
    sources={name:"// immutable fixture source\n" for name in REQUIRED}
    sources["scripts/disdex-hype-zec-long-live-runner.ts"]='import { HypeZecLongRunner } from "../lib/hype-zec-long-runner";'
    sources["lib/hype-zec-long-market-data.ts"]='signalMode === "TREND"'
    sources["lib/hype-trend-long-signal.ts"]="export function buildHypeTrendSignal() {}"
    sources["config/hypeZecLongRuntime.ts"]="signalMode: 'TREND'"
    sources["config/hypeTrendLongPolicy.ts"]=(
       'strategy: "HYPE_LONG", timeframe: "1h", '
       'fastEmaPeriod:12,slowEmaPeriod:48,regimeEmaPeriod:240,'
       'breakoutLookbackHours:24,minimumBreakoutBps:30,minimumRegimeSlopeBps:75,'
       'atrPeriod:14,stopAtrMultiple:2.5,trailingAtrMultiple:3,'
       'maximumHoldHours:168,maximumGross:1.5'
    )
    return sources

class HypeRouteSourceTests(unittest.TestCase):
    def setUp(self):
        self.original=copy.deepcopy(CASE)
        self.second=copy.deepcopy(CASE)
        self.sources=source_fixture()
        self.meta={"releaseSha":SHA,"signalMode":"TREND","maximumGross":1.5}
    def invoke(self):
        return audit(self.original,self.second,WRAPPER,self.sources,
                     SOURCE_FILES,SHA,self.meta)
    def test_different_research_vs_live_strategy_not_equivalent(self):
        r=self.invoke()
        self.assertEqual(r["status"],"RESEARCH_HYPE_ROUTE_ABSENT_FROM_REVIEWED_LIVE_EXECUTION_PATH")
        self.assertEqual(r["historicalEntryCount"],1)
        self.assertEqual(r["researchModelGrossRequestedX"],1.)
        self.assertEqual(r["liveTrendPolicy"]["maximumGross"],1.5)
        self.assertFalse(r["sourceDefinitionEquivalent"])
        self.assertFalse(r["economicParityCertified"])
        self.assertEqual(r["productionMutations"],0)
    def test_matching_label_not_enough_to_certify(self):
        self.sources["lib/hype-zec-long-runner.ts"]+=LEGACY_ROUTE
        r=self.invoke()
        self.assertEqual(r["status"],"RESEARCH_ROUTE_PRESENT_BUT_ECONOMICS_STILL_UNVERIFIED")
        self.assertFalse(r["economicParityCertified"])
    def test_cost_case_drift(self):
        self.second={}
        with self.assertRaisesRegex(ValueError,"COST_CASE_SIGNAL_DRIFT"):self.invoke()
    def test_historical_mode_not_assumed(self):
        self.meta["signalMode"]="LEGACY"
        with self.assertRaisesRegex(ValueError,"MODE_EVIDENCE_MISMATCH"):self.invoke()
    def test_mismatched_source_release(self):
        self.meta["releaseSha"]=RESEARCH_SHA
        with self.assertRaisesRegex(ValueError,"MODE_EVIDENCE_MISMATCH"):self.invoke()
    def test_gross_config_contract_mismatch(self):
        self.meta["maximumGross"]=1.0
        with self.assertRaisesRegex(ValueError,"GROSS_CONFIG_POLICY_MISMATCH"):self.invoke()
    def test_research_model_route_changed(self):
        self.original={("2026-02-21T12:00:00Z","SOME_OTHER_ROUTE",RESEARCH_SHA):
                       {**next(iter(CASE.values())),"route":"SOME_OTHER_ROUTE"}}
        self.second=copy.deepcopy(self.original)
        with self.assertRaisesRegex(ValueError,"UNEXPECTED_RESEARCH_MODEL_HYPE_ROUTE"):self.invoke()
    def test_research_definition_must_be_verified(self):
        with self.assertRaisesRegex(ValueError,"RESEARCH_MODEL_RULE_DEFINITION_CHANGED"):
            audit(self.original,self.second,LEGACY_ROUTE+" HYPE_REDESIGN_TIME48_NEXTOPEN",
                  self.sources,SOURCE_FILES,SHA,self.meta)
    def test_runner_wiring_failclosed(self):
        self.sources["scripts/disdex-hype-zec-long-live-runner.ts"]="runner"
        with self.assertRaisesRegex(ValueError,"RUNNER_WIRING_NOT_RECOGNIZED"):self.invoke()
    def test_live_policy_field_missing_rejected(self):
        self.sources["config/hypeTrendLongPolicy.ts"]=self.sources["config/hypeTrendLongPolicy.ts"].replace("fastEmaPeriod:12,","")
        with self.assertRaisesRegex(ValueError,"LIVE_POLICY_FIELD_MISSING"):self.invoke()
    def test_live_source_bundle_missing_failclosed(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError,"MISSING_LIVE_SOURCE_FILE"):
                load_sources(Path(temp))
    def test_invalid_research_entry_gross_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"rows.csv"
            fields=["trade_id","utc","logic","symbol","side","route","entry_gross_x","source_runtime_sha"]
            with path.open("w",encoding="utf8",newline="") as f:
                w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
                w.writerow(dict(trade_id="one",utc="2026-02-21T12:00:00Z",logic="HYPE",symbol="HYPEUSDT",
                    side="LONG",route=LEGACY_ROUTE,entry_gross_x="-3",source_runtime_sha=RESEARCH_SHA))
            with self.assertRaisesRegex(ValueError,"INVALID_MODEL_ENTRY_GROSS"):entries(path)

if __name__=="__main__":unittest.main()
