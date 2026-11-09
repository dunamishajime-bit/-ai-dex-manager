# -*- coding: utf-8 -*-
"""DisDex research-only compound replay, 2025-10-01 to 2026-10-01.
Native entry tapes, VPS-confirmed gross contract; H1 exit approximation for four families.
V52 lacks historic executable book and is not modeled. NOT full production parity.
"""
import bisect,collections,csv,datetime,gzip,hashlib,heapq,json,math,pathlib,re
R=pathlib.Path(r"C:\tmp\disdex-bt-20251001-20261001")
N=R/"native-new-signal-20251001-20261001"
O=R/"VPS_PENGU_V64_2H_NORMALIZED_GATE_ABLATION_20261110";O.mkdir(exist_ok=True)
CRYPTO_CAP=3.0;TOTAL_CAP=3.5;STOCK_CAP=4.0;V4_POS_CAP=1.30;V4_AGG_CAP=2.0
START=1759276800000;END=1790812800000;H=3600000;STEP=1800000
PIN={"V4":"3ad65403013b701db5d9e53e8814e6ab827a28e8",
 "Q102":"ef1ab178e26a7bf5bddb6473467765edba242e1d",
 "PENGU":"1657e173d250ad58f53e62f7bb0a3428fb405496",
 "V52":"8495daf24e53a6cf0dd5e38f022008fa8f78c688",
 "HYPE":"d6bcc94512a6416189cd92d7203b9ac3b2c98e70",
 "FET":"7688ed7c93a1918d8b44837339b7da5584a868f5",
 "IDLE":"7688ed7c93a1918d8b44837339b7da5584a868f5",
 "RESIDUAL":"7688ed7c93a1918d8b44837339b7da5584a868f5"}
QG={"MR":{"LONG":.75,"SHORT":.75},"BRK":{"LONG":.75,"SHORT":.75},
 "PB":{"LONG":2.0,"SHORT":2.5},"REV":{"LONG":1.5,"SHORT":1.25},
 "HIGH_VOL":{"LONG":1.,"SHORT":.6}}
FILES={"V4":"native-V4-raw-intentions.jsonl","Q102":"native-Q102-S34-raw-intentions.jsonl",
 "PENGU":"native-PENGU-raw-intentions.jsonl","IDLE":"native-IDLE-raw-intentions.jsonl",
 "FET":"native-FET-raw-intentions.jsonl","RESIDUAL":"native-RESIDUAL-raw-intentions.jsonl"}
A={};F={}
def jd(p):return json.loads(p.read_text(encoding="utf-8-sig"))
def jlines(p):
 with p.open(encoding="utf8") as f:
  for line in f:
   if line.strip():yield json.loads(line)
