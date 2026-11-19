#!/usr/bin/env python3
"""Read-only replay export of STABLE4 research wallet (NOT production certified).

Uses original 5-minute mark-to-market snapshots, preserves extrema per 1h bucket
and event times. Never treats modeled fills as venue executions.
"""
import argparse,bisect,csv,gzip,hashlib,json,pathlib
from collections import defaultdict
from datetime import datetime,timezone

CASE="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_STABLE3_Q102_ADOPTED_ON"
START="2025-10-01T00:00:00Z";END="2026-10-01T00:00:00Z"
def sha(path):
    x=hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1048576),b""):x.update(block)
    return x.hexdigest()
def iso(ms):
    return datetime.fromtimestamp(ms/1000,tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def load_btc(gz):
    rows=[]
    with gzip.open(gz,"rt",encoding="utf8") as f:
        for line in f:
            x=json.loads(line);t=iso(int(x[0]))
            if not START<=t<END:continue
            o,h,l,c=map(float,x[1:5])
            if min(o,h,l,c)<=0 or h<max(o,c) or l>min(o,c):raise ValueError("BAD_BTC_BAR")
            rows.append({"time":t,"closedAt":iso(int(x[0])+3600000),
              "open":o,"high":h,"low":l,"close":c})
    if len(rows)<8000:raise ValueError("BTC_HISTORY_INCOMPLETE")
    return rows
def read_csv(path):
    with path.open("r",encoding="utf-8-sig",newline="") as f:return list(csv.DictReader(f))
def build(folder,bps,btc,btc_sha):
    prefix=CASE+f"_{bps}BPS_"
    files={name:folder/(prefix+suffix) for name,suffix in (
        ("equity","EQUITY_30MIN.csv"),("fills","FILLS.csv"),
        ("decisions","DECISIONS.csv"),("risk","SHARED_RISK_EVENTS.csv"),
        ("summary","SUMMARY.json"))}
    if any(not p.is_file() for p in files.values()):raise ValueError("MISSING_RESEARCH_SOURCE")
    summary=json.loads(files["summary"].read_text(encoding="utf8"))
    if summary.get("status")!="CAUSAL_THREE_PLUS_PRETARGET_STABLE_ROUTE_QUARANTINE_RESEARCH_ONLY":
        raise ValueError("UNEXPECTED_RESEARCH_STATUS")
    if summary.get("cost_bps_roundtrip")!=bps or summary.get("case")!=CASE:
        raise ValueError("WRONG_RESEARCH_CASE")
    raw=read_csv(files["equity"])
    if len(raw)<10000:raise ValueError("MISSING_MARK_TO_MARKET_ROWS")
    if raw[0]["utc"]!=START or raw[-1]["utc"]!=END:
        raise ValueError("WRONG_HISTORICAL_PERIOD")
    gross_cols=["crypto_gross_x","stock_gross_x","total_gross_x"]
    for row in raw:
        vals=[float(row[k]) for k in gross_cols]
        if min(vals)<-0.000001 or abs(vals[0]+vals[1]-vals[2])>0.02:
            raise ValueError("SOURCE_GROSS_INCONSISTENT "+row["utc"])
    end_equity=float(raw[-1]["compounded_mtm_equity_jpy"])
    if abs(end_equity-float(summary["final_compounded_jpy"]))>0.001:
        raise ValueError("EQUITY_SUMMARY_MISMATCH")
    # Min/max/last per hour preserves extrema and chronological order while keeping
    # the complete replay below 50k frames (source contains far more raw samples).
    buckets=defaultdict(list)
    for row in raw:buckets[row["utc"][:13]].append(row)
    chosen={}
    for group in buckets.values():
        for row in (group[0],min(group,key=lambda x:float(x["compounded_mtm_equity_jpy"])),
                    max(group,key=lambda x:float(x["compounded_mtm_equity_jpy"])),group[-1]):
            chosen[row["utc"]]=row
    source_rows=[chosen[t] for t in sorted(chosen)]
    if len(source_rows)>48000:raise ValueError("REPLAY_FRAME_OVER_LIMIT")
    if source_rows[-1]["utc"]!=END:raise ValueError("MISSING_END_SNAPSHOT")
    trades=read_csv(files["fills"])
    if len(trades)!=summary["modeled_fills"]:raise ValueError("FILL_COUNT_MISMATCH")
    # Provenance-only strategy/route catalogue and closed-model-trade statistics.
    catalog={}
    by_symbol={}
    by_route={}
    for item in trades:
        logic=item["strategy"]
        sym=item["symbol"]
        source_sha=item["source_runtime_sha"].lower()
        route=item["route"]
        catalog_item=catalog.setdefault(logic,{"trades":0,"sha":set(),"classes":set(),"routes":set(),"symbols":set()})
        catalog_item["trades"]+=1
        catalog_item["sha"].add(source_sha)
        catalog_item["classes"].add(item["model_class"])
        catalog_item["routes"].add(route)
        catalog_item["symbols"].add(sym)
        key=(logic,sym)
        model=by_symbol.setdefault(key,{"trades":0,"closed":0,"wins":0,"net":0.0,"losses":[],"adverse":0,"netLosses":0})
        model["trades"]+=1
        model["closed"]+=1
        pnl=float(item["net_pnl_jpy"])
        model["net"]+=pnl
        if pnl>0:model["wins"]+=1
        if pnl<0:
            model["losses"].append(pnl)
            model["netLosses"]+=1
        entry_price=float(item["model_entry_price"])
        exit_price=float(item["model_exit_price"])
        if entry_price<=0 or exit_price<=0:raise ValueError("INVALID_PRICE_SOURCE_FILL")
        # Opposite terminal price direction, not a proof of wrong entry signal.
        adverse=(exit_price<entry_price) if item["side"]=="LONG" else (exit_price>entry_price)
        if adverse:model["adverse"]+=1
        route_model=by_route.setdefault((logic,route,sym),
          {"trades":0,"closed":0,"wins":0,"net":0.0,"losses":[],"adverse":0,"netLosses":0})
        route_model["trades"]+=1
        route_model["closed"]+=1
        route_model["net"]+=pnl
        if pnl>0:route_model["wins"]+=1
        if pnl<0:
            route_model["losses"].append(pnl)
            route_model["netLosses"]+=1
        if adverse:route_model["adverse"]+=1
    terminal=[]
    for item in summary.get("terminal_open_positions",[]):
        logic=item["strategy"];sym=item["symbol"]
        t=item["entry_utc"]
        if not START<=t<END:raise ValueError("TERMINAL_ENTRY_OUTSIDE_PERIOD")
        position={
          "logic":logic,"symbol":sym,"side":item["side"],"openedAt":t,
          "entryPrice":float(item["entry_price"]),"entryGrossX":float(item["gross_x"]),
          "route":item["route"],"modeledFutureExitAt":item.get("modeled_future_exit_utc"),
          "evidence":"SOURCE_RESEARCH_MANIFEST_TERMINAL_OPEN_NOT_VENUE"}
        terminal.append(position)
        record=by_symbol.setdefault((logic,sym),
          {"trades":0,"closed":0,"wins":0,"net":0.0,"losses":[],"adverse":0,"netLosses":0})
        record["trades"]+=1
        route_record=by_route.setdefault((logic,item["route"],sym),
          {"trades":0,"closed":0,"wins":0,"net":0.0,"losses":[],"adverse":0,"netLosses":0})
        route_record["trades"]+=1
    if len(terminal)!=summary.get("terminal_open_count",0):
        raise ValueError("TERMINAL_OPEN_COUNT_MISMATCH")
    strategy_catalog=[{
      "logic":logic,"trades":item["trades"],"sourceRuntimeShas":sorted(item["sha"]),
      "modelClasses":sorted(item["classes"]),"routes":len(item["routes"]),
      "symbols":len(item["symbols"]),"status":"RESEARCH_SOURCE_UNVERIFIED"}
      for logic,item in sorted(catalog.items())]
    strategy_stats=[{
      "logic":logic,"symbol":sym,"tradeCount":item["trades"],
      "closedCount":item["closed"],"wins":item["wins"],
      "netPnlJpy":round(item["net"],6),
      "maxLossJpy":min(item["losses"]) if item["losses"] else None,
      "winRatePct":100*item["wins"]/item["closed"] if item["closed"] else None,
      "adverseExitCount":item["adverse"],"netLossCount":item["netLosses"]}
      for (logic,sym),item in sorted(by_symbol.items())]
    strategy_route_stats=[{
      "logic":logic,"route":route,"symbol":sym,"tradeCount":item["trades"],
      "closedCount":item["closed"],"wins":item["wins"],
      "netPnlJpy":round(item["net"],6),
      "maxLossJpy":min(item["losses"]) if item["losses"] else None,
      "winRatePct":100*item["wins"]/item["closed"] if item["closed"] else None,
      "adverseExitCount":item["adverse"],"netLossCount":item["netLosses"]}
      for (logic,route,sym),item in sorted(by_route.items())]
    if sum(row["closedCount"] for row in strategy_route_stats)!=len(trades):
        raise ValueError("SOURCE_ROUTE_STATS_CLOSED_COUNT_MISMATCH")
    events=defaultdict(list)
    for item in trades:
        if item["signed_execution_verified"]!="False" or item["actual_venue_order_id"]:
            raise ValueError("UNEXPECTED_ACTUAL_FILL_FIELD")
        name=item["strategy"]+" "+item["symbol"]+" "+item["side"]
        enter,exit=item["entry_utc"],item["exit_utc"]
        if not START<=enter<exit<END:raise ValueError("MODEL_FILL_OUTSIDE_PERIOD")
        events[enter].append("MODEL ENTRY "+name+" / "+item["trade_id"]+" (NOT VENUE FILL)")
        events[exit].append("MODEL EXIT "+name+" / "+item["exit_model_reason"]+
                            " / "+format(float(item["net_pnl_jpy"]),"+.2f")+" JPY (NOT VENUE FILL)")
    for item in read_csv(files["decisions"]):
        time=item["utc"]
        if not START<=time<END:raise ValueError("DECISION_OUTSIDE_PERIOD")
        if item["decision"]=="BLOCK":
            events[time].append("BLOCK "+item["strategy"]+" "+item["reason"])
        elif item["decision"]=="MODEL_ENTER":
            events[time].append("CANDIDATE "+item["strategy"]+" "+item["reason"])
    for item in read_csv(files["risk"]):
        time=item["utc"]
        if START<=time<END:
            events[time].append("RISK "+item["event"]+" "+str(item.get("loss_pct",""))+"% (research model)")
    # Stamp each event on the NEXT available source valuation; never place a future
    # event into an earlier frame. Its original UTC remains inside the event string.
    times=[row["utc"] for row in source_rows]
    attached=defaultdict(list)
    for event_time,items in events.items():
        i=bisect.bisect_left(times,event_time)
        if i>=len(times):raise ValueError("EVENT_AFTER_SOURCE_END")
        attached[times[i]].extend(event_time+" "+item for item in items)
    btc_closes=[c["closedAt"] for c in btc]
    frames=[]
    for row in source_rows:
        now=row["utc"]
        i=bisect.bisect_right(btc_closes,now)-1
        equity=float(row["compounded_mtm_equity_jpy"])
        cash=float(row["wallet_cash_jpy"])
        total,crypto,stock=map(float,(row["total_gross_x"],row["crypto_gross_x"],row["stock_gross_x"]))
        open_count=int(row["open_count"])
        frames.append({"timestamp":now,"btc":btc[i]["close"] if i>=0 else None,
          "equity":equity,"realized":cash-10000,"positions":[],
          "events":attached.get(now,[]),"sourceOpenCount":open_count,
          "gross":{"totalX":total,"cryptoX":crypto,"stockX":stock,"source":"bt_equity_snapshot"}})
    if not frames or len(frames)>50000:raise ValueError("FRAME_BOUNDS")
    return {
     "schema":"disdex-bt-portfolio-v1","mode":"EXTERNAL","seed":0,
     "engineSha":"STABLE4_RESEARCH_SOURCE_ONLY_NOT_PRODUCTION_CERTIFIED",
     "frames":frames,"btcCandles":btc,
     "strategyCatalog":strategy_catalog,"strategyStats":strategy_stats,
     "strategyRouteStats":strategy_route_stats,
     "terminalModelPositions":terminal,
     "limits":{"total":3.5,"crypto":3.0,"stock":1.5},
     "researchSummary":{"costBps":bps,"initialJpy":summary["initial_jpy"],
       "finalEquityJpy":summary["final_compounded_jpy"],"maxDdPct":summary["max_hourly_dd_pct"],
       "modelFills":summary["modeled_fills"],"winRatePct":summary["win_rate_pct"],
       "profitFactor":summary["profit_factor"]},
     "source":{"kind":"HISTORICAL_STABLE4_RESEARCH_NOT_PRODUCTION",
       "equitySha256":sha(files["equity"]),"fillsSha256":sha(files["fills"]),
       "summarySha256":sha(files["summary"]),"btcCandlesSha256":btc_sha,
       "positionExposureEvidence":"MISSING_SOURCE_POSITION_MARKS",
       "note":json.dumps({"case":CASE,"costBps":bps,"dataInterval":"2025-10-01..2026-10-01 UTC",
           "sourceStatus":summary["status"],"runnerCounts":summary["admitted_by_runner"],
           "gross":"snapshot only; individual holdings incomplete",
           "sampledFrom":"5-minute source equity, one-hour min/max/end; source reported DD independent",
           "disclaimer":"RESEARCH ONLY; NOT current Production parity; modeled trades not actual fills"},
           separators=(",",":"))}
    }
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--source-dir",type=pathlib.Path,required=True)
    parser.add_argument("--btc-gz",type=pathlib.Path,required=True)
    parser.add_argument("--output-dir",type=pathlib.Path,required=True)
    args=parser.parse_args()
    btc=load_btc(args.btc_gz);btcsha=sha(args.btc_gz)
    args.output_dir.mkdir(parents=True,exist_ok=True)
    exports=[]
    for bps in (10,30):
        replay=build(args.source_dir,bps,btc,btcsha)
        name=f"disdex-baseline-STABLE4-research-{bps}bps-UNCERTIFIED.json"
        path=args.output_dir/name
        path.write_text(json.dumps(replay,separators=(",",":"),ensure_ascii=False)+"\n",encoding="utf-8")
        exports.append({"bps":bps,"file":name,"sha256":sha(path),
                        "frames":len(replay["frames"]),"modelFills":replay["researchSummary"]["modelFills"],
                        "researchMaxDdPct":replay["researchSummary"]["maxDdPct"]})
    manifest={"schema":"disdex-private-stable4-research-replays/v1",
      "dataset":"STABLE4_OPPORTUNITY_PROD_CAPS_20261114",
      "research_integrated_model":True,"integrated_eight_runner":False,
      "production_parity_verified":False,"actual_exchange_fills_verified":False,
      "source_common_btc_sha256":btcsha,"exports":exports}
    (args.output_dir/"MANIFEST_UNCERTIFIED.json").write_text(
      json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(manifest,ensure_ascii=False,indent=2))
if __name__=="__main__":main()