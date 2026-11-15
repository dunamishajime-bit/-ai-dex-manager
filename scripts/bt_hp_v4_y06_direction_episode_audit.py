#!/usr/bin/env python3
"""Cross-check V4 Y06 temporal label drift, episode correlation and H1 breadth.

Research-only and source-scoped; an unrealized wrong-direction proxy is not
proof of an actual exchange loss and a source pin is not current V4 LIVE.
"""
from __future__ import annotations
import argparse,hashlib,json,math
from pathlib import Path

ROUTE="REC_Y06_REV_D0_T72"
EXPECTED_SHA="3ad65403013b701db5d9e53e8814e6ab827a28e8"
SPLIT_COUNTS={"train":211,"validation":70,"test":71}
SOURCE_SPLITS=("train","validation","test")
def sha(p:Path)->str:return hashlib.sha256(p.read_bytes()).hexdigest()
def near(a,b)->bool:return math.isclose(float(a),float(b),rel_tol=1e-10,abs_tol=1e-10)
def audit_breadth(source:dict)->dict:
    if (source.get("status")!="UNRESOLVED_DATA_OR_SEPARATION" or source.get("route")!=ROUTE or
       source.get("source_runtime_sha")!=EXPECTED_SHA):
        raise ValueError("V4_Y06_BREADTH_SOURCE_UNRECOGNIZED")
    if source.get("events")!=352 or source.get("unique_entry_hours")!=280 or source.get("native_side")!="SHORT":
        raise ValueError("V4_Y06_NATIVE_SIGNAL_POPULATION_MISMATCH")
    wrong=source["wrong_native_by_split"]
    for name,expected in SPLIT_COUNTS.items():
        x=wrong[name]
        if x["n"]!=expected or not 0<=x["wrong"]<=expected or not near(x["wrong_rate"],x["wrong"]/expected):
            raise ValueError("V4_Y06_DIRECTION_PROXY_SPLIT_METRICS_DRIFT")
    if sum(wrong[k]["n"] for k in SOURCE_SPLITS)!=352:
        raise ValueError("V4_Y06_SPLIT_SUM_MISMATCH")
    if not all(wrong[SOURCE_SPLITS[i]]["last_utc"] < wrong[SOURCE_SPLITS[i+1]]["first_utc"]
               for i in (0,1)):
        raise ValueError("V4_Y06_CHRONOLOGICAL_SPLIT_NOT_SEPARATED")
    feature=source["closed_h1_feature_parity"]
    if (feature["checked_events"]!=352 or feature["comparisons"]!=2816 or
        feature["live_bar_used"] is not False or feature["universe_excludes_btc"] is not True or
        any(v!=0 for v in feature["max_abs_error_by_feature"].values())):
        raise ValueError("V4_Y06_FEATURE_CLOSED_H1_PARITY_FAILED")
    purge=source["strict_72h_purge"]
    if purge["train_fit_n"]>=wrong["train"]["n"] or purge["validation_calibration_n"]>=wrong["validation"]["n"]:
        raise ValueError("Y06_PURGED_72H_LABEL_AVAILABILITY_NOT_USED")
    models={}
    for name,item in source["models"].items():
        if item["accepted"] is not False:raise ValueError("Y06_UNSUPPORTED_GATE_PROMOTED")
        if "validation" not in item["splits"] or "unseen_test" not in item["splits"]:
            raise ValueError("Y06_SOURCE_SPLIT_MODEL_MISSING")
        if item["splits"]["validation"]["roc_auc"]>=.5:
            raise ValueError("Y06_VALIDATION_ROCAUC_FACT_DRIFT")
        if item["splits"]["validation"]["harmful_flips"]!=5 or item["splits"]["validation"]["beneficial_flips"]!=0:
            raise ValueError("Y06_VALIDATION_DIRECTION_HARM_DRIFT")
        models[name]={
          "trainRocAuc":item["splits"]["train"]["roc_auc"],
          "validationRocAuc":item["splits"]["validation"]["roc_auc"],
          "unseenTestRocAuc":item["splits"]["unseen_test"]["roc_auc"],
          "validationFlagged":item["splits"]["validation"]["flags"],
          "validationBeneficial":item["splits"]["validation"]["beneficial_flips"],
          "validationHarmful":item["splits"]["validation"]["harmful_flips"],
          "accepted":False}
    return {"status":"V4_Y06_SOURCE_BREADTH_FEATURE_PARITY_BUT_UNSTABLE_DIRECTION",
       "wrongDirectionProxyBySplit":wrong,
       "wrongDirectionProxyTrainToTestPctPoints":100*(wrong["test"]["wrong_rate"]-wrong["train"]["wrong_rate"]),
       "asofFeatureParity":feature,
       "sourceEventCount":352,
       "uniqueEntryHours":280,
       "purged72HourAvailability":purge,
       "breadthCandidateModels":models,
       "targetYearSelectedRule":None}
