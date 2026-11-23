import json,statistics,bisect,os
from pathlib import Path
from collections import defaultdict
from datetime import datetime,timezone
from zoneinfo import ZoneInfo

B=Path(r"C:\Users\dis\Desktop\bt-analysis-formal")
P=B/"v12_trail02_dualgate"/"BRK0P75_MR0P75_FET1_DUAL_GATE"/"PRICE_MODEL_10BPS"
DATA=B/"formal_extract"/"bt-v12-score100-volume080-normalonly-20260928"/"market-Aster-H1-funding-and-manifests"/"normalized"/"aster"/"klines"
EXTRA=B/"extra_h1_universe"/"DASHUSDT.jsonl"
H=3600000;J=ZoneInfo("Asia/Tokyo")
tr=[json.loads(x) for x in (P/"portfolio-trades.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
market={}
for s in ("BTCUSDT","PENGUUSDT","DOGEUSDT"):
 market[s]={int(x["event_time_ms"]):x for x in (json.loads(y) for y in (DATA/f"{s}.jsonl").read_text(encoding="utf-8").splitlines() if y.strip())}
market["DASHUSDT"]={int(x["event_time_ms"]):x for x in (json.loads(y) for y in EXTRA.read_text(encoding="utf-8").splitlines() if y.strip())}
intervals=[(int(x["entry_ts_ms"]),int(x["exit_ts_ms"])) for x in tr]
entries=sorted({e for e,_ in intervals})
delta=defaultdict(int)
for e,x in intervals:delta[e]+=1;delta[x]-=1
start=min(e for e,_ in intervals);end=max(x for _,x in intervals)
active_by={};n=0
for t in range((start//H)*H,((end+H-1)//H)*H+H,H):
 n+=delta.get(t,0);active_by[t]=n>0
def active(t):return active_by.get(t,False)
def jd(t):return datetime.fromtimestamp(t/1000,timezone.utc).astimezone(J).date()
def ret(s,t,h):
 a=market[s].get(t-H);b=market[s].get(t-(h+1)*H)
 return None if not a or not b else a["close"]/b["close"]-1
def feat(s,t):
 r=market[s];last=r.get(t-H);ent=r.get(t)
 if not last or not ent:return None
 r12=ret(s,t,12);r24=ret(s,t,24);b24=ret("BTCUSDT",t,24)
 if None in (r12,r24,b24):return None
 trs=[];vols=[];prev=[]
 for k in range(14,0,-1):
  x=r.get(t-k*H);p=r.get(t-(k+1)*H)
  if not x or not p:return None
  trs.append(max(x["high"]-x["low"],abs(x["high"]-p["close"]),abs(x["low"]-p["close"])))
 for k in range(73,1,-1):
  x=r.get(t-k*H)
  if not x:return None
  vols.append(x["quote_volume"])
 for k in range(25,1,-1):
  x=r.get(t-k*H)
  if not x:return None
  prev.append(x["close"])
 med=statistics.median(vols)
 return {"r12":r12,"r24":r24,"rel24":r24-b24,"vr":last["quote_volume"]/med if med else 0,
         "atr":sum(trs)/14/last["close"],"up":last["close"]>max(prev)}
def sig(s,k,t):
 f=feat(s,t)
 if not f:return False
 if k=="P_MOM_REL_BREAK":return f["r12"]>=.03 and f["vr"]>=1 and f["atr"]>=.007 and f["rel24"]>=0 and f["up"]
 if k=="P_BRK_REL":return f["up"] and f["vr"]>=1.3 and f["atr"]>=.007 and f["rel24"]>=0
 if k=="DOGE_REL_VOL":return f["rel24"]>=.03 and f["vr"]>=1.2 and f["atr"]>=.007
 if k=="DASH_MOM":return f["r12"]>=.03 and f["vr"]>=1 and f["atr"]>=.007
 return False
def outcome(s,t,hold=12):
 r=market[s];e=r.get(t)
 if not e:return None
 ep=float(e["open"]);stop=ep*.9;tp=ep*1.25;natural=t+hold*H
 i=bisect.bisect_right(entries,t);nxt=entries[i] if i<len(entries) else None
 end=min(natural,nxt) if nxt is not None else natural
 reason="PREEMPT" if end<natural else "TIME";xp=None
 for ts in range(t,end,H):
  x=r.get(ts)
  if not x:return None
  if x["low"]<=stop:xp=stop;reason="STOP";end=ts;break
  if x["high"]>=tp:xp=tp;reason="TP";end=ts;break
 if xp is None:
  x=r.get(end)
  if not x:return None
  xp=float(x["open"])
 raw=xp/ep-1
 return raw,reason,end,ep,xp
def generate(routes):
 out=[];used=set();busy=0
 for t in range(start+80*H,end-12*H,H):
  if t<busy or active(t) or jd(t) in used:continue
  cand=[]
  for s,k,score in routes:
   if sig(s,k,t):cand.append((score,s,k))
  if not cand:continue
  cand.sort(reverse=True);score,s,k=cand[0]
  o=outcome(s,t)
  if not o:continue
  raw,reason,xt,ep,xp=o
  out.append({"strategy_id":"RESCUE_TOP3","symbol":s,"side":"LONG","route":k,"score":score,
              "entry_ts_ms":t,"exit_ts_ms":xt,"hold_h":(xt-t)/H,"entry_price":ep,"exit_price":xp,
              "raw_return":raw,"target_net_10bps":raw-.001,"exit_reason":reason})
  used.add(jd(t));busy=t+12*H
 return out
A=[("PENGUUSDT","P_MOM_REL_BREAK",15.0),("DOGEUSDT","DOGE_REL_VOL",11.18),("DASHUSDT","DASH_MOM",11.18)]
C=[("PENGUUSDT","P_BRK_REL",16.57),("DOGEUSDT","DOGE_REL_VOL",11.18),("DASHUSDT","DASH_MOM",11.18)]
for name,routes in [("NEAR_EXCLUDED_TOP3",A),("PENGU_BRK_TOP3",C)]:
 out=generate(routes)
 (B/f"trail020_{name}_intents.json").write_text(json.dumps(out,indent=2)+"\n",encoding="utf-8")
 z=[x["target_net_10bps"] for x in out];gp=sum(x for x in z if x>0);gl=-sum(x for x in z if x<0)
 print(name,"n",len(z),"wr",sum(x>0 for x in z)/len(z) if z else 0,"pf",gp/gl if gl else 999,"ret",sum(z),
       "days",len({jd(x["entry_ts_ms"]) for x in out}),"routes",dict(__import__("collections").Counter(x["route"] for x in out)))
 print("trades",[(str(jd(x["entry_ts_ms"])),x["symbol"],x["route"],round(x["target_net_10bps"]*100,2),x["exit_reason"]) for x in out])