def iso(t):return datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat().replace("+00:00","Z")
def save(p,o):p.write_text(json.dumps(o,indent=2,ensure_ascii=False,allow_nan=False)+"\n",encoding="utf8")
def hsh(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def wr(name,rows,cols):
 with (O/name).open("w",encoding="utf-8-sig",newline="") as f:
  w=csv.DictWriter(f,fieldnames=cols,extrasaction="ignore");w.writeheader()
  for x in rows:w.writerow({k:"" if x.get(k) is None else x.get(k) for k in cols})
def bars(s):
 if s not in A:
  p=R/"aster-public-v3-h1"/(s+"-1h-20250924-20261001.jsonl.gz")
  if not p.exists():A[s]=None
  else:
   with gzip.open(p,"rt",encoding="utf8") as f:
    a=[(int(z[0]),float(z[1]),float(z[2]),float(z[3]),float(z[4]))
       for x in f if x.strip() for z in [json.loads(x)]]
   A[s]=(a[0][0],a) if a and all(a[i][0]-a[i-1][0]==H for i in range(1,len(a))) else None
 return A[s]
def bar(s,t):
 a=bars(s)
 if not a:return None
 first,v=a
 if (t-first)%H:return None
 i=(t-first)//H
 if i<0 or i>=len(v):return None
 z=v[i]
 return z if all(math.isfinite(k) and k>0 for k in z[1:]) and z[2]>=max(z[1],z[4]) and z[3]<=min(z[1],z[4]) else None
def completed_h1(s,t):
 # Last H1 candle completed at or before t; causal for :00 and :30 event times.
 open_t=(t//H)*H-H
 return bar(s,open_t)
def fr(s):
 if s not in F:
  p=R/"aster-public-funding"/(s+"-20251001-20261001.json")
  a=sorted((int(z["fundingTime"]),float(z["fundingRate"])) for z in jd(p)) if p.exists() else []
  F[s]=(a,[t for t,_ in a])
 return F[s]
def funding(s,t,e,price,side):
 a,times=fr(s)
 z=[]
 for t0,rate in a[bisect.bisect_right(times,t):bisect.bisect_left(times,e)]:
  r=bar(s,(t0-1)//H*H)
  mark=r[4] if r else price
  z.append((t0,(-1 if side=="LONG" else 1)*rate*mark/price,rate,mark))
 return z

# Added V2: Aster public M5 replays for AVAX/DOGE residual, using pinned residual timing.
M5={}
FM=300000
def fivebars(s):
 if s not in M5:
  arr=[]
  for folder,post in [("aster-public-v3-5m-prefix","20250924-20260803"),
                      ("aster-public-v3-5m-suffix","20260803-20261001")]:
   p=R/folder/(s+"-5m-"+post+".jsonl.gz")
   if not p.exists():M5[s]=None;return None
   with gzip.open(p,"rt",encoding="utf8") as f:
    for line in f:
     if not line.strip():continue
     z=json.loads(line)
     arr.append((int(z[0]),float(z[1]),float(z[2]),float(z[3]),float(z[4])))
  if not arr or any(arr[i][0]-arr[i-1][0]!=FM for i in range(1,len(arr))):
   M5[s]=None
  else:M5[s]=(arr[0][0],arr)
 return M5[s]
def five(s,t):
 a=fivebars(s)
 if not a:return None
 first,v=a
 if (t-first)%FM:return None
 i=(t-first)//FM
 if i<0 or i>=len(v):return None
 z=v[i]
 return z if all(math.isfinite(k) and k>0 for k in z[1:]) and z[2]>=max(z[1],z[4]) and z[3]<=min(z[1],z[4]) else None
def avax_m5_gate(c):
 if c["symbol"]!="AVAXUSDT":return "PASS"
 t=c["t"]
 def close(s,prior):
  x=five(s,t-prior*H-FM)
  return x[4] if x else None
 a,a3,a6=close("AVAXUSDT",0),close("AVAXUSDT",3),close("AVAXUSDT",6)
 b,b3,b6=close("BTCUSDT",0),close("BTCUSDT",3),close("BTCUSDT",6)
 if not all((x is not None and x>0) for x in (a,a3,a6,b,b3,b6)):
  return "NO_CAUSAL_AVAX_BTC_M5_GATE_HISTORY"
 a3pct=(a/a3-1)*100;b3pct=(b/b3-1)*100
 a6pct=(a/a6-1)*100;b6pct=(b/b6-1)*100
 if a3pct<=-.5 and b3pct<0:return "AVAX_VETO_CO_DECLINE"
 if a6pct>=2 and b6pct<0:return "AVAX_VETO_DIVERGENT_RALLY"
 return "PASS"
def modeled_residual_m5(c):
 t=c["t"];s=c["symbol"];v=c["v"]
 veto=avax_m5_gate(c)
 if veto!="PASS":return None,veto
 b=five(s,t)
 if b is None:return None,"M5_NO_ENTRY"
 ep=b[1];hold=int(v["holdHours"])*H
 stop=ep*(1-float(v["hardStopPct"]))
 tp=ep*(1+float(v["takeProfitPct"]))
 deadline=t+hold
 softstart=None;best=-1e100;armed=False
 for tm in range(t,deadline+FM,FM):
  z=five(s,tm)
  if z is None:return None,"M5_MISSING_ON_EXIT_PATH"
  _,op,hi,lo,close=z
  if tm>=deadline:
   return dict(entryTs=t,entryPrice=ep,exitTs=tm,exitPrice=op,
               exitReason="MODELED_FIXED_HOLD_M5"),"PASS"
  # native exchange resident STOP and TAKE_PROFIT can fill before tick-level action.
  if lo<=stop:return dict(entryTs=t,entryPrice=ep,exitTs=tm+FM,
                exitPrice=min(op,stop),exitReason="MODELED_RESIDENT_HARD_STOP_M5"),"PASS"
  if hi>=tp:return dict(entryTs=t,entryPrice=ep,exitTs=tm+FM,
                exitPrice=max(op,tp),exitReason="MODELED_RESIDENT_TP_M5"),"PASS"
  if s=="AVAXUSDT":
   # Approximate executable bid with completed M5 close (bid/orderbook history missing).
   threshold=ep*.965
   if close<=threshold:
    if softstart is None:softstart=tm+FM
    elif tm+FM>=softstart+2*H:
     nx=five(s,tm+FM)
     if nx is None:return None,"AVAX_SOFT_EXIT_NEXT_M5_GAP"
     return dict(entryTs=t,entryPrice=ep,exitTs=tm+FM,exitPrice=nx[1],
                 exitReason="AVAX_SOFT_MINUS3P5_WATCH2H_M5_CLOSE_PROXY"),"PASS"
   else:softstart=None
   gain=round((close/ep-1)*100,12)
   best=max(best,gain)
   armed=armed or best>=3-1e-12
   if armed and gain<=best-1.5+1e-12:
    nx=five(s,tm+FM)
    if nx is None:return None,"AVAX_TRAIL_NEXT_M5_GAP"
    return dict(entryTs=t,entryPrice=ep,exitTs=tm+FM,exitPrice=nx[1],
                exitReason="AVAX_TRAIL_ARM3_GIVE1P5_M5_CLOSE_PROXY"),"PASS"
 return None,"INCOMPLETE_M5_RESIDUAL_EXIT"

m5={}
for s in ("FET","IDLE"):
 p=N/("native-"+s+"-all-intent-modeled-5m-exit-audit.json")
 o=jd(p);assert len(o["trades"])==o["rawCandidateN"]
 d=collections.defaultdict(list)
 for x in o["trades"]:d[(x["entryTs"],x["symbol"],x["route"])].append(x)
 m5[s]=d
raw=[]
for s,file in FILES.items():
 if s=="Q102":
  continue
 for i,v in enumerate(jlines(N/file),1):
  t=int(v["entryTs"])
  if not START<=t<END:continue
  g=(QG.get(v.get("family"),{}).get(v["side"],0) if s=="Q102" else float(v.get("requestedGross") or 0))
  # retain native gross; configured only in research loop below
  mod=m5[s][(t,v["symbol"],v["route"])].pop(0) if s in m5 else None
  raw.append(dict(id=s+"_"+str(i).zfill(5),s=s,t=t,symbol=v["symbol"],
   side=v["side"],route=v.get("route",""),gross=g,v=v,model=mod,src=file))
p=R/"hype-aster-historical"/"hype-trend-pinned-candidates.json"
for i,v in enumerate(jd(p),1):
 t=int(v["entry_ts_ms"])
 if not START<=t<END:continue
 raw.append(dict(id="HYPE_"+str(i).zfill(5),s="HYPE",t=t,symbol="HYPEUSDT",
  side="LONG",route=v["route"],gross=float(v["requested_gross"]),v=v,
  model=dict(entryTs=t,entryPrice=v["entry_price"],exitTs=v["exit_ts_ms"],
             exitPrice=v["exit_price"],exitReason=v["exit_reason"]),src=p.name))
q102life_path=R/"Q102_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"q102-exits.jsonl"
q102life=list(jlines(q102life_path))
assert len(q102life)==205
for i,z in enumerate(q102life,1):
 t=int(z["entryTs"]); e=int(z["exitTs"])
 if not START<=t<e<=END: continue
 raw.append(dict(id="Q102S34_"+str(i).zfill(5),s="Q102",t=t,symbol=z["symbol"],
   side=z["side"],route=z["route"],gross=float(z["requestedGross"]),v=z,
   model=dict(entryTs=t,entryPrice=float(z["entryPrice"]),exitTs=e,exitPrice=float(z["exitPrice"]),
              exitReason="Q102_S34_NATIVE_"+str(z["exitReason"]),reversal=z.get("reversal")),
   src=str(q102life_path)))
assert len(raw)==2715,(len(raw),2715)
def h1exit(c):
 v=c["v"];s=c["s"];t=c["t"];b=bar(c["symbol"],t)
 if not b:return None
 ep=b[1];side=c["side"];stop=.08;maxh=24;tp=None;arm=1e9;tr=.0
 if s=="PENGU":
  stop=float(v["longHardStopPct"] if side=="LONG" else v["shortHardStopPct"])
  maxh=int(v["longMaxHoldHours"] if side=="LONG" else v["shortMaxHoldHours"])
  arm,tr=(.10,.03) if side=="LONG" else (.15,.04)
 elif s=="Q102":
  stop=float(v["hardStop"]);maxh=int(v["maxHoldHours"])
 elif s=="V4":
  a=re.search(r"TIME_(\d+)H",c["route"]);b2=re.search(r"_T(\d+)$",c["route"])
  maxh=int(a.group(1)) if a else int(b2.group(1)) if b2 else 24
 elif s=="RESIDUAL":
  stop=float(v["hardStopPct"]);maxh=int(v["holdHours"]);tp=float(v["takeProfitPct"])
  if c["symbol"]=="AVAXUSDT":arm,tr=.03,.015
 else:return None
 if maxh>168 or stop>=1 or stop<=0:return None
 sp=ep*(1-stop if side=="LONG" else 1+stop)
 target=ep*(1+tp if side=="LONG" else 1-tp) if tp is not None else None
 high=ep;low=ep
 for i in range(maxh+1):
  tm=t+i*H
  if tm>=END:return None
  b=bar(c["symbol"],tm)
  if not b:return None
  _,op,hi,lo,close=b
  if i==maxh:return dict(entryTs=t,entryPrice=ep,exitTs=tm,exitPrice=op,exitReason="MODEL_TIME_H1")
  if side=="LONG":
   if lo<=sp:return dict(entryTs=t,entryPrice=ep,exitTs=tm+H,exitPrice=min(sp,op),exitReason="MODEL_STOP_H1")
   if target and hi>=target:return dict(entryTs=t,entryPrice=ep,exitTs=tm+H,exitPrice=max(op,target),exitReason="MODEL_TP_H1")
  else:
   if hi>=sp:return dict(entryTs=t,entryPrice=ep,exitTs=tm+H,exitPrice=max(sp,op),exitReason="MODEL_STOP_H1")
   if target and lo<=target:return dict(entryTs=t,entryPrice=ep,exitTs=tm+H,exitPrice=min(op,target),exitReason="MODEL_TP_H1")
  high=max(high,hi);low=min(low,lo)
  mfe=high/ep-1 if side=="LONG" else 1-low/ep
  if s=="PENGU":
   if mfe>=arm:
    sp=max(sp,high*(1-tr)) if side=="LONG" else min(sp,low*(1+tr))
   if side=="SHORT" and i==2 and close>=ep*1.025:
    return dict(entryTs=t,entryPrice=ep,exitTs=tm+H,exitPrice=close,exitReason="MODEL_PENGU_TIMED_3H_ADVERSE2P5")
   if side=="SHORT" and i==7 and close>=ep*1.04:
    return dict(entryTs=t,entryPrice=ep,exitTs=tm+H,exitPrice=close,exitReason="MODEL_PENGU_TIMED_8H_ADVERSE4")
  if s=="V4":
   if side=="LONG":
    if mfe>=.02:sp=max(sp,ep*.95)
    if mfe>=.03 and any(z in c["route"] for z in ("X09","X10","X14")):sp=max(sp,ep*1.01)
   else:
    if mfe>=.05:sp=min(sp,ep*.98)
    if i>=12 and mfe<.01 and close>=ep*1.025:
     return dict(entryTs=t,entryPrice=ep,exitTs=tm+H,exitPrice=close,exitReason="MODEL_V4_ADVERSE")
  if s=="RESIDUAL" and c["symbol"]=="AVAXUSDT" and mfe>=arm:sp=max(sp,high*(1-tr))
 return None
v4life_path=R/"V4_STRICT_V2_PLUS_EARLY_REVERSAL_20261109"/"v4-exits.jsonl"
v4life={z["id"]:z for z in jlines(v4life_path)}
assert len(v4life)==1394
pengulife_path=R/"PENGU_LONG_V64_2H_NORMALIZED_GATE_LIFECYCLE_20261110"/"pengu-exits.jsonl"
pengulife={z["id"]:z for z in jlines(pengulife_path)}
assert len(pengulife)==116
missing=collections.Counter()
for c in raw:
 if c["s"]=="V4":
  z=v4life.get(c["id"])
  if z is None:
   c["model"]=None;c["gate_reason"]="V4_NATIVE_LIFECYCLE_UNRESOLVED_M5_GAP"
  else:
   c["side"]=z["side"]
   assert int(z["entryTs"])==c["t"] and z["symbol"]==c["symbol"] and z["side"]==c["side"] and z["route"]==c["route"]
   c["model"]=dict(entryTs=int(z["entryTs"]),entryPrice=float(z["entryPrice"]),exitTs=int(z["exitTs"]),exitPrice=float(z["exitPrice"]),
                   exitReason="V4_NATIVE_"+str(z["exitReason"]),reversal=z.get("reversal"))
   c["v4_native_exit_source"]=z["exitSource"]
 elif c["s"]=="PENGU":
  z=pengulife.get(c["id"])
  if z is None:
   c["model"]=None;c["gate_reason"]="PENGU_NATIVE_LIFECYCLE_UNRESOLVED"
  else:
   assert int(z["entryTs"])==c["t"] and z["symbol"]==c["symbol"] and z["side"]==c["side"] and z["route"]==c["route"]
   c["model"]=dict(entryTs=int(z["entryTs"]),entryPrice=float(z["entryPrice"]),exitTs=int(z["exitTs"]),exitPrice=float(z["exitPrice"]),
                   exitReason="PENGU_NATIVE_"+str(z["exitReason"]),partialEvents=list(z.get("partialEvents") or []),reversal=z.get("reversal"))
 elif c["model"] is None:
  if c["s"]=="RESIDUAL":
   c["model"],c["gate_reason"]=modeled_residual_m5(c)
  else:c["model"]=h1exit(c)
 if c["model"] is None:missing[c["s"]]+=1
 else:
  m=c["model"]
  assert m["entryTs"]==c["t"] and START<=c["t"]<m["exitTs"]<=END
  c["funding"]=funding(c["symbol"],c["t"],m["exitTs"],m["entryPrice"],c["side"])
v52path=R/"V52_FULLPERIOD_PRICE_MODEL_20261109"/"v52_10bps_trades.jsonl"
v52n=0
for z in jlines(v52path):
 if z.get("status")!="CLOSED": continue
 t=int(z["entry_ts_ms"]); e=int(z["exit_ts_ms"])
 if not START<=t<e<=END: continue
 v52n+=1
 raw.append(dict(id="V52_"+str(v52n).zfill(5),s="V52",t=t,symbol=z["symbol"],side=z["side"],
   route="V50_POST_OPEN_BASIS",gross=2.0,v=z,
   model=dict(entryTs=t,entryPrice=float(z["entry_price"]),exitTs=e,exitPrice=float(z["exit_price"]),exitReason="V52_"+z["reason"]),
   funding=[],src=str(v52path)))
print("CANDIDATES",len(raw),"V52",v52n,"EXIT_MODELS",len(raw)-sum(missing.values()),"MISSING",dict(missing),flush=True)

# VPS priority research proxy:
# formal baseline slots are V4, Q102, PENGU, FET, V52.
# IDLE SHORT has higher priority than residual; nonbaseline sidecar exposures block residual entry.
# Exact source native pending/sidecar and tick times cannot be reconstructed historically.
FORMAL_PRIORITY={"V4","Q102","PENGU","FET","V52"}
PRIORITY_NON_RESIDUAL={"V4","Q102","PENGU","FET","V52","HYPE","IDLE"}
IDLE_RAW_CANDIDATE_HOURS={c["t"] for c in raw if c["s"]=="IDLE"}
def pengu_route(v):
 return {"LONG_V64":"BASE_V64_LONG","SHORT_V20":"SHORT_V20",
         "RECOVERY_V8":"RECOVERY_V8"}.get(v,"BASE_V64_LONG")

P={"V52":0,"PENGU":1,"Q102":2,"V4":3,"FET":4,"HYPE":5,"IDLE":6,"RESIDUAL":7}
PQ=dict(P)
def simulate(name,bps,priority,include_v4):
 a=sorted(raw,key=lambda c:(c["t"],priority[c["s"]],c["symbol"],c["id"]))
 fee=bps/20000;cash=10000.;opened={};heap=[];entries=[];fills=[];funds=[];partial_audit=[];hourly=[];rej=collections.Counter()
 peak=10000.;mdd=0.;mddt=START;day=None;dayeq=10000.;latched=False;j=0
 pengu_overlay={"realized_equity":1.0,"realized_peak":1.0,"dd":0.0,
                "global_hold_until":0,"quarantines":{}}
 preemption_audit=[];pq_gate_count=collections.Counter()
 def close_modeled(pid,exitt,exit_price,reason):
  nonlocal cash
  q=opened.pop(pid)
  gm=q["notional"]*(1 if q["side"]=="LONG" else -1)*(exit_price/q["entry"]-1)
  xf=q["notional"]*fee
  cash+=gm-xf
  total_gm=q.get("realized_gross_pnl",0.0)+gm
  total_xf=q.get("exit_fee_accum",0.0)+xf
  net=total_gm-total_xf-q["fee"]+q["funded"]
  if q["s"]=="PENGU":
   # Runtime code: netAccountReturn=accountingGross*(directionalReturn -2*0.0006)
   # The overlay intentionally does NOT use scenario-bps fees.
   directional=exit_price/q["entry"]-1 if q["side"]=="LONG" else q["entry"]/exit_price-1
   if q.get("reversed"):
    directional_total=q.get("pengu_reversal_directional_realized",0.0)+directional
    account_return=q.get("original_gross",q["gross"])*(directional_total-4*.0006)
   else:
    account_return=q["gross"]*(directional-2*.0006)
   rex=pengu_overlay["realized_equity"]*(1+account_return)
   if rex>0 and math.isfinite(rex):
    pengu_overlay["realized_equity"]=rex
    pengu_overlay["realized_peak"]=max(pengu_overlay["realized_peak"],rex)
    pengu_overlay["dd"]=rex/pengu_overlay["realized_peak"]-1
    if pengu_overlay["dd"]<=-.17:
     pengu_overlay["global_hold_until"]=max(pengu_overlay["global_hold_until"],exitt+72*H)
   if "STOP" in reason and not ("TIMED" in reason):
    route=pengu_route(q["route"])
    pengu_overlay["quarantines"][route]=max(pengu_overlay["quarantines"].get(route,0),exitt+60*H)
  fills.append(dict(trade_id=pid,strategy=q["s"],symbol=q["symbol"],side=q["side"],
   route=q["route"],entry_utc=iso(q["ts"]),exit_utc=iso(exitt),
   model_entry_price=q["entry"],model_exit_price=exit_price,exit_model_reason=reason,
   entry_equity_jpy=q["equity"],notional_jpy=q.get("original_notional",q["notional"]),gross_x=q.get("original_gross",q["gross"]),
   pnl_before_cost_jpy=total_gm,entry_fee_jpy=q["fee"],exit_fee_jpy=total_xf,funding_model_jpy=q["funded"],
   net_pnl_jpy=net,wallet_cash_after_exit_jpy=cash,
   source_runtime_sha=PIN[q["s"]],source_signal_id=q["sid"],
   model_class=("PRIORITY_PREEMPT_M5_H1_QUOTE_PROXY" if reason in
                ("FORMAL_PRIORITY","IDLE_SHORT_PRIORITY") else
                ("V52_H1_BASIS_PRICE_ONLY" if q["s"]=="V52" else ("PINNED_ENTRY_M5_PRICE_EXIT" if q["s"] in ("HYPE","IDLE","FET") else
                  "PINNED_ENTRY_H1_APPROX_EXIT"))),
   actual_venue_order_id="",actual_filled_quantity="",signed_execution_verified=False))
  if reason in ("FORMAL_PRIORITY","IDLE_SHORT_PRIORITY"):
   preemption_audit.append({"trade_id":pid,"utc":iso(exitt),"strategy":q["s"],
    "symbol":q["symbol"],"exit_price_proxy":exit_price,"reason":reason,"net_pnl_jpy":net})
 def priority_price(s,t):
  z=five(s,t-5*60_000)
  if z:return z[4]
  z=bar(s,t-H)
  return z[4] if z else None
 def preempt_residual(t,reason):
  ids=[pid for pid,pos in opened.items() if pos["s"]=="RESIDUAL"]
  for pid in ids:
   q=opened[pid]
   price=priority_price(q["symbol"],t)
   if price is None:raise RuntimeError("PRIORITY_PREEMPT_QUOTE_UNAVAILABLE:"+q["symbol"]+":"+iso(t))
   close_modeled(pid,t,price,reason)
 def mark_current(t):
  v=cash
  for q in opened.values():
   z=completed_h1(q["symbol"],t)
   if z is None:return None
   mark=q["entry"] if z[0]+H<=q.get("active_ts",q["ts"]) else z[4]
   v+=q["notional"]*(1 if q["side"]=="LONG" else -1)*(mark/q["entry"]-1)
  return v
 def mtm_gross_state(t,eq,vals=None):
  if eq is None or eq<=0:return None
  xs=list(opened.values()) if vals is None else list(vals)
  crypto=stock=v4=0.0
  for q in xs:
   z=completed_h1(q["symbol"],t)
   if z is None:return None
   mark=q["entry"] if z[0]+H<=q.get("active_ts",q["ts"]) else z[4]
   current_notional=float(q["notional"])*(float(mark)/float(q["entry"]))
   gg=current_notional/eq
   if q["s"]=="V52":stock+=gg
   else:crypto+=gg
   if q["s"]=="V4":v4+=gg
  return dict(crypto=crypto,stock=stock,total=crypto+stock,v4=v4)
 for t in range(START,END+STEP,STEP):
  while heap and heap[0][0]<=t:
   t0,typ,pid,ix=heapq.heappop(heap)
   if pid not in opened:continue
   q=opened[pid]
   if typ==0:
    tm,per,rate,mark=q["funding"][ix]
    per_now=(-1 if q["side"]=="LONG" else 1)*rate*mark/q["entry"]
    amount=q["notional"]*per_now
    cash+=amount;q["funded"]+=amount
    funds.append(dict(trade_id=pid,timestamp_utc=iso(tm),public_funding_rate=rate,
       mark_proxy=mark,modeled_wallet_cashflow_jpy=amount,actual_signed_funding=False))
   elif typ==1:
    ev=q["partials"][ix]
    ratio=float(ev["closedQuantityFractionOfCurrent"])
    if not (0<ratio<1):raise RuntimeError("PENGU_PARTIAL_RATIO_INVALID")
    part_notional=q["notional"]*ratio
    px=float(ev["price"])
    gm=part_notional*(1 if q["side"]=="LONG" else -1)*(px/q["entry"]-1)
    xf=part_notional*fee
    cash+=gm-xf
    q["realized_gross_pnl"]=q.get("realized_gross_pnl",0.0)+gm
    q["exit_fee_accum"]=q.get("exit_fee_accum",0.0)+xf
    q["notional"]-=part_notional
    q["gross"]*=1-ratio
    partial_audit.append(dict(trade_id=pid,strategy=q["s"],symbol=q["symbol"],route=q["route"],
      utc=iso(t0),price=px,closed_fraction_of_current=ratio,remaining_gross_x=q["gross"],
      realized_gross_pnl_jpy=gm,exit_fee_jpy=xf))
   elif typ==2:
    ev=q.get("reversal")
    if not ev or q.get("reversed"):raise RuntimeError("INVALID_REVERSAL_EVENT")
    px=float(ev["price"])
    if int(ev["ts"])!=t0:raise RuntimeError("REVERSAL_TS_MISMATCH")
    gm=q["notional"]*(1 if q["side"]=="LONG" else -1)*(px/q["entry"]-1)
    if q["s"]=="PENGU":
     first_dir=(px/q["entry"]-1) if q["side"]=="LONG" else (q["entry"]/px-1)
     q["pengu_reversal_directional_realized"]=q.get("pengu_reversal_directional_realized",0.0)+first_dir
    xf=2*q["notional"]*fee
    cash+=gm-xf
    q["realized_gross_pnl"]=q.get("realized_gross_pnl",0.0)+gm
    q["exit_fee_accum"]=q.get("exit_fee_accum",0.0)+xf
    q["side"]=ev["side"]
    q["entry"]=px
    q["active_ts"]=t0
    q["reversed"]=True
   else:
    close_modeled(pid,t0,q["exit"],q["reason"])
  if t==END:break
  if any(v["s"]=="RESIDUAL" for v in opened.values()):
   if any(v["s"] in FORMAL_PRIORITY for v in opened.values()):
    preempt_residual(t,"FORMAL_PRIORITY")
   elif any(v["s"]=="IDLE" for v in opened.values()) or t in IDLE_RAW_CANDIDATE_HOURS:
    preempt_residual(t,"IDLE_SHORT_PRIORITY")
  eq=mark_current(t)
  if eq is not None:
   if day!=t//(24*H):day=t//(24*H);dayeq=eq;latched=False
   peak=max(peak,eq)
   if peak>0 and (eq/peak-1)*100<mdd:mdd=(eq/peak-1)*100;mddt=t
  if eq is None or dayeq<=0 or eq<=dayeq*.925:latched=True
  daily=latched
  gs=mtm_gross_state(t,eq)
  if gs is None:
   used_crypto=used_stock=used_total=usedv4=float("inf")
  else:
   used_crypto=gs["crypto"];used_stock=gs["stock"];used_total=gs["total"];usedv4=gs["v4"]
  hourly.append(dict(utc=iso(t),compounded_mtm_equity_jpy=eq,wallet_cash_jpy=cash,
                     open_count=len(opened),crypto_gross_x=used_crypto,stock_gross_x=used_stock,total_gross_x=used_total,
                     v4_gross_x=usedv4,daily_gate_block=daily))
  v4_mtm_overcap=False
  if eq is not None and eq>0:
   for q0 in opened.values():
    if q0["s"]!="V4": continue
    z0=completed_h1(q0["symbol"],t)
    if z0 is None: continue
    mark0=q0["entry"] if z0[0]+H<=q0["ts"] else z0[4]
    current_notional=q0["notional"]*(mark0/q0["entry"])
    if current_notional/eq>V4_POS_CAP+1e-8:
     v4_mtm_overcap=True;break
  while j<len(a) and a[j]["t"]<=t:
   c=a[j];j+=1
   assert c["t"]==t
   s=c["s"];g=c["gross"];reason=""
   if (s in FORMAL_PRIORITY and any(v["s"]=="RESIDUAL" for v in opened.values())
       and (include_v4 or s!="V4") and eq is not None and not daily and not v4_mtm_overcap and g>0
       and c["model"] is not None):
    others=[v for v in opened.values() if v["s"]!="RESIDUAL"]
    ogs=mtm_gross_state(t,eq,others)
    if ogs is None:
     capacity_ok=False
    else:
     oc=ogs["crypto"];os=ogs["stock"];ot=ogs["total"]
     capacity_ok=((s=="V52" and os+g<=STOCK_CAP+1e-8) or (s!="V52" and oc+g<=CRYPTO_CAP+1e-8)) and ot+g<=TOTAL_CAP+1e-8
    if (sum(v["s"]==s for v in others)<(3 if s=="V4" else 1)
        and not any(v["symbol"]==c["symbol"] for v in others) and capacity_ok):
     preempt_residual(t,"FORMAL_PRIORITY")
     eq=mark_current(t)
     gs=mtm_gross_state(t,eq)
     if gs is None:
      used_crypto=used_stock=used_total=usedv4=float("inf")
     else:
      used_crypto=gs["crypto"];used_stock=gs["stock"];used_total=gs["total"];usedv4=gs["v4"]
     if eq is None or eq<=dayeq*.925:latched=True
     daily=latched
   if v4_mtm_overcap:reason="V4_MTM_POSITION_OVER_CAP"
   elif not include_v4 and s=="V4":reason="V4_SHADOW_EXCLUDED"
   elif eq is None:reason="MISSING_MTM_PRICE"
   elif c["model"] is None:reason=c.get("gate_reason","MISSING_EXIT_PATH")
   elif daily:reason="DAILY_LOSS_7P5_GATE"
   elif g<=0:reason="MISSING_GROSS"
   elif s=="PENGU" and t<pengu_overlay["global_hold_until"]:
    reason="PENGU_REALIZED_DD_17PCT_HOLD_72H"
   elif s=="PENGU" and t<pengu_overlay["quarantines"].get(pengu_route(c["route"]),0):
    reason="PENGU_ROUTE_QUARANTINE_60H"
   elif s=="RESIDUAL" and any(v["s"] in FORMAL_PRIORITY for v in opened.values()):
    reason="RESIDUAL_FORMAL_BASELINE_OPEN"
   elif s=="RESIDUAL" and (any(v["s"] in PRIORITY_NON_RESIDUAL for v in opened.values())
                              or t in IDLE_RAW_CANDIDATE_HOURS):
    reason="RESIDUAL_SIDECAR_OR_IDLE_SIGNAL_PRIORITY"
   elif any(v["symbol"]==c["symbol"] for v in opened.values()):reason="SYMBOL_BUSY"
   elif sum(v["s"]==s for v in opened.values())>=(3 if s=="V4" else 1):reason="RUNNER_SLOT_BUSY"
   elif s=="V4" and g>V4_POS_CAP+1e-8:reason="V4_PER_POSITION_CAP"
   elif s=="V4" and usedv4+g>V4_AGG_CAP+1e-8:reason="V4_AGGREGATE_CAP"
   elif s!="V52" and used_crypto+g>CRYPTO_CAP+1e-8:reason="CRYPTO_GROSS_CAP"
   elif s=="V52" and used_stock+g>STOCK_CAP+1e-8:reason="STOCK_GROSS_CAP"
   elif used_total+g>TOTAL_CAP+1e-8:reason="TOTAL_GROSS_CAP"
   elif eq<=0:reason="NO_EQUITY"
   if reason:
    rej[reason]+=1
    entries.append(dict(signal_id=c["id"],strategy=s,utc=iso(t),decision="BLOCK",reason=reason,
                        requested_gross=g))
    continue
   m=c["model"];notional=eq*g
   cost=notional*fee;cash-=cost
   pid=name+"_"+str(bps)+"_"+c["id"]
   q=dict(s=s,side=c["side"],symbol=c["symbol"],route=c["route"],ts=t,active_ts=t,
          entry=m["entryPrice"],exit=m["exitPrice"],reason=m["exitReason"],
          equity=eq,notional=notional,original_notional=notional,gross=g,original_gross=g,fee=cost,funded=0.,
          realized_gross_pnl=0.,exit_fee_accum=0.,partials=list(m.get("partialEvents") or []),
          funding=c["funding"],sid=c["id"],reversal=m.get("reversal"),reversed=False)
   opened[pid]=q
   if q["reversal"]:heapq.heappush(heap,(int(q["reversal"]["ts"]),2,pid,0))
   heapq.heappush(heap,(m["exitTs"],3,pid,0))
   for ix,ev in enumerate(q["partials"]):heapq.heappush(heap,(int(ev["eventTs"]),1,pid,ix))
   for ix,(tm,_,_,_) in enumerate(c["funding"]):heapq.heappush(heap,(tm,0,pid,ix))
   if s=="V52":used_stock+=g
   else:used_crypto+=g
   used_total+=g
   if s=="V4":usedv4+=g
   entries.append(dict(signal_id=c["id"],strategy=s,utc=iso(t),decision="MODEL_ENTER",
                       reason="MODELED_EXIT_NOT_VENUE_FILL",requested_gross=g))
 assert j==len(a),(j,len(a))
 assert not opened,("positions_still_open",len(opened))
 assert len(entries)==len(a)
 assert math.isclose(cash,10000+sum(x["net_pnl_jpy"] for x in fills),rel_tol=1e-9,abs_tol=1e-6)
 pp=name+"_"+str(bps)+"BPS"
 wr(pp+"_FILLS.csv",fills,["trade_id","strategy","symbol","side","route","entry_utc","exit_utc",
 "model_entry_price","model_exit_price","exit_model_reason","entry_equity_jpy","notional_jpy",
 "gross_x","pnl_before_cost_jpy","entry_fee_jpy","exit_fee_jpy","funding_model_jpy",
 "net_pnl_jpy","wallet_cash_after_exit_jpy","source_runtime_sha","source_signal_id",
 "model_class","actual_venue_order_id","actual_filled_quantity","signed_execution_verified"])
 wr(pp+"_DECISIONS.csv",entries,["signal_id","strategy","utc","decision","reason","requested_gross"])
 wr(pp+"_EQUITY_30MIN.csv",hourly,["utc","compounded_mtm_equity_jpy","wallet_cash_jpy",
 "open_count","crypto_gross_x","stock_gross_x","total_gross_x","v4_gross_x","daily_gate_block"])
 wr(pp+"_FUNDING.csv",funds,["trade_id","timestamp_utc","public_funding_rate",
 "mark_proxy","modeled_wallet_cashflow_jpy","actual_signed_funding"])
 wr(pp+"_PENGU_PARTIAL_EVENTS.csv",partial_audit,["trade_id","strategy","symbol","route","utc","price",
 "closed_fraction_of_current","remaining_gross_x","realized_gross_pnl_jpy","exit_fee_jpy"])
 wr(pp+"_RESIDUAL_PREEMPTIONS.csv",preemption_audit,
 ["trade_id","utc","strategy","symbol","exit_price_proxy","reason","net_pnl_jpy"])
 wins=sum(x["net_pnl_jpy"]>0 for x in fills)
 gp=sum(x["net_pnl_jpy"] for x in fills if x["net_pnl_jpy"]>0)
 gl=-sum(x["net_pnl_jpy"] for x in fills if x["net_pnl_jpy"]<0)
 result=dict(case=name,cost_bps_roundtrip=bps,initial_jpy=10000.,
 final_compounded_jpy=cash,net_return_pct=(cash/10000-1)*100,max_hourly_dd_pct=mdd,
 dd_time_utc=iso(mddt),modeled_fills=len(fills),
 win_rate_pct=wins/len(fills)*100 if fills else None,
 profit_factor=gp/gl if gl else None,
 admitted_by_runner=dict(collections.Counter(x["strategy"] for x in entries if x["decision"]=="MODEL_ENTER")),
 blocked_by_reason=dict(rej),source_intents=len(a),
 residual_priority_exits=len(preemption_audit),
 pengu_partial_events=len(partial_audit),
 pengu_final_realized_dd_pct=100*pengu_overlay["dd"],
 pengu_final_realized_index=pengu_overlay["realized_equity"],
 status="RESEARCH_ONLY_V52_MISSING_V4_SHADOW_Q102_PARTIAL_EXIT_MODEL_APPROX")
 save(O/(pp+"_SUMMARY.json"),result)
 print("COMPOUND_RESULT",name,bps,round(cash,2),round(mdd,2),
    len(fills),round(result["win_rate_pct"] or 0,2),round(result["profit_factor"] or 0,3),flush=True)
 return result
# Sensitivity research only; no production write or strategy code changes.
import os


native_v4_gross={c["id"]:c["gross"] for c in raw if c["s"]=="V4"}
CRYPTO_CAP=3.0;TOTAL_CAP=3.5;STOCK_CAP=4.0;V4_AGG_CAP=2.0;V4_POS_CAP=1.35
all_results=[]
case="PENGU_V64_2H_NORMALIZED_GATE_ABLATION"
for c in raw:
 if c["s"]=="V4":c["gross"]=native_v4_gross[c["id"]]
for bps in (10,30):
 res=simulate(case,bps,P,True)
 res.update(v4_sizing="NATIVE_GROSS",v4_per_position_cap=V4_POS_CAP,v4_aggregate_cap=V4_AGG_CAP,
            crypto_cap=CRYPTO_CAP,stock_cap=STOCK_CAP,total_cap=TOTAL_CAP,
            direction_overrides={"V4":["G4","X03","X05","X07","X11","Y07"],"Q102":["FET_PB168","UNI_MR72"],"IDLE":[],"PENGU":["LONG_V64_2H_7_EVENTS"]},
            v4_direction_override_candidates=43,q102_direction_override_candidates=9,
            pengu_timed_stops=True,q102_selected_native_modeled=205,
            q102_selected_native_unresolved_failclosed=66,q102_high_vol_missing=True,
            v4_native_lifecycle_modeled=1394,v4_native_lifecycle_unresolved=0)
 all_results.append(res)
save(O/"PARTIAL_RESULTS.json",all_results)
save(O/"RUN_MANIFEST.json",dict(
 status="PENGU_V64_2H_NORMALIZED_GATE_ABLATION_RESEARCH_ONLY_NOT_FULL_PRODUCTION_PARITY",
 period=["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z"],
 results=all_results,
 caveats=["Direction overrides only from strict zero-FP train/val/test candidates with full opposite exit replay for V4/Q102",
          "V4 1394/1394 M5 lifecycle modeled; Q102 S34 205 modeled, 66 fail-closed, HIGH_VOL missing",
          "IDLE direction candidates excluded because no adopted LONG exit contract",
          "PENGU LONG V64 planned two-hour LONG-to-SHORT reversal on seven normalized-gate events; research-only",
          "V52 supplemental price model; HYPE/IDLE assumed active; market fills/funding modeled"]))
print("SAVED",O,flush=True)
