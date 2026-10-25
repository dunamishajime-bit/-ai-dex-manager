#!/usr/bin/env python3
"""Source-verifiable historical model ONLY; never places orders or claims native8."""
import bisect,collections,csv,datetime as dt,hashlib,json,statistics,zipfile
from pathlib import Path
ROOT=Path("C:/tmp")
OUT=ROOT/"render-dual-preflight-native8-20261025"
M=300_000;H=3_600_000;DAY=24*H
START=dt.datetime(2025,8,10,tzinfo=dt.timezone.utc)
END=dt.datetime(2026,8,10,tzinfo=dt.timezone.utc)
START_MS=int(START.timestamp()*1000);END_MS=int(END.timestamp()*1000)
def read_series(symbol):
 older=ROOT/"idle-render-independent-older-m5-20261024"/symbol/"5m"
 newer=ROOT/("render-btc-complete-20261024" if symbol=="BTCUSDT" else "render-flow-raw-data-20261024")/"monthly"/"klines"/symbol/"5m"
 archives=sorted(older.glob("*.zip"))+sorted(newer.glob("*.zip"))
 if len(archives)!=25:raise RuntimeError(("REQUIRED_25_SOURCE_MONTHS",symbol,len(archives)))
 seen={}; manifest=[]
 for path in archives:
  raw=path.read_bytes();digest=hashlib.sha256(raw).hexdigest()
  with zipfile.ZipFile(path) as z:
   if z.testzip() is not None:raise RuntimeError(("ZIP_CRC",path))
   csvname=next((n for n in z.namelist() if n.endswith(".csv")),None)
   if not csvname:raise RuntimeError(("NO_CSV",path))
   with z.open(csvname) as stream:
    for line in stream:
     text=line.decode("utf-8").strip()
     if not text or text.startswith("open_time"):continue
     row=next(csv.reader([text]))
     if len(row)<10:raise RuntimeError(("BAD_COLUMNS",path,row[:2]))
     try: r=(int(row[0]),float(row[1]),float(row[2]),float(row[3]),float(row[4]),float(row[5]),float(row[9]))
     except ValueError as e:raise RuntimeError(("BAD_ROW",path,row[:2])) from e
     t,o,hi,lo,c,v,buy=r
     if t%M or not all(x>0 for x in (o,hi,lo,c)) or hi<max(o,c) or lo>min(o,c) or lo>hi or v<0 or buy<0 or buy>v+1e-6:
      raise RuntimeError(("INVALID_BAR",symbol,t))
     if t in seen and seen[t]!=r:raise RuntimeError(("CONFLICTING_DUPLICATE",symbol,t))
     seen[t]=r
  manifest.append({"name":path.name,"sha256":digest})
 rows=[seen[k] for k in sorted(seen)]
 for a,b in zip(rows,rows[1:]):
  if b[0]-a[0]!=M:raise RuntimeError(("M5_SOURCE_GAP",symbol,a[0],b[0]))
 if rows[0][0]>int(dt.datetime(2024,8,1,tzinfo=dt.timezone.utc).timestamp()*1000) or rows[-1][0]<END_MS:
  raise RuntimeError(("SOURCE_COVERAGE_GAP",symbol,rows[0][0],rows[-1][0]))
 return rows,{r[0]:r for r in rows},manifest
def quality(vals):
 n=len(vals);wins=sum(x>0 for x in vals);g=sum(x for x in vals if x>0);l=-sum(x for x in vals if x<0)
 return {"n":n,"wr":wins/n if n else 0,"pf":g/l if l else (5 if n>=3 else 0),"mean":sum(vals)/n if n else 0}
def expiry_outcome(t,r,limit_minutes,cost_bps):
 entry=r[t][1];stop=entry*1.02;tp=entry*.985; end=t+limit_minutes*60_000
 for bar_ts in range(t,end,M):
  bar=r.get(bar_ts)
  if not bar:raise RuntimeError(("HIST_EXIT_M5_MISSING",bar_ts))
  _,op,high,low,*_=bar
  if high>=stop:
   ep=max(op,stop)
   return {"entryTs":t,"exitTs":bar_ts,"settledAt":bar_ts+M,"entryPrice":entry,"exitPrice":ep,"netPct":(1-ep/entry)*100-cost_bps/100,"result":"STOP"}
  if low<=tp:
   return {"entryTs":t,"exitTs":bar_ts,"settledAt":bar_ts+M,"entryPrice":entry,"exitPrice":tp,"netPct":(1-tp/entry)*100-cost_bps/100,"result":"TP"}
 e=r.get(end)
 if not e:raise RuntimeError(("HIST_TIME_M5_MISSING",end))
 ep=e[1]
 return {"entryTs":t,"exitTs":end,"settledAt":end+M,"entryPrice":entry,"exitPrice":ep,"netPct":(1-ep/entry)*100-cost_bps/100,"result":"TIME"}
