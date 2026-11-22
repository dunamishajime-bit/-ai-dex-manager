#!/usr/bin/env python3
"""P107 read-only comparison of historical STABLE4-research ledger with currently pinned source.
This is an exclusion / incompatibility test, not a full STABLE4 backtest.
Never calls venue, SSH, or production services.
"""
from pathlib import Path
import collections,csv,hashlib,json,sys
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
CURRENT_PIN={
"V4":"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",
"PENGU":"1657e173d250ad58f53e62f7bb0a3428fb405496",
"Q102":"c7310d34ba1b6de07071d8883a2ed0de8dcce2a7",
"V52":"c7310d34ba1b6de07071d8883a2ed0de8dcce2a7",
"HYPE":"e0e4f1d8f22b62e9410188ef6e590a20e31f760f",
"FET":"7688ed7c93a1918d8b44837339b7da5584a868f5",
"IDLE":"7688ed7c93a1918d8b44837339b7da5584a868f5",
}
SCENARIOS=[
"VPS_EFFECTIVE_CURRENT_CANONICAL_PARITY_Q102_ADOPTED_ON_20261111",
"STABLE4_OPPORTUNITY_PROD_CAPS_20261114",
"STABLE4_NORMALGROSS_3P5_V4_475_EXPLORATORY_20261116_V2",
"STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1",
"DD_STUDY_EXIT_INDEPENDENT_STOCK15_TOTAL35_V52_100_20261121",
]
def sha256(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(p):
 with p.open(encoding="utf-8-sig",newline="") as f:
  return list(csv.DictReader(f))
def inspect(case):
 folder=ROOT/case
 if not folder.is_dir():return {"case":case,"state":"MISSING_SCENARIO","parity":False}
 manifest=folder/"RUN_MANIFEST.json"
 if not manifest.is_file():return {"case":case,"state":"MISSING_MANIFEST","parity":False}
 m=json.loads(manifest.read_text(encoding="utf-8-sig"))
 out={"case":case,"manifest_sha256":sha256(manifest),"declared_status":m.get("status"),"period":m.get("period"),"research_caveats":m.get("caveats"),"runs":[],"parity":False}
 for result in sorted(m.get("results",[]),key=lambda a:a.get("cost_bps_roundtrip",0)):
  bps=result["cost_bps_roundtrip"]
  fi=next(folder.glob(f"*_{bps}BPS_FILLS.csv"),None)
  de=next(folder.glob(f"*_{bps}BPS_DECISIONS.csv"),None)
  fu=next(folder.glob(f"*_{bps}BPS_FUNDING.csv"),None)
  if any(f is None for f in [fi,de,fu]):
   out["runs"].append({"bps":bps,"gate":"FAIL_CLOSED_MISSING_TAPES"})
   continue
  fills=rows(fi);decisions=rows(de);fund=rows(fu)
  by_runner=collections.Counter(f.get("strategy") for f in fills)
  sha_by_runner={}
  mismatch_by_runner={}
  reasons_by_runner={}
  missing_sig=0
  signed_true=0
  for f in fills:
   runner=f.get("strategy")
   sh=f.get("source_runtime_sha","")
   if not sh or sh not in ("",):sha_by_runner.setdefault(runner,set()).add(sh)
   if runner in CURRENT_PIN and sh!=CURRENT_PIN[runner]:mismatch_by_runner[runner]=mismatch_by_runner.get(runner,0)+1
   reasons_by_runner.setdefault(runner,collections.Counter())[f.get("exit_model_reason","UNKNOWN")]+=1
   if not f.get("actual_venue_order_id"):missing_sig+=1
   if str(f.get("signed_execution_verified","")).lower() in ("true","yes","1"):signed_true+=1
  decisions_count=collections.Counter(x.get("decision","") for x in decisions)
  blocked_reason=collections.Counter(x.get("reason","") for x in decisions if str(x.get("decision","")).upper() not in ("MODEL_ENTER","ENTER"))
  model_class=collections.Counter(x.get("model_class") for x in fills)
  duration_missing=sum(not x.get("exit_utc") for x in fills)
  summary_count=result.get("modeled_fills")
  suspicious=sorted(set(mismatch_by_runner))
  ctx={
   "bps":bps,
   "manifest_final_jpy":result.get("final_compounded_jpy"),
   "manifest_max_drawdown_pct":result.get("max_hourly_dd_pct"),
   "manifest_win_rate_pct":result.get("win_rate_pct"),
   "manifest_fills":summary_count,
   "observed_fills":len(fills),
   "fills_count_match":len(fills)==summary_count,
   "source_intents":result.get("source_intents"),
   "decisions_rows":len(decisions),
   "decisions_count_by_outcome":dict(decisions_count),
   "modeled_fills_by_runner":dict(sorted(by_runner.items())),
   "manifest_admitted_by_runner":result.get("admitted_by_runner"),
   "distinct_source_sha_by_runner":{k:sorted(v) for k,v in sorted(sha_by_runner.items())},
   "fills_not_matching_VPS_current_pin_by_runner":mismatch_by_runner,
   "runtime_sha_mismatch_runners":suspicious,
   "HYPE_exit_reasons":dict(reasons_by_runner.get("HYPE",{}).most_common(15)),
   "V52_model_classes":dict((k,v) for k,v in model_class.items() if k and ("v" in k.lower() or "proxy" in k.lower())),
   "model_classes":dict(model_class),
   "missing_real_order_id_count":missing_sig,
   "signed_verified_fills_count":signed_true,
   "missing_exit_utc_count":duration_missing,
   "v4_dd21_decision_rows":blocked_reason.get("V4_MAX_DRAWDOWN_21PCT_HOLD",0),
   "v4_dd21_manifest_count":result.get("blocked_by_reason",{}).get("V4_MAX_DRAWDOWN_21PCT_HOLD",0),
   "funding_event_rows":len(fund),
   "ledger_sha256":{q.name:sha256(q) for q in (fi,de,fu)},
   "research_only_not_full_live_pin_parity":True
  }
  out["runs"].append(ctx)
 return out
def main():
 output={"schema":"p107-stable4-full-parity-exclusion-audit/v1","status":"P107_NOT_FULL_PARITY","asof_date":"2026-11-22","period":["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z"],"current_pins_observed_on_VPS":CURRENT_PIN,"scenario_checks":[inspect(s) for s in SCENARIOS],"passing_current_production_exact_entry_exit_fills_shared_risk_gross_h48_dd21":False,"production_changed":False,"orders_sent":0,"required_next_gate":"Full source-native engine on current pinned SHA for all routes, H48 policy proof, exact orders/STOP/Funding/Aster venue model, daily Gross/Shared Risk/HOLD chronological fill replay"}
 OUT.mkdir(parents=True,exist_ok=True)
 target=OUT/"P107_HISTORIC_LEDGER_PIN_INCOMPATIBILITY_AUDIT_20261122.json"
 target.write_text(json.dumps(output,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 for c in output["scenario_checks"]:
  print("CASE",c["case"],"research_only",not c["parity"])
  for z in c.get("runs",[]):
   print(" BPS",z.get("bps"),"fills",z.get("observed_fills"),"count_ok",z.get("fills_count_match"),"SHA_MISMATCH",z.get("fills_not_matching_VPS_current_pin_by_runner"),"signed",z.get("signed_verified_fills_count"),"DD21",z.get("v4_dd21_decision_rows"),"reported_DD21",z.get("v4_dd21_manifest_count"))
 print("AUDIT_JSON",target,"sha256",sha256(target))
if __name__=="__main__":main()

