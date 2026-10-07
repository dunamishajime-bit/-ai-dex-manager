"""Independent ledger verification for the no-DCA study (standard library only)."""
from pathlib import Path
import json,math,gzip,sys
ROOT=Path(__file__).resolve().parent
def rows(path):
 p=Path(path)
 raw=p.read_bytes() if p.exists() else gzip.decompress(p.with_name(p.name+".gz").read_bytes())
 return [json.loads(s) for s in raw.decode().splitlines() if s.strip()]
cfg=json.loads((ROOT/"vps-config-snapshot.json").read_text())
assert cfg["allConfigGitBlobMatches"] and len(cfg["files"])==32
audit=json.loads((ROOT/"v12-current-source-candidate-sizing-audit.json").read_text())
assert audit["matched"]==audit["candidateCount"]==1978 and audit["grossMismatches"]==0 and audit["currentSignalNotMatched"]==0
qty=json.loads((ROOT/"quantity-source-parity.json").read_text());assert qty["status"]=="PASS" and qty["vectors"]==1503
proof=[]
for variant in ["VPS_VERIFIED_VENUE_365D","VPS_VERIFIED_CONTINUOUS_365D"]:
 archived="--archived" in sys.argv or not (ROOT/"runs"/variant/"summary.json").exists()
 if archived:
  final=json.loads((ROOT/"result-summary.json").read_text())
  result=final["primaryWithCurrentObservedVenueQuantityFilters" if "VENUE" in variant else "continuousQuantityComparison"]
 else: result=json.loads((ROOT/"runs"/variant/"summary.json").read_text())
 assert not result["unresolved_crypto_candidate_counts"]
 assert result["v52_model_complete"] and result["v52_funding_verified"]
 for s in result["scenarios"]:
  folder=ROOT/("ledgers" if archived else "runs")/variant/s["scenario_id"]
  trades=rows(folder/"portfolio-trades.jsonl");events=rows(folder/"portfolio-events.jsonl");decisions=rows(folder/"candidate-decisions.jsonl")
  deposits=[e for e in events if e["event_type"]=="MONTHLY_CONTRIBUTION"]
  assert len(deposits)==1 and deposits[0]["contribution_jpy"]==10000.0 and deposits[0]["ts_ms"]==1754784000000
  assert s["contributed_jpy"]==10000 and s["monthly_jpy"]==0 and s["closed_trades"]==len(trades)
  assert (s["period_end_ms"]-s["period_start_ms"])/86400000==365
  assert s["missing_active_position_mtm_hours"]==0 and s["accounting_reconciliation"]["status"]=="PASS"
  assert all(t["entry_ts_ms"]>=s["period_start_ms"] and t["exit_ts_ms"]<=s["period_end_ms"] for t in trades)
  assert len({t["candidate_id"] for t in trades})==len(trades)
  assert sum(d["decision"]=="ACCEPTED_MODELED_ENTRY" for d in decisions)==len(trades)
  assert all(t["accepted_gross"]<=.1+1e-9 for t in trades if t["strategy_id"]=="V12" and t.get("rank")==3)
  assert all(t["accepted_gross"]<=1+1e-9 for t in trades if t["strategy_id"]=="V12")
  pnls=[float(t["total_pnl_jpy"]) for t in trades]
  gains=math.fsum(p for p in pnls if p>0);losses=-math.fsum(p for p in pnls if p<0)
  assert abs(gains/losses-s["profit_factor"])<1e-9
  account=s["accounting_reconciliation"];wallet=account["wallet_settlement_units"]
  assert abs(math.fsum(pnls)+deposits[0]["settlement_cashflow"]-wallet)<max(1e-6,wallet*1e-9)
  assert abs(s["initial_jpy"]+sum(s["strategy_pnl_jpy"].values())+s["fx_cash_translation_pnl_jpy"]-s["final_equity_jpy"])<1e-5
  proof.append({"variant":variant,"scenario":s["scenario_id"],"trades":len(trades),"depositEvents":len(deposits),"calendarDays":365,"independentAccounting":"PASS","productionGrossBounds":"PASS"})
(ROOT/"independent-verification.json").write_text(json.dumps({"status":"PASS","checks":proof},indent=2)+"\n")
print("INDEPENDENT_LEDGER_VERIFICATION_PASS",len(proof))