def run():
 render,rm,rmanifest=read_series("RENDERUSDT")
 btc,bm,bmanifest=read_series("BTCUSDT")
 start=max(render[0][0],btc[0][0])+72*H
 stop=min(render[-1][0],btc[-1][0])-7*H
 # The signal at t is permitted only after t has a fully closed H1.
 raw=[]
 for t in range(((start+H-1)//H)*H,stop,H):
  rb=[rm.get(x) for x in range(t-H,t,M)]
  bb=[bm.get(x) for x in range(t-H,t,M)]
  h4end=(t//(4*H))*4*H
  d1end=(t//DAY)*DAY
  h4=[rm.get(x) for x in range(h4end-4*H,h4end,M)]
  d1=[rm.get(x) for x in range(d1end-DAY,d1end,M)]
  prev=[]
  for k in range(2,8):
   src=[rm.get(x) for x in range(t-k*H,t-(k-1)*H,M)]
   if any(x is None for x in src):raise RuntimeError(("GATE_H1_GAP",t,k))
   prev.append(sum(x[5] for x in src))
  if any(x is None for x in rb+bb+h4+d1):raise RuntimeError(("GATE_PRICE_GAP",t))
  volumes=sorted(prev);median=(volumes[2]+volumes[3])/2
  if median<=0:continue
  btc1=100*(bb[-1][4]/bb[0][1]-1)
  rh1=100*(rb[-1][4]/rb[0][1]-1)
  rh4=100*(h4[-1][4]/h4[0][1]-1)
  rhd1=100*(d1[-1][4]/d1[0][1]-1)
  vol=sum(x[5] for x in rb)
  if vol<=0:continue
  sell=(vol-sum(x[6] for x in rb))/vol
  upperwick=100*(max(x[2] for x in rb)-max(rb[0][1],rb[-1][4]))/rb[0][1]
  if btc1>=.15 and rh1<=-.5 and rh4<=-.15 and sell>=.53 and upperwick>=.35:
   shadow=expiry_outcome(t,rm,360,30)
   raw.append({"ts":t,"shadow":shadow,"btc1Pct":btc1,"renderH1Pct":rh1,"h4Pct":rh4,"d1Pct":rhd1,"sellerShare":sell,"upperWickPctOfOpen":upperwick,"volRatio":vol/median})
 # Historical quality uses only fully settled 6h hypothetical outcomes and excludes contemporaneous samples.
 bysettle=sorted(raw,key=lambda x:x["shadow"]["settledAt"])
 accepted=[];cursor=0;settled=[]
 lastAccepted=None
 for x in raw:
  t=x["ts"]
  while cursor<len(bysettle) and bysettle[cursor]["shadow"]["settledAt"]<t:
   settled.append(bysettle[cursor]);cursor+=1
  lifetime=quality([v["shadow"]["netPct"] for v in settled])
  year=quality([v["shadow"]["netPct"] for v in settled if v["shadow"]["settledAt"]>=t-365*DAY])
  pass_quality=(lifetime["n"]>=24 and lifetime["wr"]>=.75 and lifetime["pf"]>=1.35
   and lifetime["mean"]>=.10 and year["n"]>=3 and year["wr"]>=.60 and year["mean"]>=0)
  if pass_quality and START_MS<=t<END_MS and (lastAccepted is None or t-lastAccepted>=12*H):
   o55=expiry_outcome(t,rm,55,30)
   accepted.append({"ts":t,"model55_30bps":o55,"lifetime":lifetime,"year":year})
   lastAccepted=t
 def report(cost):
  xs=[dict(v, netCostPct=v["model55_30bps"]["netPct"]+(.30-cost/100)) for v in accepted]
  vals=[v["netCostPct"] for v in xs];q=quality(vals);equity=peak=1.;dd=0.
  for gain in vals:
   equity*=1+gain/100;peak=max(peak,equity);dd=min(dd,100*(equity/peak-1))
  return {"modelTradeCount":len(xs),"winRate":q["wr"],"pf":q["pf"],"meanNetPct":q["mean"],"standaloneCompoundPct":(equity-1)*100,"standaloneClosedDdPct":dd}
 result={
  "schema":"render-independent-exact-causal-m5-research/v1",
  "status":"RESEARCH_ONLY_PUBLIC_BINANCE_M5_NOT_ASTER_NATIVE8_OR_LIVE",
  "periodStart":START.isoformat(),"periodEnd":END.isoformat(),
  "sourceRangeFirst":render[0][0],"sourceRangeLast":render[-1][0],
  "sourceRawMonthlyFiles":{"RENDERUSDT":rmanifest,"BTCUSDT":bmanifest},
  "sourceContinuity":"PASS_5M_NO_GAPS_NO_CONFLICTS",
  "rawQualifiedH1":len(raw),"firstRawSignal":raw[0]["ts"] if raw else None,
  "lastRawSignal":raw[-1]["ts"] if raw else None,
  "qualifiedAsOfIndependentSignalsBeforeWallet":len(accepted),
  "signals":[{"t":x["ts"],"net30Pct":x["model55_30bps"]["netPct"],"exitTs":x["model55_30bps"]["exitTs"],"result":x["model55_30bps"]["result"],"qualityLifetime":x["lifetime"],"quality365":x["year"]} for x in accepted],
  "10bps":report(10),"30bps":report(30),
  "limitations":[
   "Independent outcomes are modeled on Binance futures public M5, not signed Aster venue fills, funding, or L2 slippage.",
   "Each shadow receives TP1.5% STOP2% 6h until settled. Entry-quality uses only settledAt<t, including shadow signals never traded.",
   "55m real route uses TP1.5% STOP2%, 12h cooldown since prior accepted ENTRY.",
   "These results do NOT replay shared native eight-strategy wallet capital, owner score, competing signals, or margin.",
   "24 historical shadows are in-sample; untouched out-of-sample and real venue lifecycle still required."] }
 dest=OUT/"RENDER_INDEPENDENT_EXACT_CAUSAL_M5_55M_10_30_RESEARCH_20261025.json"
 dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print("FINISHED",dest,"RAW",len(raw),"QUALIFIED",len(accepted),"TEN",result["10bps"],"THIRTY",result["30bps"],flush=True)
if __name__=="__main__":run()
