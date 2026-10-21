#!/usr/bin/env python3
"""HYPE: user-adopted BTC3h<=0.6% / HYPE-BTC3h>=2pp entry, plus research exits.
No deployment, no venue actions. Dynamic 8-logic causal reallocation (10/30 bps).
V12 V4 four + Q102 three previously accepted exit rules stay locked.
"""
from __future__ import annotations
import argparse, collections, hashlib, importlib.util, json, math, sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
def load(alias,name):
    spec=importlib.util.spec_from_file_location(alias,HERE/name)
    assert spec and spec.loader
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod
entry=load("hype_gated_entry_research","run-hype-entry-winrate-after-v4-q102adopted3-20261022.py")
old_exit=load("hype_old_exit_research","run-hype-profit-loss-after-accepted-v4-q102-20261022.py")
base=entry.base
core=entry.core
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research")
OUT=ROOT/"2026-10-22_hype_entry_plus_exit_full8"
ANCHOR=ROOT/"2026-10-22_hype_entry_winrate_after_v4_q102adopted3_full8/HYPE_WINRATE_PRIMARY_BTC0P6_REL2_20261022.json"
GATE=entry.POLICIES["HYPE_BTC3H_LE0P6_REL3H_GE2P0"]
Q102=base.Q102_CASES["Q102_ADOPTED2_PLUS_HV_LONG_H1_2H_MINUS3"]
V4=base.V4

RULES={
 "INITIAL_0H_1P5_MFE0P3":{"id":"HYPE_GATED_INITIAL_0H_1P5_MFE0P3","strategy":"HYPE_LONG","sides":["LONG"],"kind":"initial","arm_hours":0,"stop_pct":.015,"mfe_gate_pct":.003,"reentry_hours":0},
 "INITIAL_1H_1P0_MFE0P3":{"id":"HYPE_GATED_INITIAL_1H_1P0_MFE0P3","strategy":"HYPE_LONG","sides":["LONG"],"kind":"initial","arm_hours":1,"stop_pct":.01,"mfe_gate_pct":.003,"reentry_hours":0},
 "INITIAL_1H_1P5_MFE0P5":{"id":"HYPE_GATED_INITIAL_1H_1P5_MFE0P5","strategy":"HYPE_LONG","sides":["LONG"],"kind":"initial","arm_hours":1,"stop_pct":.015,"mfe_gate_pct":.005,"reentry_hours":0},
 "INITIAL_2H_2P0_MFE0P5":{"id":"HYPE_GATED_INITIAL_2H_2P0_MFE0P5","strategy":"HYPE_LONG","sides":["LONG"],"kind":"initial","arm_hours":2,"stop_pct":.02,"mfe_gate_pct":.005,"reentry_hours":0},
 "PROFIT_2P0_FLOOR0P5":{"id":"HYPE_GATED_PROFIT_2P0_FLOOR0P5","strategy":"HYPE_LONG","sides":["LONG"],"kind":"profit","arm":.02,"floor":.005},
 "PROFIT_3P0_FLOOR1P0":{"id":"HYPE_GATED_PROFIT_3P0_FLOOR1P0","strategy":"HYPE_LONG","sides":["LONG"],"kind":"profit","arm":.03,"floor":.01},
 "PROFIT_3P0_FLOOR1P5":{"id":"HYPE_GATED_PROFIT_3P0_FLOOR1P5","strategy":"HYPE_LONG","sides":["LONG"],"kind":"profit","arm":.03,"floor":.015},
 "PROFIT_4P0_FLOOR2P0":{"id":"HYPE_GATED_PROFIT_4P0_FLOOR2P0","strategy":"HYPE_LONG","sides":["LONG"],"kind":"profit","arm":.04,"floor":.02},
 "COMBO_I0H1P5_P3F1":{"id":"HYPE_GATED_COMBO_I0H1P5_P3F1","strategy":"HYPE_LONG","sides":["LONG"],"kind":"combined","arm_hours":0,"stop_pct":.015,"mfe_gate_pct":.003,"reentry_hours":0,"arm":.03,"floor":.01},
 "COMBO_I1H1_P3F1":{"id":"HYPE_GATED_COMBO_I1H1_P3F1","strategy":"HYPE_LONG","sides":["LONG"],"kind":"combined","arm_hours":1,"stop_pct":.01,"mfe_gate_pct":.003,"reentry_hours":0,"arm":.03,"floor":.01},
}

