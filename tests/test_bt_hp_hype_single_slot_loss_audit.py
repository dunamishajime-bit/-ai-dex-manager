"""Fail-closed synthetic tests for source HYPE single-slot ledger auditing."""
import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_hype_single_slot_loss_audit import audit

START=1760000000000
CANDIDATES=[
 {"entry_ts_ms":START+i*3_600_000,"exit_ts_ms":START+i*3_600_000+1_800_000,
  "strategy_id":"HYPE_LONG","symbol":"HYPEUSDT","route":"HYPE_TREND_LONG_PINNED",
  "exit_reason":"PINNED_HYPE_TAKE_PROFIT" if i==0 else "PINNED_HYPE_HARD_STOP"}
 for i in range(78)
]
def sample_case(cost):
 fee=-0.001 if cost=="10bps" else -0.003
 realized=[0.05+fee,-0.04+fee]
 opening=10_000;trades=[];peak=opening;dd=0.
 for i,ret in enumerate(realized):
  closing=opening*(1+ret)
  peak=max(peak,closing)
  dd=min(dd,(closing/peak-1)*100)
  trades.append({"start":CANDIDATES[i]["entry_ts_ms"],"end":CANDIDATES[i]["exit_ts_ms"],
   "gross":1.0,"rawReturn":0.05 if i==0 else -0.04,
   "feeWalletReturn":fee,"fundingWalletReturn":0.,
   "netWalletReturn":ret,"netCapitalJPY":closing,
   "fundingEvents":0,"exitReason":CANDIDATES[i]["exit_reason"]})
  opening=closing
 return {"initialJpy":10000.,"finalJpy":opening,"winRatePct":50.,
   "realizedDDPct":dd,"modelTrades":trades,"fundingEventsDuringTrades":0,
   "strategyTradeWins":1}
def fixture():
 return {"schema":"disdex-hype-pinned-aster-funding-sensitivity/v1",
   "results":{cost:sample_case(cost) for cost in ("10bps","30bps")}},copy.deepcopy(CANDIDATES)

class SingleSlotHypeLedgerTests(unittest.TestCase):
 def test_valid_reconciliation_and_cross_cost_selection(self):
  d,c=fixture();r=audit(d,c)
  self.assertEqual(r["status"],"HYPE_SINGLE_SLOT_RESEARCH_LEDGER_RECONCILED")
  self.assertEqual(r["entryCandidatesFromNativeSignal"],78)
  self.assertEqual(r["singleSlotSelectedModelTrades"],2)
  self.assertEqual(r["models"]["10bps"]["wins"],1)
  self.assertFalse(r["sharedRiskOrOtherRunnerArbitrationCertified"])
 def test_bad_cost_model_fee(self):
  d,c=fixture();d["results"]["30bps"]["modelTrades"][0]["feeWalletReturn"]=-.001
  with self.assertRaisesRegex(ValueError,"COST_BPS_MODEL_FEE_MISMATCH"):audit(d,c)
 def test_net_pnl_ledger_identity(self):
  d,c=fixture();d["results"]["10bps"]["modelTrades"][0]["netWalletReturn"]+=.001
  with self.assertRaisesRegex(ValueError,"MODEL_PNL_IDENTITY_FAILED"):audit(d,c)
 def test_dd_summary_forgery(self):
  d,c=fixture();d["results"]["10bps"]["realizedDDPct"]=-99
  with self.assertRaisesRegex(ValueError,"DD_SUMMARY_DRIFT"):audit(d,c)
 def test_end_balance_summary_forgery(self):
  d,c=fixture();d["results"]["10bps"]["finalJpy"]+=50
  with self.assertRaisesRegex(ValueError,"FINAL_EQUITY_SUMMARY_DRIFT"):audit(d,c)
 def test_missing_candidates(self):
  d,c=fixture();c[0]["entry_ts_ms"]+=5
  with self.assertRaisesRegex(ValueError,"ARCHIVED_CANDIDATE_MISSING"):audit(d,c)
 def test_duplicate_source_candidate_identity(self):
  d,c=fixture();c[1]["entry_ts_ms"]=c[0]["entry_ts_ms"]
  with self.assertRaisesRegex(ValueError,"ARCHIVED_HYPE_CANDIDATE_IDENTITY_INVALID"):audit(d,c)
 def test_overlapping_single_slot_trades(self):
  d,c=fixture()
  entry=d["results"]["10bps"]["modelTrades"][1]["start"]
  d["results"]["10bps"]["modelTrades"][0]["end"]=entry+1
  c[0]["exit_ts_ms"]=entry+1
  with self.assertRaisesRegex(ValueError,"SINGLE_SLOT_INTERVAL_OVERLAP"):audit(d,c)
 def test_cross_cost_trade_selection_mismatch(self):
  d,c=fixture()
  d["results"]["30bps"]["modelTrades"][1]["start"]=c[2]["entry_ts_ms"]
  d["results"]["30bps"]["modelTrades"][1]["end"]=c[2]["exit_ts_ms"]
  with self.assertRaisesRegex(ValueError,"COST_CASE_TRADE_SELECTION_MISMATCH"):audit(d,c)
 def test_funding_count_summary_invalid(self):
  d,c=fixture();d["results"]["10bps"]["fundingEventsDuringTrades"]=12
  with self.assertRaisesRegex(ValueError,"FUNDING_EVENT_COUNT_DRIFT"):audit(d,c)
 def test_compounding_equality(self):
  d,c=fixture();d["results"]["10bps"]["modelTrades"][0]["netCapitalJPY"]+=1
  with self.assertRaisesRegex(ValueError,"COMPOUNDING_LEDGER_MISMATCH"):audit(d,c)

if __name__=="__main__":unittest.main()
