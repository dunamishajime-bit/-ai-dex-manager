#!/usr/bin/env python3
"""Offline STABLE4 exit-replay audit: recompute equity DD and fills against manifests.
No orders, no production changes, no auth/secret reads. Windows research root only.
"""
from pathlib import Path
import hashlib,csv,math,json,datetime
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUTPUT=Path.home()/"Documents"/"DisDex_Research"/"DD_H48_GROSS_V52_V4_20261121"
CASE_MAP={
 "BASE_H48_CAPS":"STABLE4_OPPORTUNITY_PROD_CAPS_20261114",
 "BASE_GROSS425":"STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1",
 "BASE_GROSS350":"STABLE4_NORMALGROSS_3P5_V4_475_EXPLORATORY_20261116_V2",
 "V4_RECOVER_20_15":"DD_STUDY_V4_TRIP20_RECOVER15_G425_20261121",
 "V52_CAP48_MODEL_ONLY":"DD_STUDY_V52_CAP48_G425_V4_LATCH21_20261121",
 "V52_EXIT_INDEPENDENT":"DD_STUDY_V52_DUE_EXIT_INDEPENDENT_G425_V4_LATCH21_20261121",
 "V52_EXIT_AND_REARM":"DD_STUDY_V52_DUE_EXIT_INDEPENDENT_G425_V4_REARM20_15_20261121",
 "SAFEGROSS_V52_100":"DD_STUDY_EXIT_INDEPENDENT_STOCK15_TOTAL35_V52_100_20261121",
 "SAFEGROSS_V52_125":"DD_STUDY_EXIT_INDEPENDENT_STOCK15_TOTAL35_V52_125_20261121",
 "SAFEGROSS_V52_150":"DD_STUDY_EXIT_INDEPENDENT_STOCK15_TOTAL35_V52_150_20261121",
 "Q102_STOP3":"DD_STUDY_Q102_CAUSAL_STOP3_V52_EXIT_LATCH21_20261121",
 "Q102_STOP4":"DD_STUDY_Q102_CAUSAL_STOP4_V52_EXIT_LATCH21_20261121",
 "Q102_STOP5":"DD_STUDY_Q102_CAUSAL_STOP5_V52_EXIT_LATCH21_20261121",
 "Q102_STOP3_REARM":"DD_STUDY_Q102_CAUSAL_STOP3_V52_EXIT_REARM20_15_20261121",
 "Q102_STOP3_IDLE_STOP3":"DD_STUDY_Q102_STOP3_IDLE_STOP3_V52_EXIT_LATCH21_20261121",
 "Q102_STOP3_IDLE_STOP4":"DD_STUDY_Q102_STOP3_IDLE_STOP4_V52_EXIT_LATCH21_20261121",
 "Q102_STOP3_IDLE_STOP5":"DD_STUDY_Q102_STOP3_IDLE_STOP5_V52_EXIT_LATCH21_20261121",
 "Q102_STOP3_IDLE_STOP3_REARM":"DD_STUDY_Q102_STOP3_IDLE_STOP3_V52_EXIT_REARM20_15_20261121",
 "Q102_STOP3_V4_TRAIL4_2":"DD_STUDY_Q102_STOP3_V4_TRAIL4_20_V52_EXIT_LATCH21_20261121",
 "Q102_STOP3_V4_TRAIL5_3":"DD_STUDY_Q102_STOP3_V4_TRAIL5_30_V52_EXIT_LATCH21_20261121",
 "V4_TRAIL4_2_Q102_CONTROL":"DD_STUDY_Q102_STOP100_V4_TRAIL4_20_V52_EXIT_LATCH21_20261121",
}
START="2025-10-01T00:00:00Z"
END="2026-10-01T00:00:00Z"
EXPECTED_ROWS=105121
def sha(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for b in iter(lambda:f.read(1048576),b""):h.update(b)
 return h.hexdigest()
def load_rows(path):
 with path.open(encoding="utf-8-sig",newline="") as f:
  for row in csv.DictReader(f):yield row
def read_one(directory,fee,manifestrow):
 eq_files=list(directory.glob(f"*_{fee}BPS_EQUITY_30MIN.csv"))
 fill_files=list(directory.glob(f"*_{fee}BPS_FILLS.csv"))
 dec_files=list(directory.glob(f"*_{fee}BPS_DECISIONS.csv"))
 assert len(eq_files)==len(fill_files)==len(dec_files)==1,(directory,fee,"UNIQUE_SOURCE_REQUIRED")
 ep,fp,dp=eq_files[0],fill_files[0],dec_files[0]
 peak=10000.;mdd=0.;ddts=None;low=None;bestpeak=None;last=None;cnt=0;prior=None
 for z in load_rows(ep):
  tt=z["utc"];v=float(z["compounded_mtm_equity_jpy"])
  assert math.isfinite(v) and v>0,(directory,"INVALID_EQUITY",tt,v)
  if prior is None:assert tt==START,(directory,tt)
  else:
   assert tt>prior
   p=datetime.datetime.fromisoformat(prior.replace("Z","+00:00"))
   t=datetime.datetime.fromisoformat(tt.replace("Z","+00:00"))
   assert (t-p).total_seconds()==300,(directory,prior,tt)
  prior=tt;cnt+=1
  peak=max(peak,v);dd=100*(v/peak-1)
  if dd<mdd:mdd=dd;ddts=tt;low=v;bestpeak=peak
  last=v
 assert prior==END and cnt==EXPECTED_ROWS,(directory,prior,cnt)
 fillings=0;winners=0;nettotal=0.;verified=0
 for z in load_rows(fp):
  fillings+=1;net=float(z["net_pnl_jpy"]);nettotal+=net
  winners+=int(net>0)
  assert z["entry_utc"]<z["exit_utc"],("INVALID_FILL_TIME",directory,z["trade_id"])
  verified+=int(z.get("signed_execution_verified","").strip().lower()=="true")
 assert verified==0,("UNEXPECTED_ACTUAL_EXECUTION_MARK",directory,fee)
 v4admit=0;v4blocked=0
 for z in load_rows(dp):
  if z["strategy"]=="V4":
   if z["decision"]=="MODEL_ENTER":v4admit+=1
   if z["reason"]=="V4_MAX_DRAWDOWN_21PCT_HOLD":v4blocked+=1
 assert fillings==manifestrow["modeled_fills"],(directory,fee,"FILL_MISMATCH")
 assert abs(mdd-manifestrow["max_hourly_dd_pct"])<1e-6,(directory,fee,"DD_MISMATCH")
 assert abs(last-manifestrow["final_compounded_jpy"])<.011,(directory,fee,"WALLET_MISMATCH")
 assert abs(100*winners/fillings-manifestrow["win_rate_pct"])<1e-4,(directory,fee,"WIN_MISMATCH")
 assert v4blocked==manifestrow["blocked_by_reason"].get("V4_MAX_DRAWDOWN_21PCT_HOLD",0)
 return {"cost_bps":fee,"max_dd_pct":round(mdd,7),"peak_before_trough_jpy":round(bestpeak or 0,2),
 "trough_jpy":round(low or 0,2),"trough_utc":ddts,
 "final_equity_jpy":round(last,2),"modeled_fills":fillings,"win_rate_pct":round(100*winners/fillings,5),
 "v4_admits":v4admit,"v4_dd21_blocks":v4blocked,"v52_daily_trips":manifestrow["v52_daily_trip_count"],
 "v52_due_exit_deferrals":manifestrow["v52_deferred_exit_count"],"equity_rows":cnt,
 "mdd_le_20_pct":mdd>=-20.0,"signed_venue_fills":0,
 "equity_sha256":sha(ep),"fills_sha256":sha(fp),"decisions_sha256":sha(dp),
 "recomputation":"PASS"}
def main():
 data={"schema":"disdex-stable4-exit-risk-21-case-audit/v1",
 "scope":{"window":"2025-10-01T00:00Z to 2026-10-01T00:00Z (exclusive)", "initial_jpy":10000,
 "cost_models":[10,30],"min_equity_rows":EXPECTED_ROWS,
 "research_only":True,"production_pin_parity_proven":False,
 "current_hype_production_parity_proven":False,
 "out_of_sample_certified":False,"orders_sent":0},
 "sources":{},"cases":{}}
 src=ROOT/"DIRECTION_RESEARCH_20261109"/"STABLE3_REPRO_RECOVERED_20261113"
 for f in (src/"canonical_generated_sim_ON_20261113.py",src/"portfolio_stable4_gross425_v4_475_l3_q102_h48_20261116.py",
           OUTPUT/"research_q102_causal_stop_replay_20261121.py",
           OUTPUT/"research_q102_idle_causal_stop_replay_20261121.py",
           OUTPUT/"research_q102_v4_causal_trail_replay_20261121.py"):
  data["sources"][f.name]={"sha256":sha(f),"path":str(f)}
 for k,dname in CASE_MAP.items():
  directory=ROOT/dname
  m=directory/"RUN_MANIFEST.json"
  assert m.exists(),("MISSING_MANIFEST",k)
  values=json.loads(m.read_text(encoding="utf-8-sig"))
  assert len(values["results"])==2,(k,"MODEL_COSTS_MISSING")
  fee_results={}
  for fee in (10,30):
   row=next(x for x in values["results"] if x["cost_bps_roundtrip"]==fee)
   fee_results[str(fee)]=read_one(directory,fee,row)
  data["cases"][k]={"source_directory":str(directory),"run_manifest_sha256":sha(m),"cost_models":fee_results}
  print("RECALC_PASS",k,"10bps",fee_results["10"]["max_dd_pct"],
        "30bps",fee_results["30"]["max_dd_pct"],flush=True)
 assert len(data["cases"])==21
 data["checks"]={"case_count":len(data["cases"]),"fee_case_count":42,
                 "each_equity_sample_count":EXPECTED_ROWS,"all_recalculations":"PASS",
                 "cases_passing_20pct_both":sum(x["cost_models"]["10"]["mdd_le_20_pct"] and x["cost_models"]["30"]["mdd_le_20_pct"] for x in data["cases"].values())}
 OUTPUT.mkdir(parents=True,exist_ok=True)
 out=OUTPUT/"exit_improvement_audit.json"
 out.write_text(json.dumps(data,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
 print("VALIDATION_COMPLETE",out,"AUDIT_SHA256",sha(out),data["checks"],flush=True)
if __name__=="__main__":main()
