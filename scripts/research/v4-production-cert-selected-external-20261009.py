"""Causal translation of selected repaired V2 on external H1; route-only, not portfolio."""
import pathlib,sys,json,ast,re,math,hashlib,collections
sys.dont_write_bytecode=True
SOURCE=pathlib.Path("C:/Users/dis/DisDex-five-improvements-20261008")
DEST=pathlib.Path(__file__).resolve().parents[2]/"docs/research/results/v4-production-cert-20261009/bt-selected-external"
DEST.mkdir(parents=True,exist_ok=True)
script=SOURCE/"scripts/research/run_v12_multilogic_causal_holdout.py"
code=script.read_text(encoding="utf-8")
ns={"__file__":str(script),"__name__":"__cert_selected_external__"}
exec(compile(code[:code.index("features_list=[];route_trades=[];unassigned=[];incomplete=[]")],str(script),"exec"),ns)
H=3600000
def literal(name,file):
 for n in ast.parse(file.read_text(encoding="utf-8")).body:
  if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in n.targets):return ast.literal_eval(n.value)
 raise KeyError(name)
first=literal("REPAIRS",SOURCE/"scripts/research/run_v12_v4_route_repair_integrated.py")
second=literal("SECOND",SOURCE/"scripts/research/run_v12_v4_route_repair_secondpass.py")
extended_path=SOURCE/"docs/research/results/v12-recovery-stage3-extended-20261009/selected-stage3-routes-extended.json"
extended=json.loads(extended_path.read_text())
priority_path=SOURCE/"docs/research/results/v12-v4-priority-gross-v2-20261009/route-priority-score.json"
priority=json.loads(priority_path.read_text());rank={r["route"]:i+4 for i,r in enumerate(priority)};score={r["route"]:r for r in priority}
oldpred=ns["pred"]
def pred(x,k):
 if k=="EXPAND":return isinstance(x.get("compression"),(int,float)) and x["compression"]>=1.1
 if k=="RANGE_MID":return isinstance(x.get("range_loc24"),(int,float)) and .25<=x["range_loc24"]<.75
 if k=="AGE_12_24":return isinstance(x.get("age"),(int,float)) and 12<=x["age"]<24
 return oldpred(x,k)
ns["pred"]=pred
checks=[];base_b=ns["b"]
def causal_features(c,label):
 access=[]
 def traced_b(sym,t):access.append(int(t));return base_b(sym,t)
 ns["b"]=traced_b
 f=ns["features"](c)
 ns["b"]=base_b
 assert access and max(access)<c["entry_ts_ms"]
 checks.append({"kind":label,"symbol":c["symbol"],"entry_ts_ms":c["entry_ts_ms"],"max_feature_bar_open_ms":max(access)})
 return f
def shifted_exit(c,spec):
 m=re.fullmatch(r"(REV|ORIG)_D(\d+)_(T(\d+)|TP([\d.]+)_SL([\d.]+)_H(\d+))",spec)
 if not m:return ns["apply_exit"](c,spec)
 mode,delay=m.group(1),int(m.group(2));t=int(c["entry_ts_ms"])+delay*H
 side=("SHORT" if c["side"]=="LONG" else "LONG") if mode=="REV" else c["side"]
 z=base_b(c["symbol"],t)
 if z is None:return None
 d=dict(c,source_side=c["side"],source_entry_ts_ms=c["entry_ts_ms"],side=side,entry_ts_ms=t,entry_price=float(z["open"]))
 if m.group(4):return ns["time_exit"](d,int(m.group(4)))
 return ns["tpsl_exit"](d,float(m.group(5)),float(m.group(6)),int(m.group(7)))
assigned=[];source_map={}
for c in ns["candidates"]:
 f=causal_features(c,"source")
 if not f:continue
 route,spec=ns["assign"](f)
 if route is None:
  for idx in [12,13,14,15,16,17,18,20]:
   r=extended[idx]
   if all(pred(f,k) for k in r["rule"]):
    spec=r["exit"];route=("REC_Y" if spec.startswith("REV_") else "REC_Z")+f"{idx+1:02d}_"+spec
    break
 if route is None:continue
 z=shifted_exit(dict(f,route=route,route_exit=spec),spec)
 if z:
  assigned.append(z);source_map[(z["route"],z["symbol"],z["entry_ts_ms"])]=f
