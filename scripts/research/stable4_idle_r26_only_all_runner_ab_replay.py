"""Exact-scope historical shared-wallet R26 vs old IDLE A/B comparison.

Only IDLE's 3 already-decided filters differ. Other 6/7 runner source tapes,
P91 R21_ONE/slot, gross, fee/funding, exit model and priority are unchanged.
Archived 2026-11-27 engine/wrapper and reference result are SHA-pinned. This
is not full live-native source or venue-fill certification. No live orders.
"""
from __future__ import annotations
import collections
import csv
import hashlib
import json
import math
import pathlib
import sys

ARCHIVE=pathlib.Path(r"C:\tmp\disdex-d126-crossrunner-research-20261126")
ARTIFACT=pathlib.Path.home()/"disdex-idle-r26-one-change-sevenrunner-ab-20261128"
FILES={
 "engine":("replay_v4_y06_stop8_gap2pct_base_v2.py","d39f1bdaeda85f453a1bf6987ffdc97e00af8ee2015282341997215eb13a0c43"),
 "wrapper":("y06_r26_single_arm_reexec_20261127.py","ddafe69b010b68864edf0f644f92d94f115dc32cd96db864664fd9d23bd7d191"),
 "reference":("Y06_R26_SINGLE_ARM_REEXEC_RESULTS_20261127.json","91decaf83f3ff84e05391ae943a49363ac949b6efc359c4e6c85fdbae1670ff1"),
 "protocol":("Y06_R26_SINGLE_ARM_REEXEC_PROTOCOL_20261127.json","251422208c73917a167dbf3202fb4d64ae3c37871bd3851df2fe952861cd5855"),
 "r21":("y06_r21_bear_combination_20261127.py","84d5c1a1b9cc792200b83c267d0425411d1b5c74a1ea8f1d0115f0c078efb92e"),
 "parent":("y06_r18_portfolio_repair_20261127.py","5f56241f465fd2351c9370302499bb132fa780d9c267fd0d3b8128dbf12ccb1e"),
}
REPORT_NAME="STABLE4_IDLE_R26_197_VS_OLD849_FROZEN_SEVEN_RUNNER_SHARED_WALLET_AB_20261128.json"
def require_once(s,old,new,label):
    if s.count(old)!=1:raise ValueError("FROZEN_ENGINE_OR_WRAPPER_ANCHOR_CHANGED:"+label)
    return s.replace(old,new,1)
def load_sha_pins():
    for name,(filename,sha) in FILES.items():
        if hashlib.sha256((ARCHIVE/filename).read_bytes()).hexdigest()!=sha:
            raise ValueError("FROZEN_R26_ACCOUNT_MODEL_SHA_MISMATCH:"+name)
    return json.loads((ARCHIVE/FILES["reference"][0]).read_bytes())
def fmt_float(v):return round(float(v),6)
def rows_of(folder,fee):
    path=folder/f"R21_ONE_{fee}BPS_FILLS.csv"
    with path.open(encoding="utf-8-sig",newline="") as f:return list(csv.DictReader(f))
def summarized(fills):
    by=collections.defaultdict(lambda:{"trades":0,"wins":0,"netPnlJpy":0.0,"signedVenueFills":0})
    for x in fills:
        s=x["strategy"];v=float(x["net_pnl_jpy"])
        by[s]["trades"]+=1;by[s]["wins"]+=int(v>0);by[s]["netPnlJpy"]+=v
        by[s]["signedVenueFills"]+=int(x.get("signed_execution_verified","").strip().lower()=="true")
    return {s:{**r,"netPnlJpy":fmt_float(r["netPnlJpy"])} for s,r in sorted(by.items())}

