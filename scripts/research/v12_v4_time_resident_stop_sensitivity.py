from __future__ import annotations
import json,math,hashlib,os
from pathlib import Path
from collections import defaultdict,Counter
ROOT=Path(__file__).resolve().parents[2]
MARKET=Path(os.environ.get("DISDEX_MARKET_KLINES",r"C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\market-Aster-H1-funding-and-manifests\normalized\aster\klines"))
BASE=ROOT/"docs/research/results/v4-production-cert-20261009/bt-baseline/cases/V2_M150_D05_CORE_NATIVE/runs"
CATALOG=ROOT/"docs/research/results/v4-production-cert-20261009/exact-production-exit-catalog.json"
OUT=ROOT/"docs/research/results/v4-time-stop-sensitivity-20261010"
H=3600000
def rows(path):
 with path.open(encoding="utf-8") as f:
  for l in f:
   if l.strip():yield json.loads(l)
def load_bars(symbols):
 out={}
 for sym in sorted(symbols):
  f=MARKET/f"{sym}.jsonl"
  if not f.exists():raise RuntimeError("MISSING_CANONICAL_H1:"+sym)
  data={int(z["event_time_ms"]):z for z in rows(f)}
  out[sym]=data
 return out
def atr14(bars,entry):
 # only 14 fully completed H1 bars strictly preceding the entry opening.
 previous=[bars.get(entry-j*H) for j in range(15,0,-1)]
 if any(v is None for v in previous):return None
 tr=[]
 for i in range(1,15):
  b=previous[i]
  pc=float(previous[i-1]["close"])
  high=float(b["high"]);low=float(b["low"])
  tr.append(max(high-low,abs(high-pc),abs(low-pc)))
 return sum(tr)/len(tr)
def scenarios(entry,atr):
 return {
  "none":None,
  **{f"fixed_{p}pct":entry*p/100 for p in (4,6,8,10,12,15,20)},
  **{f"atr_{k}x":atr*k for k in (2.5,4,6,8,10) },
  "max_8pct_4atr":max(entry*.08,atr*4),
  "max_12pct_6atr":max(entry*.12,atr*6),
  "max_15pct_8atr":max(entry*.15,atr*8),
 }
def simulate(trade,bars,dist):
 if dist is None:return None
 qty=float(trade["quantity"]);entry=float(trade["entry_price"])
 side=trade["side"];sg=1 if side=="LONG" else -1
 stop=entry-sg*dist
 if stop<=0:return None
 begin=int(trade["entry_ts_ms"]);end=int(trade["exit_ts_ms"])
 if end<=begin or (end-begin)%H:raise RuntimeError("NONHOURLY_TRADE_"+str(trade["position_id"]))
 for ts in range(begin,end,H):
  b=bars.get(ts)
  if b is None:raise RuntimeError("MISSING_H1_BAR_"+trade["symbol"]+"_"+str(ts))
  if float(b["low"])<=stop if sg==1 else float(b["high"])>=stop:
   op=float(b["open"])
   price=min(op,stop) if sg==1 else max(op,stop)
   # identical to historical price-only H1 adverse gap convention
   fee_fraction=float(trade["exit_fee"])/(qty*float(trade["exit_price"]))
   pnl_delta=qty*sg*(price-float(trade["exit_price"]))-fee_fraction*qty*(price-float(trade["exit_price"]))
   return dict(ts=ts+H,price=price,pnl_delta=pnl_delta)
 return None
def stats(vals):
 winners=sum(v for v in vals if v>0);losers=-sum(v for v in vals if v<0)
 return dict(n=len(vals),wins=sum(v>0 for v in vals),losses=sum(v<0 for v in vals),
  pf=winners/losers if losers else None,net_usd=sum(vals),
  win_rate=sum(v>0 for v in vals)/len(vals) if vals else None)
