#!/usr/bin/env python3
"""V52 LONG and SHORT scheduled-checkpoint exits: formal 8-logic replay.

FET trailing +8% arm/4 percentage-point giveback, HYPE LONG, RENDER/TAO
three additional Idle SHORT rules and prior V12/Q102 exits are fixed.

All stock exit prices use archived Aster official H1 and Yahoo public H1,
strictly from PREVIOUSLY COMPLETED hours; no 5m token proxy and no intrabar
stop claim. Native V52 exit reason and source price must match before overlay.
Only research; never places orders, changes LIVE, or deploys VPS.
"""
from __future__ import annotations
import argparse,bisect,collections,hashlib,importlib.util,json,math
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
ASTER=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/Previous_Projects/bt-analysis-formal/formal_extract/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests")
YAHOO=ROOT/"v52_hourly_reference_recovery"
HOUR=3600000
CASE_BASE="V52_AFTER_FET84_NO_CHANGE"
CASES={
 CASE_BASE:None,
 "V52_SHORT_PARTIAL_CONV30_PNL0P2":{"id":"V52_SHORT_PARTIAL_CONV30_PNL0P2","strategy":"V52","sides":["SHORT"],"kind":"partial_convergence","progressBps":30.0,"minPriceGainFraction":.002},
 "V52_SHORT_BASIS125_LOSS0P1":{"id":"V52_SHORT_BASIS125_LOSS0P1","strategy":"V52","sides":["SHORT"],"kind":"basis_early","basisRatioMin":1.25,"maxPriceGainFraction":-.001},
 "V52_LONG_PARTIAL_CONV30_PNL0P2":{"id":"V52_LONG_PARTIAL_CONV30_PNL0P2","strategy":"V52","sides":["LONG"],"kind":"partial_convergence","progressBps":30.0,"minPriceGainFraction":.002},
}
SYMBOLS=("TSLA","NVDA","META","MSFT","AMZN")
PARENT=HERE/"run-fet-exits-after-hype-render-tao-20261022.py"
spec=importlib.util.spec_from_file_location("v52_full8_parent_fet84",PARENT)
assert spec and spec.loader
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
m=p.m
PARENT_APPLY=p.apply
PARENT_FET=p.RULES["FET_TRAIL_8P_GIVEBACK_4P"]
HYPE_IDLE_TRIPLE=p.TRIPLE
RESEARCH_INSTRUMENT="Aster official 1h stock perpetual + Yahoo 60m price-only"
PRICES={}
INDEX={}
STATS=collections.Counter()

def jsonl(file):
 with Path(file).open(encoding="utf-8") as f:return [json.loads(s) for s in f if s.strip()]