tokens={(t["symbol"],t["side"],t["entry_ts_ms"]) for t in assigned}
for c in ns["rows"](ns["CORE_DIR"]/"holdout-trades.jsonl"):
 if not ns["START"]<=c["entry_ts_ms"]<ns["ENTRY_END"]:continue
 token=(c["symbol"],c["side"],c["entry_ts_ms"])
 if token not in tokens:
  z=dict(c,route="FAILED_BREAK_REV_SHORT_6H",unit_gross_return=float(c["unit_gross_return"]))
  assigned.append(z);tokens.add(token)
def passes(k,f):
 mapping={"EMA_GE1":"ema12_dist","RANGE_NOT_TOP":"range_loc24","NOT_COMPRESS":"compression"}
 if k=="EMA_GE1":return isinstance(f.get(mapping[k]),(int,float)) and f[mapping[k]]>=1
 if k=="RANGE_NOT_TOP":return isinstance(f.get(mapping[k]),(int,float)) and f[mapping[k]]<.75
 if k=="NOT_COMPRESS":return isinstance(f.get(mapping[k]),(int,float)) and f[mapping[k]]>.8
 return pred(f,k)
accepted=[];rejected=[]
for d in assigned:
 d=dict(d);rt=d["route"]
 f=source_map.get((rt,d["symbol"],d["entry_ts_ms"]))
 a=first.get(rt)
 if a and (not f or not all(passes(k,f) for k in a["filters"])):
  rejected.append({"route":rt,"symbol":d["symbol"],"entry_ts_ms":d["entry_ts_ms"],"reason":"FIRST_PASS_FILTER"});continue
 if rt=="REC_G5_SLOW_TREND":d=ns["time_exit"](d,48)
 if a and a.get("time_h"):d=ns["time_exit"](d,a["time_h"])
 if not d:continue
 b=second.get(rt)
 if b:
  ef=causal_features(d,"entry")
  if not ef or not all(passes(k,ef) for k in b["filters"]):
   rejected.append({"route":rt,"symbol":d["symbol"],"entry_ts_ms":d["entry_ts_ms"],"reason":"SECOND_PASS_FILTER"});continue
  if b.get("time_h"):d=ns["time_exit"](d,b["time_h"])
 if not d:continue
 assert rt in score
 core=rt=="FAILED_BREAK_REV_SHORT_6H"
 sc=score[rt]
 d.update(rank=1 if core else rank[rt],requested_gross=(d.get("requested_gross") if core else .05 if sc["tier"]=="D" else min(1,float(sc["gross"])*1.5)))
 accepted.append(d)
def calc(rows,c):
 v=[x["unit_gross_return"]-c/10000 for x in rows];loss=-sum(min(0,x) for x in v)
 return {"n":len(v),"wins":sum(x>0 for x in v),"pf":sum(max(0,x) for x in v)/loss if loss else None,"mean":sum(v)/len(v) if v else None,"sum":sum(v)}
groups=collections.defaultdict(list)
for d in accepted:groups[d["route"]].append(d)
summary={"status":"SELECTED_V2_REPAIRED_CAUSAL_TRANSLATION_ROUTE_ONLY_NOT_EXACT_ID_BASELINE_OR_FULL8","fixed_priority_sha256":hashlib.sha256(priority_path.read_bytes()).hexdigest(),
"frozen_priority_after_training_end":True,"ranking_is_retrospective_in_train":True,"first_pass_repairs":first,"second_pass_repairs":second,"route_catalog_count":len(priority),
"source_candidates":len(ns["candidates"]),"pre_repair":len(assigned),"after_repairs":len(accepted),"rejected_by_repair":len(rejected),"causal_feature_checks":len(checks),
"all_routes":{str(c):calc(accepted,c) for c in [10,20,30]},"by_route":{r:{str(c):calc(a,c) for c in [10,20,30]} for r,a in sorted(groups.items())},
"y06":{str(c):calc(groups["REC_Y06_REV_D0_T72"],c) for c in [10,20,30]},
"limitations":["Research training routes use inc_keys; external translation applies frozen causal predicates sequentially without development identity keys.","No exact training-baseline translation parity yet; full8 historical ownership/gross/quantity/funding/MTM DD not replayed.","Core reuses separately extracted causal holdout core events; core scanner has not been rerun in this script.","Fixed ranks/gross recorded but portfolio admission not replayed.","Previously viewed external period, not pristine prospective OOS."],"trading_mutation":0}
for name,rows in [("repaired-candidates.jsonl",accepted),("rejected.jsonl",rejected),("causal-checks.jsonl",checks)]:
 (DEST/name).write_text("".join(json.dumps(d,sort_keys=True)+"\n" for d in rows),encoding="utf-8")
(DEST/"summary.json").write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps({k:summary[k] for k in ["status","pre_repair","after_repairs","all_routes","y06"]},indent=2))
