#!/usr/bin/env python3
"""HYPE TREND 78-event same-time competitor *presence* reconciliation.

Competing model decisions are post-tick outcomes, not as-of EV features.
This audit never ranks, selects or trades on those decisions.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,math
from collections import Counter,defaultdict
from pathlib import Path
ALLOWED={"HYPE","V4","PENGU","Q102","FET","V52","IDLE"}
def digest(p:Path)->str:return hashlib.sha256(p.read_bytes()).hexdigest()
def load_decisions(path:Path,signal_times:set[str])->dict:
    rows=defaultdict(list);seen=set()
    with path.open(encoding="utf-8-sig",newline="") as f:
      reader=csv.DictReader(f)
      required={"signal_id","strategy","utc","decision","reason","requested_gross"}
      if not reader.fieldnames or not required.issubset(reader.fieldnames):
          raise ValueError("MODEL_DECISION_FIELDS_MISSING")
      for r in reader:
        t=r["utc"]
        if t not in signal_times:continue
        k=r["signal_id"]
        if (not k or k in seen or r["strategy"] not in ALLOWED or
            r["decision"] not in ("MODEL_ENTER","BLOCK") or not r["reason"]):
            raise ValueError("INVALID_DUPLICATE_MODEL_CONCURRENT_DECISION")
        seen.add(k)
        gross=float(r["requested_gross"])
        if not math.isfinite(gross) or gross<0:raise ValueError("INVALID_MODEL_GROSS_REQUEST")
        rows[t].append({"signalId":k,"strategy":r["strategy"],
            "decision":r["decision"],"reason":r["reason"],
            "requestedGrossX":gross})
    if set(rows)!=signal_times:
        raise ValueError("NOT_ALL_HYPE_CANDIDATE_TIMES_IN_DECISION_LOG")
    for t,values in rows.items():
        hype=[z for z in values if z["strategy"]=="HYPE"]
        if len(hype)!=1 or not hype[0]["signalId"].startswith("HYPE_"):
            raise ValueError("HYPE_ONE_DECISION_PER_NATIVE_CANDIDATE_UNVERIFIED")
    return rows
def reconcile(shadow:dict,dec10:dict,dec30:dict)->dict:
    if shadow.get("schema")!="disdex-bt-hype-native-layer2-3-asof-shadow/v1":
        raise ValueError("HYPE_ASOF_SHADOW_SOURCE_UNRECOGNIZED")
    r10=shadow["models"]["10bps"]["signals"]
    r30=shadow["models"]["30bps"]["signals"]
    t10=[r["candidateEntryUtc"] for r in r10]
    t30=[r["candidateEntryUtc"] for r in r30]
    if len(t10)!=78 or t10!=t30 or len(set(t10))!=78:
        raise ValueError("HYPE_NATIVE_SIGNAL_SET_NOT_78_UNIQUE")
    if set(dec10)!=set(t10) or set(dec30)!=set(t30):
        raise ValueError("MODEL_DECISION_TIME_COVERAGE_MISMATCH")
    output={}
    for cost,rows in (("10bps",dec10),("30bps",dec30)):
        events=[];strategy=Counter();hits=0
        for t in t10:
            competitors=[x for x in rows[t] if x["strategy"]!="HYPE"]
            if competitors:hits+=1
            strategy.update(x["strategy"] for x in competitors)
            events.append({"entryUtc":t,"competitorCandidateCount":len(competitors),
                "competingStrategies":sorted({x["strategy"] for x in competitors}),
                "competitorModelPostTickDecisions":competitors,
                "hypeModelPostTickDecision":next(x for x in rows[t] if x["strategy"]=="HYPE"),
                "canEvaluateCompetingExpectedValue":False,
                "opportunityRank":None,
                "postTickDecisionCannotBeUsedAsCausalEntryFeature":True})
        output[cost]={"nativeHypeCandidates":len(events),
          "withSameTickCompetitor":hits,
          "sameTickCompetitorCandidateCount":sum(x["competitorCandidateCount"] for x in events),
          "candidateCountByCompetingStrategy":dict(sorted(strategy.items())),
          "events":events}
    return {"schema":"disdex-bt-hype-layer3-competitor-source-coverage/v1",
        "status":"SAME_TICK_COMPETING_CANDIDATES_RECONCILED_NO_LAYER3_EV_RANK",
        "models":output,
        "postTickDecisionsAreNeverCausalFeatures":True,
        "competingCandidateEVAvailable":False,
        "competingCandidateProbabilityCalibrationCertified":False,
        "sourceProvesVenueTimingOrOrderAcceptance":False,
        "productionMutations":0}
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--shadow",type=Path,required=True)
    p.add_argument("--decisions10",type=Path,required=True)
    p.add_argument("--decisions30",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    shadow=json.loads(a.shadow.read_text("utf8"))
    times={x["candidateEntryUtc"] for x in shadow["models"]["10bps"]["signals"]}
    result=reconcile(shadow,load_decisions(a.decisions10,times),
           load_decisions(a.decisions30,times))
    result["sourceSha256"]={name:digest(file) for name,file in (
       ("layer23Shadow",a.shadow),("decisions10",a.decisions10),("decisions30",a.decisions30))}
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
    print(json.dumps({"status":result["status"],"cases":{
      b:{"hypeCandidates":v["nativeHypeCandidates"],
         "collisionTimes":v["withSameTickCompetitor"],
         "competitorCandidates":v["sameTickCompetitorCandidateCount"],
         "competingStrategies":v["candidateCountByCompetingStrategy"]}
      for b,v in result["models"].items()}},ensure_ascii=False))
if __name__=="__main__":main()