def audit_episodes(data:dict)->dict:
    if data.get("study")!="Y06 non-IID exposure episodes, descriptive regime shifts":
        raise ValueError("Y06_EPISODE_STUDY_UNKNOWN")
    if data.get("events")!=352 or data.get("matched_feature_rows")!=352:
        raise ValueError("Y06_EPISODE_POPULATION_DRIFT")
    episodes=data["episodes"]
    summary=data["episode_bootstrap"]
    if len(episodes)!=31 or summary["episode_count"]!=31:
        raise ValueError("Y06_EPISODE_COUNT_MISMATCH")
    total_members=0;member_ids=set();positive=negative=zero=0;delta=0.
    for epi in episodes:
        count=int(epi["n"])
        members=epi["members"]
        if count!=len(members) or not members or members!=list(range(members[0],members[-1]+1)):
            raise ValueError("Y06_EPISODE_MEMBERS_NOT_CONTIGUOUS")
        if any(i in member_ids for i in members):
            raise ValueError("Y06_EPISODE_MEMBER_DUPLICATED")
        member_ids.update(members);total_members+=count
        if int(epi["start"])>int(epi["end"]):raise ValueError("Y06_EPISODE_NEGATIVE_DURATION")
        v=float(epi["h60_delta_sum"])
        if not math.isfinite(v):raise ValueError("Y06_EPISODE_NONFINITE_DELTA")
        delta+=v
        if v>0:positive+=1
        elif v<0:negative+=1
        else:zero+=1
    if (total_members!=352 or member_ids!=set(range(352)) or
        (positive,negative,zero)!=(summary["episode_positive"],
                    summary["episode_negative"],summary["episode_zero"]) or
        not near(delta,summary["total_route_60h_delta_sum"])):
        raise ValueError("Y06_EPISODE_TOTAL_OR_COUNT_MISMATCH")
    ci=summary["resampled_total_ci95_raw_return_sum"]
    if not ci[0]<0<ci[1]:raise ValueError("Y06_EPISODE_BOOTSTRAP_CONFIDENCE_INCORRECT")
    if not data["split_crossing_episodes"] or len(data["split_crossing_episodes"])!=2:
        raise ValueError("Y06_EPISODES_CROSSING_CHRONOLOGICAL_SPLITS_NOT_ACCOUNTED")
    return {"status":"Y06_EVENTS_NOT_IID_EXPOSURE_EPISODES",
        "rawEvents":352,"exposureEpisodes":len(episodes),
        "episodesCrossingTrainValidTest":len(data["split_crossing_episodes"]),
        "resampledIllustrativeSumInterval":ci,
        "episodeBootstrapIsNOTIndependentOOS":True,
        "modelH60TimeExitSelected":False}
def build(breadth:dict,episodes:dict)->dict:
    b=audit_breadth(breadth);e=audit_episodes(episodes)
    if b["sourceEventCount"]!=e["rawEvents"]:
        raise ValueError("Y06_CROSS_SOURCE_EVENT_COUNT_DRIFT")
    return {"schema":"disdex-bt-v4-y06-direction-episodes-source-audit/v1",
       "status":"V4_Y06_DIRECTION_PROXY_DRIFT_NO_GATE_PRODUCTION_PROMOTION",
       "direction":b,"nonIidExposure":e,
       "targetYearPeriodUsedToAuthorizeRule":False,
       "wrongDirectionProxyIsSignedVenueLoss":False,
       "independentForwardMarketPerformanceCertified":False,
       "v4CurrentCodexLivePinCertified":False,
       "productionMutations":0}
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--breadth",type=Path,required=True)
    ap.add_argument("--episodes",type=Path,required=True)
    ap.add_argument("--output",type=Path,required=True)
    a=ap.parse_args()
    report=build(json.loads(a.breadth.read_text("utf-8-sig")),
                 json.loads(a.episodes.read_text("utf-8-sig")))
    report["sourceSha256"]={"breadth":sha(a.breadth),"episodes":sha(a.episodes)}
    a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
    print(json.dumps({"status":report["status"],
      "wrongDirectionProxyRate":{k:v["wrong_rate"] for k,v in report["direction"]["wrongDirectionProxyBySplit"].items()},
      "episodes":report["nonIidExposure"]["exposureEpisodes"],
      "crossing":report["nonIidExposure"]["episodesCrossingTrainValidTest"],
      "improvedModels":sum(x["accepted"] for x in report["direction"]["breadthCandidateModels"].values())},ensure_ascii=False))
if __name__=="__main__":main()
