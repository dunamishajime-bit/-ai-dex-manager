#!/usr/bin/env python3
"""RESIDUAL DOGE/AVAX 5m causal exits screening, 10bps + 30bps.

Read exactly SHA-pinned original portfolio trades selected in the 8-strategy
cumulative FET8/4 baseline; report *original integrated* cost economics.
Screen hard stop, delayed low-MFE close, and arm-protect candidates without
claiming these isolated price-delta screens are integrated economic BT.
M5 signal is completed bar close; earliest re-price is next M5 OPEN with
slippage cost. No same-bar high-to-low lookahead, no intrabar venue certification.
"""
from __future__ import annotations
import bisect,collections,datetime,hashlib,importlib.util,json,math,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
M5=300000;H1=3600000
sp=importlib.util.spec_from_file_location("residual_stock_h1_crypto5m_source",HERE/"run-v52-correct-stock-tape-full8-after-fet-20261022.py")
assert sp and sp.loader
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
RULES={
 "DOGE_INITIAL_1H_LOSS2_MFE_LT1":{"symbol":"DOGEUSDT","kind":"early_loss","hours":1,"lossPct":2,"mfeMaxPct":1},
 "DOGE_INITIAL_2H_LOSS1P5_MFE_LT1":{"symbol":"DOGEUSDT","kind":"early_loss","hours":2,"lossPct":1.5,"mfeMaxPct":1},
 "DOGE_INITIAL_2H_LOSS2_MFE_LT1":{"symbol":"DOGEUSDT","kind":"early_loss","hours":2,"lossPct":2,"mfeMaxPct":1},
 "DOGE_INITIAL_2H_LOSS3_MFE_LT1":{"symbol":"DOGEUSDT","kind":"early_loss","hours":2,"lossPct":3,"mfeMaxPct":1},
 "DOGE_PROFIT_ARM2_FLOOR0P5":{"symbol":"DOGEUSDT","kind":"profit","armPct":2,"floorPct":.5},
 "DOGE_PROFIT_ARM3_FLOOR1":{"symbol":"DOGEUSDT","kind":"profit","armPct":3,"floorPct":1},
 "AVAX_INITIAL_2H_LOSS2_MFE_LT1":{"symbol":"AVAXUSDT","kind":"early_loss","hours":2,"lossPct":2,"mfeMaxPct":1},
 "AVAX_PROFIT_ARM2_FLOOR0P5":{"symbol":"AVAXUSDT","kind":"profit","armPct":2,"floorPct":.5},
}
def digest(p):
 h=hashlib.sha256()
 with Path(p).open("rb") as f:
  for c in iter(lambda:f.read(1<<20),b""):h.update(c)
 return h.hexdigest()
def read(p):return json.loads(Path(p).read_text(encoding="utf-8"))
def trade_data(c):
 meta=read(ROOT/"f8v52native/V52_NATIVE_TAPE_FULL8_20261022.json")["cases"]["V52_AFTER_FET84_NO_CHANGE"]["costs"][str(c)]
 candidates=[x for x in (ROOT/"f8v52native/engine").rglob("portfolio-trades.jsonl") if digest(x)==meta["ledgerSha256"]]
 assert candidates
 allrows=[json.loads(s) for s in sorted(candidates,key=str)[0].read_text(encoding="utf-8").splitlines() if s]
 filtered=[x for x in allrows if x["strategy_id"]=="RESIDUAL"]
 assert len(filtered)==(30 if c==10 else 29)
 return filtered