def apply(row,rule,source,cost_bps,obs,original_row=None):
    if rule.get("strategy")!="HYPE_LONG":
        return base.apply(row,rule,source,cost_bps,obs,original_row=original_row)
    if not base.ORIGINAL_MATCHES(row,rule):return row
    kind=rule["kind"]
    if kind=="initial":
        return base.ORIGINAL_APPLY(row,rule,source,cost_bps,obs,original_row=original_row)
    if kind=="profit":
        return old_exit.profit_after_confirmed_m5(row,rule,source,cost_bps,obs)
    if kind=="combined":
        initial=base.ORIGINAL_APPLY(row,rule,source,cost_bps,obs,original_row=original_row)
        profit=old_exit.profit_after_confirmed_m5(row,rule,source,cost_bps,obs)
        return min((row,initial,profit),key=lambda x:int(x["exit_ts_ms"]))
    raise ValueError(kind)

def readjsonl(path):
    with Path(path).open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]

def baseline_trades(cost):
    p=ROOT/"2026-10-22_hype_entry_winrate_after_v4_q102adopted3_full8"/"engine"
    anchor=json.loads(ANCHOR.read_text(encoding="utf-8"))
    runs=anchor["results"]["HYPE_BTC3H_LE0P6_REL3H_GE2P0"]["costs"][str(cost)]["cooldownPasses"]
    ix=runs[-1]["iteration"]
    policy=f"HYPE_WINRATE_HYPE_BTC3H_LE0P6_REL3H_GE2P0_C{cost}_I{ix}"
    hashpart=hashlib.sha256(policy.encode("utf-8")).hexdigest()[:12]
    name="cmp_"+hashpart
    file=p/name/name/f"{cost}bps"/"cases"/"V2_M150_D05_CORE_NATIVE"/"runs"/f"PRICE_MODEL_{cost}BPS"/"portfolio-trades.jsonl"
    assert file.is_file(),file
    rows=[x for x in readjsonl(file) if x.get("strategy_id")=="HYPE_LONG"]
    assert len(rows)==anchor["results"]["HYPE_BTC3H_LE0P6_REL3H_GE2P0"]["costs"][str(cost)]["hypeAcceptedTrades"]
    return rows

def screen(source):
    results={}
    for cost in (10,30):
        rows=baseline_trades(cost)
        checks={}
        for name,rule in RULES.items():
            touched=[];bad=0
            for row in rows:
                obs=collections.defaultdict(int);obs["by_reason"]=collections.Counter();obs["stop_decisions"]=[]
                updated=apply(row,rule,source,cost,obs,original_row=row)
                if int(updated["exit_ts_ms"])<int(row["exit_ts_ms"]):
                    touched.append((row,updated))
                if obs.get("data_gap") or obs.get("internal_gap") or obs.get("entry_mismatch"):
                    bad+=1
            checks[name]={
                "triggered":len(touched),
                "oldLosers":sum(float(o["modeled_realized_pnl_jpy_at_exit_fx"])<=0 for o,n in touched),
                "oldWinners":sum(float(o["modeled_realized_pnl_jpy_at_exit_fx"])>0 for o,n in touched),
                "priceAlignmentOrGapWarnings":bad
            }
        results[str(cost)]={"baselineHypeCount":len(rows),"checks":checks}
        print("SCREEN",cost,json.dumps(results[str(cost)],ensure_ascii=False),flush=True)
    return results

def cooldown_run(label,cost,source,helper,previous,rule,max_iterations=5):
    prev_events=None;hist=[];last=None
    for ix in range(max_iterations):
        base.CURRENT.clear()
        if prev_events is not None:base.CURRENT["cooldown_events"]=prev_events
        entry.ACTIVE["policy"]=GATE
        for k in ("lookups","passed","blocked","missing"):entry.ACTIVE[k].clear()
        overlays=[V4,Q102]+([rule] if rule else [])
        run=core._run_engine(f"HYPE_GATED_PROTECTION_{label}_C{cost}_I{ix}",
                             "V12_LONG_COMPOSITE",overlays,cost,source,helper,previous)
        assert run["accounting"]=="PASS"
        ev=base.actual_cooldown_events(run)
        hist.append({"iteration":ix,"v4AdmittedShortStopCount":len(ev),
                     "appliedPreviousCooldowns":len(prev_events or []),
                     "gateSourceMissing":len(entry.ACTIVE["missing"])})
        last=run
        if prev_events==ev:break
        if ix==max_iterations-1:raise RuntimeError("V4_COOLDOWN_DID_NOT_CONVERGE")
        prev_events=ev
    assert not any(x["gateSourceMissing"] for x in hist)
    return last,hist

