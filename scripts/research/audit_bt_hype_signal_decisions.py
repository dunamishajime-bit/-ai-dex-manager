#!/usr/bin/env python3
"""Reconcile isolated pinned HYPE signal candidates to historical modeled portfolio decisions."""
from __future__ import annotations
import argparse,csv,hashlib,json
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path

CASE="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON"
def file_sha(path:Path)->str:
 h=hashlib.sha256()
 with path.open("rb") as f:
  for chunk in iter(lambda:f.read(1048576),b""):h.update(chunk)
 return h.hexdigest()

def compare(accepted:set[str],rows:list[dict])->dict:
 if len(accepted)!=len(set(accepted)):
  raise ValueError("Duplicate accepted signal candidates")
 seen=set()
 entries=set()
 blocked=0
 for row in rows:
  time=row["utc"]
  if time in seen:raise ValueError("Duplicate HYPE decision time")
  seen.add(time)
  if time not in accepted:raise ValueError("Historical decision absent from pinned pure HYPE signal")
  if row["decision"]=="MODEL_ENTER":
   entries.add(time)
  elif row["decision"]=="BLOCK":
   blocked+=1
  else:raise ValueError("Unexpected historical portfolio decision type")
 return {
  "pure_signal_candidates":len(accepted),
  "historical_hype_decisions":len(rows),
  "historical_modeled_enters":len(entries),
  "historical_blocks":blocked,
  "pure_signals_without_hype_decision":sorted(accepted-seen),
  "pure_signals_without_hype_decision_count":len(accepted-seen),
  "historical_decision_outside_pure_signal_count":0,
  "historical_modeled_enter_times":sorted(entries),
  "cause_of_unlogged_pure_candidates_verified":False,
  "full_portfolio_arbitration_reexecuted":False,
 }

def audit(pure:dict,folder:Path,source_audit:dict)->dict:
 if pure.get("schema")!="disdex-bt-hype-pinned-pure-signal-replay/v1" or pure.get("production_bt_parity_certified") is not False:
  raise ValueError("Isolated pure HYPE signal report missing or falsely certified")
 raw=pure.get("accepted_pure_signals")
 if not isinstance(raw,list) or len(raw)!=pure.get("accepted_pure_signal_count"):
  raise ValueError("Pure HYPE signal count inconsistent")
 accepted={x["utc"] for x in raw}
 if len(accepted)!=len(raw):raise ValueError("Duplicate pure candidate timestamps")
 if source_audit.get("schema")!="disdex-bt-stable4-research-source-audit/v1":
  raise ValueError("Untrusted research audit")
 scenarios={}
 for bps in (10,30):
  case=folder/f"{CASE}_{bps}BPS_DECISIONS.csv"
  with case.open(encoding="utf-8-sig",newline="") as f:
   rows=[x for x in csv.DictReader(f) if x["strategy"]=="HYPE"]
  x=compare(accepted,rows)
  modeled=source_audit["scenarios"][str(bps)]["source_models"]["HYPE"]["modeled_exits"]
  if x["historical_modeled_enters"]!=modeled or modeled!=pure.get("research_modeled_hype_exits"):
   raise ValueError("HYPE model entry count conflicts with independent study")
  scenarios[str(bps)]={**x,"decision_csv_sha256":file_sha(case)}
 return {
  "schema":"disdex-bt-hype-pinned-signal-to-model-decision-reconciliation/v1",
  "created_utc":datetime.now(timezone.utc).isoformat(),
  "source_hype_sha":pure["observed_live_git_commit"],
  "source_h1_hype_sha256":pure["market_h1_files"]["hype_sha256"],
  "source_h1_btc_sha256":pure["market_h1_files"]["btc_sha256"],
  "no_real_exchange_orders_issued":True,
  "causes_of_missing_research_decisions_known":False,
  "production_bt_parity_certified":False,
  "scenarios":scenarios,
 }

def main():
 p=argparse.ArgumentParser(description=__doc__)
 root=Path(__file__).resolve().parents[2]
 base=root/"docs/research-results"
 p.add_argument("--data-root",type=Path,required=True)
 p.add_argument("--pure-report",type=Path,default=base/"BT_HYPE_PINNED_PURE_SIGNAL_REPLAY_20261119_UNCERTIFIED.json")
 p.add_argument("--source-audit",type=Path,default=base/"BT_STABLE4_SOURCE_PARITY_AUDIT_20261119.json")
 p.add_argument("--output",type=Path,default=base/"BT_HYPE_PURE_SIGNAL_MODEL_DECISION_RECONCILE_20261119_UNCERTIFIED.json")
 args=p.parse_args()
 d=audit(json.loads(args.pure_report.read_text(encoding="utf8")),args.data_root,
  json.loads(args.source_audit.read_text(encoding="utf8")))
 args.output.parent.mkdir(parents=True,exist_ok=True)
 args.output.write_text(json.dumps(d,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 for key,row in d["scenarios"].items():
  print(f"{key}bps pure={row['pure_signal_candidates']} decisions={row['historical_hype_decisions']} enters={row['historical_modeled_enters']} blocks={row['historical_blocks']} undocumented={row['pure_signals_without_hype_decision_count']}")
 print("MODEL_DECISION_COVERAGE_NOT_COMPLETE_NOT_PRODUCTION_BT")

if __name__=="__main__":
 main()