def candidate(row,rule,source,cost,obs):
 if row["strategy_id"]!="RESIDUAL" or row["side"]!="LONG" or row["symbol"]!=rule["symbol"]:
  return None
 e=float(row["entry_price"]);t0=int(row["entry_ts_ms"]);texit=int(row["exit_ts_ms"])
 bars,times=source.getdata(row["symbol"])
 lo=bisect.bisect_left(times,t0);hi=bisect.bisect_left(times,texit)
 if lo>=hi or lo>=len(bars) or times[lo]>t0+M5:
  obs["data_gap"]+=1;return None
 origin=float(bars[lo][1])
 if origin<=0 or abs(origin/e-1)>.025:
  obs["entry_mismatch"]+=1;return None
 scale=e/origin;peak=0.;armed=False
 for j in range(lo,hi):
  ts,op,high,low,close,vol=bars[j]
  if j>lo and ts-times[j-1]!=M5:
   obs["internal_gap"]+=1;return None
  completed=ts+M5
  close=float(close)*scale;high=float(high)*scale;low=float(low)*scale
  if rule["kind"]=="early_loss":
   if completed>=t0+rule["hours"]*H1 and close<=e*(1-rule["lossPct"]/100) and peak<rule["mfeMaxPct"]/100:
    # This is a *completed* M5 close; next bar OPEN is earliest executable price.
    if j+1>=len(bars) or times[j+1]!=completed or completed>=texit:continue
    fill=float(bars[j+1][1])*scale*(1-cost/10000)
    if fill<=0:raise ValueError("NEGATIVE_STOP_PRICE")
    obs["triggers"]+=1
    return {"ts":int(completed),"fill":fill,"reason":"RESEARCH_RESIDUAL_M5_CLOSE_EARLYLOSS_NEXT_OPEN",
      "threshold":rule["lossPct"],"mfePctBeforeTrigger":100*peak,
      "completedM5barTs":int(completed),"gapFillVsTriggerClosePct":100*(fill/close-1)}
  elif rule["kind"]=="profit":
   if armed and low<=e*(1+rule["floorPct"]/100):
    # Avoid high-before-low same-candle: previous bar armed and this M5 low triggers,
    # but executing at next M5 open is conservative under uncertain intrabar order.
    if j+1<len(bars) and times[j+1]==completed and completed<texit:
     fill=float(bars[j+1][1])*scale*(1-cost/10000)
     obs["triggers"]+=1
     return {"ts":int(completed),"fill":fill,"reason":"RESEARCH_RESIDUAL_PROFIT_ARMED_PREVIOUS_M5_NEXT_OPEN",
       "mfePctBeforeTrigger":100*peak,"floorPct":rule["floorPct"],
       "completedM5barTs":int(completed),"gapFillVsTriggerClosePct":100*(fill/close-1)}
  peak=max(peak,(high/e-1))
  if rule["kind"]=="profit" and (close/e-1)>=rule["armPct"]/100:
   armed=True
 return None

def main():
 m.m.acquire_verified_h1()
 source,helper=m.m.m.core.task8.legacy.bootstrap()
 reports={"schema":"residual-exit-m5-screen-after-hype-idle-fet-v52native-v1",
  "scope":"research_screen_only_not_economic_full8",
  "period":"2025-08-10..2026-08-10",
  "sourceData":"Verified crypto market causal M5 getdata of previously loaded frozen engine, 114048 bars per symbol",
  "candidateFillModel":"confirmed M5 close/high at preceding bar; next M5 open minus round-trip stress bps, NEVER same bar future",
  "rules":RULES,"costs":{}}
 for cost in (10,30):
  rows=trade_data(cost)
  out={}
  for name,rule in RULES.items():
   obs=collections.Counter()
   changed=[];losers=0;winners=0;improved=0;worsened=0;totalpct=0.
   for x in rows:
    if x["symbol"]!=rule["symbol"]:continue
    result=candidate(x,rule,source,cost,obs)
    if result is None:continue
    # approximate original economics, not recomputed wallet.
    sign=1;delta=(result["fill"]-x["exit_price"])*float(x["quantity"])/float(x["entry_equity"])
    if x["total_pnl_jpy"]>0:winners+=1
    else:losers+=1
    if delta>0:improved+=1
    else:worsened+=1
    totalpct+=100*delta
    changed.append({"candidateId":x["candidate_id"],"symbol":x["symbol"],"route":x["route"],
      "side":x["side"],"originalExit":x["exit_reason_actual"],
      "originalTotalWalletPct":100*x["total_pnl_jpy"]/x["entry_equity"],
      "originalModeledContributionJpy":x["modeled_realized_pnl_jpy_at_exit_fx"],
      "originalExitPrice":x["exit_price"],"newExitPrice":result["fill"],
      "deltaWalletPctApprox":100*delta,**result})
   out[name]={
    "qualifyingOriginalSymbolTrades":sum(x["symbol"]==rule["symbol"] for x in rows),
    "changedTrades":len(changed),"originalWinnersChanged":winners,
    "originalLosersChanged":losers,"improved":improved,"worsened":worsened,
    "sumOriginalWalletReturnDeltaPctApprox":totalpct,
    "screenOnlyEvents":changed,"obs":dict(obs)}
   print("RESIDUAL_SCREEN",cost,name,"CHANGED",len(changed),"W",winners,"L",losers,
     "BETTER",improved,"WORSE",worsened,"SUM_ROI_DELTA",round(totalpct,3),
      "GAP",obs["data_gap"],obs["entry_mismatch"],obs["internal_gap"],flush=True)
  reports["costs"][str(cost)]=out
 target=REPO/"docs/research/results/residual-after-v52amzn-20261023"
 target.mkdir(parents=True,exist_ok=True)
 (target/"RESIDUAL_M5_EARLY_EXIT_SCREEN_20261023.json").write_text(json.dumps(reports,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("RESIDUAL_M5_SCREEN_COMPLETE",len(RULES),"X2_COSTS",flush=True)
if __name__=="__main__":main()
