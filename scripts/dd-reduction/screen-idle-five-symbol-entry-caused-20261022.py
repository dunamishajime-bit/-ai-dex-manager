#!/usr/bin/env python3
"""Causal completed-5m entry features and within-sample / temporal validation for IDLE SHORT."""
from __future__ import annotations
import bisect,collections,hashlib,importlib.util,json,math,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
OUT=ROOT/"five5"
OUT.mkdir(exist_ok=True)
M5=300000
SYMS=("RENDERUSDT","TAOUSDT","DOTUSDT","JUPUSDT","TIAUSDT")
CANDIDATES=[
 ("BTC3H_LE0",{"feat":"btc3h","op":"le","threshold":0}),
 ("BTC3H_LE_MINUS0P5",{"feat":"btc3h","op":"le","threshold":-.5}),
 ("BTC3H_GE_MINUS0P5",{"feat":"btc3h","op":"ge","threshold":-.5}),
 ("BTC6H_LE0",{"feat":"btc6h","op":"le","threshold":0}),
 ("REL1H_LE0",{"feat":"rel1h","op":"le","threshold":0}),
 ("REL1H_LE_MINUS0P5",{"feat":"rel1h","op":"le","threshold":-.5}),
 ("REL3H_LE0",{"feat":"rel3h","op":"le","threshold":0}),
 ("REL3H_LE_MINUS0P5",{"feat":"rel3h","op":"le","threshold":-.5}),
 ("REL3H_LE_MINUS1",{"feat":"rel3h","op":"le","threshold":-1}),
 ("REL3H_GE_MINUS1",{"feat":"rel3h","op":"ge","threshold":-1}),
 ("REL6H_LE0",{"feat":"rel6h","op":"le","threshold":0}),
 ("REL6H_LE_MINUS1",{"feat":"rel6h","op":"le","threshold":-1}),
 ("RET1H_LE0",{"feat":"ret1h","op":"le","threshold":0}),
 ("RET1H_LE_MINUS1",{"feat":"ret1h","op":"le","threshold":-1}),
 ("RET1H_GE_MINUS1",{"feat":"ret1h","op":"ge","threshold":-1}),
 ("RET3H_LE0",{"feat":"ret3h","op":"le","threshold":0}),
 ("RET3H_LE_MINUS1",{"feat":"ret3h","op":"le","threshold":-1}),
 ("RET3H_GE_MINUS3",{"feat":"ret3h","op":"ge","threshold":-3}),
 ("RET6H_LE0",{"feat":"ret6h","op":"le","threshold":0}),
 ("RET6H_LE_MINUS2",{"feat":"ret6h","op":"le","threshold":-2}),
 ("RET6H_GE_MINUS4",{"feat":"ret6h","op":"ge","threshold":-4}),
 ("RET12H_LE0",{"feat":"ret12h","op":"le","threshold":0}),
 ("RET12H_GE_MINUS5",{"feat":"ret12h","op":"ge","threshold":-5}),
 ("RET24H_LE0",{"feat":"ret24h","op":"le","threshold":0}),
 ("RET24H_GE_MINUS7",{"feat":"ret24h","op":"ge","threshold":-7}),
 ("VOLUME1H_GE1P2",{"feat":"volratio","op":"ge","threshold":1.2}),
 ("VOLUME1H_LE1",{"feat":"volratio","op":"le","threshold":1}),
 ("ATR3H_LE1P5",{"feat":"atr3h","op":"le","threshold":1.5}),
 ("ATR3H_GE1P5",{"feat":"atr3h","op":"ge","threshold":1.5}),
 ("RECENTHIGH3H_LE0P4",{"feat":"rangepos3h","op":"le","threshold":.4}),
 ("RECENTHIGH3H_GE0P6",{"feat":"rangepos3h","op":"ge","threshold":.6}),
 ("REL6H_GE_MINUS2",{"feat":"rel6h","op":"ge","threshold":-2}),
 ("RET6H_GE_MINUS2P5",{"feat":"ret6h","op":"ge","threshold":-2.5}),
 ("RET3H_GE_MINUS1",{"feat":"ret3h","op":"ge","threshold":-1}),
 ("ATR3H_LE0P45",{"feat":"atr3h","op":"le","threshold":.45}),
]
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file)
 assert spec and spec.loader
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 return m
hype=load("hype_cumulative_anchor","run-hype-gated-protection-20261022.py")
core=hype.core
def jsonl(p):
 with Path(p).open(encoding="utf-8") as f:return [json.loads(line) for line in f if line.strip()]
def accepted(cost):
 j=json.loads((ROOT/"adopted_3p1p5_plus_1h_initial"/"HYPE_GATED_PROTECTION_FULL8_20261022.json").read_text(encoding="utf-8"))
 x=j["results"]["COMBO_I1H1_P3F1P5"]["costs"][str(cost)]
 name=f'HYPE_GATED_PROTECTION_COMBO_I1H1_P3F1P5_C{cost}_I{x["replayPasses"][-1]["iteration"]}'
 slug="cmp_"+hashlib.sha256(name.encode()).hexdigest()[:12]
 f=ROOT/"adopted_3p1p5_plus_1h_initial"/"engine"/slug/slug/f"{cost}bps"/"cases"/"V2_M150_D05_CORE_NATIVE"/"runs"/f"PRICE_MODEL_{cost}BPS"/"portfolio-trades.jsonl"
 return [r for r in jsonl(f) if r.get("strategy_id")=="IDLE" and r.get("side")=="SHORT"],f
