#!/usr/bin/env python3
"""Audit named strategy-family coverage before describing BT as '8-logic'.

An operator/supervisor is NOT automatically counted as a trading strategy.
No source network access, exchange actions, credentials or code execution.
"""
from __future__ import annotations
import argparse,csv,json,re,hashlib
from pathlib import Path
from collections import Counter,defaultdict

REQUIRED={"logic","trade_id","utc","route","symbol","source_runtime_sha"}
KNOWN_FAMILIES={"V4","Q102","PENGU","V52","HYPE","FET","IDLE"}
def read_entries(path:Path)->dict:
    count=Counter();routes=defaultdict(set);pins=defaultdict(set);seen=set()
    with path.open("r",encoding="utf-8-sig",newline="") as fp:
        rdr=csv.DictReader(fp)
        if not rdr.fieldnames or not REQUIRED.issubset(set(rdr.fieldnames)):
            raise ValueError("REQUIRED_MODEL_ADMISSION_FIELDS_MISSING")
        for row in rdr:
            label=row["logic"].strip();key=row["trade_id"].strip()
            sha=row["source_runtime_sha"].strip()
            if not label or not key or key in seen or not row["route"] or not row["symbol"]:
                raise ValueError("INVALID_OR_DUPLICATE_MODEL_ADMISSION")
            if not re.fullmatch("[a-f0-9]{40}",sha):
                raise ValueError("MODEL_SOURCE_SHA_NOT_FULL_PIN")
            seen.add(key);count[label]+=1
            routes[label].add(row["route"]);pins[label].add(sha)
    if not count:raise ValueError("EMPTY_MODEL_ADMISSION_CASE")
    return {"entries":dict(count),"pins":{k:sorted(v) for k,v in pins.items()},
       "routeCounts":{k:len(v) for k,v in routes.items()},"total":sum(count.values())}
def assess(ten:dict,thirty:dict,expected:int)->dict:
    if expected<1:raise ValueError("EXPECTED_SCOPE_INVALID")
    a=set(ten["entries"]);b=set(thirty["entries"])
    if a!=b:raise ValueError("COST_CASE_FAMILY_SET_DRIFT")
    if a!=set(ten["pins"]) or b!=set(thirty["pins"]):raise ValueError("SOURCE_PIN_COVERAGE_MISSING")
    for name in a:
        if ten["pins"][name]!=thirty["pins"][name]:
            raise ValueError("COST_CASE_FAMILY_PIN_DRIFT:"+name)
    actual=len(a)
    return {
      "schema":"disdex-bt-named-family-scope-audit/v1",
      "status":"NAMED_STRATEGY_SCOPE_NOT_PROVEN" if actual!=expected else
               "NAMED_LABEL_COUNT_MATCH_ONLY_ECONOMIC_PARITY_UNVERIFIED",
      "requestedNamedLogicCount":expected,
      "distinctModeledLogicLabels":actual,
      "modeledLogicLabels":sorted(a),
      "consistentLabelsAndSourcePinsBetweenCostCases":True,
      "10bps":ten,"30bps":thirty,
      "cannotInferUnrepresentedEighthStrategy":actual!=expected,
      "requiresOperatorVsIndependentStrategyManifest":True,
      "liveEconomicParityCertified":False,
      "productionMutations":0,
    }
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--entries10",type=Path,required=True)
    ap.add_argument("--entries30",type=Path,required=True)
    ap.add_argument("--expected-named-logic-count",type=int,default=8)
    ap.add_argument("--output",type=Path)
    a=ap.parse_args()
    result=assess(read_entries(a.entries10),read_entries(a.entries30),a.expected_named_logic_count)
    result["inputSha256"]={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in
       (a.entries10,a.entries30)}
    s=json.dumps(result,ensure_ascii=False,indent=2)+"\n"
    if a.output:a.output.write_text(s,"utf8")
    print(json.dumps({"status":result["status"],"familyLabels":result["modeledLogicLabels"],
      "expected":result["requestedNamedLogicCount"],"observed":result["distinctModeledLogicLabels"],
      "entries10":result["10bps"]["total"],"entries30":result["30bps"]["total"]},ensure_ascii=False))
    return 2 if result["status"]=="NAMED_STRATEGY_SCOPE_NOT_PROVEN" else 0
if __name__=="__main__":raise SystemExit(main())
