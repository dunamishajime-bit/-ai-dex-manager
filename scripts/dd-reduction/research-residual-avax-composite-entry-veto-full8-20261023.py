#!/usr/bin/env python3
"""Research-only causal entry gates for AVAX RESIDUAL after DOGE veto and adopted-candidate exit combo.
Full8 native wallet, H1 baseline, candidate reselection, all original other strategies fixed.
"""
from __future__ import annotations
import argparse,bisect,collections,datetime,hashlib,importlib.util,json,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
DOC=REPO/"docs/research/results/residual-composite-20261023"
M5=300000;H=3600000
def load(name,path):
 sp=importlib.util.spec_from_file_location(name,path);obj=importlib.util.module_from_spec(sp);sp.loader.exec_module(obj);return obj
prior=load("avax_entry_gate_replay_reference",HERE/"research-residual-avax-exit-native-full8-after-no-doge-20261023.py")
native=prior.native
original_screen=prior.screen
STOCK=prior.STOCK
REFERENCE=DOC/"RESIDUAL_AVAX_6H_TRAIL3_COMBO_FULL8_20261023.json"
CASES={
 "BASE_COMPOSITE":"NO_GATE",
 "VETO_CO_DECLINE":"CO_DECLINE",
 "VETO_AVAX_RALLY_BTC_WEAK":"AVAX_RALLY_BTC_WEAK",
 "VETO_BTC3_AVAX1_FAST_FADE":"FAST_FADE",
 "VETO_DUAL":"DUAL",
 "VETO_TRIPLE":"TRIPLE",
 "VETO_BTC3_AVAX3_NEG":"BTC3_AVAX3_NEG",
}
def sha(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for block in iter(lambda:f.read(1<<20),b""):h.update(block)
 return h.hexdigest()
def get_feature(source,sym,ts,cache):
 key=(sym,ts)
 if key in cache:return cache[key]
 bars,times=source.getdata(sym)
 j=bisect.bisect_left(times,int(ts))
 if j<74 or j>=len(times) or times[j]!=int(ts) or times[j-1]+M5!=int(ts):
  cache[key]=None;return None
 close=float(bars[j-1][4])
 if not math.isfinite(close) or close<=0:
  cache[key]=None;return None
 f={f"ret{h}h":100*(close/float(bars[j-1-12*h][4])-1) for h in (1,3,6)}
 cache[key]=f
 return f
def reason(rule,avax,btc):
 co=avax["ret3h"]<=-0.5 and btc["ret3h"]<0
 anti=avax["ret6h"]>=2 and btc["ret6h"]<0
 fade=avax["ret1h"]<=-0.3 and btc["ret3h"]<0
 if rule=="NO_GATE":return None
 if rule=="CO_DECLINE":return "co_decline" if co else None
 if rule=="AVAX_RALLY_BTC_WEAK":return "divergent_rally" if anti else None
 if rule=="FAST_FADE":return "fast_fade" if fade else None
 if rule=="DUAL":
  if co:return "co_decline"
  if anti:return "divergent_rally"
  return None
 if rule=="TRIPLE":
  if co:return "co_decline"
  if anti:return "divergent_rally"
  if fade:return "fast_fade"
  return None
 if rule=="BTC3_AVAX3_NEG":return "broad_negative_3h" if avax["ret3h"]<0 and btc["ret3h"]<0 else None
 raise KeyError(rule)
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--output",type=Path,required=True)
 ap.add_argument("--cases",nargs="+",default=list(CASES))
 a=ap.parse_args()
 assert a.cases and len(set(a.cases))==len(a.cases) and set(a.cases)<=set(CASES)
 assert REPO not in (a.output.resolve(),*a.output.resolve().parents)
 assert STOCK.is_dir()
 manifest=json.loads((STOCK/"scenario-manifest.json").read_text("utf8"))
 assert manifest["caseTape99Sha256"]==sha(STOCK/"v52-model-ledger.jsonl")
 anchor=json.loads(REFERENCE.read_text("utf8"))["cases"]["COMBO_TIME6_TRAIL3_GIVE1P5"]["costs"]
 native.m.acquire_verified_h1()
 a.output.mkdir(parents=True,exist_ok=True)
 core=native.m.m.core
 core.OUTPUT=a.output
 core.BOOTSTRAP_REDIRECT=a.output/"_legacy-bootstrap-cache"
 original_filter=native.m.m.entry_filter
 original_apply=native.m.p.apply
 original_run=core._run_engine
 original_writer=original_run.__globals__["_path_write_text"]
 def safe_research_writer(self,data,*args,**kwargs):
  if a.output.name in self.parts:self.parent.mkdir(parents=True,exist_ok=True)
  return original_writer(self,data,*args,**kwargs)
 original_run.__globals__["_ensure_research_output_parent_write_text"]=safe_research_writer
 current="BASE_COMPOSITE"
 fcache={}
 def candidate_filter(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
  transformed=original_filter(rows,overlays,source,cost_bps,obs,baseline_lookup)
  out=[]
  for row in transformed:
   if row.get("strategy_id")!="RESIDUAL":
    out.append(row);continue
   if row.get("symbol")=="DOGEUSDT":
    obs["no_doge_rejected"]=obs.get("no_doge_rejected",0)+1
    continue
   if row.get("symbol")!="AVAXUSDT" or row.get("side")!="LONG":
    out.append(row);continue
   if current=="BASE_COMPOSITE":
    out.append(row);continue
   ts=row.get("entry_ts_ms")
   assert ts is not None,("AVAX_MISSING_ENTRY_TS",row.get("candidate_id"))
   avax=get_feature(source,"AVAXUSDT",ts,fcache)
   btc=get_feature(source,"BTCUSDT",ts,fcache)
   assert avax is not None and btc is not None,("AVAX_MISSING_CAUSAL_M5",row.get("candidate_id"),ts)
   veto=reason(CASES[current],avax,btc)
   if veto:
    obs["avaxGateRemoved"]=obs.get("avaxGateRemoved",0)+1
    obs.setdefault("avaxGateEvidence",[]).append({"candidateId":row.get("candidate_id"),
      "entryTsMs":ts,"reason":veto,"AVAX1h":avax["ret1h"],"AVAX3h":avax["ret3h"],
      "AVAX6h":avax["ret6h"],"BTC3h":btc["ret3h"],"BTC6h":btc["ret6h"]})
    continue
   out.append(row)
  return out
 def apply_exit(row,rule,source,cost_bps,obs,original_row=None):
  if rule.get("kind")!="residual_avax_exit_after_no_doge_20261023":
   return original_apply(row,rule,source,cost_bps,obs,original_row=original_row)
  if row.get("strategy_id")!="RESIDUAL" or row.get("symbol")!="AVAXUSDT" or row.get("side")!="LONG":
   return row
  policy="COMBO_TIME6_TRAIL3_GIVE1P5"
  q=original_screen._find_exit(row,policy,source,obs.setdefault("avaxDataQuality",collections.Counter()))
  if q is None:return row
  assert int(row["entry_ts_ms"])<q["ts"]<int(row["exit_ts_ms"])
  nextrow=dict(row,exit_ts_ms=q["ts"],exit_price=q["fill"],
    exit_reason="RESEARCH_AVAX_"+policy,unit_price_return=float(q["fill"])/float(row["entry_price"])-1)
  obs["by_reason"]["RESEARCH_AVAX_"+policy]+=1
  obs["avaxExitModified"]=obs.get("avaxExitModified",0)+1
  return nextrow
 def run_overlay(name,phase,overlays,cost,source,helper,previous_factory,baseline_lookup=None):
  overlay=prior.overlay("COMBO_TIME6_TRAIL3_GIVE1P5")
  xname=name+"_AVAX_ENTRY_"+current
  digest=hashlib.sha256(xname.encode("utf8")).hexdigest()[:12]
  n="cmp_"+digest
  run_dir=a.output/"engine"/n/n/(str(cost)+"bps")/"cases"/"V2_M150_D05_CORE_NATIVE"/"runs"/("PRICE_MODEL_"+str(cost)+"BPS")
  run_dir.mkdir(parents=True,exist_ok=True)
  original_run.__globals__["OUTPUT"]=a.output
  return original_run(xname,phase,[*overlays,*overlay],cost,source,helper,previous_factory,
    baseline_lookup=baseline_lookup)
 core._transform_rows=candidate_filter
 core._apply_initial_stop=apply_exit
 core._matches=native.m.m.idle.matches
 core._run_engine=run_overlay
 source,helper=core.task8.legacy.bootstrap()
 native.m.m.base.install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 results={"status":"RESEARCH_ONLY_AVAX_COMPOSITE_ENTRY_VETO_NATIVE_FULL8_NOT_LIVE",
  "referenceSha":sha(REFERENCE),"reference":"RESIDUAL_AVAX_6H_TRAIL3_COMBO_FULL8_20261023.json",
  "convention":"Closed M5 at or before entry timestamp for AVAX and BTC 1h/3h/6h returns",
  "conditions":CASES,"costsBps":[10,30],"cases":{},
  "limitations":["24 accepted initial trades are small; same historical sample used to select thresholds",
       "Study not an untouched OOS; can reselect only candidate events available to frozen source",
       "V52 historical suppressed 11 source events not regenerated",
       "Crypto native H1 price model and completed M5; real execution L2, margin, funding, STOP orders not certified",
       "LIVE Production SHA, venue transitions and lifecycle not verified; research-only"]}
 for case in a.cases:
  current=case
  for cost in (10,30):
   r,passes=native.replay("AVAX_COMBO_ENTRY_GATES_"+case,cost,source,helper,previous,STOCK)
   assert r["accounting"]=="PASS"
   trade=native.m.jsonl(r["ledger"])
   residual=[x for x in trade if x["strategy_id"]=="RESIDUAL"]
   avax=[x for x in residual if x["symbol"]=="AVAXUSDT"]
   assert all(x["symbol"]!="DOGEUSDT" for x in residual)
   old=anchor[str(cost)]
   info={"costBps":cost,"finalEquityJpy":r["final_equity_jpy"],
      "deltaVsCompositeJpy":r["final_equity_jpy"]-old["finalEquityJpy"],
      "portfolioPF":r["profit_factor"],
      "ddPct":r["maximum_mtm_drawdown_pct"],
      "ddDeltaVsCompositePctPoints":r["maximum_mtm_drawdown_pct"]-old["maxMtmDrawdownPct"],
      "closedTrades":r["closed_trades"],
      "deltaTradesVsComposite":r["closed_trades"]-old["closedTrades"],
      "totalWinners":sum(float(x["total_pnl_jpy"])>0 for x in trade),
      "avaxCount":len(avax),"avaxWins":sum(float(x["total_pnl_jpy"])>0 for x in avax),
      "avaxModeledPnLJpy":sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in avax),
      "avaxCandidateIds":[x["candidate_id"] for x in avax],
      "byStrategy":dict(collections.Counter(x["strategy_id"] for x in trade)),
      "ledgerSha256":sha(r["ledger"]),"reselectionPasses":len(passes),"accounting":"PASS"}
   assert len(passes)==3,("RESELECTION_COUNT",case,cost,len(passes))
   if case=="BASE_COMPOSITE":
    assert abs(info["deltaVsCompositeJpy"])<.02
    assert abs(info["ddDeltaVsCompositePctPoints"])<1e-8
    assert info["closedTrades"]==old["closedTrades"]
    assert info["ledgerSha256"]==old["ledgerSha256"]
   results["cases"].setdefault(case,{"rule":CASES[case],"costs":{}})["costs"][str(cost)]=info
   (a.output/"AVAX_COMPOSITE_ENTRY_VETO_NATIVE_FULL8_20261023.json").write_text(
     json.dumps(results,ensure_ascii=False,indent=2)+"\n",encoding="utf8",newline="\n")
   print("FULL8_AVAX_ENTRY_GATE",case,cost,"FINAL",round(info["finalEquityJpy"]),
     "GAIN",round(info["deltaVsCompositeJpy"]),"DD",round(info["ddPct"],6),
     "TRADES",info["closedTrades"],"AVAX",info["avaxCount"],
     "AVA_WINS",info["avaxWins"],"WR",round(100*info["avaxWins"]/len(avax),2) if avax else None,
     "ALL_WR",round(100*info["totalWinners"]/info["closedTrades"],3),
     "PF",round(info["portfolioPF"],4),"PASSES",len(passes),flush=True)
 print("FULL8_AVAX_ENTRY_GATE_RESEARCH_COMPLETE",len(results["cases"]))
if __name__=="__main__":main()
