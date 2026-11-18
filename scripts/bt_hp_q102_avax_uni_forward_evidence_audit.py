#!/usr/bin/env python3
"""Q102 AVAX/UNI structured pretarget/forward and online shadow audit.

A forward winner in a small sample is NOT permission to optimize/promote. No
target period nor forward is used for model selection in this audit.
"""
from __future__ import annotations
import argparse,hashlib,json,math
from pathlib import Path
SYMBOLS=("AVAXUSDT","UNIUSDT")
SPLITS=("DEV_TRAIN","DEV_VALID","DEV_HOLD")
COUNT_POLICY={"DEV_TRAIN":1455,"DEV_VALID":728,"DEV_HOLD":736,"FORWARD":302}
def sha(p:Path)->str:return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p:Path)->dict:return json.loads(p.read_text("utf-8-sig"))
def near(a,b)->bool:return math.isclose(float(a),float(b),rel_tol=1e-9,abs_tol=1e-9)
def verify_aggregate(x:dict,scope:str)->dict:
    n=int(x["n"]);v=float(x["mean"]);total=float(x["sum"]);wr=x["wr"];pf=x["pf"]
    if n<0 or (n>0 and (wr is None or pf is None)) or not math.isfinite(v) or not math.isfinite(total):
        raise ValueError("Q102_METRIC_UNSUPPORTED:"+scope)
    if n and (not near(n*v,total) or not 0<=wr<=1 or not pf>=0):
        raise ValueError("Q102_METRIC_ARITHMETIC_DRIFT:"+scope)
    return {"n":n,"wr":wr,"mean":v,"pf":pf}
def validate_structured(doc:dict)->dict:
    if (doc.get("status")!="RESEARCH_ONLY_Q102_STRUCTURED_REDESIGN_FORWARD_UNSEEN" or
       doc.get("selectionUsesForward") is not False):
        raise ValueError("Q102_STRUCTURED_FORWARD_SELECTION_CONTAMINATED")
    if set(doc.get("assets",{}))!=set(SYMBOLS):
        raise ValueError("Q102_STRUCTURED_ASSET_SET_DRIFT")
    out={}
    for symbol in SYMBOLS:
        asset=doc["assets"][symbol]
        expected=3 if symbol=="AVAXUSDT" else 9
        if asset["splitCounts"]!=COUNT_POLICY or asset["qualifyingDev"]!=expected or len(asset["topDevFrozen"])!=expected:
            raise ValueError("Q102_STRUCTURED_FROZEN_COHORT_DRIFT:"+symbol)
        rows=[];good=0;bad=0
        for i,r in enumerate(asset["topDevFrozen"]):
            if (r["side"] not in ("LONG","SHORT") or
                r["structure"] not in ("REV_LONG","EXHAUST_SHORT") or
                (r["structure"]=="REV_LONG")!=(r["side"]=="LONG")):
                raise ValueError("Q102_STRUCTURED_ROUTE_DIRECTION_MISMATCH")
            if not 0<float(r["score"])<1:raise ValueError("Q102_STRUCTURED_SCORE_INVALID")
            for seg in SPLITS:
                v=r["dev30"][seg]
                verify_aggregate(v,symbol+seg)
                if int(v["n"])<1:raise ValueError("Q102_STRUCTURED_PRETARGET_SPLIT_NO_OBSERVATION")
            f=verify_aggregate(r["FORWARD30"],symbol+"FORWARD")
            if f["n"]<1:raise ValueError("Q102_STRUCTURED_FORWARD_MISSING")
            good+=int(f["mean"]>0)
            bad+=int(f["mean"]<0)
            rows.append({"frozenRank":i+1,"route":r["structure"],"side":r["side"],
                "sourceFamily":r["family"],
                "prior30":{k:verify_aggregate(r["dev30"][k],symbol+k) for k in SPLITS},
                "forward30":f,
                "forwardUsedForSelectingRule":False})
        out[symbol]={"pretargQualified":expected,
            "forwardPositiveMean":good,"forwardNegativeMean":bad,
            "sourceRows":rows}
    return out
