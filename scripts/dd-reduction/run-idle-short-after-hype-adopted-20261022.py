#!/usr/bin/env python3
"""Evaluate IDLE SHORT initial adverse protection with user-adopted HYPE long entry+dual exits.
8-strategy causal reallocation, V12 V4 4 + Q102 3 untouched, no LIVE.
"""
from __future__ import annotations
import argparse,collections,hashlib,importlib.util,json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file)
 assert spec and spec.loader
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
hype=load("cumulative_adopted_hype","run-hype-gated-protection-20261022.py")
entry=hype.entry
base=hype.base
core=hype.core
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
OUT=ROOT/"i8"
CONFIG=ROOT/"repo"/"config"/"research"/"hype-entry-adopted-20261022.json"
HYPE_RULE=hype.RULES["COMBO_I1H1_P3F1P5"]
IDLE_RULES={
 "IDLE_RENDER_INITIAL_1H_1P0_MFE0P3":{"id":"IDLE_RENDER_SHORT_INITIAL_1H_1P0_MFE0P3",
    "strategy":"IDLE","sides":["SHORT"],"symbols":["RENDERUSDT"],"kind":"initial",
    "arm_hours":1,"stop_pct":.01,"mfe_gate_pct":.003,"reentry_hours":0},
 "IDLE_TAO_INITIAL_1H_1P0_MFE0P3":{"id":"IDLE_TAO_SHORT_INITIAL_1H_1P0_MFE0P3",
    "strategy":"IDLE","sides":["SHORT"],"symbols":["TAOUSDT"],"kind":"initial",
    "arm_hours":1,"stop_pct":.01,"mfe_gate_pct":.003,"reentry_hours":0},
 "IDLE_RENDER_TAO_INITIAL_1H_1P0_MFE0P3":{"id":"IDLE_RENDER_TAO_SHORT_INITIAL_1H_1P0_MFE0P3",
    "strategy":"IDLE","sides":["SHORT"],"symbols":["RENDERUSDT","TAOUSDT"],"kind":"initial",
    "arm_hours":1,"stop_pct":.01,"mfe_gate_pct":.003,"reentry_hours":0}
}
def matches(row,rule):
 if rule.get("strategy")=="IDLE" and row.get("symbol") not in rule.get("symbols",()):
  return False
 return base.ORIGINAL_MATCHES(row,rule)

def apply(row,rule,source,cost_bps,obs,original_row=None):
 if rule.get("strategy")=="IDLE":
  if not matches(row,rule):return row
  return base.ORIGINAL_APPLY(row,rule,source,cost_bps,obs,original_row=original_row)
 return hype.apply(row,rule,source,cost_bps,obs,original_row=original_row)

def jsonl(path):
 with Path(path).open(encoding="utf-8") as f:return [json.loads(s) for s in f if s.strip()]