def digest(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for chunk in iter(lambda:f.read(1<<20),b""):h.update(chunk)
 return h.hexdigest()

def acquire_verified_h1():
 coverage=json.loads((ASTER/"aster-stock-hourly-coverage.json").read_text(encoding="utf-8"))
 manifest=json.loads((YAHOO/"yahoo-h1-provenance-manifest.json").read_text(encoding="utf-8"))
 for sym in SYMBOLS:
  af=ASTER/"normalized"/"aster_stock"/"klines"/f"{sym}USDT.jsonl"
  yf=YAHOO/f"yahoo-{sym}-h1.jsonl"
  assert digest(af)==coverage["symbols"][sym]["normalized_sha256"]
  assert digest(yf)==manifest[sym]["normalizedSha256"]
  a=jsonl(af);y=jsonl(yf)
  aa=[(int(v["event_time_ms"]),float(v["close"])) for v in a]
  yy=[(int(v["start_ms"]),float(v["close"])) for v in y]
  assert len(aa)==8784 and len(yy)>1500
  assert all(aa[i][0]>aa[i-1][0] for i in range(1,len(aa)))
  assert all(yy[i][0]>yy[i-1][0] for i in range(1,len(yy)))
  PRICES[sym]={"a":([v[0] for v in aa],[v[1] for v in aa]),
               "y":([v[0] for v in yy],[v[1] for v in yy])}
 source=REPO/"docs/research/results/v4-production-cert-20261009/bt-baseline/cases/V2_M150_D05_CORE_NATIVE/runs/PRICE_MODEL_10BPS/candidate-decisions.jsonl"
 old=[x for x in jsonl(source) if x.get("strategy_id")=="V52"
      and isinstance(x.get("v52_entry_basis_bps"),(int,float))
      and isinstance(x.get("v52_yahoo_entry_reference_usd"),(int,float))]
 bykey=collections.defaultdict(list)
 for row in old:bykey[(int(row["entry_ts_ms"]),str(row["symbol"]),str(row["side"]))].append(row)
 INDEX.update(bykey)
 assert len(old)==88
 print("V52_YAHOO_ASTER_HOURLY_SOURCES_ALL_5_SHA256_VERIFIED",len(old),flush=True)

def asof(sym,source,ts):
 times,vals=PRICES[sym][source]
 i=bisect.bisect_right(times,ts-HOUR)-1
 if i<0:return None
 assert times[i]+HOUR<=ts
 return vals[i]

def native_basis_reason(basis,original):
 if abs(basis)<=20. or basis*original<=0:return "BASIS_CONVERGED"
 if abs(basis)>=1.75*abs(original):return "BASIS_STOP"
 return "TIME_OR_SESSION_FLAT"

def matching_entry(row):
 if row.get("strategy_id")!="V52" or row.get("symbol") not in {x+"USDT" for x in SYMBOLS}:return None
 key=(int(row["entry_ts_ms"]),str(row["symbol"]),str(row["side"]))
 items=INDEX.get(key,[])
 if len(items)!=1:
  STATS["unknown_source_entry"]+=1;return None
 original=items[0]
 sym=row["symbol"][:-4];entry=int(row["entry_ts_ms"]);exit_ts=int(row["exit_ts_ms"])
 y0=asof(sym,"y",entry);a0=asof(sym,"a",entry)
 yend=asof(sym,"y",exit_ts);aend=asof(sym,"a",exit_ts)
 if any(x is None for x in (y0,a0,yend,aend)):STATS["missing_hourly"]+=1;return None
 b0=float(original["v52_entry_basis_bps"])
 if abs(10000*(a0/y0-1)-b0)>5:
  STATS["basis_entry_mismatch"]+=1;return None
 if abs(10000*(a0/float(row["entry_price"])-1))>1:
  STATS["aster_entry_mismatch"]+=1;return None
 if abs(10000*(aend/float(row["exit_price"])-1))>1:
  STATS["aster_exit_mismatch"]+=1;return None
 exit_basis=10000*(aend/yend-1)
 expected=native_basis_reason(exit_basis,b0)
 reason=str(row.get("exit_reason_actual") or row.get("exit_reason"))
 if expected!=reason:
  STATS["baseline_exit_reason_mismatch"]+=1;return None
 return sym,b0

def apply(row,rule,source,cost,obs,original_row=None):
 if rule.get("strategy")!="V52":
  return PARENT_APPLY(row,rule,source,cost,obs,original_row=original_row)
 if row.get("strategy_id")!="V52" or row.get("side") not in rule["sides"]:return row
 matched=matching_entry(row)
 if matched is None:return row
 sym,b0=matched
 entry=int(row["entry_ts_ms"]);old_exit=int(row["exit_ts_ms"]);entryprice=float(row["entry_price"])
 sign=1.0 if row["side"]=="LONG" else -1.0
 if entryprice<=0:return row
 for elapsed in (1,2):
  cp=entry+elapsed*HOUR
  if cp>=old_exit:break
  a=asof(sym,"a",cp);y=asof(sym,"y",cp)
  if a is None or y is None or a<=0 or y<=0:
   STATS["missing_checkpoint"]+=1;return row
  basis=10000*(a/y-1)
  native=native_basis_reason(basis,b0)
  if native!="TIME_OR_SESSION_FLAT":
   # Older original V52 exit would have had precedence and this replay
   # would be inconsistent at an earlier checkpoint, so fail closed.
   STATS["native_prior_mismatch"]+=1;return row
  rel=sign*(a/entryprice-1)
  progress=abs(b0)-abs(basis)
  trig=False
  if rule["kind"]=="partial_convergence":
   trig=progress>=rule["progressBps"] and rel>=rule["minPriceGainFraction"]
  elif rule["kind"]=="basis_early":
   trig=(abs(basis)>=rule["basisRatioMin"]*abs(b0)
         and rel<=rule["maxPriceGainFraction"])
  else:raise RuntimeError("UNDECLARED_V52_EXIT_CASE")
  if not trig:continue
  # Original model will separately apply cost; add conservative 10 bps
  # one-way exit slippage, no order book or signed fill was available.
  close=float(a)*(1.0-sign*10.0/10000)
  if close<=0:return row
  obs["triggered"]+=1
  obs["by_reason"][rule["id"]]+=1
  STATS["modelled_hourly_early_exit_"+rule["id"]]+=1
  return dict(row,exit_ts_ms=cp,exit_price=close,
       unit_price_return=sign*(close/entryprice-1),
       exit_reason="RESEARCH_H1_"+rule["id"])
 return row

def replay(name,cost,source,helper,previous):
 prev=None
 snapshots=[]
 for iteration in range(6):
  m.base.CURRENT.clear()
  if prev is not None:m.base.CURRENT["cooldown_events"]=prev
  m.entry.ACTIVE["policy"]=m.hype.GATE
  for k in ("lookups","passed","blocked","missing"):m.entry.ACTIVE[k].clear()
  for k in ("passed","blocked","missing"):m.ACTIVE[k].clear()
  m.ACTIVE["checked"]=0
  m.ACTIVE["policy"]=m.POLICIES[HYPE_IDLE_TRIPLE]
  overlays=[m.hype.V4,m.hype.Q102,m.idle.HYPE_RULE,m.EXIT_RULES[HYPE_IDLE_TRIPLE],PARENT_FET]
  if name!=CASE_BASE:overlays.append(CASES[name])
  result=m.core._run_engine("V52_"+name+"_C"+str(cost)+"_I"+str(iteration),
      "V12_LONG_COMPOSITE",overlays,cost,source,helper,previous)
  assert result["accounting"]=="PASS"
  assert not m.ACTIVE["missing"] and not m.entry.ACTIVE["missing"],"UNSUPPORTED_M5_SIGNAL_FEATURES"
  events=m.base.actual_cooldown_events(result)
  snapshots.append({"iteration":iteration,"cooldownEvents":len(events)})
  if events==prev:return result,snapshots
  prev=events
 raise RuntimeError("V52_DYNAMIC_FULL8_RESELECTION_NOT_CONVERGED")

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--cases",nargs="+",default=list(CASES))
 parser.add_argument("--output",required=True,type=Path)
 args=parser.parse_args()
 assert set(args.cases)<=set(CASES) and len(set(args.cases))==len(args.cases)
 assert REPO not in (args.output.resolve(),*args.output.resolve().parents)
 acquire_verified_h1()
 args.output.mkdir(parents=True,exist_ok=True)
 m.core.OUTPUT=args.output
 m.core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 m.core._transform_rows=m.entry_filter
 m.core._apply_initial_stop=apply
 m.core._matches=m.idle.matches
 source,helper=m.core.task8.legacy.bootstrap()
 m.base.install_legacy_capture(helper)
 m.core.Path.write_text=m.core._path_write_text
 m.core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 original=json.loads((ROOT/"f8fet/FET_NEXT_FULL8_RESEARCH_20261022.json").read_text(encoding="utf-8"))
 expected=original["cases"]["FET_TRAIL_8P_GIVEBACK_4P"]["costs"]
 output={"status":"V52_HOURLY_ASOF_RESEARCH_ONLY_NO_LIVE", "cases":{},
   "reference":"User adopted HYPE+Idle and FET8/4 research baseline, not current venue Production",
   "hourlyDataProvenance":str(YAHOO/"yahoo-h1-provenance-manifest.json"),
   "nativeBasisStopMultiple":1.75,
   "caveat":"Completed H1 price-only model, no actual book/venue fill or current Production TypeScript certification",
   "quoteExceptions":"Entry basis/exit reason outliers are protected by no-change fail closed"}
 for name in args.cases:
  out={}
  for cost in (10,30):
   STATS.clear()
   v,history=replay(name,cost,source,helper,previous)
   trades=jsonl(v["ledger"])
   vt=[x for x in trades if x.get("strategy_id")=="V52"]
   assert len(vt)>0
   wins=sum(x["modeled_realized_pnl_jpy_at_exit_fx"]>0 for x in vt)
   row={
    "equityJpy":v["final_equity_jpy"],
    "deltaVsFet84BaselineJpy":v["final_equity_jpy"]-expected[str(cost)]["portfolioFinalEquityJpy"],
    "maxMtmDdPct":v["maximum_mtm_drawdown_pct"],
    "profitFactor":v["profit_factor"],
    "closedTrades":v["closed_trades"],
    "v52Trades":len(vt),"v52Wins":wins,"v52Losses":len(vt)-wins,
    "v52ModeledPnlJpy":sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in vt),
    "v52BySide":{side:{
       "trades":sum(x["side"]==side for x in vt),
       "wins":sum(x["side"]==side and x["modeled_realized_pnl_jpy_at_exit_fx"]>0 for x in vt),
       "pnlJpy":sum(x["modeled_realized_pnl_jpy_at_exit_fx"] for x in vt if x["side"]==side)
    } for side in ("LONG","SHORT")},
    "modifiedV52Exits":sum(str(x.get("exit_reason_actual") or x.get("exit_reason")).startswith("RESEARCH_H1_V52") for x in vt),
    "sourceStats":dict(STATS),"ledgerSha256":digest(v["ledger"]),
    "accounting":v["accounting"],"reselectionHistory":history,
   }
   if name==CASE_BASE:
    assert abs(row["equityJpy"]-expected[str(cost)]["portfolioFinalEquityJpy"])<.20
    assert abs(row["maxMtmDdPct"]-expected[str(cost)]["maxMtmDdPct"])<1e-7
    assert row["v52Trades"]==87
   out[str(cost)]=row
   print("V52_FULL8_CASE",name,cost,"FINAL",round(row["equityJpy"]),
      "DELTA",round(row["deltaVsFet84BaselineJpy"]),
      "DD",round(row["maxMtmDdPct"],5),
      "V52",row["v52Wins"],row["v52Losses"],"EXIT_N",row["modifiedV52Exits"],
      "OBSERVER",row["sourceStats"],flush=True)
  output["cases"][name]={"rule":CASES[name],"costs":out}
  (args.output/"V52_HOURLY_FULL8_RESULTS_20261022.json").write_text(
    json.dumps(output,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("V52_FULL8_ALL_CASES_RESEARCH_DONE",len(output["cases"]),flush=True)
if __name__=="__main__":
 raise SystemExit("V52_DIRECT_CRYPTO_CANDIDATE_HOOK_IS_INERT_FOR_STOCK: use run-v52-correct-stock-tape-full8-after-fet-20261022.py")