def digest(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for part in iter(lambda:f.read(1024*1024),b""):h.update(part)
    return h.hexdigest()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--cases",nargs="+",default=["GATED_BASELINE",*RULES])
    parser.add_argument("--screen-only",action="store_true")
    parser.add_argument("--output",type=Path,default=OUT)
    args=parser.parse_args()
    assert len(set(args.cases))==len(args.cases)
    assert all(name=="GATED_BASELINE" or name in RULES for name in args.cases)
    args.output.mkdir(parents=True,exist_ok=True)
    anchor=json.loads(ANCHOR.read_text(encoding="utf-8"))
    ref=anchor["results"]["HYPE_BTC3H_LE0P6_REL3H_GE2P0"]["costs"]
    assert anchor["acceptedV4FourAndQ102ThreeLocked"]
    assert anchor["sourceArchiveSha256"]
    core.OUTPUT=args.output
    core.BOOTSTRAP_REDIRECT=args.output/"_legacy-bootstrap-cache"
    core._transform_rows=entry.candidate_transform
    core._apply_initial_stop=apply
    core._matches=base.ORIGINAL_MATCHES
    source,helper=core.task8.legacy.bootstrap()
    base.install_legacy_capture(helper)
    core.Path.write_text=core._path_write_text
    core.task8.legacy.ensure_baseline(helper)
    if args.screen_only:
        screen_results=screen(source)
        (args.output/"HYPE_GATED_EXIT_SCREEN_20261022.json").write_text(
            json.dumps(screen_results,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print("SCREEN_DONE",flush=True)
        return
    old_filter=helper.experiment_filter
    output={}
    for name in args.cases:
        rule=None if name=="GATED_BASELINE" else RULES[name]
        costs={}
        for cost in (10,30):
            last,passes=cooldown_run(name,cost,source,helper,old_filter,rule)
            trades=readjsonl(last["ledger"])
            hype=[x for x in trades if x.get("strategy_id")=="HYPE_LONG"]
            wins=sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"])>0 for x in hype)
            mismatched=[]
            entry.ACTIVE["lookups"].clear()
            for row in hype:
                if not entry.gate_hype(row,GATE,source):
                    mismatched.append(str(row.get("candidate_id")))
            assert not mismatched,("GATE_FILL_VIOLATION",mismatched)
            original=ref[str(cost)]
            if rule is None:
                assert abs(last["final_equity_jpy"]-original["finalEquityJpy"])<0.05,("BASELINE_PARITY",cost)
                assert abs(last["maximum_mtm_drawdown_pct"]-original["maxMtmDdPct"])<1e-6
                assert len(hype)==original["hypeAcceptedTrades"]
                assert wins==original["hypeWins"]
            run_dir=Path(last["ledger"]).parent
            hashes={}
            for filename in ("candidate-decisions.jsonl","portfolio-events.jsonl",
                             "portfolio-trades.jsonl","task9-mtm.jsonl","metrics.json"):
                file=run_dir/filename
                if file.exists():hashes[filename]=digest(file)
            exits=collections.Counter(str(x.get("exit_reason_actual")) for x in hype)
            costs[str(cost)]={
                "finalEquityJpy":last["final_equity_jpy"],
                "equityDeltaFromGatedBaselineJpy":last["final_equity_jpy"]-original["finalEquityJpy"],
                "maxMtmDdPct":last["maximum_mtm_drawdown_pct"],
                "ddDeltaFromGatedBaselinePp":last["maximum_mtm_drawdown_pct"]-original["maxMtmDdPct"],
                "profitFactor":last["profit_factor"],"closedTrades":last["closed_trades"],
                "hypeTrades":len(hype),"hypeWins":wins,"hypeLosses":len(hype)-wins,
                "hypeWinRatePct":100*wins/len(hype) if hype else 0,
                "hypePnlJpy":sum(float(x["modeled_realized_pnl_jpy_at_exit_fx"]) for x in hype),
                "hypeExitReasons":dict(exits),"replayPasses":passes,
                "ledgersSha256":hashes,"accounting":last["accounting"]
            }
            print("CASE",name,cost,"HYPE",len(hype),"WINS",wins,"EQUITY",round(last["final_equity_jpy"]),
                  "DELTA",round(costs[str(cost)]["equityDeltaFromGatedBaselineJpy"]),
                  "DD",round(last["maximum_mtm_drawdown_pct"],5),"ITERS",len(passes),flush=True)
        output[name]={"rule":rule,"costs":costs}
        report={"status":"RESEARCH_ONLY_NOT_LIVE","period":"2025-08-10..2026-08-10",
                "sourceCommit":"a40b72af98ce7e923beb3c4f7474c3fb42d4d7c3",
                "sourceArchiveSha256":anchor["sourceArchiveSha256"],
                "startingJPY":10000,"gate":GATE,"acceptedV4FourAndQ102ThreeLocked":True,
                "eightLogicDynamicAllocation":True,"independentTask9ParityCertified":False,
                "ordersProductionVPSModified":False,
                "gatedBaseline":{k:{z:ref[k][z] for z in ("finalEquityJpy","maxMtmDdPct","profitFactor","hypeAcceptedTrades","hypeWins")}
                     for k in ("10","30")},"results":output}
        (args.output/"HYPE_GATED_PROTECTION_FULL8_20261022.json").write_text(
            json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("COMPLETED",len(output),flush=True)

if __name__=="__main__":main()
