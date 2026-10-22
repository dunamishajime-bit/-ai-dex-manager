#!/usr/bin/env python3
"""Pre-allocation causal entry gates for five IDLE SHORT symbols, HYPE adopted 3-condition baseline retained."""
from __future__ import annotations
import argparse,collections,hashlib,importlib.util,json,math
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
OUT=ROOT/"f8v2"
def load(name,f):
 spec=importlib.util.spec_from_file_location(name,HERE/f)
 assert spec and spec.loader
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
idle=load("idle_cumulative","run-idle-short-after-hype-adopted-20261022.py")
screen=load("idle5_feature_screen","screen-idle-five-symbol-entry-caused-20261022.py")
entry=idle.entry
hype=idle.hype
base=idle.base
core=idle.core
SYMBOLS=set(screen.SYMS)
FEATURE_RULES=dict(screen.CANDIDATES)
POLICIES={
 "HYPE_ADOPTED_BASELINE":{},
 "RENDER_VOL1P2":{"RENDERUSDT":["VOLUME1H_GE1P2"]},
 "RENDER_BTC6LE0_RET6GE_MINUS4":{"RENDERUSDT":["BTC6H_LE0","RET6H_GE_MINUS4"]},
 "RENDER_VOL1P2_RET24GE_MINUS7":{"RENDERUSDT":["VOLUME1H_GE1P2","RET24H_GE_MINUS7"]},
 "RENDER_BTC3GE_MINUS0P5_REL6LE0":{"RENDERUSDT":["BTC3H_GE_MINUS0P5","REL6H_LE0"]},
 "RENDER_RET6GE_MINUS4_REL6GE_MINUS2":{"RENDERUSDT":["RET6H_GE_MINUS4","REL6H_GE_MINUS2"]},
 "RENDER_RET6GE_MINUS2P5_RET3GE_MINUS1":{"RENDERUSDT":["RET6H_GE_MINUS2P5","RET3H_GE_MINUS1"]},
 "RENDER_ATR3H_LE0P45":{"RENDERUSDT":["ATR3H_LE0P45"]},
 "TAO_RET1H_LE_MINUS1":{"TAOUSDT":["RET1H_LE_MINUS1"]},
 "DOT_VOL1P2":{"DOTUSDT":["VOLUME1H_GE1P2"]},
 "DOT_RET6GE_MINUS4":{"DOTUSDT":["RET6H_GE_MINUS4"]},
 "JUP_REL3GE_MINUS1":{"JUPUSDT":["REL3H_GE_MINUS1"]},
}
ACTIVE={"policy":{},"passed":set(),"blocked":set(),"missing":set(),"checked":0}
def entry_filter(rows,overlays,source,cost_bps,obs,baseline_lookup=None):
    # Apply fixed native overlays and the user-adopted HYPE long entry gate first.
    transformed=entry.candidate_transform(rows,overlays,source,cost_bps,obs,baseline_lookup)
    if not ACTIVE["policy"]:return transformed
    out=[]
    for row in transformed:
        rules=ACTIVE["policy"].get(str(row.get("symbol")))
        if not rules or row.get("strategy_id")!="IDLE" or row.get("side")!="SHORT":
            out.append(row);continue
        tag=(str(row.get("candidate_id")),str(row.get("symbol")))
        f=screen.get_feat(source,str(row["symbol"]),int(row["entry_ts_ms"]))
        ACTIVE["checked"]+=1
        if f is None:
            ACTIVE["missing"].add(tag)
            # Entry unavailable and policy active -> fail closed.
            ACTIVE["blocked"].add(tag);continue
        if all(screen.passes(f,FEATURE_RULES[k]) for k in rules):
            out.append(row);ACTIVE["passed"].add(tag)
        else:ACTIVE["blocked"].add(tag)
    return out
def jsonl(p):
 with Path(p).open(encoding="utf-8") as f:return [json.loads(x) for x in f if x.strip()]
