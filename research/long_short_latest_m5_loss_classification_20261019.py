#!/usr/bin/env python3
"""Latest 2026-10-17 8-strategy LONG/SHORT M5 loss classification.
Read-only, not a backtest candidate and not LIVE. BinanceVision M5 normalized
to archived frozen Aster entry prices; 2.5% source mismatch exclusion.
For ambiguous same-candle stop/arm ordering, never infer a within-candle
recoverable exit from high/low; only pre-exit diagnostics.
"""
from __future__ import annotations
import bisect,collections,csv,datetime,functools,hashlib,io,json,statistics,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
LEDGER=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-17_qh_idle_overlay/dot_render_trail/DOT_RENDER_TRAIL_3/10bps/cases/V2_M150_D05_CORE_NATIVE/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl")
ZIPROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/Previous_Projects/idle-exit-deep-research-20261016/bt120_5m_20261017/monthly_zip")
OUT=ROOT/"docs/research/results/long-loss-research-20261019/LATEST_8LOGIC_SIDE_LOSS_M5_CLASSIFICATION_20261019.json"
H=300_000
def load_symbol(sym):
 bars=[]
 for y,m in [(2025,n) for n in range(8,13)]+[(2026,n) for n in range(1,9)]:
  f=ZIPROOT/sym/f"{sym}-5m-{y}-{m:02}.zip"
  if not f.exists():continue
  with zipfile.ZipFile(f) as z:
   with io.TextIOWrapper(z.open(z.namelist()[0]),encoding="utf8") as h:
    for line in h:
     if not line or not line[0].isdigit():continue
     try:
      cells=line.strip().split(",")
      row=(int(cells[0]),float(cells[1]),float(cells[2]),float(cells[3]),float(cells[4]))
      if min(row[1:])>0:bars.append(row)
     except (ValueError,IndexError):continue
 bars.sort(key=lambda r:r[0])
 uniq=[]
 for z in bars:
  if not uniq or z[0]!=uniq[-1][0]:uniq.append(z)
 return uniq,[v[0] for v in uniq]
def xfmt(row):
 return {"symbol":row["symbol"],"family":row.get("family"),"side":row["side"],
   "strategy_id":row["strategy_id"],
   "entry_date_utc":datetime.datetime.fromtimestamp(row["entry_ts_ms"]/1000,datetime.timezone.utc).strftime("%Y-%m-%d"),
   "gross":row["accepted_gross"],"exit_reason":row["exit_reason_actual"]}
def per_trade(tr,bars,times):
 entry=float(tr["entry_price"])
 ts=int(tr["entry_ts_ms"]);te=int(tr["exit_ts_ms"]);sg=1 if tr["side"]=="LONG" else -1
 idx=bisect.bisect_left(times,ts)
 if idx>=len(bars) or times[idx]>ts+H:return {**xfmt(tr),"status":"MISSING_ENTRY5M"}
 first=bars[idx]
 deviation=first[1]/entry-1
 if abs(deviation)>.025:return {**xfmt(tr),"status":"ENTRY_VENUE_MISMATCH","entry_diff_pct":round(100*deviation,3)}
 scale=entry/first[1]
 end=bisect.bisect_left(times,te)
 seg=bars[idx:end]
 if not seg:return {**xfmt(tr),"status":"EMPTY_INTERVAL"}
 favor_high=0;favor_close=0;adverse_high=0;first_exit_idx={}
 tfirst_positive_close=None;tfirst_adverse_1pct=None;tfirst_fav_1pct=None
 gap=False
 for i,(t,op,hi,lo,cl) in enumerate(seg):
  if i>0 and t!=seg[i-1][0]+H:gap=True
  op,hi,lo,cl=(v*scale for v in (op,hi,lo,cl))
  favorable=((hi-entry)/entry if sg==1 else (entry-lo)/entry)
  unfavorable=((entry-lo)/entry if sg==1 else (hi-entry)/entry)
  favorable_close=sg*(cl/entry-1)
  favor_high=max(favor_high,favorable)
  adverse_high=max(adverse_high,unfavorable)
  favor_close=max(favor_close,favorable_close)
  if tfirst_positive_close is None and favorable_close>.0025:tfirst_positive_close=(t-ts)/H
  if tfirst_adverse_1pct is None and unfavorable>=.01:tfirst_adverse_1pct=(t-ts)/H
  if tfirst_fav_1pct is None and favorable_close>=.01:tfirst_fav_1pct=(t-ts)/H
  for th in (.005,.01,.02,.03,.05):
   if favorable_close>=th and th not in first_exit_idx:first_exit_idx[th]=(t-ts)/H
 pnl=float(tr["total_pnl_jpy"])
 asset=float(tr["entry_equity"])
 marked=float(tr["exit_price"])/entry-1
 modeled_gross=sg*marked
 loss=(pnl<0)
 if not loss:kind="WIN_OR_FLAT"
 elif favor_close>=.02:kind="WIN_2PCT_THEN_LOSS"
 elif favor_close>=.01:kind="WIN_1PCT_THEN_LOSS"
 elif favor_close>=.0025:kind="SMALL_WIN_THEN_LOSS"
 else:kind="NEVER_FAVORABLE_CLOSE_0P25_PCT"
 return {**xfmt(tr),"status":"VALID" if not gap else "H1_OR_M5_GAP",
 "kind":kind,"loss":loss,"pnl_settlement_units":pnl,"pnl_over_entry_equity_pct":round(pnl/asset*100,5),
 "max_mfe_m5_high_pct":round(favor_high*100,4),
 "max_mfe_m5_close_pct":round(favor_close*100,4),
 "max_mae_m5_low_pct":round(adverse_high*100,4),
 "end_gross_return_pct":round(modeled_gross*100,4),
 "time_to_fav_close_1pct_h":tfirst_fav_1pct,
 "time_to_adverse_1pct_h":tfirst_adverse_1pct,
 "time_to_fav_close_025pct_h":tfirst_positive_close,
 "bars":len(seg),
 "hold_hours":(te-ts)/3600000,
 "signal_row_original":tr["candidate_id"]}
