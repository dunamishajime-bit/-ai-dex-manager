#!/usr/bin/env python3
"""Audit V4 source-vs-policy time provenance. Read-only; never promote shadow to LIVE."""
from __future__ import annotations
import collections,hashlib,json,re,datetime as dt,os
from pathlib import Path
R=Path(os.environ.get("DISDEX_BT_ROOT",r"C:\tmp\disdex-bt-20251001-20261001"))
SRC=R/"pinned-source"/"V4"/"lib"/"v12-v4-v2-shadow.ts"
PRIOR=R/"pinned-source"/"V4"/"docs"/"implementation"/"v12-v4-v2-full-year-priority.json"
FOR=R/"FORWARD_HOLDOUT_20261001_20261108"
PRE=R/"PREPERIOD_TRAIN_20250322_20251001"
SCRIPTS={
 "preperiod":PRE/"native-V4-raw-intentions-with-atr-20261109.jsonl",
 "target":R/"native-new-signal-20251001-20261001"/"native-V4-raw-intentions.jsonl",
 "forward":FOR/"native-V4-forward-with-atr.jsonl"}
SUMMARIES={
 "preperiod":PRE/"native-V4-entry-atr-summary-20261109.json",
 "target":R/"native-new-signal-20251001-20261001"/"native-V4-entry-summary.json",
 "forward":FOR/"native-V4-forward-atr-summary.json"}
def hash_file(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()
def when(ms):return dt.datetime.fromtimestamp(ms/1000,dt.timezone.utc).isoformat()
def iso(s):return int(dt.datetime.fromisoformat(s.replace("Z","+00:00")).timestamp()*1000)
policy_date=iso("2026-10-09T00:00:00Z")
gross_date=iso("2026-10-26T00:00:00Z")
text=SRC.read_text(encoding="utf8")
assert "Full-development-year hindsight-ranked route priorities" in text
assert 'rankingSource: "Full-development-year realized trade results; lookahead leakage"' in text
assert 'BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06' in text
assert "Operator-approved 2026-10-26" in text
assert "2026-10-09" in text
prior=json.loads(PRIOR.read_text(encoding="utf8"))
assert len(prior)==41 and len({x["route"] for x in prior})==41
assert len({x["priority_order"] for x in prior})==41
assert sum("n30" in x and "mean_return30" in x for x in prior)==41
out={
 "status":"METHODOLOGY_INVALID_FOR_CLAIMED_OOS_NOT_MARKET_DATA_FAILURE",
 "v4_source_pin":"3ad65403013b701db5d9e53e8814e6ab827a28e8",
 "source_files_sha256":{"policy_code":hash_file(SRC),"priority_ranking_json":hash_file(PRIOR)},
 "policy_not_before_utc":"2026-10-09T00:00:00Z",
 "later_gross_not_before_utc":"2026-10-26T00:00:00Z",
 "policy_time_limits":"Dates are extracted from source comments and indicate reported changes, not independently authenticated deployment timestamps. Cannot infer LIVE activation.",
 "full_development_year_hindsight_rankings":True,
 "ranking_routes":len(prior),
 "training_outcome_columns":["n30","wr30","pf30","mean_return30","net30_jpy"],
 "periods":{},
 "anomalies":{},
 "rules":["A candidate may be chronological on market input yet noncausal as an OOS claim because its policy was fitted on the evaluated period.",
          "No conversion of frozen hindsight-ranked V2 to independent target-period OOS by simply splitting target rows.",
          "Candidates in forward after Oct09 retain hindsight tuned parameters; they can be a temporal prospective simulation only if frozen from that date and never used in tuning; still marked SHADOW_ONLY.",
          "The later Oct26 size changes make earlier forward entries counterfactual, not faithful historical as-of policy.",
          "Any signal with entryTs earlier than its decisionTs or after feature capture requires additional explicit proof of execution feasibility.",
          "Censor forward trades without complete exit horizon; do not count incomplete outcomes as zero or success."]}
for label,p in SCRIPTS.items():
 if not p.exists():out["anomalies"][label]="missing_input";continue
 rows=[json.loads(z) for z in p.open(encoding="utf8-sig") if z.strip()]
 summary=json.loads(SUMMARIES[label].read_text(encoding="utf8")) if SUMMARIES[label].exists() else {}
 stamps=[int(r["entryTs"]) for r in rows]
 timestamps=[int(r.get("decisionTs",r["entryTs"])) for r in rows]
 past_policy=sum(t<policy_date for t in stamps)
 pre_gross=sum(t<gross_date for t in stamps)
 delta=collections.Counter(int(r["entryTs"])-int(r.get("decisionTs",r["entryTs"])) for r in rows)
 status=collections.Counter(r.get("certification","MISSING") for r in rows)
 side=collections.Counter(r.get("side") for r in rows)
 out["periods"][label]={
  "count":len(rows),"entry_first_utc":when(min(stamps)) if stamps else None,
  "entry_last_utc":when(max(stamps)) if stamps else None,
  "row_sha256":hash_file(p),"manifest_status":summary.get("strategyStatus"),
  "source_pin_matches":all(r.get("source_runtime_sha")=="3ad65403013b701db5d9e53e8814e6ab827a28e8" for r in rows),
  "entry_before_policy_date":past_policy,"entry_before_later_gross":pre_gross,
  "entry_minus_decision_ms_counts":{str(k):v for k,v in sorted(delta.items())},
  "entry_before_decision":sum(t<d for t,d in zip(stamps,timestamps)),
  "entry_after_decision":sum(t>d for t,d in zip(stamps,timestamps)),
  "certification":dict(status),"sides":dict(side),
  "ranking_evaluation_clean_OOS":False if label in ("target","preperiod") else None,
  "candidate_not_live":True,
  "manifest_checked":summary.get("checked"),
  "manifest_errors":summary.get("errors",{}),
  "manifest_count":summary.get("admittedRuleCandidates"),
  "manifest_output_hash_matches":hash_file(p)==summary.get("outputSHA256"),
  "route_distribution":dict(collections.Counter(r.get("route") for r in rows))}
 # Existing merged raw source uses entry-tape sorted but different filenames/normalization.
 if label in ("preperiod","forward"):
  assert out["periods"][label]["manifest_output_hash_matches"]
 assert out["periods"][label]["source_pin_matches"]
 assert not out["periods"][label]["entry_before_decision"]
out["time_assessment"]={
 "historical_202510_202610":"The V2 priority ranks had fitted full-year realized outcomes and were reported created Oct09 2026; the entire historical target is retrospective development/resubstitution, NOT an out-of-sample evaluation.",
 "forward_202610_202611":"The forward window begins before documented V2 ranking date and before Oct26 gross changes. Replayed current pin is a counterfactual full-window policy; existing forward results have already been inspected. This cannot now be asserted to be an untouched prospective OOS test.",
 "new_protocol":"Create replay with each policy/gross configuration frozen by an authentic earlier commit timestamp; where unavailable classify RESEARCH_HINDSIGHT until independent future unlabeled market data arrives."}
path=R/"DIRECTION_RESEARCH_20261109"/"v4_pin_temporal_priority_leakage_audit_20261110.json"
path.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("RESULT",path)
print("RANKS",len(prior))
for k,v in out["periods"].items():
 print("PERIOD",k,"n",v["count"],"policy_before",v["entry_before_policy_date"],
 "gross_before",v["entry_before_later_gross"],"source_sha_ok",v["source_pin_matches"],
 "manifest_sha_ok",v["manifest_output_hash_matches"],"decision_delays",v["entry_minus_decision_ms_counts"])
print("ANOMALIES",out["anomalies"])