def digest(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
 return h.hexdigest()
def replay(name,cost,source,helper,prev_filter):
 prev=None;last=None;passes=[]
 for i in range(5):
  base.CURRENT.clear()
  if prev is not None:base.CURRENT["cooldown_events"]=prev
  entry.ACTIVE["policy"]=hype.GATE
  for key in ("lookups","passed","blocked","missing"):entry.ACTIVE[key].clear()
  for key in ("passed","blocked","missing"):ACTIVE[key].clear()
  ACTIVE["checked"]=0
  ACTIVE["policy"]=POLICIES[name]
  overlays=[hype.V4,hype.Q102,idle.HYPE_RULE]
  last=core._run_engine(f"IDLE5_{name}_C{cost}_I{i}","V12_LONG_COMPOSITE",overlays,cost,source,helper,prev_filter)
  assert last["accounting"]=="PASS"
  assert not ACTIVE["missing"] and not entry.ACTIVE["missing"], ("PRICE_WINDOW_MISSING",name,cost,ACTIVE["missing"],entry.ACTIVE["missing"])
  stops=base.actual_cooldown_events(last)
  passes.append({"i":i,"stops":len(stops),"entryCandidatesChecked":ACTIVE["checked"],
                 "idlesAllowed":len(ACTIVE["passed"]),"idlesRejected":len(ACTIVE["blocked"]),
                 "hypePassed":len(entry.ACTIVE["passed"]),"hypeRejected":len(entry.ACTIVE["blocked"])})
  if prev==stops:break
  if i==4:raise RuntimeError(f"V12_SHORT_COOLDOWN_NO_CONVERGE:{name}:{cost}")
  prev=stops
 return last,passes
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--cases",nargs="+",default=list(POLICIES))
 parser.add_argument("--output",type=Path,default=OUT)
 args=parser.parse_args()
 assert len(set(args.cases))==len(args.cases) and all(n in POLICIES for n in args.cases)
 args.output.mkdir(parents=True,exist_ok=True)
 cfg=json.loads((ROOT/"repo"/"config"/"research"/"hype-entry-adopted-20261022.json").read_text(encoding="utf-8"))
 assert cfg["adoptedCombinedCaseId"]=="COMBO_I1H1_P3F1P5"
 assert cfg["adoptedProfitProtectionExit"]["protectedGainFromEntryPct"]==1.5
 assert cfg["adoptedInitialAdverseExit"]["adverseMoveFromEntryPct"]==-1
 baseline=cfg["adoptedDualExitIntegratedAnchor"]
 core.OUTPUT=args.output
 core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
 core._transform_rows=entry_filter
 core._apply_initial_stop=idle.apply
 core._matches=idle.matches
 source,helper=core.task8.legacy.bootstrap()
 base.install_legacy_capture(helper)
 core.Path.write_text=core._path_write_text
 core.task8.legacy.ensure_baseline(helper)
 previous=helper.experiment_filter
 results={}
 for case in args.cases:
  costs={}
  for c in (10,30):
   data,history=replay(case,c,source,helper,previous)
   ledger=Path(data["ledger"])
   trades=jsonl(ledger)
   idle_trades=[r for r in trades if r.get("strategy_id")=="IDLE" and r.get("side")=="SHORT"]
   hype_trades=[r for r in trades if r.get("strategy_id")=="HYPE_LONG"]
   assert len(hype_trades)>0
   # accepted fills must always satisfy both HYPE entrance gates
   entry.ACTIVE["lookups"].clear()
   assert all(entry.gate_hype(r,hype.GATE,source) for r in hype_trades)
   assert all((str(r["symbol"]) not in POLICIES[case]) or all(
    screen.passes(screen.get_feat(source,str(r["symbol"]),int(r["entry_ts_ms"])),FEATURE_RULES[k])
    for k in POLICIES[case][str(r["symbol"])]) for r in idle_trades)
   ref=baseline[str(c)]
   if case=="HYPE_ADOPTED_BASELINE":
    assert abs(data["final_equity_jpy"]-ref["finalEquityJpy"])<.1
    assert abs(data["maximum_mtm_drawdown_pct"]-ref["maxMtmDdPct"])<1e-7
    assert len(hype_trades)==ref["hypeTrades"]
   symbols={}
   for sym in screen.SYMS:
    ss=[x for x in idle_trades if x["symbol"]==sym]
    wins=sum(float(r["modeled_realized_pnl_jpy_at_exit_fx"])>0 for r in ss)
    symbols[sym]={"trades":len(ss),"wins":wins,"losses":len(ss)-wins,
                  "winRatePct":100*wins/len(ss) if ss else None,
                  "modeledPnlJpy":sum(float(r["modeled_realized_pnl_jpy_at_exit_fx"]) for r in ss),
                  "loserPnlJpy":sum(float(r["modeled_realized_pnl_jpy_at_exit_fx"]) for r in ss if r["modeled_realized_pnl_jpy_at_exit_fx"]<=0)}
   run_dir=ledger.parent
   ledgerHashes={f:digest(run_dir/f) for f in ("portfolio-trades.jsonl","candidate-decisions.jsonl","portfolio-events.jsonl","task9-mtm.jsonl","metrics.json") if (run_dir/f).exists()}
   costs[str(c)]={"finalEquityJpy":data["final_equity_jpy"],
          "equityDeltaVsAdoptedJpy":data["final_equity_jpy"]-ref["finalEquityJpy"],
          "maxMtmDdPct":data["maximum_mtm_drawdown_pct"],
          "maxMtmDdDeltaPp":data["maximum_mtm_drawdown_pct"]-ref["maxMtmDdPct"],
          "profitFactor":data["profit_factor"],"trades":data["closed_trades"],
          "portfolioWinRatePct":100*data["win_rate"],
          "hypeTrades":len(hype_trades),
          "byIdleShortSymbol":symbols,"replay":history,
          "sha256Ledgers":ledgerHashes,"accounting":data["accounting"]}
   print("CASE",case,c,"EQUITY",round(data["final_equity_jpy"]),
         "DELTA",round(costs[str(c)]["equityDeltaVsAdoptedJpy"]),
         "DD",round(data["maximum_mtm_drawdown_pct"],4),
         "RENDER_WR",round(symbols["RENDERUSDT"]["winRatePct"],2),
         "RENDER_N",symbols["RENDERUSDT"]["trades"],
         "TAO_WR",round(symbols["TAOUSDT"]["winRatePct"],2),
         "ITER",len(history),flush=True)
  results[case]={"gates":POLICIES[case],"costs":costs}
  (args.output/"IDLE5_FULL8_AFTER_HYPE_20261022.json").write_text(json.dumps({
   "status":"RESEARCH_ONLY_NOT_LIVE",
   "period":"2025-08-10..2026-08-10","initialCapitalJpy":10000,"costsBps":[10,30],
   "adoptedHypePolicy":"HYPE_BTC3H_LE0P6_REL3H_GE2P0_AND_COMBO_I1H1_P3F1P5",
   "lockedV12V4Q102":True,"independentTask9TypeScriptParityCertified":False,
   "dynamicEightLogicReselection":True,"source": "fully completed historical M5 at candidate entry",
   "liveChanged":False,"results":results},
   ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print("FINISHED",list(results),flush=True)
if __name__=="__main__":main()
