#!/usr/bin/env python3
from pathlib import Path
import json,math,collections,hashlib,statistics
R=Path(r"C:\tmp\disdex-bt-20251001-20261001")
D=R/"DIRECTION_RESEARCH_20261109"/"NATIVE_CAUSAL_SOURCE_REPLAY_20261110"
p=D/"base41-first-match-original-exits.jsonl"
rows=[json.loads(x) for x in p.open(encoding="utf8") if x.strip()]
pre=[x for x in rows if x["period"]=="pre" and x["status"]=="MODELED_COMPLETE_BASE41"]
assert len(pre)==738,len(pre)
# Only PRE outcomes are used. TARGET outcomes are deliberately never referenced here.
catalog=json.loads((R/"pinned-source"/"V4"/"docs"/"research"/"V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json").read_text(encoding="utf8"))["routes"]
routes=sorted({x["route"] for x in catalog if x["route"]!="FAILED_BREAK_REV_SHORT_6H"})
by=collections.defaultdict(list)
for x in pre:by[x["route"]].append(x)
ranked=[]
for route in routes:
 a=by.get(route,[])
 vals30=[float(x["grossDirectionalReturn"])-.003 for x in a]
 vals10=[float(x["grossDirectionalReturn"])-.001 for x in a]
 if vals30:
  s=sum(vals30);ss=math.sqrt(sum(v*v for v in vals30))
  score=(s-.5*ss)/(len(vals30)+20)
  wr30=sum(v>0 for v in vals30)/len(vals30)
  wr10=sum(v>0 for v in vals10)/len(vals10)
  gp=sum(v for v in vals30 if v>0);gl=-sum(v for v in vals30 if v<0)
  pf30=gp/gl if gl>0 else 999.0
 else:
  score=float("-inf");wr30=wr10=None;pf30=None
 ranked.append({"route":route,"n":len(a),"score":score if math.isfinite(score) else None,
                "sum30":sum(vals30),"mean30":statistics.mean(vals30) if vals30 else None,
                "wr30":wr30,"wr10":wr10,"pf30":pf30,
                "requestedGrossValues":sorted({float(x["requestedGross"]) for x in a})})
ranked.sort(key=lambda z:(-(z["score"] if z["score"] is not None else -1e99),z["route"]))
for i,z in enumerate(ranked,1):z["prePriority"]=i
# Internal temporal stability audit only; ranking is NOT refit.
mid=len(pre)//2
halves={"PRE_A":pre[:mid],"PRE_B":pre[mid:]}
for z in ranked:
 z["half"]={}
 for name,a0 in halves.items():
  a=[x for x in a0 if x["route"]==z["route"]]
  vals=[float(x["grossDirectionalReturn"])-.003 for x in a]
  z["half"][name]={"n":len(vals),"mean30":statistics.mean(vals) if vals else None,
                   "wr30":sum(v>0 for v in vals)/len(vals) if vals else None,
                   "sum30":sum(vals)}
report={"status":"PRE_ONLY_ROUTE_PRIORITY_FROZEN_BEFORE_TARGET_OUTCOME_REVIEW",
 "formula":"(sum(net30)-0.5*sqrt(sum(net30^2)))/(n+20), alphabetical tie-break; no route removal",
 "preN":len(pre),"catalogRoutesExCore":len(routes),"routesWithPreEvidence":sum(z["n"]>0 for z in ranked),
 "ranking":ranked,
 "top10":[z["route"] for z in ranked[:10]],
 "caveats":["No PRE funding available; ranking labels are original Base41 exit price return minus 30bps only.",
            "Route catalog itself is 2026 research-derived; ranking is PRE-only but not historical as-deployed policy.",
            "No TARGET outcome was accessed by this script.",
            "Routes with no PRE evidence are sorted at the bottom alphabetically and are not deleted."],
 "inputSha256":hashlib.sha256(p.read_bytes()).hexdigest()}
out=D/"base41_preonly_route_priority_20261110.json"
out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("PRE_N",len(pre),"ROUTES",len(routes),"EVIDENCE",report["routesWithPreEvidence"])
print("TOP15")
for z in ranked[:15]:
 print(z["prePriority"],z["route"],"n",z["n"],"score",z["score"],"wr30",z["wr30"],"mean30",z["mean30"],
       "A",z["half"]["PRE_A"],"B",z["half"]["PRE_B"])
print("BOTTOM_NO_EVIDENCE",[z["route"] for z in ranked if z["n"]==0])
print("OUT",out,"SHA",hashlib.sha256(out.read_bytes()).hexdigest())
