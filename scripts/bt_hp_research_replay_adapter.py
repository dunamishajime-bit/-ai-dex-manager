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

@dataclass(frozen=True)
class Source:
    equity: Path
    fills: Path
    summary: Path | None
    decisions: Path | None = None
    risk_events: Path | None = None
    btc_candles: Path | None = None

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
        timeline.append((entry,1,key,position,"ENTRY "+row["strategy"]+" "+row["symbol"]+" "+direction+" [model]"))
        if exit_time:
            pnl=number(row.get("net_pnl_jpy","0") or "0","model net PnL")
            timeline.append((exit_time,0,key,None,"EXIT "+row["strategy"]+" "+row["symbol"]+" "+direction+" "+format(pnl,"+.2f")+" JPY [model]"))
    if len({r["id"] for r in fills})!=len(fills):
        raise ValueError("Duplicate trade_id")
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
    timeline.sort(key=lambda x:(x[0],x[1]))
    return fills,timeline

def convert(source:Source, limits:dict[str,float], *, interval_minutes:int=60, max_frames:int=50000) -> dict:
    fills,events=prepare(source)
    candles=load_btc_candles(source.btc_candles)
    candle_cursor=0
    latest_btc=None
    active:dict[str,dict]={}
    cursor=0;frames=[];previous_epoch=-1
    event_buffer:list[str]=[]
    first_equity=None
    max_equity_gross=0.0
    t_last=None
    for row in read_rows(source.equity):
        t=iso(row["utc"])
        seconds=int(datetime.fromisoformat(t.replace("Z","+00:00")).timestamp())
        if t_last is not None and t<=t_last:raise ValueError("Equity timestamps unsorted/duplicated")
        t_last=t
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
        while cursor<len(events) and events[cursor][0]<=t:
            when,kind,key,position,description=events[cursor]
            if kind==0: active.pop(key,None)
            elif kind==1 and position is not None: active[key]=position
            event_buffer.append(when+" "+description)
            cursor+=1
        if previous_epoch>=0 and (seconds-previous_epoch)<interval_minutes*60 and not event_buffer:
            continue
        previous_epoch=seconds
        frames.append({
            "timestamp":t,"btc":latest_btc,
            "equity":number(row["compounded_mtm_equity_jpy"],"equity"),
            "realized":number(row["wallet_cash_jpy"],"wallet_cash")-first_equity,
            "positions":list(active.values()),
            "events":event_buffer,
            "gross":{"totalX":total,"cryptoX":crypto,"stockX":stock,"source":"bt_equity_snapshot"},
        })
        event_buffer=[]
        if len(frames)>max_frames:raise ValueError("Too many frames, raise --interval-minutes")
    if not frames:raise ValueError("No equity snapshots")
    manifest={
        "kind":"RESEARCH_MODEL_RECONSTRUCTED",
        "note":"NOT a proven parity BT: model fills; positions reconstructed by time; unknown quantity/mark/current per-position Gross are null. Risk caps passed as parameters, not derived from source. Reported Gross and equity are from original snapshots.",
        "equitySha256":digest(source.equity),
        "fillsSha256":digest(source.fills),
        "summarySha256":digest(source.summary) if source.summary else None,
        "decisionSha256":digest(source.decisions) if source.decisions else None,
        "riskEventsSha256":digest(source.risk_events) if source.risk_events else None,
        "btcCandlesSha256":digest(source.btc_candles) if source.btc_candles else None,
        "costAndFunding":"from research source; not recalculated",
        "grossCapEvidence":"USER_SUPPLIED_NOT_VERIFIED",
        "drawdownModel":"BT equity snapshot; no re-estimation",
        "intervalMinutes":interval_minutes,
        "inputFillCount":len(fills),
        "maxRecordedGrossX":max_equity_gross
    }
    return {
        "schema":"disdex-bt-portfolio-v1","mode":"EXTERNAL",
        "engineSha":"UNVERIFIED_RESEARCH_BACKTEST",
        "seed":0,
        "limits":limits,
        "source":manifest,
        "frames":frames,
        "btcCandles":candles
    }

def main(argv=None)->int:
    ap=argparse.ArgumentParser(description=__doc__)
    for k in ("equity","fills"):ap.add_argument("--"+k,required=True,type=Path)
    for k in ("summary","decisions","risk-events"):ap.add_argument("--"+k,type=Path)
    ap.add_argument("--output",type=Path)
    ap.add_argument("--interval-minutes",type=int,default=60)
    ap.add_argument("--btc-candles",type=Path,help="Aster historical BTC 1h JSONL.GZ; only completed candles are exposed")
    ap.add_argument("--total-cap",type=float)
    ap.add_argument("--crypto-cap",type=float)
    ap.add_argument("--stock-cap",type=float)
    ap.add_argument("--inspect-only",action="store_true")
    args=ap.parse_args(argv)
    src=Source(args.equity,args.fills,args.summary,args.decisions,args.risk_events,args.btc_candles)
    for f in (src.equity,src.fills,src.summary,src.decisions,src.risk_events,src.btc_candles):
        if f is not None and not f.is_file():ap.error("Missing source "+str(f))
    caps={"total":args.total_cap,"crypto":args.crypto_cap,"stock":args.stock_cap}
    if args.inspect_only:
        fills,events=prepare(src)
        print(json.dumps({"fills":len(fills),"events":len(events),"sampleFirst":fills[0] if fills else None},ensure_ascii=False,indent=2))
        return 0
    if args.output is None:ap.error("--output is mandatory unless --inspect-only")
    if args.interval_minutes<5 or args.interval_minutes>1440:ap.error("Invalid interval")
    if any(v is None or not math.isfinite(v) or v<=0 or v>100 for v in caps.values()):
        ap.error("All three source-proven caps must be supplied explicitly: --total-cap --crypto-cap --stock-cap")
    if caps["crypto"]>caps["total"] or caps["stock"]>caps["total"]:
        ap.error("Category cap exceeds total cap")
    out=convert(src,caps,interval_minutes=args.interval_minutes)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(out,ensure_ascii=False,separators=(",",":"),allow_nan=False),encoding="utf-8")
    print(json.dumps({"output":str(args.output),"frames":len(out["frames"]),"maxRecordedGrossX":out["source"]["maxRecordedGrossX"],"sha256":digest(args.output),"note":"RESEARCH MODEL ONLY. NO LIVE FILLS."},ensure_ascii=False))
    return 0

if __name__=="__main__":
    sys.exit(main())
