#!/usr/bin/env python3
"""Build reproducible, source-hashed read-only HP replays from existing research BT folders.

This tool NEVER runs a trading strategy and NEVER sends or modifies LIVE orders.
The source manifest must contain a unique cost case, and all caps/counts must match.
"""
from __future__ import annotations
import argparse,json,sys
from pathlib import Path
from bt_hp_research_replay_adapter import Source,resolve_gross_caps,convert,digest

def source_file(base:Path,bps:int,suffix:str)->Path:
    matches=list(base.glob("*_"+str(bps)+"BPS_"+suffix))
    if len(matches)!=1:raise ValueError("Expected exactly one "+str(bps)+"BPS_"+suffix+" in "+str(base))
    return matches[0]
def build_case(base:Path,bps:int,btc:Path|None,interval_minutes:int,outdir:Path)->dict:
    source=Source(
        equity=source_file(base,bps,"EQUITY_30MIN.csv"),
        fills=source_file(base,bps,"FILLS.csv"),
        summary=base/"RUN_MANIFEST.json",
        decisions=source_file(base,bps,"DECISIONS.csv"),
        risk_events=source_file(base,bps,"SHARED_RISK_EVENTS.csv"),
        btc_candles=btc,
        partial_events=source_file(base,bps,"PENGU_PARTIAL_EVENTS.csv"),
        funding=source_file(base,bps,"FUNDING.csv"),
    )
    if not source.summary.is_file():raise ValueError("Missing RUN_MANIFEST.json")
    caps,evidence,meta=resolve_gross_caps(source,cost_bps=bps)
    result=convert(source,caps,interval_minutes=interval_minutes,cap_evidence=evidence,source_meta=meta)
    modeled=sum(item["trades"] for item in result["strategyCatalog"])
    if modeled!=int(meta["summaryExpectedFillCount"]):
        raise ValueError("Source modeled fill count does not match summary")
    dst=outdir/(base.name+"_"+str(bps)+"BPS_REPLAY.json")
    payload=json.dumps(result,ensure_ascii=False,separators=(",",":"),allow_nan=False)
    if len(payload.encode("utf-8"))>60_000_000:
        raise ValueError("Replay JSON > HP 60MB import cap; increase sampling interval")
    dst.write_text(payload,encoding="utf-8")
    return {
        "file":dst.name,"bytes":dst.stat().st_size,"sha256":digest(dst),
        "sourceCase":base.name,"bps":bps,"frames":len(result["frames"]),
        "modeledFills":modeled,"sourceGrossCaps":caps,
        "strategyCount":len(result["strategyCatalog"]),
        "btcCandles":len(result.get("btcCandles",[])),
        "penguPartialEvents":sum(" PARTIAL " in e for f in result["frames"] for e in f["events"]),
        "fundingEventCount":sum(" FUNDING " in e for f in result["frames"] for e in f["events"]),
        "modelSummary":result.get("researchSummary"),
        "sourceStatus":meta["manifestStatus"],
        "sourceMode":"RESEARCH_MODEL_NOT_VENUE_EXECUTION"
    }
def main(argv=None)->int:
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--case-dir",type=Path,nargs="+",required=True)
    ap.add_argument("--output-dir",type=Path,required=True)
    ap.add_argument("--btc-candles",type=Path)
    ap.add_argument("--cost-bps",type=int,nargs="+",choices=(10,30),default=[10,30])
    ap.add_argument("--interval-minutes",type=int,default=60)
    args=ap.parse_args(argv)
    if not 5<=args.interval_minutes<=1440:ap.error("Invalid sampling interval")
    if args.btc_candles and not args.btc_candles.is_file():ap.error("BTC price file missing")
    args.output_dir.mkdir(parents=True,exist_ok=True)
    results=[]
    for base in args.case_dir:
        if not base.is_dir():ap.error("Case folder missing: "+str(base))
        for bps in sorted(set(args.cost_bps)):
            results.append(build_case(base,bps,args.btc_candles,args.interval_minutes,args.output_dir))
    index=args.output_dir/"INDEX.json"
    index.write_text(json.dumps(results,indent=2,ensure_ascii=False,allow_nan=False),encoding="utf-8")
    print(json.dumps({"created":len(results),"index":str(index),
      "results":results},ensure_ascii=False,indent=2))
    return 0
if __name__=="__main__":
    sys.exit(main())