def digest(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for part in iter(lambda:f.read(1024*1024),b""):h.update(part)
 return h.hexdigest()

def run(name,cost,rule,source,helper,previous):
 prev=None;last=None;passes=[]
 for i in range(5):
  base.CURRENT.clear()
  if prev is not None:base.CURRENT["cooldown_events"]=prev
  entry.ACTIVE["policy"]=hype.GATE
  for k in ("lookups","passed","blocked","missing"):entry.ACTIVE[k].clear()
  overlays=[hype.V4,hype.Q102,HYPE_RULE]+([rule] if rule else [])
  last=core._run_engine(f"IDLE_AFTER_HYPE_{name}_C{cost}_I{i}",
       "V12_LONG_COMPOSITE",overlays,cost,source,helper,previous)
  assert last["accounting"]=="PASS"
  events=base.actual_cooldown_events(last)
  passes.append({"iteration":i,"v12ShortStopEvents":len(events),
                 "hypeSourceMissing":len(entry.ACTIVE["missing"])})
  assert len(entry.ACTIVE["missing"])==0
  if prev==events:break
  if i==4:raise RuntimeError("V12_SHORT_COOLDOWN_CONVERGENCE_FAILED")
  prev=events
 assert last is not None
 return last,passes

def main():
 a=argparse.ArgumentParser()
 a.add_argument("--cases",nargs="+",default=["HYPE_ADOPTED_BASELINE",*IDLE_RULES])
 a.add_argument("--output",type=Path,default=OUT)
 args=a.parse_args()
 assert len(args.cases)==len(set(args.cases))
 assert all(x=="HYPE_ADOPTED_BASELINE" or x in IDLE_RULES for x in args.cases)
 conf=json.loads(CONFIG.read_text(encoding="utf-8"))
 assert conf["adoptedCombinedCaseId"]=="COMBO_I1H1_P3F1P5"
 assert conf["adoptedInitialAdverseExit"]["adverseMoveFromEntryPct"]==-1
 assert conf["adoptedProfitProtectionExit"]["protectedGainFromEntryPct"]==1.5
 prior=conf["adoptedDualExitIntegratedAnchor"]
 args.output.mkdir(parents=True,exist_ok=True)
 core.OUTPUT=args.output;core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 core._transform_rows=entry.candidate_transform
 core._apply_initial_stop=apply;core._matches=matches
 source,helper=core.task8.legacy.bootstrap()
 base.install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 results={}
 for name in args.cases:
  rule=None if name=="HYPE_ADOPTED_BASELINE" else IDLE_RULES[name]
  costs={}
  for cost in (10,30):
   data,passes=run(name,cost,rule,source,helper,previous)
   trades=jsonl(data["ledger"])
   idle=[x for x in trades if x.get("strategy_id")=="IDLE" and x.get("side")=="SHORT"]
   other=[x for x in trades if x.get("strategy_id")=="HYPE_LONG"]
   assert len(other)>0
   entry.ACTIVE["lookups"].clear()
   assert all(entry.gate_hype(x,hype.GATE,source) for x in other)
   ref=prior[str(cost)]
   if rule is None:
    assert abs(data["final_equity_jpy"]-ref["finalEquityJpy"])<.1
    assert abs(data["maximum_mtm_drawdown_pct"]-ref["maxMtmDdPct"])<1e-8
    assert len(other)==ref["hypeTrades"] and sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"])>0 for x in other)==ref["hypeWins"]
   exits=collections.Counter(str(x["exit_reason_actual"]) for x in idle)
   wins=sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"])>0 for x in idle)
   source_dir=Path(data["ledger"]).parent
   hashes={n:digest(source_dir/n) for n in ("portfolio-trades.jsonl","candidate-decisions.jsonl","portfolio-events.jsonl","task9-mtm.jsonl","metrics.json") if (source_dir/n).exists()}
   costs[str(cost)]={"finalEquityJpy":data["final_equity_jpy"],"equityDeltaVsHypeAdoptedJpy":data["final_equity_jpy"]-ref["finalEquityJpy"],
      "maxMtmDdPct":data["maximum_mtm_drawdown_pct"],"ddDeltaPp":data["maximum_mtm_drawdown_pct"]-ref["maxMtmDdPct"],
      "profitFactor":data["profit_factor"],"totalClosedTrades":data["closed_trades"],
      "idleShortTrades":len(idle),"idleShortWins":wins,"idleShortLosses":len(idle)-wins,
      "idleShortRealizedJpy":sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in idle),
      "idleShortExitReasons":dict(exits),"replayPasses":passes,"accounting":data["accounting"],
      "hypeAcceptedTradeCount":len(other),"ledgersSha256":hashes}
   print("CASE",name,cost,"EQUITY",round(data["final_equity_jpy"]),
         "DELTA",round(costs[str(cost)]["equityDeltaVsHypeAdoptedJpy"]),
         "DD",round(data["maximum_mtm_drawdown_pct"],5),
         "IDLE_SHORT",len(idle),"WINS",wins,
         "PROTECTIVE",sum(v for k,v in exits.items() if "IDLE_" in k),
         "COOLDOWN_PASSES",len(passes),flush=True)
  results[name]={"rule":rule,"costs":costs}
  result={"status":"IDLE_SHORT_AFTER_USER_ADOPTED_HYPE_LONG_RESEARCH_NOT_LIVE",
      "period":"2025-08-10..2026-08-10","startingJPY":10000,
      "sourceHypeAdoptedCaseId":"COMBO_I1H1_P3F1P5",
      "sourceHypeAdoptedEntryGate":hype.GATE,"lockedV12V4AndQ102":True,
      "eightLogicChronologicalReselection":True,
      "productionOrOrdersChanged":False,"independentTask9TypeScriptParityCertified":False,
      "HypeAdoptedBaseline":prior,"results":results}
  (args.output/"IDLE_SHORT_FULL8_AFTER_HYPE_ADOPTED_20261022.json").write_text(
     json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print("COMPLETED",len(results),flush=True)
if __name__=="__main__":main()
