"""Regression tests for HYPE as-of historical gate evidence, offline only."""
import csv,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_hype_asof_gate_audit import load_case,audit,proof_map,GATES

SHA="7"*40

class HistoricalHypeGateTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.root=Path(temp.name)
        self.entries10,self.fills10=self.fixture("10")
        self.entries30,self.fills30=self.fixture("30")
    def write(self,path,fields,rows):
        with path.open("w",encoding="utf8",newline="") as f:
            w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
    def fixture(self,cost):
        entry=self.root/(cost+"_MODEL_ENTRIES.csv")
        fills=self.root/(cost+"_FILLS.csv")
        self.write(entry,["trade_id","utc","logic","symbol","side","route","source_signal_id","source_runtime_sha"],
                   [{"trade_id":"hype"+cost,"utc":"2026-02-21T12:00:00Z","logic":"HYPE","symbol":"HYPEUSDT",
                     "side":"LONG","route":"HYPE_REDESIGN_CAUSAL","source_signal_id":"HYPE-SIGNAL-01","source_runtime_sha":SHA}])
        self.write(fills,["trade_id","strategy","symbol","entry_utc","exit_utc","net_pnl_jpy"],
                   [{"trade_id":"hype"+cost,"strategy":"HYPE","symbol":"HYPEUSDT",
                     "entry_utc":"2026-02-21T12:00:00Z","exit_utc":"2026-02-21T16:00:00Z",
                     "net_pnl_jpy":"-100" if cost=="10" else "-110"}])
        return entry,fills
    def source(self):
        return load_case(self.entries10,self.fills10),load_case(self.entries30,self.fills30)
    def proof(self,changes=None):
        row={"source_signal_id":"HYPE-SIGNAL-01","utc":"2026-02-21T12:00:00Z",
             "symbol":"HYPEUSDT","route":"HYPE_REDESIGN_CAUSAL",
             "observed_utc":"2026-02-21T11:59:00Z",**{g:"PASS" for g in GATES}}
        if changes:row.update(changes)
        path=self.root/"observations.csv"
        self.write(path,list(row),[row])
        return path
    def test_unproven_stays_unproven(self):
        data=audit(*self.source(),{})
        self.assertEqual(data["status"],"HISTORICAL_GATES_UNVERIFIED")
        self.assertEqual(data["historicalSignals"],1)
        self.assertEqual(data["unverifiedSignals"],1)
        self.assertTrue(all(x=="UNKNOWN" for x in data["signals"][0]["gateState"].values()))
        self.assertFalse(data["economicParityCertified"])
    def test_proof_present_never_certifies_live_economics(self):
        data=audit(*self.source(),proof_map(self.proof()))
        self.assertEqual(data["status"],"GATE_OBSERVATIONS_PRESENT_NOT_ECONOMIC_PARITY")
        self.assertFalse(data["economicParityCertified"])
        self.assertFalse(data["portfolioResimulationCompleted"])
    def test_observed_block_not_a_counterfactual_bt(self):
        data=audit(*self.source(),proof_map(self.proof({"shared_kill_switch":"BLOCK"})))
        self.assertEqual(data["signals"][0]["comparisonStatus"],"HISTORICAL_GATE_BLOCK_OBSERVED")
        self.assertEqual(data["signals"][0]["modeledOutcome10bps"]["netPnlJpy"],-100)
        self.assertFalse(data["economicParityCertified"])
    def test_future_observation_rejected(self):
        with self.assertRaisesRegex(ValueError,"Noncausal"):
            proof_map(self.proof({"observed_utc":"2026-02-21T12:01:00Z"}))
    def test_stale_observation_rejected(self):
        with self.assertRaisesRegex(ValueError,"Noncausal"):
            proof_map(self.proof({"observed_utc":"2026-02-21T11:40:00Z"}))
    def test_unavailable_states_cannot_be_assumed_pass(self):
        with self.assertRaisesRegex(ValueError,"Unverifiable"):
            proof_map(self.proof({"v4_stop_ownership":"UNKNOWN"}))
    def test_entry_cost_variant_mismatch_rejected(self):
        self.fills30=self.root/"30_CHANGED_FILLS.csv"
        self.write(self.fills30,["trade_id","strategy","symbol","entry_utc","exit_utc","net_pnl_jpy"],
                   [{"trade_id":"hype30","strategy":"HYPE","symbol":"HYPEUSDT",
                     "entry_utc":"2026-02-21T12:00:00Z","exit_utc":"2026-02-21T17:00:00Z",
                     "net_pnl_jpy":"-110"}])
        with self.assertRaisesRegex(ValueError,"lifecycle"):
            audit(*self.source(),{})
    def test_unknown_proof_signal_rejected(self):
        proof=proof_map(self.proof({"source_signal_id":"FORGED_SIGNAL"}))
        with self.assertRaisesRegex(ValueError,"Unknown historical"):
            audit(*self.source(),proof)
    def test_missing_model_fill_rejected(self):
        self.write(self.fills10,["trade_id","strategy","symbol","entry_utc","exit_utc","net_pnl_jpy"],[])
        with self.assertRaisesRegex(ValueError,"model exit absent"):
            self.source()
    def test_duplicate_model_entry_rejected(self):
        with self.entries10.open(encoding="utf8",newline="") as fp:
            rows=list(csv.DictReader(fp))
        self.write(self.entries10,list(rows[0]),rows+rows)
        with self.assertRaisesRegex(ValueError,"duplicate admission"):
            self.source()

if __name__=="__main__":unittest.main()
