import json,urllib.parse,urllib.request,datetime,time,hashlib,collections,pathlib,math
UTC=datetime.timezone.utc;H=3600_000
import os
_source=os.environ.get("DISDEX_V4_FROZEN_RESEARCH_ROOT")
if not _source: raise SystemExit("SET_DISDEX_V4_FROZEN_RESEARCH_ROOT")
source=pathlib.Path(_source)/"docs/research/results/v12-multilogic-causal-holdout-20261009/causal-trades.jsonl"
out=pathlib.Path(os.environ.get("DISDEX_EXIT_RESEARCH_OUTPUT","research-runs/exit-protection-3change-heldout-20261016"))
out.mkdir(parents=True,exist_ok=True)
rows=[json.loads(x) for x in source.read_text(encoding="utf-8").splitlines() if x.strip()]
target={"REC_G5_SLOW_TREND":(.02,.005),"REC_X05_TIME_36H":(.025,.01)}
selected=[r for r in rows if r.get("route") in target]
prices={}
start=min(r["entry_ts_ms"] for r in selected)-2*H;stop=max(r["exit_ts_ms"] for r in selected)+H
for symbol in sorted({r["symbol"] for r in selected}):
 path=out/("aster_public_"+symbol+"_1h.json")
 if path.exists():
  obj=json.loads(path.read_text(encoding="utf-8"))
  if obj["start"]==start and obj["end"]==stop:
   prices[symbol]={int(x[0]):[float(v) for v in x[1:5]] for x in obj["bars"]}
   print("CACHE_HIT",symbol,len(prices[symbol]),flush=True)
   continue
 data={};nreq=0
 for startts in range(start,stop+H,1000*H):
  params={"symbol":symbol,"interval":"1h","startTime":startts,"endTime":min(stop+H,startts+1000*H),"limit":1000}
  url="https://fapi.asterdex.com/fapi/v1/klines?"+urllib.parse.urlencode(params)
  with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"DisDex-research-public-only/1"}),timeout=21) as resp:
   item=json.loads(resp.read().decode())
  for x in item:
   data[int(x[0])]=[float(y) for y in x[1:5]]
  nreq+=1
  time.sleep(.07)
 prices[symbol]=data
 path.write_text(json.dumps({"start":start,"end":stop,"bars":[[k,*v] for k,v in sorted(data.items())]},ensure_ascii=False),encoding="utf-8")
 print("DOWNLOADED",symbol,len(data),"N_REQUESTS",nreq,flush=True)
 def pct(e,p,sg):return sg*(p/e-1)
results=[]
for r in selected:
 symbol=r["symbol"];bar=prices.get(symbol,{})
 entry=float(r["entry_price"]);oldExit=float(r["exit_price"]);sg=1 if r["side"]=="LONG" else -1
 arm,floor=target[r["route"]]
 stopprice=None;newExit=oldExit;newTime=r["exit_ts_ms"];reason="ORIGINAL";wasArmed=False;triggered=False
 missing=[];highwater=0;intrabarPeak=0;closedBars=0
 for t in range(int(r["entry_ts_ms"]),int(r["exit_ts_ms"]),H):
  z=bar.get(t)
  if z is None:
   missing.append(t);break
  op,hi,lo,cl=z;closedBars+=1
  highwater=max(highwater,pct(entry,cl,sg))
  intrabarPeak=max(intrabarPeak,pct(entry,hi if sg==1 else lo,sg))
  # The floor activated on PREVIOUS completed H1 only, and is active this hour.
  if stopprice is not None and ((op<=stopprice or lo<=stopprice) if sg==1 else (op>=stopprice or hi>=stopprice)):
   newExit=min(op,stopprice) if sg==1 else max(op,stopprice)
   newTime=t+H;reason="FLOOR_HIT";triggered=True;break
  if pct(entry,cl,sg)>=arm:
   wasArmed=True
   targetStop=entry*(1+sg*floor)
   stopprice=max(stopprice,targetStop) if sg==1 and stopprice is not None else min(stopprice,targetStop) if sg==-1 and stopprice is not None else targetStop
 delta=pct(entry,newExit,sg)-pct(entry,oldExit,sg) if not missing else None
 results.append({"route":r["route"],"symbol":symbol,"side":r["side"],"entry_ts_ms":r["entry_ts_ms"],"entry_price":entry,
      "original_exit_ts_ms":r["exit_ts_ms"],"original_exit_price":oldExit,
      "baselineGrossPct":round(100*pct(entry,oldExit,sg),5),"newGrossPct":round(100*pct(entry,newExit,sg),5) if delta is not None else None,
      "deltaPctPoints":round(100*delta,6) if delta is not None else None,
      "wasArmed":wasArmed,"stopped":triggered,"firstError":missing[0] if missing else None,
      "bars":closedBars,"peakCompletedClosePct":round(100*highwater,5),"peakIntrabarPct":round(100*intrabarPeak,5),"exitReason":reason})
summary={"study":"exit-policy-OOS-heldout-only-v1","domain":"2026-08-11 to 2026-10-04; old V4 external causal route-only—not portfolio",
"status":"HISTORICAL_EXTERNAL_PERIOD_PREVIOUSLY_VIEWED_FOR_OTHER_V4_RESEARCH_NOT_PRISTINE",
"source_labeled_274_events":len(rows),"target_n":len(selected),
"changed":sum(x["stopped"] for x in results),
"activated":sum(x["wasArmed"] for x in results),
"missing":sum(x["firstError"] is not None for x in results),
"profit_delta_pctpoints":round(sum(x["deltaPctPoints"] or 0 for x in results),6),
"byRoute":{route:{"n":sum(x["route"]==route for x in results),"armed":sum(x["route"]==route and x["wasArmed"] for x in results),"stopTriggered":sum(x["route"]==route and x["stopped"] for x in results)} for route in target},
"rows":results,
"warnings":["Selected after seeing in-sample results","Only 3 route candidates: insufficient for proof","PENGU/Q102/portfolio replay not included","H1 bars current public Aster, not signed venue fills","Causal activations only after completed H1"]}
p=out/"heldout_aug_oct_selected_exit_sweep.json";p.write_text(json.dumps(summary,indent=2),encoding="utf-8")
print("OOS_EXIT_REPORT",json.dumps(summary,ensure_ascii=True),flush=True)
print("SAVED",p,"BYTES",p.stat().st_size,flush=True)
