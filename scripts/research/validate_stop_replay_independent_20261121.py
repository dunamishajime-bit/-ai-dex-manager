#!/usr/bin/env python3
"""Independently validate original and stop-repaired STABLE4 research replays.
No venue access or trading actions. Strict reproducibility and timing checks.
"""
from pathlib import Path
import csv,json,datetime,hashlib,collections,math
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
OUT=Path(__file__).parent
CASES=[
"STABLE4_OPPORTUNITY_PROD_CAPS_20261114",
"STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1",
"DD_STOP_COHERENCE_STOP_ONLY_20261121",
"DD_STOP_COHERENCE_STOP_V52_EXIT_INDEPENDENT_20261121",
"DD_STOP_COHERENCE_STOP_M5_SUFFIX_20261121",
"DD_STOP_COHERENCE_STOP_M5_SUFFIX_V52_EXIT_INDEPENDENT_20261121",
]
def filehash(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for b in iter(lambda:f.read(1<<20),b""):h.update(b)
 return h.hexdigest()
def read_csv(path):
 with path.open(encoding="utf-8-sig",newline="") as f:
  yield from csv.DictReader(f)
def tm(x):return round(datetime.datetime.fromisoformat(x.replace("Z","+00:00")).timestamp()*1000)
start=1759276800000;end=1790812800000
manifest=dict(schema="disdex-stable4-stop-audit-independent-recalc/v1",
  status="RESEARCH_ONLY_NOT_PRODUCTION_PARITY",
  initial_wallet_jpy=10000,
  period_start_inclusive_utc="2025-10-01T00:00:00Z",
  period_end_exclusive_utc="2026-10-01T00:00:00Z",
  equity_30min_name_mismatch="files are named 30MIN but contain 5-minute rows",
  caveats=[
"All executions are modeled and no actual order/fill proof was collected.",
"STOP_REPAIR changes source-model exit times, not live exchange resident STOP or master.",
"HYPE time-only research exits and the missing Q102 pre-August M5 source remain unresolved.",
"V52 future path / capital dependence may worsen DD even if protective exits are restored.",
"Both fee models and genuine independent OOS are required before any deployment."],
  cases={},source_sha256={})
for name in CASES:
 d=R/name;m=d/"RUN_MANIFEST.json"
 assert m.exists(),("MISSING_CASE",name)
 raw=json.loads(m.read_text(encoding="utf-8-sig"))
 record={"cost_models":{}}
 for bps in (10,30):
  r=next(x for x in raw["results"] if int(x["cost_bps_roundtrip"])==bps)
  eq=next(d.glob(f"*_{bps}BPS_EQUITY_30MIN.csv"))
  trades=next(d.glob(f"*_{bps}BPS_FILLS.csv"))
  peak=-float("inf");dd=0.;count=0;last=None;lasttm=None;worst=None
  for row in read_csv(eq):
   t=tm(row["utc"]);e=float(row["compounded_mtm_equity_jpy"])
   assert math.isfinite(e) and e>0,(name,bps,"INVALID_EQUITY",row)
   if count==0:assert t==start and abs(e-10000)<1e-6
   if lasttm is not None:assert t-lasttm==300000,(name,bps,"MISSING_OR_DUPLICATE_M5",lasttm,t)
   count+=1;last=e;lasttm=t
   peak=max(peak,e)
   z=100*(1-e/peak)
   if z>dd:dd=z;worst=row["utc"]
  assert lasttm==end and count==105121,(name,bps,"PERIOD_OR_COUNT",lasttm,count)
  fills=list(read_csv(trades))
  wins=sum(float(z["net_pnl_jpy"])>0 for z in fills)
  good=sum(float(z["net_pnl_jpy"]) for z in fills if float(z["net_pnl_jpy"])>0)
  bad=-sum(float(z["net_pnl_jpy"]) for z in fills if float(z["net_pnl_jpy"])<0)
  assert len(fills)==int(r["modeled_fills"]),(name,bps,"FILL_COUNT")
  assert abs(last-float(r["final_compounded_jpy"]))<1e-5,(name,bps,"FINAL_EQUITY")
  assert abs(dd+float(r["max_hourly_dd_pct"]))<1e-6,(name,bps,"MAX_DD")
  assert abs(100*wins/len(fills)-float(r["win_rate_pct"]))<1e-8,(name,bps,"WIN_RATE")
  assert abs(good/bad-float(r["profit_factor"]))<1e-8,(name,bps,"PF")
  reasons=collections.Counter(z["exit_model_reason"] for z in fills)
  summary=dict(reevaluation_status="PASS",fee_bps=bps,
   equity_rows=count,first_utc="2025-10-01T00:00:00Z",last_utc="2026-10-01T00:00:00Z",
   final_compounded_jpy=last,max_drawdown_pct=dd,dd_trough_utc=worst,
   modeled_fills=len(fills),win_rate_pct=100*wins/len(fills),profit_factor=good/bad,
   risk_stop_corrected_fills=reasons["AUDIT_M5_DECLARED_INITIAL_STOP"],
   delayed_v52_fills=reasons["MISSED_CHECKPOINT_FAIL_CLOSED"],
   exit_reason_counts=dict(reasons),
   runner_fills=dict(collections.Counter(x["strategy"] for x in fills)),
   equity_sha256=filehash(eq),fill_sha256=filehash(trades))
  record["cost_models"][str(bps)]=summary
  print("RECALC_PASS",name,bps,"DD",round(dd,6),"Fills",len(fills),"StopFix",summary["risk_stop_corrected_fills"],"DelayedV52",summary["delayed_v52_fills"],flush=True)
 manifest["cases"][name]=record
for file in ["audit_m5_stop_barriers.py","audit_corrected_stop_portfolio_replay.py","audit_corrected_stop_portfolio_replay_with_suffix.py"]:
 p=OUT/file
 manifest["source_sha256"][file]=filehash(p)
manifest["checks"]={"case_count":len(CASES),"fee_models":2*len(CASES),
                     "all_recalculations":"PASS",
                     "dd20_pass_both_count":sum(max(v["cost_models"]["10"]["max_drawdown_pct"],v["cost_models"]["30"]["max_drawdown_pct"])<=20
                                           for v in manifest["cases"].values())}
out=OUT/"STOP_AUDIT_INDEPENDENT_MANIFEST.json"
out.write_text(json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf-8")
print("SAVED",out,"cases",len(CASES),"dd20_pass_both",manifest["checks"]["dd20_pass_both_count"],flush=True)
