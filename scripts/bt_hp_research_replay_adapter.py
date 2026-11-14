#!/usr/bin/env python3
"""Read-only adapter: research BT evidence -> visual replay. It NEVER runs a strategy.

Research fills are model fills, not venue executions. They often lack quantity and
mark prices; these fields are null, and per-position current Gross is also null.
Only the equity CSV provides as-of Total/Crypto/Stock Gross. The adapter will never
invent a BTC chart or per-position Gross to complete a screenshot.
"""
from __future__ import annotations
import argparse, csv, gzip, hashlib, json, math, sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from bt_hp_source_position_snapshots import load_position_snapshots,check_source_snapshot

@dataclass(frozen=True)
class Source:
    equity: Path
    fills: Path
    summary: Path | None
    decisions: Path | None = None
    risk_events: Path | None = None
    btc_candles: Path | None = None
    partial_events: Path | None = None
    funding: Path | None = None
    position_snapshots: Path | None = None

def digest(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def iso(raw: str) -> str:
    t=raw.strip()
    d=datetime.fromisoformat(t.replace("Z","+00:00"))
    if d.tzinfo is None: raise ValueError("Naive timestamp prohibited: "+raw)
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def number(raw: str, label: str) -> float:
    n=float(raw)
    if not math.isfinite(n):raise ValueError("Nonfinite "+label)
    return n

def read_rows(path: Path):
    with path.open("r",encoding="utf-8-sig",newline="") as fh:
        yield from csv.DictReader(fh)

def load_btc_candles(path:Path|None) -> list[dict]:
    if path is None: return []
    result=[]
    with gzip.open(path,"rt",encoding="utf-8") as fh:
        for line in fh:
            if not line.strip(): continue
            row=json.loads(line)
            if not isinstance(row,list) or len(row)<7:raise ValueError("Invalid BTC candle source")
            start=datetime.fromtimestamp(int(row[0])/1000,timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            closed=datetime.fromtimestamp((int(row[6])+1)/1000,timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            o,h,l,c=(number(str(x),"BTC price") for x in row[1:5])
            if min(o,h,l,c)<=0 or l>min(o,c) or h<max(o,c) or closed<=start:raise ValueError("Invalid BTC OHLC candle")
            if result and (start<=result[-1]["time"] or closed<=result[-1]["closedAt"]):
                raise ValueError("Duplicate/unsorted BTC candles")
            result.append({"time":start,"closedAt":closed,"open":o,"high":h,"low":l,"close":c})
    return result

def prepare(source: Source):
    fills=[]
    timeline=[]
    for row in read_rows(source.fills):
        entry=iso(row["entry_utc"])
        exit_time=iso(row["exit_utc"]) if row.get("exit_utc") else None
        if exit_time and exit_time<entry:
            raise ValueError("Exit before entry for "+row["trade_id"])
        key=row["trade_id"]
        if not key:raise ValueError("Missing trade ID")
        direction=row["side"].upper()
        if direction not in ("LONG","SHORT"):raise ValueError("Unknown side "+direction)
        position={
            "id":key,"logic":row["strategy"],"symbol":row["symbol"],
            "side":direction,"quantity":None,
            "entry":number(row["model_entry_price"],"entry"),
            "mark":None,"gross":None,
            "grossAtEntry":number(row["gross_x"],"gross at entry"),
            "notional":number(row["notional_jpy"],"notional JPY"),
            "openedAt":entry
        }
        fills.append(position)
        timeline.append((entry,1,key,position,"ENTRY "+row["strategy"]+" "+row["symbol"]+" "+direction+
                        " route="+row.get("route","")+" signal="+row.get("source_signal_id","")+" [model]"))
        if exit_time:
            pnl=number(row.get("net_pnl_jpy","0") or "0","model net PnL")
            timeline.append((exit_time,0,key,None,"EXIT "+row["strategy"]+" "+row["symbol"]+" "+direction+
                            " reason="+row.get("exit_model_reason","")+" "+format(pnl,"+.2f")+" JPY [model]"))
    if len({r["id"] for r in fills})!=len(fills):
        raise ValueError("Duplicate trade_id")
    if source.partial_events:
        for row in read_rows(source.partial_events):
            t=iso(row["utc"]);key=row["trade_id"]
            fraction=number(row["closed_fraction_of_current"],"closed fraction")
            remaining=number(row["remaining_gross_x"],"remaining Gross")
            if not (0<fraction<=1 and remaining>=0):
                raise ValueError("Invalid partial-close fraction or gross")
            timeline.append((t,3,key,{
                "lastPartialGrossX":remaining,
                "lastPartialAt":t,
                "lastPartialFractionClosed":fraction,
            },"PARTIAL "+row["strategy"]+" "+row["symbol"]+
                             " closed="+format(fraction*100,".2f")+"%"+
                             " remaining="+format(remaining,".4f")+"x [source model]"))
    if source.funding:
        for row in read_rows(source.funding):
            amount=number(row["modeled_wallet_cashflow_jpy"],"model funding")
            t=iso(row["timestamp_utc"])
            key=row.get("trade_id","")
            timeline.append((t,2,key,None,"FUNDING "+key+" "+
                             format(amount,"+.4f")+" JPY [model]"))
    if source.decisions:
        for row in read_rows(source.decisions):
            decision=row.get("decision","")
            if decision not in ("MODEL_ENTER","BLOCK"):
                continue
            if decision=="BLOCK":
                timeline.append((iso(row["utc"]),2,"",None,"BLOCK "+row.get("strategy","")+" "+row.get("reason","")))
    if source.risk_events:
        for row in read_rows(source.risk_events):
            timeline.append((iso(row["utc"]),2,"",None,"RISK "+row.get("event","")+" "+row.get("strategy","")))
    # Same timestamp: ENTRY -> PARTIAL -> FINAL EXIT -> annotation.
    # A research model may report a partial close and its final stop in the same tick.
    timeline.sort(key=lambda x:(x[0],{1:0,3:1,0:2,2:3}[x[1]],x[2]))
    return fills,timeline

def research_strategy_catalog(fills_path:Path) -> list[dict]:
    catalog:dict[str,dict]={}
    for row in read_rows(fills_path):
        logic=row.get("strategy","").strip()
        if not logic:raise ValueError("Fill without strategy name")
        if logic not in catalog:
            catalog[logic]={"logic":logic,"trades":0,"sourceRuntimeShas":set(),
                            "modelClasses":set(),"routesSet":set(),"symbolsSet":set(),
                            "status":"RESEARCH_SOURCE_UNVERIFIED"}
        item=catalog[logic]
        item["trades"]+=1
        if row.get("source_runtime_sha"):item["sourceRuntimeShas"].add(row["source_runtime_sha"])
        if row.get("model_class"):item["modelClasses"].add(row["model_class"])
        if row.get("route"):item["routesSet"].add(row["route"])
        if row.get("symbol"):item["symbolsSet"].add(row["symbol"])
    result=[]
    for logic in sorted(catalog):
        item=catalog[logic]
        result.append({"logic":logic,"trades":item["trades"],
                       "sourceRuntimeShas":sorted(item["sourceRuntimeShas"]),
                       "modelClasses":sorted(item["modelClasses"]),
                       "routes":len(item["routesSet"]),"symbols":len(item["symbolsSet"]),
                       "status":"RESEARCH_SOURCE_UNVERIFIED"})
    return result

def resolve_gross_caps(source:Source, *, total:float|None=None, crypto:float|None=None,
                       stock:float|None=None, cost_bps:int|None=None) -> tuple[dict[str,float],str,dict]:
    """Use exactly the source's cost-bps case; refuse external overrides that disagree."""
    evidence:dict={}
    record=None
    if source.summary is not None:
        raw=json.loads(source.summary.read_text(encoding="utf-8-sig"))
        if not isinstance(raw,dict) or not isinstance(raw.get("results"),list):
            raise ValueError("Summary manifest must contain results list")
        candidates=raw["results"]
        if cost_bps is None:
            import re
            matches=set()
            for path in (source.fills,source.equity):
                matches.update(int(v) for v in re.findall(r"(?<![0-9])(10|30)BPS",path.name.upper()))
            if len(matches)!=1:
                raise ValueError("Ambiguous cost mode: specify --cost-bps 10 or 30")
            cost_bps=matches.pop()
        matching=[r for r in candidates if isinstance(r,dict) and r.get("cost_bps_roundtrip")==cost_bps]
        if len(matching)!=1:
            raise ValueError("No unique source manifest case for cost-bps="+str(cost_bps))
        record=matching[0]
        terminal_count=record.get("terminal_open_count")
        terminal_rows=record.get("terminal_open_positions")
        if terminal_count is not None or terminal_rows is not None:
            if not isinstance(terminal_count,int) or isinstance(terminal_count,bool) or not 0<=terminal_count<=300:
                raise ValueError("Invalid source terminal open count")
            if not isinstance(terminal_rows,list) or len(terminal_rows)!=terminal_count:
                raise ValueError("Source terminal open positions/count mismatch")
            validated_terminal=[]
            for pos in terminal_rows:
                if not isinstance(pos,dict):raise ValueError("Invalid terminal model position source")
                if not all(isinstance(pos.get(k),str) and pos[k] for k in
                           ("strategy","symbol","side","entry_utc","route")):
                    raise ValueError("Incomplete terminal model position identity")
                if pos["side"] not in ("LONG","SHORT"):raise ValueError("Invalid terminal model direction")
                when=iso(pos["entry_utc"])
                future=iso(pos["modeled_future_exit_utc"]) if pos.get("modeled_future_exit_utc") else None
                if future and future<=when:raise ValueError("Terminal model future exit before entry")
                entry_price=number(str(pos["entry_price"]),"terminal entry price")
                entry_gross=number(str(pos["gross_x"]),"terminal entry Gross")
                if entry_price<=0 or entry_gross<=0:raise ValueError("Invalid terminal model price or Gross")
                validated_terminal.append({
                    "logic":pos["strategy"],"symbol":pos["symbol"],"side":pos["side"],
                    "openedAt":when,"entryPrice":entry_price,"entryGrossX":entry_gross,
                    "route":pos["route"],"modeledFutureExitAt":future,
                    "evidence":"SOURCE_RESEARCH_MANIFEST_TERMINAL_OPEN_NOT_VENUE"
                })
        else:validated_terminal=None
        evidence={"costBps":cost_bps,
                  "researchCase":record.get("case"),
                  "manifestStatus":raw.get("status"),
                  "summaryExpectedFillCount":record.get("modeled_fills"),
                  "terminalModelPositions":validated_terminal,
                  "researchSummary":({
                    "costBps":cost_bps,
                    "initialJpy":number(str(record["initial_jpy"]),"initial_jpy"),
                    "finalEquityJpy":number(str(record["final_compounded_jpy"]),"final_compounded_jpy"),
                    "maxDdPct":number(str(record["max_hourly_dd_pct"]),"max_hourly_dd_pct"),
                    "modelFills":int(record["modeled_fills"]),
                    "winRatePct":number(str(record["win_rate_pct"]),"win_rate_pct"),
                    "profitFactor":number(str(record["profit_factor"]),"profit_factor")
                  } if all(k in record for k in
                    ("initial_jpy","final_compounded_jpy","max_hourly_dd_pct",
                     "modeled_fills","win_rate_pct","profit_factor")) else None)}
        caps={key:number(str(record[label]),label) for key,label in
              (("total","total_cap"),("crypto","crypto_cap"),("stock","stock_cap"))}
        for name,requested in (("total",total),("crypto",crypto),("stock",stock)):
            if requested is not None and not math.isclose(requested,caps[name],abs_tol=1e-7):
                raise ValueError("Gross cap mismatch: "+name+" supplied "+str(requested)+
                                 " vs source manifest "+str(caps[name]))
        source_kind="SOURCE_SUMMARY_MATCHED_RESEARCH_ONLY"
    else:
        caps={"total":total,"crypto":crypto,"stock":stock}
        source_kind="USER_SUPPLIED_NOT_VERIFIED"
    if any(v is None or not math.isfinite(v) or v<=0 or v>100 for v in caps.values()):
        raise ValueError("Missing or invalid source Gross limits")
    # A category cap can legally exceed total cap; the independent total gate is stricter.
    return caps,source_kind,evidence

def model_strategy_performance(path:Path) -> list[dict]:
    """Model-filled trade statistics by strategy/symbol, not signed exchange PnL."""
    groups:dict[tuple[str,str],dict]={}
    for row in read_rows(path):
        key=(row["strategy"],row["symbol"])
        if key not in groups:
            groups[key]={"logic":key[0],"symbol":key[1],"tradeCount":0,"closedCount":0,
                         "wins":0,"netPnlJpy":0.0,"maxLossJpy":None}
        g=groups[key];g["tradeCount"]+=1
        if not row.get("exit_utc"):continue
        pnl=number(row["net_pnl_jpy"],"model trade net pnl")
        g["closedCount"]+=1
        if pnl>0:g["wins"]+=1
        g["netPnlJpy"]+=pnl
        g["maxLossJpy"]=min(g["maxLossJpy"] if g["maxLossJpy"] is not None else 0,pnl)
    result=[]
    for key in sorted(groups):
        g=groups[key]
        g["winRatePct"]=(100*g["wins"]/g["closedCount"]) if g["closedCount"] else None
        result.append(g)
    return result

def convert(source:Source, limits:dict[str,float], *, interval_minutes:int=60, max_frames:int=50000, cap_evidence:str="USER_SUPPLIED_NOT_VERIFIED", source_meta:dict|None=None) -> dict:
    fills,events=prepare(source)
    candles=load_btc_candles(source.btc_candles)
    source_positions=(load_position_snapshots(source.position_snapshots)
                      if source.position_snapshots is not None else None)
    used_source_position_times:set[str]=set()

    candle_cursor=0
    latest_btc=None
    active:dict[str,dict]={}
    cursor=0;frames=[];previous_epoch=-1
    event_buffer:list[str]=[]
    first_equity=None
    max_equity_gross=0.0
    phase_corrected=0
    phase_ambiguous=0
    phase_unmatched=0
    t_last=None
    last_equity_open_count=None
    for row in read_rows(source.equity):
        t=iso(row["utc"])
        seconds=int(datetime.fromisoformat(t.replace("Z","+00:00")).timestamp())
        if t_last is not None and t<=t_last:raise ValueError("Equity timestamps unsorted/duplicated")
        t_last=t
        last_equity_open_count=(int(row["open_count"])
                                if row.get("open_count") not in (None,"") else None)
        total=number(row["total_gross_x"],"total_gross_x")
        crypto=number(row["crypto_gross_x"],"crypto_gross_x")
        stock=number(row["stock_gross_x"],"stock_gross_x")
        if min(total,crypto,stock)<-1e-6 or abs((crypto+stock)-total)>0.02:
            raise ValueError("Invalid equity Gross at "+t)
        max_equity_gross=max(total,max_equity_gross)
        if first_equity is None:first_equity=number(row["wallet_cash_jpy"],"wallet_cash_jpy")
        # NEVER read the close of an unfinished candle.
        while candle_cursor<len(candles) and candles[candle_cursor]["closedAt"]<=t:
            latest_btc=candles[candle_cursor]["close"]
            candle_cursor+=1
        same_timestamp_states=[]
        same_time_events=[]
        while cursor<len(events) and events[cursor][0]<=t:
            when,kind,key,position,description=events[cursor]
            if when==t:
                if not same_timestamp_states:same_timestamp_states.append(dict(active))
                same_time_events.append((kind,key,position))
            if kind==0: active.pop(key,None)
            elif kind==1 and position is not None: active[key]=position
            elif kind==3:
                if key not in active:raise ValueError("Partial close outside active position: "+key)
                if not isinstance(position,dict):raise ValueError("Invalid partial payload")
                active[key]={**active[key],**position}
            event_buffer.append(when+" "+description)
            cursor+=1
            if when==t:same_timestamp_states.append(dict(active))
        # A source equity row may be sampled *before* a same-timestamp ENTRY,
        # but *after* an EXIT. The original research exporter observes this:
        # 2025-10-01 01:00:00 has 0 open / 0 Gross, while the 01:00
        # modeled entry appears at the subsequent 01:05 equity snapshot.
        # Reconcile the actual sampled phase, not merely event_time <= utc.
        candidates=same_timestamp_states or [dict(active)]
        phase_status=None
        if same_time_events:
            # Original research engine executes maturing EXITs first, samples
            # equity/Gross, then may admit new ENTRYs at this same timestamp.
            # Visual annotation ledger sorts ENTRY before EXIT for legibility,
            # but source-equity snapshots can be from the exit-first phase.
            exit_first=dict(candidates[0])
            for kind,key,payload in same_time_events:
                if kind==0:exit_first.pop(key,None)
            candidates.append(dict(exit_first))
            for kind,key,payload in same_time_events:
                if kind==3 and key in exit_first and isinstance(payload,dict):
                    exit_first[key]={**exit_first[key],**payload}
            candidates.append(dict(exit_first))
            for kind,key,payload in same_time_events:
                if kind==1 and isinstance(payload,dict):
                    exit_first[key]=payload
            candidates.append(dict(exit_first))
        sampled=dict(active)
        if source_positions is not None:
            source_ids={p["id"] for p in source_positions.get(t,[])}
            possible=[state for state in candidates if set(state)==source_ids]
            if not possible:
                raise ValueError("Source portfolio/event phase mismatch at "+t)
            phase_status="MATCHED"
            # Source quantity/mark/Gross are authoritative; among the states
            # with matching IDs, the latest partial-close bookkeeping wins.
            sampled=possible[-1]
        elif row.get("open_count") not in (None,""):
            count=int(row["open_count"])
            count_matches=[state for state in candidates if len(state)==count]
            distinct={frozenset(state) for state in count_matches}
            if len(distinct)==1 and count_matches:
                sampled=count_matches[-1]
                phase_status="MATCHED"
            elif len(distinct)>1:
                phase_ambiguous+=1
                phase_status="AMBIGUOUS"
            else:
                phase_unmatched+=1
                phase_status="UNMATCHED"
        if set(sampled)!=set(active):phase_corrected+=1
        if source_positions is not None:
            # Validate every equity source observation, even timepoints
            # intentionally omitted from the reduced playback view.
            latest_positions=check_source_snapshot(
                timestamp=t,active=sampled,summary=row,
                source_gross={"total":total,"crypto":crypto,"stock":stock},
                positions=source_positions)
            used_source_position_times.add(t)
        else:
            latest_positions=list(sampled.values())
        if previous_epoch>=0 and (seconds-previous_epoch)<interval_minutes*60 and not event_buffer:
            continue
        previous_epoch=seconds
        frames.append({
            "timestamp":t,"btc":latest_btc,
            "equity":number(row["compounded_mtm_equity_jpy"],"equity"),
            "realized":number(row["wallet_cash_jpy"],"wallet_cash")-first_equity,
            "positions":latest_positions,
            "events":event_buffer,
            **({"sourceOpenCount":int(row["open_count"]),
                 "sourcePositionAlignment":phase_status}
                if phase_status is not None and row.get("open_count") not in (None,"") else {}),
            "gross":{"totalX":total,"cryptoX":crypto,"stockX":stock,"source":"bt_equity_snapshot"},
        })
        event_buffer=[]
        if len(frames)>max_frames:raise ValueError("Too many frames, raise --interval-minutes")
    if not frames:raise ValueError("No equity snapshots")
    if source_positions is not None and used_source_position_times!=set(source_positions):
        raise ValueError("Unexpected source position snapshot time not in equity source")
    terminal=source_meta.get("terminalModelPositions") if source_meta else None
    if terminal is not None and last_equity_open_count is not None:
        if len(terminal)!=last_equity_open_count:
            raise ValueError("Source terminal model count disagrees with terminal equity snapshot")
        if any(p["openedAt"]>t_last for p in terminal):
            raise ValueError("Terminal source model entry is after source period")
    manifest={
        "kind":"RESEARCH_MODEL_RECONSTRUCTED",
        "note":("RESEARCH MODEL ONLY, not full production parity. Model-engine source "
                "position snapshots supplied and reconciled against source equity Gross. "
                if source_positions is not None else
                "RESEARCH MODEL ONLY, not full production parity. Current quantity/mark/"
                "per-position Gross are not supplied by the research fills. "
                "Gross and equity are original source snapshots."),
        "equitySha256":digest(source.equity),
        "fillsSha256":digest(source.fills),
        "summarySha256":digest(source.summary) if source.summary else None,
        "decisionSha256":digest(source.decisions) if source.decisions else None,
        "riskEventsSha256":digest(source.risk_events) if source.risk_events else None,
        "btcCandlesSha256":digest(source.btc_candles) if source.btc_candles else None,
        "partialEventsSha256":digest(source.partial_events) if source.partial_events else None,
        "fundingEventsSha256":digest(source.funding) if source.funding else None,
        "positionSnapshotsSha256":digest(source.position_snapshots) if source.position_snapshots else None,
        "positionExposureEvidence":("SOURCE_ENGINE_TIMEPOINT_RECONCILED"
                                    if source_positions is not None else "MISSING_SOURCE_POSITION_MARKS"),
        "costAndFunding":"from research source; not recalculated",
        "grossCapEvidence":cap_evidence,
        "sourceRiskManifest":source_meta or {},
        "drawdownModel":"BT equity snapshot; no re-estimation",
        "intervalMinutes":interval_minutes,
        "inputFillCount":len(fills),
        "maxRecordedGrossX":max_equity_gross,
        "modelEventSnapshotPhaseCorrections":phase_corrected,
        "modelEventSnapshotPhaseAmbiguous":phase_ambiguous,
        "modelEventSnapshotPhaseUnmatched":phase_unmatched
    }
    return {
        "schema":"disdex-bt-portfolio-v1","mode":"EXTERNAL",
        "engineSha":"UNVERIFIED_RESEARCH_BACKTEST",
        "seed":0,
        "limits":limits,
        "source":manifest,
        "frames":frames,
        "btcCandles":candles,
        "strategyCatalog":research_strategy_catalog(source.fills),
        "researchSummary":(source_meta or {}).get("researchSummary"),
        "strategyStats":model_strategy_performance(source.fills),
        **({"terminalModelPositions":source_meta["terminalModelPositions"]}
           if source_meta and source_meta.get("terminalModelPositions") is not None else {})
    }

def main(argv=None)->int:
    ap=argparse.ArgumentParser(description=__doc__)
    for k in ("equity","fills"):ap.add_argument("--"+k,required=True,type=Path)
    for k in ("summary","decisions","risk-events"):ap.add_argument("--"+k,type=Path)
    ap.add_argument("--output",type=Path)
    ap.add_argument("--interval-minutes",type=int,default=60)
    ap.add_argument("--btc-candles",type=Path,help="Aster historical BTC 1h JSONL.GZ; only completed candles are exposed")
    ap.add_argument("--partial-events",type=Path,help="Source PENGU partial close event ledger")
    ap.add_argument("--funding",type=Path,help="Source model funding cashflow ledger")
    ap.add_argument("--position-snapshots",type=Path,
        help="Optional strict source-engine position observations at EVERY equity timestamp;"
             " empty timestamps must contain a marker; never estimate missing Gross")
    ap.add_argument("--total-cap",type=float)
    ap.add_argument("--crypto-cap",type=float)
    ap.add_argument("--stock-cap",type=float)
    ap.add_argument("--cost-bps",type=int,choices=(10,30),help="Source research case; inferred from filenames when unique")
    ap.add_argument("--inspect-only",action="store_true")
    args=ap.parse_args(argv)
    src=Source(args.equity,args.fills,args.summary,args.decisions,args.risk_events,args.btc_candles,args.partial_events,args.funding,args.position_snapshots)
    for f in (src.equity,src.fills,src.summary,src.decisions,src.risk_events,src.btc_candles,src.partial_events,src.funding,src.position_snapshots):
        if f is not None and not f.is_file():ap.error("Missing source "+str(f))
    if args.inspect_only:
        fills,events=prepare(src)
        print(json.dumps({"fills":len(fills),"events":len(events),"sampleFirst":fills[0] if fills else None},ensure_ascii=False,indent=2))
        return 0
    if args.output is None:ap.error("--output is mandatory unless --inspect-only")
    if args.interval_minutes<5 or args.interval_minutes>1440:ap.error("Invalid interval")
    caps,cap_evidence,meta=resolve_gross_caps(
        src,total=args.total_cap,crypto=args.crypto_cap,stock=args.stock_cap,cost_bps=args.cost_bps)
    out=convert(src,caps,interval_minutes=args.interval_minutes,cap_evidence=cap_evidence,source_meta=meta)
    if meta.get("summaryExpectedFillCount") is not None and len({p["id"] for p in prepare(src)[0]})!=int(meta["summaryExpectedFillCount"]):
        raise ValueError("Fills count does not match source summary manifest")
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(out,ensure_ascii=False,separators=(",",":"),allow_nan=False),encoding="utf-8")
    print(json.dumps({"output":str(args.output),"frames":len(out["frames"]),"maxRecordedGrossX":out["source"]["maxRecordedGrossX"],"sha256":digest(args.output),"note":"RESEARCH MODEL ONLY. NO LIVE FILLS."},ensure_ascii=False))
    return 0

if __name__=="__main__":
    sys.exit(main())
