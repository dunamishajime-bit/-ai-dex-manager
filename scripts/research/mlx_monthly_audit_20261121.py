#!/usr/bin/env python3
"""Offline calendar-level robustness ledger for predeclared DisDex STABLE4 replays.
Full-year runs are NOT independent OOS. Segmentations are diagnostic only.
"""
import csv,json,datetime,statistics,collections,math,hashlib
from pathlib import Path
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
P=Path(__file__).parent
P.mkdir(parents=True,exist_ok=True)
CASE_NAMES=[
"DD_STUDY_V52_DUE_EXIT_INDEPENDENT_G425_V4_LATCH21_20261121",
"DD_MLX_COHERENT_CONTROL_20261121",
"DD_MLX_COHERENT_ATR_ONLY_20261121",
"DD_MLX_COHERENT_FULL_LAYER_20261121",
"DD_MLX_COHERENT_RISK_SIZED_20261121",
"DD_MLX_COHERENT_PORTFOLIO_SIZED_20261121",
"DD_MLX_ABLATION_Q102_ONLY_20261121",
"DD_MLX_ABLATION_V4_ONLY_20261121",
"DD_MLX_ABLATION_IDLE_ONLY_20261121",
"DD_MLX_ABLATION_PENGU_ONLY_20261121",
"DD_MLX_ABLATION_FET_ONLY_20261121",
"DD_MLX_ABLATION_NO_V4_20261121",
]
def load(path):
 with path.open("r",encoding="utf-8-sig",newline="") as f:yield from csv.DictReader(f)
def sha(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for c in iter(lambda:f.read(1048576),b""):h.update(c)
 return h.hexdigest()
def months(folder,bps):
 eq=next(folder.glob(f"*{bps}BPS_EQUITY_30MIN.csv"))
 ft=next(folder.glob(f"*{bps}BPS_FILLS.csv"))
 groups={}
 for row in load(eq):
  mon=row["utc"][:7];x=float(row["compounded_mtm_equity_jpy"])
  g=groups.setdefault(mon,dict(start=x,end=x,peak=x,dd=0.,rows=0,worst_time=None))
  g["end"]=x;g["peak"]=max(g["peak"],x)
  dd=100*(x/g["peak"]-1)
  if dd<g["dd"]:g["dd"]=dd;g["worst_time"]=row["utc"]
  g["rows"]+=1
 stats={}
 byrun=collections.defaultdict(lambda:collections.Counter())
 lossby=collections.defaultdict(list)
 for row in load(ft):
  strategy=row["strategy"];net=float(row["net_pnl_jpy"])
  c=byrun[strategy];c["fills"]+=1;c["wins"]+=int(net>0)
  c["net_jpy"]+=net
  if net<0:lossby[strategy].append(net)
 out_month=[]
 for mon in sorted(groups):
  x=groups[mon]
  out_month.append(dict(month=mon,month_return_pct=100*(x["end"]/x["start"]-1),
   month_mtm_maxdd_pct=x["dd"],worst_time=x["worst_time"],samples=x["rows"]))
 for name,c in byrun.items():
  bad=sorted(lossby[name])
  stats[name]=dict(fills=c["fills"],win_rate_pct=100*c["wins"]/c["fills"],
   total_jpy=c["net_jpy"],negative_trades=len(bad),
   worst_loss_jpy=bad[0] if bad else 0,
   average_of_worst_5pct_losses_jpy=statistics.mean(bad[:max(1,len(bad)//20)]) if bad else 0)
 return {"monthly":out_month,"runner":stats,"equity_sha256":sha(eq),"fills_sha256":sha(ft)}
report=dict(schema="disdex-mlx-monthly-diagnostic/v1",
 notes=["The comparisons are not out of sample (same known Oct-2025 to Sep-2026 period).",
        "Monthly drawdown is reset using month-first equity, not portfolio all-time high.",
        "Absolute JPY trading P&L is path-dependent under compound sizing.",
        "All model fills are hypothetical and not exchange-executed."],cases={})
for name in CASE_NAMES:
 d=R/name
 if not (d/"RUN_MANIFEST.json").exists():
  print("MISSING_CASE",name,flush=True)
  continue
 result=json.loads((d/"RUN_MANIFEST.json").read_text(encoding="utf-8-sig"))
 obj={}
 for b in (10,30):
  z=next(x for x in result["results"] if x["cost_bps_roundtrip"]==b)
  obj[str(b)]=months(d,b)
  obj[str(b)]["max_portfolio_dd_pct"]=z["max_hourly_dd_pct"]
  obj[str(b)]["final_equity_jpy"]=z["final_compounded_jpy"]
 report["cases"][name]=obj
 print("ANALYZED",name,flush=True)
out=P/"MLX_MONTHLY_RISK_ATTRIBUTION.json"
out.write_text(json.dumps(report,ensure_ascii=False,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf8")
print("SAVED",out,"CASES",len(report["cases"]),flush=True)