def summary(rows):
 a=[r for r in rows if r["status"]=="VALID"]
 l=[r for r in a if r["loss"]];w=[r for r in a if not r["loss"]]
 buckets=collections.defaultdict(list)
 for x in l:buckets[x["kind"]].append(x)
 def step(v):
  return {"n":len(v),"sum_loss":round(sum(x["pnl_settlement_units"] for x in v),4),
       "worst_wallet_contribution_pct":round(min((x["pnl_over_entry_equity_pct"] for x in v),default=0),4)}
 return {"trades":len(rows),"valid":len(a),"unusable":len(rows)-len(a),"wins":len(w),"losses":len(l),
  "total_loss_settlement_units":round(sum(x["pnl_settlement_units"] for x in l),4),
  "loss_types":{k:step(v) for k,v in sorted(buckets.items())},
  "top_losers":sorted([{k:x[k] for k in ["symbol","side","entry_date_utc","kind","pnl_settlement_units","pnl_over_entry_equity_pct",
 "max_mfe_m5_close_pct","max_mfe_m5_high_pct","max_mae_m5_low_pct",
 "time_to_adverse_1pct_h","time_to_fav_close_1pct_h"]} for x in l],key=lambda x:x["pnl_settlement_units"])[:7],
  "original_winners_that_dipped_1pct_first":sum(x["time_to_adverse_1pct_h"] is not None and
    (x["time_to_fav_close_1pct_h"] is None or x["time_to_adverse_1pct_h"]<x["time_to_fav_close_1pct_h"]) for x in w)}
def main():
 rows=[json.loads(s) for s in LEDGER.read_text(encoding="utf8").splitlines() if s.strip()]
 assert len(rows)==1310
 bysym=collections.defaultdict(list)
 for r in rows:bysym[r["symbol"]].append(r)
 output=[]
 for j,sym in enumerate(sorted(bysym)):
  bars,times=load_symbol(sym)
  vals=[per_trade(t,bars,times) for t in bysym[sym]]
  output.extend(vals)
  print("SYMBOL",j+1,"of",len(bysym),sym,"rows",len(bysym[sym]),"m5",len(bars),"valid",sum(x["status"]=="VALID" for x in vals),flush=True)
 groups={}
 for st in sorted(set(r["strategy_id"] for r in rows)):
  for side in ["LONG","SHORT"]:
   v=[x for x in output if x["strategy_id"]==st and x["side"]==side]
   if v:groups[st+"_"+side]=summary(v)
 OUT.parent.mkdir(parents=True,exist_ok=True)
 final={"status":"LATEST_20261017_1310_TRADES_M5_LOSS_CLASSIFICATION_RESEARCH_ONLY",
  "ledger_sha256":hashlib.sha256(LEDGER.read_bytes()).hexdigest(),
  "m5_source":str(ZIPROOT),"original_metrics":"2026-10-17 10bps / ¥222818966.878 / maxDD -15.6206368129%",
  "caveats":["BinanceVision historical 5m normalized to Aster H1 frozen entry; not signed actual venue ticks or orders",
  "H1/M5 data gaps omitted and source mismatch>2.5% excluded",
  "Stop-first conservative execution verification not represented in diagnostics",
  "PnL is historical settled outcome including earlier overlays, not hypothetical live profitability"],
  "groups":groups,"trades":output}
 OUT.write_text(json.dumps(final,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print("FINAL",str(OUT),"VALID",sum(x["status"]=="VALID" for x in output),"TOTAL",len(output))
 for st,v in groups.items():
  print("GROUP",st,json.dumps({k:v[k] for k in ["trades","valid","losses","total_loss_settlement_units","loss_types","original_winners_that_dipped_1pct_first"]},ensure_ascii=False))
if __name__=="__main__":main()
