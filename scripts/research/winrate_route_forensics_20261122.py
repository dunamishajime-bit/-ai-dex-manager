#!/usr/bin/env python3
"""STABLE4 causal-entry / modeled-outcome forensic audit (no venue actions).

No portfolio replay or production parity is claimed. The only allowed
historical feature timestamps are fully closed H1 candles ending <= entry.
"""
from __future__ import annotations
import bisect,csv,datetime as dt,gzip,hashlib,json,math,statistics,sys
from collections import Counter,defaultdict
from pathlib import Path

START=dt.datetime(2025,10,1,tzinfo=dt.timezone.utc)
END=dt.datetime(2026,10,1,tzinfo=dt.timezone.utc)
ROOT=Path(r"C:\tmp\disdex-bt-20251001-20261001")
CASE="STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1"
D=ROOT/"DIRECTION_RESEARCH_20261109"
FEATURE_SOURCE=D/"direction_features_expanded.jsonl"
CANDIDATE_SOURCE=D/"three_layer_layer1_all_candidates_20261114.jsonl"
H1_DIR=ROOT/"aster-public-v3-h1"
SCOPE=("V4","PENGU","Q102","V52","FET","IDLE","HYPE")
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path.cwd()/"WINRATE_ROUTE_FORENSICS"
OUT.mkdir(parents=True,exist_ok=True)

