#!/usr/bin/env python3
"""Read-only audit of STABLE4 research replay source lineage; never a LIVE certifier."""
import argparse,csv,hashlib,json,pathlib,re,subprocess
from collections import Counter,defaultdict
CASE="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON"
EXPECTED_RUNNERS=("V4","PENGU","Q102","V52","HYPE","IDLE","FET")
def sha(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for block in iter(lambda:f.read(1048576),b""):h.update(block)
 return h.hexdigest()
def source_object_kind(repo,src):
 if not re.fullmatch(r"[a-f0-9]{40}",src):return "NOT_GIT_SHA_SHAPED"
 result=subprocess.run(["git","-C",str(repo),"cat-file","-t",src],capture_output=True,text=True,timeout=5)
 return result.stdout.strip() if result.returncode==0 else "NOT_PRESENT_AS_LOCAL_GIT_OBJECT"
def audit(folder,repo):
 per_cost={}
 for bps in (10,30):
  prefix=f"{CASE}_{bps}BPS_"
  fill=folder/(prefix+"FILLS.csv")
  summary=folder/(prefix+"SUMMARY.json")
  if not fill.exists() or not summary.exists():raise ValueError("MISSING_SOURCE_FILES")
  summ=json.loads(summary.read_text(encoding="utf8"))
  if summ.get("status")!="CAUSAL_THREE_PLUS_PRETARGET_STABLE_ROUTE_QUARANTINE_RESEARCH_ONLY":
   raise ValueError("UNEXPECTED_RESEARCH_STATUS")
  per_runner=defaultdict(lambda:{"shaCounts":Counter(),"modelClasses":Counter(),"routeCounts":Counter()})
  count=0;actual_verified=0
  with fill.open(newline="",encoding="utf8") as f:
   for row in csv.DictReader(f):
    count+=1
    strategy=row["strategy"]
    if strategy not in EXPECTED_RUNNERS:raise ValueError("UNEXPECTED_MODEL_RUNNER")
    src=row["source_runtime_sha"].lower()
    per_runner[strategy]["shaCounts"][src]+=1
    per_runner[strategy]["modelClasses"][row["model_class"]]+=1
    per_runner[strategy]["routeCounts"][row["route"]]+=1
    if row["signed_execution_verified"]=="True":actual_verified+=1
  if count!=summ["modeled_fills"]:raise ValueError("MODEL_FILL_SUMMARY_MISMATCH")
  if actual_verified:raise ValueError("UNEXPECTED_VERIFIED_ACTUAL_FILLS")
  compact={}
  for name in EXPECTED_RUNNERS:
   if name not in per_runner:continue
   entry=per_runner[name]
   compact[name]={
    "modeled_exits":sum(entry["shaCounts"].values()),
    "source_identifiers":[{"sha":code,"trades":n,
       "local_git_object_type":source_object_kind(repo,code)} for code,n in sorted(entry["shaCounts"].items())],
    "model_classes":dict(entry["modelClasses"].most_common()),
    "distinct_routes":len(entry["routeCounts"]),
    "production_parity_verified":False
   }
  admitted=summ.get("admitted_by_runner",{})
  remaining={name:admitted.get(name,0)-compact.get(name,{}).get("modeled_exits",0) for name in admitted}
  if any(v<0 for v in remaining.values()):raise ValueError("MODELED_EXITS_EXCEED_ADMITTED")
  if sum(remaining.values())!=summ.get("terminal_open_count",0):
   raise ValueError("ADMITTED_TERMINAL_OPEN_RECONCILIATION_FAILED")
  per_cost[str(bps)]={
   "fills_file_sha256":sha(fill),"summary_file_sha256":sha(summary),
   "research_source_status":summ["status"],"modeled_exits":count,
   "admitted_by_runner":admitted,"remaining_terminal_open_by_runner":remaining,
   "source_models":compact,"reported_max_dd_pct":summ["max_hourly_dd_pct"],
   "drawdown_20pct_limit_satisfied":summ["max_hourly_dd_pct"]>=-20,
   "actual_exchange_fills_verified":actual_verified
  }
 return {
  "schema":"disdex-bt-stable4-research-source-audit/v1",
  "scope":"LOCAL_RESEARCH_EVIDENCE_ONLY_NOT_PRODUCTION",
  "production_runner_sha_from_venue_verified":False,
  "research_to_live_code_parity_verified":False,
  "full_8_runner_causal_evidence_verified":False,
  "study_case":CASE,"scenarios":per_cost,
  "blockers":[
   "STABLE4 research has seven named runner categories, not a certified current eight-runner runtime reconstruction",
   "Runner source SHA references in historic fills are not proof of currently deployed production SHA",
   "No signed actual exchange execution evidence; fills are model scenarios",
   "Some modeled route exits rely on H1 approximation or price-only proxies",
   "Both 10bps and 30bps reported max drawdown exceed -20%",
   "No permitted variable-capital/regular-contribution portfolio re-execution evidence"
  ]
 }
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--source-dir",type=pathlib.Path,required=True)
 p.add_argument("--repository",type=pathlib.Path,required=True)
 p.add_argument("--out",type=pathlib.Path,required=True)
 args=p.parse_args()
 data=audit(args.source_dir,args.repository)
 args.out.parent.mkdir(parents=True,exist_ok=True)
 args.out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print(json.dumps({"status":"PASS_RESEARCH_SOURCE_AUDIT","counts":{
  bps:{"model_exits":item["modeled_exits"],"terminal_open":item["remaining_terminal_open_by_runner"],
  "dd":item["reported_max_dd_pct"]} for bps,item in data["scenarios"].items()},
  "production_parity_verified":False},ensure_ascii=False,indent=2))
if __name__=="__main__":main()