def execute():
    reference=load_sha_pins()
    if ARTIFACT.exists():raise ValueError("AB_OUTPUT_ALREADY_EXISTS_REFUSE_OVERWRITE")
    ARTIFACT.mkdir(parents=True)
    script=(ARCHIVE/FILES["wrapper"][0]).read_text(encoding="utf8")
    head=script[:script.index("# Reconstruct R21 candidates without modifying archived files.")]
    mid=script[script.index("# Reconstruct R21 candidates without modifying archived files."):
             script.index("arms=[('R21_ONE'")]
    head=require_once(head,
        "assert not P23.exists() and not O23.exists()",
        "assert P23.is_file() and O23.is_file()",
        "REQUIRE_ARCHIVED_IMMUTABLE_REFERENCE")
    head=require_once(head,
        "P23.write_text(json.dumps(p23,indent=2),encoding='utf8')",
        "# Original immutable reference protocol: read only",
        "PROTOCOL_OUTPUT_DISABLE")
    # Changes below are strictly output routing and an observation snapshot
    # of existing pre-filter IDLE candidates. No production source changes.
    injection="""# OUT-OF-REPO OUTPUT REMAP AND PRE-EXISTING CANDIDATE OBSERVER ONLY
assert s.count('O=R/"STABLE4_R26_SINGLE_ARM_REEXEC_RESEARCH_20261127";O.mkdir(exist_ok=False)')==1
s=s.replace('O=R/"STABLE4_R26_SINGLE_ARM_REEXEC_RESEARCH_20261127";O.mkdir(exist_ok=False)',
            'O=pathlib.Path(r"__ABS_FOLDER__");O.mkdir(exist_ok=False)')
assert s.count('raw=[c for c in raw if _keep(c)]')==1
s=s.replace('raw=[c for c in raw if _keep(c)]',
            '_owner_pre_r26_filter=tuple(raw)\\nraw=[c for c in raw if _keep(c)]')
""".replace("__ABS_FOLDER__",(ARTIFACT/"engine").as_posix())
    head=require_once(head,"compile(s,str(src),'exec')",injection+"\ncompile(s,str(src),'exec')",
                      "ORIGINAL_ENGINE_COMPILE_OBSERVATION_ONLY")
    print("AB_ORIGINAL_SOURCES_VERIFIED",FILESSHA(),flush=True)
    ctx={"__name__":"idle_r26_exact_ab_research","__file__":str(ARCHIVE/FILES["wrapper"][0])}
    exec(compile(head+mid,str(ARCHIVE/FILES["wrapper"][0]),"exec"),ctx)
    ns=ctx["ns"]
    original=list(ns["_owner_pre_r26_filter"])
    filtered=list(ns["raw"])
    original_idle=[x for x in original if x["s"]=="IDLE"]
    retained_idle=[x for x in filtered if x["s"]=="IDLE"]
    if len(original_idle)!=849 or len(retained_idle)!=197 or len({x["id"] for x in original_idle})!=849:
        raise ValueError(f"FROZEN_IDLE_CANDIDATES_NOT_849_TO_197:{len(original_idle)}:{len(retained_idle)}")
    filter_6=[x for x in filtered if x["s"]!="IDLE"]
    original_6=[x for x in original if x["s"]!="IDLE"]
    # Pure source identity of non-IDLE is guaranteed before filter toggling:
    # both variants have exactly the same already-filtered 6-runner rows.
    if {x["id"] for x in retained_idle}-{x["id"] for x in original_idle}:
        raise ValueError("IDLE_R26_RETAINED_SET_NOT_A_SUBSET")
    old_y06=[x for x in filtered if x["s"]=="V4" and x["route"]=="REC_Y06_REV_D0_T72" and x["side"]=="SHORT"]
    if len(old_y06)!=len(ctx["orig"]):raise ValueError("ARCHIVED_Y06_REMOVAL_DRIFT")
    if len(ctx["newraw"])!=378:raise ValueError("ARCHIVED_R21_ENTRY_CANDIDATES_DRIFT")
    new=ctx["newraw"]
    other=[x for x in filter_6 if x not in old_y06]
    r21=[z for c in new if (z:=ctx["reshape"](c,.30,"NATIVE")) is not None]
    assert len(r21)==378
    print("EXACT_AB_CANDIDATES",json.dumps({
        "unfilteredIdle":len(original_idle),"r26Idle":len(retained_idle),
        "otherSixAfterOriginalFilter":len(other),"r21FrozenSource":len(r21),
        "excludedIdle":len(original_idle)-len(retained_idle),
    },sort_keys=True),flush=True)
    root={x:ARTIFACT/x for x in ("OLD849","R26_197")}
    for p in root.values():p.mkdir()
    ns.update(R21_SLOTS=1,R21_PRIORITY=2,R21_RESERVE=0,R21_NO_PREEMPT=False)
    results={}
    for bps in (30,10):
        for variant,idle in (("R26_197",retained_idle),("OLD849",original_idle)):
            ns["raw"]=other+idle+r21
            ns["IDLE_RAW_CANDIDATE_HOURS"]={c["t"] for c in ns["raw"] if c["s"]=="IDLE"}
            ns["O"]=root[variant]
            result=ns["simulate"]("R21_ONE",bps,ns["P"],True)
            fills=rows_of(root[variant],bps)
            if len(fills)!=result["modeled_fills"]:
                raise ValueError("FILL_LEDGER_METRIC_COUNT_MISMATCH")
            if variant=="R26_197":
                ref=reference["results"]["R21_ONE"][str(bps)]
                for key in ("final_compounded_jpy","max_hourly_dd_pct","modeled_fills","win_rate_pct"):
                    if not math.isclose(float(result[key]),float(ref[key]),rel_tol=1e-10,abs_tol=1e-7):
                        raise ValueError("REFERENCE_R26_BPS_REPLAY_NOT_IDENTICAL:"+str(bps)+":"+key+":"+str(result[key])+":"+str(ref[key]))
                if result["admitted_by_runner"]!=ref["admitted_by_runner"]:
                    raise ValueError("REFERENCE_R26_RUNNER_ADMISSIONS_DIFFER")
            rr={k:result[k] for k in (
                "final_compounded_jpy","max_hourly_dd_pct","modeled_fills","win_rate_pct","profit_factor",
                "admitted_by_runner","blocked_by_reason","source_intents","shared_risk_trip_count",
                "shared_risk_flatten_count","v52_daily_trip_count","terminal_open_count"
                ) if k in result}
            rr["resultByRunner"]=summarized(fills)
            rr["allObservedFillsArePriceModels"]=all(
                x.get("signed_execution_verified","").strip().lower()!="true" for x in fills)
            rr["modeledFillSourceIdsByRunner"]={s:sorted(set(
                (x["source_signal_id"] for x in fills if x["strategy"]==s))) for s in
                sorted({x["strategy"] for x in fills})}
            results[f"{variant}/{bps}"]=rr
            print("AB_ACCOUNT_RESULT",variant,bps,
                "JPY",fmt_float(rr["final_compounded_jpy"]),
                "MAXDD",fmt_float(rr["max_hourly_dd_pct"]),
                "WINS",fmt_float(rr["win_rate_pct"]),
                "FILLS",rr["modeled_fills"],"IDLE",rr["admitted_by_runner"].get("IDLE"),
                flush=True)
    deltas={}
    for bps in (10,30):
        old=results[f"OLD849/{bps}"];new=results[f"R26_197/{bps}"]
        families=sorted(set(old["resultByRunner"])|set(new["resultByRunner"]))
        byrunner={}
        for fam in families:
            ov=old["resultByRunner"].get(fam,{"trades":0,"wins":0,"netPnlJpy":0})
            nv=new["resultByRunner"].get(fam,{"trades":0,"wins":0,"netPnlJpy":0})
            oids=set(old["modeledFillSourceIdsByRunner"].get(fam,[]))
            nids=set(new["modeledFillSourceIdsByRunner"].get(fam,[]))
            byrunner[fam]={
                "oldModeledTrades":ov["trades"],"newModeledTrades":nv["trades"],
                "tradeCountDelta":nv["trades"]-ov["trades"],
                "sourceIdsLost":len(oids-nids),"sourceIdsGained":len(nids-oids),
                "oldNetPnlJPY":fmt_float(ov["netPnlJpy"]),
                "r26NetPnlJPY":fmt_float(nv["netPnlJpy"]),
                "netPnlJPYDelta":fmt_float(nv["netPnlJpy"]-ov["netPnlJpy"])}
        deltas[str(bps)]={
            "oldFinalJPY":fmt_float(old["final_compounded_jpy"]),
            "r26FinalJPY":fmt_float(new["final_compounded_jpy"]),
            "r26MinusOldFinalJPY":fmt_float(new["final_compounded_jpy"]-old["final_compounded_jpy"]),
            "r26OverOldFinalRatio":round(new["final_compounded_jpy"]/old["final_compounded_jpy"],8),
            "oldMaxDdPct":fmt_float(old["max_hourly_dd_pct"]),
            "r26MaxDdPct":fmt_float(new["max_hourly_dd_pct"]),
            "maxDdPercentPointsR26MinusOld":fmt_float(new["max_hourly_dd_pct"]-old["max_hourly_dd_pct"]),
            "oldWinRatePct":fmt_float(old["win_rate_pct"]),
            "r26WinRatePct":fmt_float(new["win_rate_pct"]),
            "perRunner":byrunner,
        }
    report={
        "schema":"stable4-idle-r26-only-849-vs-197-sevenrunner-wallet-frozen-bt-ab/v1",
        "status":"ARCHIVED_FROZEN_SEVEN_RUNNER_PRICE_MODEL_COMPARISON_NOT_SOURCE_NATIVE_LIVE_CUTOVER_CERTIFICATE",
        "periodUtc":["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z"],
        "initialCapitalJPY":10000,"modelsBpsRoundTrip":[10,30],
        "fixedR21":"R21_ONE 0.30x one slot original native exit",
        "fixedP91":"original archived R26 PENGU replacement",
        "sameNonIdleSourceTapeAndAllOtherSixPolicies":True,
        "onlyChangedFactor":"IDLE keep all 849 archived source candidates vs the already selected R26 197",
        "sourceSha256":{k:{"filename":v[0],"sha256":v[1]} for k,v in FILES.items()},
        "r26HistoricalReferenceReproduced":True,
        "candidateCounts":{"old":len(original_idle),"r26":len(retained_idle),
             "removedByR26":len(original_idle)-len(retained_idle),
             "unchangedOtherSixBeforeR21":len(other),"fixedR21Candidates":len(r21)},
        "results":results,"differencesR26MinusOld":deltas,
        "liveOrderAuthority":False,"completeActualSevenRunnerNativeReplay":False,
        "actualVenueFillsProven":False,"realFutureReturnGuaranteed":False,
        "caveats":[
            "Historical source-filled 7-sleeve multi-asset 2026-11-27 R26 model is only an archived reconstructed-intent/price-proxy model, not current-source strict native all-seven BT. V52 has no executable dual-venue L2 book; this uses pre-existing price/exit proxy unchanged in both arms.",
            "Only IDLE candidate inclusion set changes. All other six source intentions including R21 and adopted P91, original gross/admission/preemption, risk, exit and funding logic remain identical in one isolated execution namespace.",
            "Outputs are compounded-wallet modeled JPY, NOT live or realistically executable fill amounts. Comparing terminal portfolios must include displaced peers and opportunity costs, not standalone IDLE mean PnL.",
            "The IDLE 849 source tape has archived prices and M5 exit observations. In-candidate R26 policy is already selected in original frozen model, and no optimization is attempted.",
            "No source logic edits, no VPS/Root/master/Owner release, no order or test order; all report outputs in owner user-root.",
        ]}
    out=ARTIFACT/REPORT_NAME
    out.write_text(json.dumps(report,sort_keys=True,indent=2,ensure_ascii=False,allow_nan=False)+"\n",encoding="utf8")
    print("AB_FINAL_REPORT",str(out),"SHA256",hashlib.sha256(out.read_bytes()).hexdigest(),flush=True)
    print("AB_SUMMARY",json.dumps(deltas,sort_keys=True,ensure_ascii=True)[:11000],flush=True)
def FILESSHA():return {k:v[1][:12] for k,v in FILES.items()}
if __name__=="__main__":execute()