def hashfile(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for b in iter(lambda:f.read(1<<18),b""):h.update(b)
 return h.hexdigest()

def readrows(path):
 with path.open(encoding="utf-8-sig",newline="") as f:return list(csv.DictReader(f))

def wilson(w,n):
 if n<=0:return [0.0,1.0]
 z=1.9599639845;p=w/n;d=1+z*z/n
 mid=(p+z*z/(2*n))/d
 half=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
 return [round(mid-half,4),round(mid+half,4)]

def dtparse(s):return dt.datetime.fromisoformat(str(s).replace("Z","+00:00"))
def nt(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)

bars_cache={}
def load_h1(symbol):
 if symbol in bars_cache:return bars_cache[symbol]
 files=list(H1_DIR.glob(symbol+"-1h-*.jsonl.gz"))
 if len(files)!=1:
  bars_cache[symbol]=None;return None
 seen={}
 with gzip.open(files[0],"rt",encoding="utf8") as f:
  for line in f:
   a=json.loads(line)
   t=int(a[0]); vals=tuple(float(a[i]) for i in (1,2,3,4,5))
   if not all(nt(x) and (x>=0 if i==4 else x>0) for i,x in enumerate(vals)):
    raise ValueError("H1_MALFORMED_PRICE:"+symbol)
   if t in seen:raise ValueError("H1_DUPLICATE_TS:"+symbol)
   seen[t]=vals
 arr=sorted(seen.items())
 bars_cache[symbol]=(list(seen_t for seen_t,_ in arr),[vals for _,vals in arr],hashfile(files[0]))
 return bars_cache[symbol]

def at_entry(symbol,ts):
 src=load_h1(symbol)
 if not src:return None
 tsarr,vals,_=src
 idx=bisect.bisect_right(tsarr,ts-3600000)-1
 if idx<73:return None
 if ts-tsarr[idx]-3600000>2*3600000:return None
 # Every hour since the oldest lookback must be confirmed; never fill gaps.
 if tsarr[idx]-tsarr[idx-73]!=73*3600000:return None
 closes=[v[3] for v in vals]
 c=closes[idx]
 def m(h):return c/closes[idx-h]-1 if closes[idx-h]>0 else None
 tr=[]
 for i in range(idx-23,idx+1):
  hi=vals[i][1];lo=vals[i][2];prev=closes[i-1]
  tr.append(max(hi-lo,abs(hi-prev),abs(lo-prev)))
 rv=sum(tr)/24/c
 slow=closes[idx-24:idx+1]
 eff=abs(c-slow[0])/sum(abs(slow[i+1]-slow[i]) for i in range(24)) if any(abs(slow[i+1]-slow[i])>0 for i in range(24)) else 0
 return {"sym_ret3":m(3),"sym_ret6":m(6),"sym_ret12":m(12),"sym_ret24":m(24),
  "sym_ret48":m(48),"sym_ret72":m(72),"sym_atr24ratio":rv,"sym_er24":eff,
  "sym_24h_bar_position":(c-min(vals[i][2] for i in range(idx-23,idx+1)))/
    max(1e-12,max(vals[i][1] for i in range(idx-23,idx+1))-min(vals[i][2] for i in range(idx-23,idx+1)))}

def entry_features(trade):
 ts=int(dtparse(trade["entry_utc"]).timestamp()*1000)
 sym=at_entry(trade["symbol"],ts)
 btc=at_entry("BTCUSDT",ts)
 if not sym or not btc:return None
 side=1 if trade["side"]=="LONG" else -1
 return {"aligned_sym6":side*sym["sym_ret6"],"aligned_sym24":side*sym["sym_ret24"],
 "aligned_sym72":side*sym["sym_ret72"],"aligned_btc24":side*btc["sym_ret24"],
 "aligned_relative24":side*(sym["sym_ret24"]-btc["sym_ret24"]),
 "sym_atr24ratio":sym["sym_atr24ratio"],"sym_efficiency24":sym["sym_er24"],
 "sym_24h_position":sym["sym_24h_bar_position"],
 "triple_countertrend":side*sym["sym_ret6"]<0 and side*sym["sym_ret24"]<0 and side*btc["sym_ret24"]<0,
 "data_asof_utc":(dt.datetime.fromtimestamp((ts//3600000-1)*3600,tz=dt.timezone.utc)).isoformat()}

def stats(rows):
 n=len(rows);w=sum(r["win"] for r in rows);loss=[r for r in rows if not r["win"]];win=[r for r in rows if r["win"]]
 grosspos=sum(max(0,r["net_pnl_jpy"]) for r in rows);grossneg=-sum(min(0,r["net_pnl_jpy"]) for r in rows)
 def mean(v):return statistics.mean(v) if v else None
 return {"n":n,"wins":w,"losses":n-w,"win_pct":round(100*w/n,2) if n else None,
   "wilson_95_win_pct":[round(x*100,2) for x in wilson(w,n)],
   "net_pnl_sum_jpy":round(sum(r["net_pnl_jpy"] for r in rows),2),
   "net_return_on_notional_pct_mean":round(100*mean([r["net_return_on_notional"] for r in rows]),4) if n else None,
   "profit_factor":round(grosspos/grossneg,4) if grossneg>0 else None,
   "gross_negative_directional_trades":sum(r["directionally_negative_on_exit"] for r in rows),
   "losses_primarily_cost_or_funding":sum(r["cost_sensitive"] for r in rows),
   "wrong_direction_flag_rate_pct":round(100*sum(r["directionally_negative_on_exit"] for r in rows)/n,2) if n else None,
   "mean_winner_notional_pct":round(100*mean([r["net_return_on_notional"] for r in win]),4) if win else None,
   "mean_loser_notional_pct":round(100*mean([r["net_return_on_notional"] for r in loss]),4) if loss else None,
   "net_trade_losses_abs_jpy":round(grossneg,2)}

def exportcsv(path,rows):
 if not rows:return
 cols=list(rows[0])
 with path.open("w",encoding="utf-8-sig",newline="") as f:
  w=csv.DictWriter(f,cols);w.writeheader();w.writerows(rows)

base={}
raw={}
files={}
for bps in [10,30]:
 hits=list((ROOT/CASE).glob(f"*_{bps}BPS_FILLS.csv"))
 if len(hits)!=1:raise ValueError("EXACT_ONE_FILL_FILE_"+str(bps))
 path=hits[0];files[str(bps)]=hashfile(path)
 rows=readrows(path)
 normalized=[]
 for x in rows:
  if x["strategy"] not in SCOPE:raise ValueError("UNEXPECTED_RUNNER")
  t=dtparse(x["entry_utc"])
  if not START<=t<END:raise ValueError("OUT_OF_SCOPE_ENTRY")
  n=float(x["notional_jpy"])
  if not n>0:raise ValueError("NONPOSITIVE_NOTIONAL")
  pnl=float(x["net_pnl_jpy"]);g=float(x["pnl_before_cost_jpy"])
  y={**x,"net_pnl_jpy":pnl,"gross_price_pnl_jpy":g,"win":pnl>0,
   "directionally_negative_on_exit":g<0,"cost_sensitive":pnl<=0 and g>=0,
   "net_return_on_notional":pnl/n,"direction_return":g/n,
   "holding_hours":(dtparse(x["exit_utc"])-t).total_seconds()/3600}
  normalized.append(y)
 g=defaultdict(list)
 for r in normalized:g[r["strategy"]].append(r)
 summary=json.loads(next((ROOT/CASE).glob(f"*_{bps}BPS_SUMMARY.json")).read_text(encoding="utf8"))
 if summary["modeled_fills"]!=len(normalized):raise ValueError("SUMMARY_FILL_COUNT_MISMATCH")
 measured=round(100*sum(r["win"] for r in normalized)/len(normalized),10)
 if abs(measured-summary["win_rate_pct"])>1e-6:raise ValueError("SUMMARY_WIN_RATE_MISMATCH")
 base[str(bps)]={s:stats(g.get(s,[])) for s in SCOPE}
 base[str(bps)]["ALL"]=stats(normalized)
 raw[bps]=normalized
 print("CHECK",bps,"fills",len(rows),"recalc",measured,flush=True)

# Independent point-in-time feature audit: use only the H1 bars whose end precedes entry.
inspected=0;verified=0;mismatch=[]
archive={}
with FEATURE_SOURCE.open(encoding="utf8") as f:
 for line in f:
  v=json.loads(line)
  k=(v["strategy"],v["entryUtc"][:19],v["symbol"],v["native_side"],v["native_route"])
  if k in archive:raise ValueError("DUPLICATE_CAUSAL_FEATURE_KEY")
  archive[k]=v
matched=Counter();missing=Counter();cases=[]
for r in raw[10]:
 key=(r["strategy"],r["entry_utc"][:19],r["symbol"],r["side"],r["route"])
 prior=archive.get(key)
 pre=entry_features(r)
 if not pre:
  missing[r["strategy"]]+=1
 else:
  r["entry_features"]=pre
  for name in ["sym_ret6","sym_ret24"]:
   if prior and nt(prior.get(name)):
    inspected+=1
    factor=1 if r["side"]=="LONG" else -1
    v=pre["aligned_sym6" if name=="sym_ret6" else "aligned_sym24"]/factor
    if abs(v-prior[name])<1e-10:verified+=1
    else:mismatch.append({"id":r["source_signal_id"],"field":name,"independent":v,"archived":prior[name]})
 if prior:matched[r["strategy"]]+=1
 else:missing["FEATURE_CORPUS_"+r["strategy"]]+=1
 if pre:
  cases.append({"strategy":r["strategy"],"route":r["route"],"symbol":r["symbol"],"side":r["side"],
    "entry_utc":r["entry_utc"],"source_signal_id":r["source_signal_id"],
    "net_pnl_jpy":round(r["net_pnl_jpy"],2),"net_return_on_notional_pct":round(100*r["net_return_on_notional"],4),
    "net_win_10bps":r["win"],"exit_model_reason":r["exit_model_reason"],
    **{k:round(100*v,4) if k not in ("triple_countertrend","data_asof_utc") else v for k,v in pre.items()}})

if mismatch:raise ValueError("CAUSAL_H1_RECALC_DISAGREES:"+str(mismatch[:4]))
byset=defaultdict(list);symbolset=defaultdict(list);reasonset=defaultdict(list);sideset=defaultdict(list)
for r in raw[10]:
 byset[(r["strategy"],r["route"],r["side"])].append(r)
 symbolset[(r["strategy"],r["symbol"],r["side"])].append(r)
 reasonset[(r["strategy"],r["exit_model_reason"])].append(r)
 sideset[(r["strategy"],r["side"])].append(r)
route_res=[]
for k,rs in byset.items():
 r30=[x for x in raw[30] if (x["strategy"],x["route"],x["side"])==k]
 st10=stats(rs);st30=stats(r30)
 pre=[r for r in rs if "entry_features" in r]
 contra=[r for r in pre if r["entry_features"]["triple_countertrend"]]
 v=stats(contra) if contra else None
 route_res.append({"strategy":k[0],"route":k[1],"side":k[2],**{f"10_{a}":b for a,b in st10.items()},
  "30_n":st30["n"],"30_win_pct":st30["win_pct"],"30_net_return_on_notional_pct_mean":st30["net_return_on_notional_pct_mean"],
  "feature_rows":len(pre),"triple_countertrend_n":len(contra),
  "triple_countertrend_win_pct":v["win_pct"] if v else None,
  "loss_profile":Counter(r["exit_model_reason"] for r in rs if not r["win"]).most_common(5)})
route_res.sort(key=lambda x:(x["strategy"],-x["10_n"],x["route"],x["side"]))
exportcsv(OUT/"route_breakdown_10_30bps.csv",[{k:json.dumps(v) if isinstance(v,(list,dict)) else v for k,v in r.items()} for r in route_res])
exportcsv(OUT/"entry_asof_win_loss_features_10bps.csv",cases)

symbols=[{"strategy":k[0],"symbol":k[1],"side":k[2],**stats(v)} for k,v in symbolset.items()]
symbols.sort(key=lambda x:(x["strategy"],-x["n"],x["symbol"]))
exportcsv(OUT/"symbol_side_10bps.csv",[{k:json.dumps(v) if isinstance(v,list) else v for k,v in r.items()} for r in symbols])
reasons=[{"strategy":k[0],"exit_model_reason":k[1],**stats(v)} for k,v in reasonset.items()]
exportcsv(OUT/"exit_reason_10bps.csv",[{k:json.dumps(v) if isinstance(v,list) else v for k,v in r.items()} for r in reasons])

# Canonical candidate layer includes many signals never admitted to the portfolio:
# Use a separate counterfactual label. Never mix it with portfolio fill win rate.
candidate_by_group=defaultdict(lambda: {"n":0,"wins_10bps":0,"wins_30bps":0,"missing_price":0,"outside_period":0,"sha":set()})
candidates=0
with CANDIDATE_SOURCE.open(encoding="utf8") as f:
 for line in f:
  d=json.loads(line);candidates+=1
  if d["strategy"] not in SCOPE:raise ValueError("CAND_UNKNOWN_RUNNER")
  key=(d["strategy"],d["route"],d["side"],d["symbol"])
  a=candidate_by_group[key];a["n"]+=1
  a["sha"].add(str(d.get("v",{}).get("source_runtime_sha","unknown")))
  m=d.get("model") or {};ep=m.get("entryPrice");xp=m.get("exitPrice")
  if nt(m.get("exitTs")) and m["exitTs"]>=int(END.timestamp()*1000):
   a["outside_period"]+=1;continue
  if not nt(ep) or not nt(xp) or min(ep,xp)<=0:
   a["missing_price"]+=1;continue
  ret=(xp/ep-1)*(1 if d["side"]=="LONG" else -1)
  a["wins_10bps"]+=ret>0.001
  a["wins_30bps"]+=ret>0.003
cand_res=[]
for (s,route,side,symbol),v in candidate_by_group.items():
 cand_res.append({"strategy":s,"route":route,"side":side,"symbol":symbol,
 "candidates":v["n"],"priced":v["n"]-v["outside_period"]-v["missing_price"],
 "modeled_price_10bps_win_pct":round(100*v["wins_10bps"]/(v["n"]-v["outside_period"]-v["missing_price"]),2) if v["n"]>v["outside_period"]+v["missing_price"] else None,
 "modeled_price_30bps_win_pct":round(100*v["wins_30bps"]/(v["n"]-v["outside_period"]-v["missing_price"]),2) if v["n"]>v["outside_period"]+v["missing_price"] else None,
 "outside_period_exits":v["outside_period"],"missing_price":v["missing_price"],"source_shas":";".join(sorted(v["sha"]))})
cand_res.sort(key=lambda x:(x["strategy"],-x["candidates"],x["route"]))
exportcsv(OUT/"all_candidates_price_only_counterfactual.csv",cand_res)

# Month and cross-fee win classification (trade identity may differ per fee).
month=defaultdict(list)
for row in raw[10]:month[(row["strategy"],row["entry_utc"][:7])].append(row)
months=[{"strategy":k[0],"month":k[1],**stats(v)} for k,v in month.items()]
months.sort(key=lambda x:(x["strategy"],x["month"]))
exportcsv(OUT/"runner_monthly_10bps.csv",[{k:json.dumps(v) if isinstance(v,list) else v for k,v in r.items()} for r in months])

# Route ranking surfaces economic impact and trial sample size, no automatic trade policy.
risk=[
 {"runner":r["strategy"],"route":r["route"],"side":r["side"],
  "n":r["10_n"],"win_pct_10":r["10_win_pct"],"win_pct_30":r["30_win_pct"],
  "net_pnl_sum_jpy":r["10_net_pnl_sum_jpy"],"loss_sum_abs_jpy":r["10_net_trade_losses_abs_jpy"],
  "mean_net_pct_notional":r["10_net_return_on_notional_pct_mean"],
  "target":80 if r["strategy"]=="PENGU" else 70,
  "priority_reason":"INSUFFICIENT_SAMPLE" if r["10_n"]<10 else
   ("WIN_RATE_BELOW_TARGET" if (r["30_win_pct"] or 0)<(80 if r["strategy"]=="PENGU" else 70) else "MONITOR")
 } for r in route_res]
risk.sort(key=lambda x:(x["runner"],x["priority_reason"]!="WIN_RATE_BELOW_TARGET",-x["n"]))
exportcsv(OUT/"route_research_priority.csv",risk)
output={
 "schema":"disdex-causal-entry-winrate-audit/v1",
 "period":"2025-10-01T00:00:00Z to 2026-10-01T00:00:00Z (end excluded)",
 "case":CASE,"source_sha256":{
  "fills_10bps":files["10"],"fills_30bps":files["30"],
  "source_features":hashfile(FEATURE_SOURCE),"all_candidates":hashfile(CANDIDATE_SOURCE)},
 "cohort":"Actual portfolio-modeled fills; 10/30bps independently simulated; partial fills may be attributed per runner differently",
 "runners":base,"per_route":route_res,"per_symbol_side":symbols,"by_exit_reason":reasons,"monthly":months,
 "source_candidate_counts":dict(Counter({s:sum(v["n"] for k,v in candidate_by_group.items() if k[0]==s) for s in SCOPE})),
 "candidate_count":candidates,
 "asof_feature_provenance":{"feature_archive_match_by_runner":dict(matched),
  "missing_feature_archive_or_h1_by_runner":dict(missing),
  "verified_independent_h1_momentum_lookbacks":verified,
  "checked_independent_h1_momentum_lookbacks":inspected,
  "mismatch":mismatch,
  "asof_rule":"confirmed bar start+3600000 <= entryTs; never use current open bar or future"},
 "sample_target_definition":{"general":70,"PENGU":80,
  "coverage_minimum":10,"confidence":"Wilson 95% intervals; 8 fills cannot establish >=70% skill"},
 "limitations":[
  "Research BT model fills only; all signed_execution_verified=false; do not call confirmed venue wins",
  "H1 stock records and basis context differ from crypto; stock direction features are only contextual",
  "HYPE 8/FET 8 and PENGU SHORT_V20 8 are too small for a reliable 70/80 claim",
  "Portfolio model has known STOP timing issues; corrected stop exit sample not adopted as production truth",
  "Candidate-only price PnL ignores funding, order admission, risk and potential market impact; not portfolio win rate",
  "Fixed-period historical losses and route/feature associations are diagnosis, not evidence a gate improves live results",
  "Win rate is not directional precision: entry, exit, cost, funding, sizing, correlation and execution interact.",
  "Source setup is non-live and historical; the current Production SHA parity is not yet certified"
 ]}
(OUT/"route_audit_summary.json").write_text(json.dumps(output,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n",encoding="utf8")
print("AUDIT_DONE",json.dumps({"trades_10":len(raw[10]),"trades_30":len(raw[30]),
 "routes":len(route_res),"symbols":len(symbols),"candidates":candidates,"feature_rows":len(cases),
 "H1_PARITY_CHECKS":inspected,"H1_PARITY_PASS":verified,"missing_features":dict(missing),
 "runners_10":{s:base["10"][s]["win_pct"] for s in SCOPE}},ensure_ascii=False),flush=True)