def evaluate(cost):
 path=BASE/f"PRICE_MODEL_{cost}BPS"/"portfolio-trades.jsonl"
 trades=list(rows(path))
 catalog={x["route"]:x["spec"] for x in json.loads(CATALOG.read_text(encoding="utf-8"))}
 target=[t for t in trades if t["strategy_id"]=="V12" and catalog[t["route"]]["kind"]=="TIME"]
 bars=load_bars({t["symbol"] for t in target})
 at_map={(symbol,t):atr14(sb,t) for symbol,sb in bars.items() for t in
  {int(x["entry_ts_ms"]) for x in target if x["symbol"]==symbol}}
 invalid=sum(at_map[(t["symbol"],int(t["entry_ts_ms"]))] is None for t in target)
 if invalid:raise RuntimeError(f"INSUFFICIENT_H1_ENTRY_ATR:{invalid}")
 baselines={int(t["position_id"]):float(t["total_pnl_jpy"]) for t in target}
 labels=list(scenarios(100,1))
 result=[]
 details=[]
 for label in labels:
  vals=[];triggered=0;improved=0;worsened=0;delta=0
  perroute=defaultdict(lambda:dict(trades=0,triggered=0,pnl_delta_usd=0))
  for t in target:
   original=float(t["total_pnl_jpy"]);atr=at_map[(t["symbol"],int(t["entry_ts_ms"]))]
   cutoff=scenarios(float(t["entry_price"]),atr)[label]
   sim=simulate(t,bars[t["symbol"]],cutoff)
   new=original+(sim["pnl_delta"] if sim else 0)
   vals.append(new)
   row=perroute[t["route"]];row["trades"]+=1
   if sim:
    triggered+=1;delta+=sim["pnl_delta"];row["triggered"]+=1;row["pnl_delta_usd"]+=sim["pnl_delta"]
    if sim["pnl_delta"]>0:improved+=1
    if sim["pnl_delta"]<0:worsened+=1
    if cost==10 and label in ("fixed_8pct","fixed_12pct","atr_4x","max_12pct_6atr"):
     details.append(dict(policy=label,position_id=t["position_id"],route=t["route"],symbol=t["symbol"],
      entry_ts_ms=t["entry_ts_ms"],original_exit_ts_ms=t["exit_ts_ms"],emergency_exit_ts_ms=sim["ts"],
      old_exit_price=t["exit_price"],stop_exit_price=sim["price"],net_delta_usd=sim["pnl_delta"]))
  result.append(dict(policy=label,total_time_trades=len(target),triggered=triggered,
   unchanged=len(target)-triggered,improved=improved,worsened=worsened,
   delta_usd=delta,**stats(vals),routes=perroute))
 return dict(cost_bps=cost,base_all_trades=len(trades),base_v12_trades=sum(t["strategy_id"]=="V12" for t in trades),
  base_time_trades=len(target),baseline_fixed_cohort=stats(list(baselines.values())),
  policies=result),details
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 results=[];details=[]
 for cost in (10,20,30):
  r,d=evaluate(cost);results.append(r);details.extend(d)
  print("COST",cost,"N_TIME",r["base_time_trades"],
   "COMPARISON",[(x["policy"],x["triggered"],round(x["delta_usd"],3)) for x in r["policies"]],flush=True)
 (OUT/"policy-comparison.json").write_text(json.dumps(results,indent=2),encoding="utf-8")
 with (OUT/"affected-trades.jsonl").open("w",encoding="utf-8") as f:
  for d in details:f.write(json.dumps(d,sort_keys=True)+"\n")
 (OUT/"methodology.json").write_text(json.dumps({
  "status":"FIXED_ACCEPTED_COHORT_H1_COUNTERFACTUAL_NOT_PORTFOLIO_REPLAY",
  "period":"2025-08-10 to 2026-08-10",
  "canonical_market_root":str(MARKET),
  "entry_and_exit_original":"unchanged accepted V12 TIME trades in selected V4 10/20/30bps trade ledger",
  "stop_timing":"H1 high/low from entry until original exit (exclusive); intrabar stop assumed triggered if touched",
  "stop_fill":"adverse gap: LONG min(open,stop), SHORT max(open,stop)",
  "atr_source":"ATR14 simple True Range from 14 H1 completed bars strictly before entry",
  "fee":"original exit fee fraction applied to stop-price difference",
  "funding":"baseline unchanged; not certified for altered funding settlement",
  "warnings":["fixed original accepted trades (no compounding/re-admission/reallocation)",
   "not real historical intrabar fills; no tick/orderbook/slippage proof",
   "no reflow of other strategies or DD; do not infer integrated final equity or DD",
   "treat as policy sensitivity only; live resident STOP requires explicit contract approval"]
 },indent=2),encoding="utf-8")
 print("OUTPUT",OUT)
if __name__=="__main__":main()