CACHE={}
def get_feat(source,sym,ts):
 key=(sym,ts)
 if key in CACHE:return CACHE[key]
 ts=int(ts)
 result={}
 for ticker in (sym,"BTCUSDT"):
  bars,times=source.getdata(ticker)
  i=bisect.bisect_left(times,ts)-1
  if i<288 or times[i]+M5>ts:
   CACHE[key]=None;return None
  prices={};valid=True
  for n in (0,12,36,72,144,288):
   if times[i]-times[i-n]!=n*M5:
    valid=False;break
   v=float(bars[i-n][4])
   if not math.isfinite(v) or v<=0:valid=False;break
   prices[n]=v
  if not valid:
   CACHE[key]=None;return None
  for n,h in ((12,"1h"),(36,"3h"),(72,"6h"),(144,"12h"),(288,"24h")):
   result[("btc" if ticker=="BTCUSDT" else "ret")+h]=100*(prices[0]/prices[n]-1)
  if ticker==sym:
   w=bars[i-36:i+1];hi=max(float(r[2]) for r in w);lo=min(float(r[3]) for r in w)
   result["atr3h"]=100*sum((float(r[2])-float(r[3]))/float(r[4]) for r in w[-36:])/36
   result["rangepos3h"]=(prices[0]-lo)/(hi-lo) if hi>lo else .5
   prev=bars[i-83:i-11];last=bars[i-11:i+1]
   result["volratio"]=(sum(float(r[5]) for r in last)/len(last))/(sum(float(r[5]) for r in prev)/len(prev)) if sum(float(r[5]) for r in prev)>0 else None
 for h in ("1h","3h","6h","12h","24h"):result["rel"+h]=result["ret"+h]-result["btc"+h]
 CACHE[key]=result
 return result
def passes(feat,rule):
 x=feat.get(rule["feat"]) if feat else None
 if x is None or not math.isfinite(x):return False
 return x<=rule["threshold"] if rule["op"]=="le" else x>=rule["threshold"]
def measure(rows):
 if not rows:return {"n":0}
 w=[r for r in rows if r["win"]];l=[r for r in rows if not r["win"]]
 return {"n":len(rows),"wins":len(w),"losses":len(l),"winRate":round(100*len(w)/len(rows),2),
         "pnlJpy":round(sum(r["pnl"] for r in rows),3),
         "loserPnlJpy":round(sum(r["pnl"] for r in l),3)}
def detail(rows):
 med=sorted(int(r["ts"]) for r in rows)[len(rows)//2]
 return {"all":measure(rows),"early":measure([r for r in rows if r["ts"]<med]),
         "late":measure([r for r in rows if r["ts"]>=med])}
def main():
 source,_=core.task8.legacy.bootstrap()
 report={"status":"ACCEPTED_ONLY_SCREEN_NOT_CAUSAL_8LOGIC_RESELECTION","samples":{},"features":{},"candidateRules":dict(CANDIDATES)}
 detailed={}
 for cost in (10,30):
  rows,ledger=accepted(cost);mapped=[]
  for r in rows:
   ts=int(r["entry_ts_ms"]);sym=str(r["symbol"]);feat=get_feat(source,sym,ts)
   mapped.append({"candidateId":r["candidate_id"],"symbol":sym,"ts":ts,
                  "pnl":float(r["modeled_realized_pnl_jpy_at_exit_fx"]),
                  "win":float(r["modeled_realized_pnl_jpy_at_exit_fx"])>0,"features":feat})
  miss=[r for r in mapped if r["features"] is None]
  assert len(miss)==0,[(r["symbol"],r["candidateId"]) for r in miss]
  for sym in SYMS:
   group=[r for r in mapped if r["symbol"]==sym]
   vals=[]
   for name,rule in CANDIDATES:
    keep=[r for r in group if passes(r["features"],rule)]
    if len(keep)<3 or len(keep)>=len(group):continue
    d=detail(keep)
    vals.append({"name":name,"rule":rule,**d,
                 "winRateUplift":round(d["all"]["winRate"]-measure(group)["winRate"],2)})
   # Focus on stable trade breadth and win rate but report all candidates unchanged.
   vals.sort(key=lambda v:(v["winRateUplift"],v["all"]["n"]),reverse=True)
   report["samples"][f"{cost}_{sym}"]={"baseline":detail(group),"candidateComparisons":vals,
        "topRobust":[z for z in vals if z["all"]["n"]>=max(5,int(.45*len(group)))][:15]}
   print("COST",cost,"SYM",sym,"BASE",measure(group))
   for v in report["samples"][f"{cost}_{sym}"]["topRobust"][:10]:
    print(" GATE",v["name"],"N",v["all"]["n"],"WR",v["all"]["winRate"],
          "EARLY",v["early"].get("winRate"),"LATE",v["late"].get("winRate"),
          "PnL",round(v["all"]["pnlJpy"]),flush=True)
  detailed[str(cost)]=mapped
 (OUT/"IDLE_ALL5_ACCEPTED_CAUSAL_FEATURES_20261022.json").write_text(json.dumps(detailed,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 (OUT/"IDLE_ALL5_FEATURE_SCREEN_20261022.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print("SCREEN_COMPLETE",len(CACHE),flush=True)
if __name__=="__main__":main()