def compare_fast_shadow_numerics(a,b)->dict:
    # Fast and reference paths can disagree at floating summation roundoff.
    # All decisions and discrete attributes must match exactly.
    stack=[(a,b)]
    n=0;max_abs=0.
    while stack:
        left,right=stack.pop()
        if isinstance(left,dict) and isinstance(right,dict):
            if set(left)!=set(right):
                raise ValueError("Q102_ONLINE_FAST_SHADOW_FIELDS_MISMATCH")
            stack.extend((left[k],right[k]) for k in left)
        elif isinstance(left,list) and isinstance(right,list):
            if len(left)!=len(right):
                raise ValueError("Q102_ONLINE_FAST_SHADOW_ROW_COUNT_MISMATCH")
            stack.extend(zip(left,right))
        elif isinstance(left,(int,float)) and not isinstance(left,bool) and isinstance(right,(int,float)) and not isinstance(right,bool):
            if not all(math.isfinite(float(x)) for x in (left,right)):
                raise ValueError("Q102_ONLINE_FAST_SHADOW_NONFINITE_NUMERIC")
            difference=abs(float(left)-float(right))
            if difference:
                n+=1
                max_abs=max(max_abs,difference)
            if difference>1e-12:
                raise ValueError("Q102_ONLINE_FAST_SHADOW_NUMERIC_DRIFT")
        elif left!=right or type(left)!=type(right):
            raise ValueError("Q102_ONLINE_FAST_SHADOW_NON_NUMERIC_DRIFT")
    return {"differentFloatingCells":n,"maxAbsoluteFloatingDifference":max_abs,
            "allowedRoundoffAbsTolerance":1e-12,
            "byteExact":n==0}

def validate_online(online:dict,fast:dict)->dict:
    if (online.get("status")!="RESEARCH_ONLY_Q102_ONLINE_REGIME_SHADOW_SAFE5" or
       online.get("selectionUsesTarget") is not False):
        raise ValueError("Q102_ONLINE_ASOF_PROVENANCE_UNSAFE")
    if (fast.get("status")!="RESEARCH_ONLY_Q102_ONLINE_REGIME_SHADOW_SAFE5_FAST_EQUIVALENT" or
       fast.get("selectionUsesTarget") is not False):
        raise ValueError("Q102_ONLINE_FAST_IMPLEMENTATION_PROVENANCE_UNSAFE")
    if (set(online.get("assets",{}))!=set(SYMBOLS) or
       set(fast.get("assets",{}))!=set(SYMBOLS)):
        raise ValueError("Q102_ONLINE_ASSET_SET_DRIFT")
    out={}
    for symbol in SYMBOLS:
        a=online["assets"][symbol];b=fast["assets"][symbol]
        parity=compare_fast_shadow_numerics(a,b)
        n=3 if symbol=="AVAXUSDT" else 0
        if a["rowsN"]!=2383 or a["qualifyingPretarget"]!=n or len(a["topPretargetFrozen"])!=n:
            raise ValueError("Q102_ONLINE_QUALIFYING_POPULATION_DRIFT")
        for row in a["topPretargetFrozen"]:
            for split in ("E1","E2","E3"):
                if row["pre30"][split]["n"]<=0:raise ValueError("ONLINE_PRETARGET_EMPTY_SPLIT")
                verify_aggregate(row["pre30"][split],symbol+split)
            target=verify_aggregate(row["TARGET30"],symbol+"target")
            if target["n"]<=0 or target["mean"]>=0:
                raise ValueError("Q102_ONLINE_AVAX_TARGET_FALSIFICATION_CHANGED")
        out[symbol]={"preTargetQualified":n,
           "sourceFastEquivalentWithinFloatTolerance":True,
           "fastReferenceNumericalComparison":parity,
           "frozenRulesTargetAllNegativeMean":all(x["TARGET30"]["mean"]<0 for x in a["topPretargetFrozen"]),
           "modelOutcomeDoesNotAuthorizeTargetFittedRule":True}
    return out
def build(structured:dict,online:dict,fast:dict)->dict:
    a=validate_structured(structured);b=validate_online(online,fast)
    return {
        "schema":"disdex-bt-q102-avax-uni-structured-online-forward-evidence/v1",
        "status":"AVAX_UNI_PRETARGET_FORWARD_MIXED_ONLINE_UNCONFIRMED_NO_PRODUCTION_GATE",
        "structured":a,"onlineShadow":b,
        "targetYearSelectionPermitted":False,
        "forwardBestRuleSelectionPermitted":False,
        "independentVenueExecutionCertified":False,
        "productionMutations":0}
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--structured",type=Path,required=True)
    ap.add_argument("--online",type=Path,required=True)
    ap.add_argument("--fast",type=Path,required=True)
    ap.add_argument("--output",type=Path,required=True)
    a=ap.parse_args()
    result=build(read(a.structured),read(a.online),read(a.fast))
    result["sourceSha256"]={name:sha(getattr(a,name)) for name in ("structured","online","fast")}
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
    print(json.dumps({"status":result["status"],
       "structured":{s:{"qualified":x["pretargQualified"],"forwardPositive":x["forwardPositiveMean"],
                     "forwardNegative":x["forwardNegativeMean"]}
            for s,x in result["structured"].items()},
       "online":result["onlineShadow"]},ensure_ascii=False))
if __name__=="__main__":main()
