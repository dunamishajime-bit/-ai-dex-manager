"""External fixed-rule route study and independent Y06 exit/causality verification."""
import sys, pathlib, hashlib, json, math, collections, datetime
sys.dont_write_bytecode=True
SOURCE=pathlib.Path("C:/Users/dis/DisDex-five-improvements-20261008")
DEST=pathlib.Path(__file__).resolve().parents[2]/"docs/research/results/v4-production-cert-20261009/bt-external"
DEST.mkdir(parents=True,exist_ok=True)
script=SOURCE/"scripts/research/run_v12_multilogic_causal_holdout.py"
code=script.read_text(encoding="utf-8")
prefix=code[:code.index("features_list=[];route_trades=[];unassigned=[];incomplete=[]")]
ns={"__file__":str(script),"__name__":"__cert_external__"}
exec(compile(prefix,str(script),"exec"),ns)
H=3600000
route_trades=[]
y06=[]
causal_checks=[]
base_b=ns["b"]
for c in ns["candidates"]:
    accessed=[]
    def traced_b(sym,t):
        accessed.append(int(t))
        return base_b(sym,t)
    ns["b"]=traced_b
    f=ns["features"](c)
    ns["b"]=base_b
    assert accessed and max(accessed)<c["entry_ts_ms"], (c,max(accessed))
    causal_checks.append({"symbol":c["symbol"],"entry_ts_ms":c["entry_ts_ms"],"max_feature_bar_open_ms":max(accessed),"feature_complete":f is not None})
    if f is None:continue
    route,exit_name=ns["assign"](f)
    if route is None:continue
    z=ns["apply_exit"](dict(f,route=route,route_exit=exit_name),exit_name)
    if z is None:continue
    route_trades.append(z)
    if route=="REC_Y06_REV_D0_T72":
        assert c["side"]=="LONG"
        t=int(c["entry_ts_ms"])
        def close(sym,t):return float(ns["bars"][sym][t]["close"])
        rel=(close(c["symbol"],t-H)/close(c["symbol"],t-25*H)-1)-(close("BTCUSDT",t-H)/close("BTCUSDT",t-25*H)-1)
        assert rel>0 and math.isclose(rel,f["rel24"],abs_tol=1e-12)
        entry=float(c["entry_price"])
        exit=float(ns["bars"][c["symbol"]][t+72*H]["open"])
        independent={"symbol":c["symbol"],"source_side":"LONG","side":"SHORT","entry_ts_ms":t,"exit_ts_ms":t+72*H,"entry_price":entry,"exit_price":exit,"unit_gross_return":1-exit/entry,"rel24_from_closed_bars":rel}
        for k in ["entry_price","exit_price","unit_gross_return"]:assert math.isclose(independent[k],z[k],abs_tol=1e-12)
        assert independent["side"]==z["side"] and independent["exit_ts_ms"]==z["exit_ts_ms"]
        y06.append(independent)
tokens={(t["symbol"],t["side"],int(t["entry_ts_ms"])) for t in route_trades}
for c in ns["rows"](ns["CORE_DIR"]/"holdout-trades.jsonl"):
    if not ns["START"]<=c["entry_ts_ms"]<ns["ENTRY_END"]:continue
    token=(c["symbol"],c["side"],int(c["entry_ts_ms"]))
    if token not in tokens:
        route_trades.append(dict(c,route="FAILED_BREAK_REV_SHORT_6H",unit_gross_return=float(c["unit_gross_return"])))
        tokens.add(token)
route_trades.sort(key=lambda x:(int(x["entry_ts_ms"]),x["symbol"],x["route"]))
reference=ns["rows"](ns["BASE"]/"causal-trades.jsonl")
assert route_trades==reference, "EXTERNAL_ROUTE_LEDGER_MISMATCH"
def calc(rows,bps):
    vals=[r["unit_gross_return"]-bps/10000 for r in rows]
    gain=sum(max(0,x) for x in vals);loss=-sum(min(0,x) for x in vals)
    return {"n":len(vals),"wins":sum(x>0 for x in vals),"losses":sum(x<0 for x in vals),"pf":gain/loss if loss else None,"mean":sum(vals)/len(vals) if vals else None,"sum":sum(vals)}
groups=collections.defaultdict(list)
for r in route_trades:groups[r["route"]].append(r)
priority_path=SOURCE/"docs/research/results/v12-v4-priority-gross-v2-20261009/route-priority-score.json"
priority=json.loads(priority_path.read_text())
summary={"status":"EXTERNAL_FIXED_RULE_ROUTE_ONLY_NOT_FULL8_PORTFOLIO","route_ledger_exact_reference_equal":True,"causal_feature_checks":len(causal_checks),
"external_period": {"start":ns["START"],"entry_end":ns["ENTRY_END"]},
"fixed_priority_source_sha256":hashlib.sha256(priority_path.read_bytes()).hexdigest(),"priority_frozen_at_training_end_for_external_evaluation":True,
"priority_retrospectively_fit_within_training":True,"external_priority_not_reoptimized":True,
"selected_v2_secondpass_route_repairs_applied":False,"fixed_priority_portfolio_admission_replayed":False,
"all_routes":{str(c):calc(route_trades,c) for c in [10,20,30]},
"by_route":{k:{str(c):calc(v,c) for c in [10,20,30]} for k,v in sorted(groups.items())},
"y06_independent":{str(c):calc(y06,c) for c in [10,20,30]},
"limitations":["Frozen original V4 routing differs from selected repaired V2; this is exact original external-source rerun, not selected-policy certification.","No quantity, shared ownership, portfolio funding or DD replay.","External Aug-Oct period previously inspected; not pristine prospective holdout."],"trading_mutation":0}
for name,rows in [("route-trades.jsonl",route_trades),("y06-independent.jsonl",y06),("causal-feature-checks.jsonl",causal_checks)]:
    (DEST/name).write_text("".join(json.dumps(x,sort_keys=True)+"\n" for x in rows),encoding="utf-8")
(DEST/"summary.json").write_text(json.dumps(summary,indent=2)+"\n",encoding="utf-8")
inputs=[script,priority_path,ns["S2"],ns["S3"],ns["BASE"]/"baseline-candidates.jsonl",ns["CORE_DIR"]/"holdout-trades.jsonl"]+sorted(ns["DATA"].glob("*.jsonl"))
(DEST/"input-manifest.json").write_text(json.dumps([{"path":str(p),"sha256":hashlib.sha256(p.read_bytes()).hexdigest()} for p in inputs],indent=2)+"\n")
print(json.dumps({"status":summary["status"],"all_routes":summary["all_routes"],"y06":summary["y06_independent"],"causal_feature_checks":len(causal_checks)},indent=2))
