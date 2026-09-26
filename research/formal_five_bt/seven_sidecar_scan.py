"""Seven-logic BT: HYPE/ZEC Aster-native 15m/1m causal candidate scan.

This is a sidecar *research* signal overlay; cde62b... is not the audited live
VPS release. It emits candidates, not fills. Never execute account actions.
Only closed minute bars with continuous candle history may confirm breakouts.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import subprocess
import time
from typing import Any, Iterable

from . import sources
from .seven_source import (
    LIVE_FIVE_SHA, SEVEN_RESEARCH_SHA, verify_seven_source,
)

FIFTEEN = 900_000
MINUTE = 60_000
HALF_DAY = 43_200_000
START = int(datetime(2025,8,10,tzinfo=timezone.utc).timestamp()*1000)
END = int(datetime(2026,8,11,tzinfo=timezone.utc).timestamp()*1000)
WARMUP = START - 10*86_400_000
STRATEGIES = {"HYPE": "HYPEUSDT", "ZEC":"ZECUSDT"}


def canonical(data: Any) -> bytes:
    return (json.dumps(data,ensure_ascii=False,sort_keys=True,
        separators=(",",":"),allow_nan=False)+"\n").encode("utf-8")


def save(path: Path, data: Any) -> str:
    path.parent.mkdir(parents=True,exist_ok=True)
    raw=canonical(data)
    path.write_bytes(raw)
    return sha256(raw).hexdigest()


def save_jsonl(path:Path, rows:Iterable[dict[str,Any]]) -> tuple[int,str]:
    path.parent.mkdir(parents=True,exist_ok=True)
    count=0
    digest=__import__("hashlib").sha256()
    with path.open("wb") as out:
        for row in rows:
            raw=canonical(row)
            out.write(raw)
            digest.update(raw)
            count+=1
    return count,digest.hexdigest()


def to_bar(row:list[Any], interval:int)->dict[str,float|int]:
    if not isinstance(row,list) or len(row)<6:
        raise ValueError("HYPE_ZEC_CANDLE_MALFORMED")
    values=list(map(float,row[:6]))
    ts=int(values[0])
    if ts<=0 or ts%interval!=0 or any(not math.isfinite(x) for x in values):
        raise ValueError("HYPE_ZEC_CANDLE_TIMESTAMP_OR_VALUE_INVALID")
    op,hi,lo,cl,vol=values[1:]
    if not (op>0 and hi>=max(op,cl,lo) and lo<=min(op,cl) and lo>0 and cl>0 and vol>=0):
        raise ValueError("HYPE_ZEC_CANDLE_OHLC_INVALID")
    return {"ts":ts,"open":op,"high":hi,"low":lo,"close":cl,"volume":vol}


def check_contiguous(rows:list[dict[str,Any]],interval:int) -> tuple[int,int,int]:
    if not rows:return 0,0,0
    gaps=duplicates=0
    for a,b in zip(rows,rows[1:]):
        gap=int(b["ts"])-int(a["ts"])
        if gap<=0:duplicates+=1
        elif gap!=interval:gaps+=1
    return len(rows),gaps,duplicates


class SevenBridge:
    def __init__(self, root:Path):
        manifest=verify_seven_source(root)
        if manifest["actual_vps_seven_live_verified"] is not False:
            raise ValueError("SIDECAR_NOT_A_VERIFIED_LIVE_RELEASE")
        env=dict(os.environ,SEVEN_BT_SOURCE_ROOT=str(root))
        self.proc=subprocess.Popen(
            ["node",str(Path(__file__).with_name("seven_runtime_bridge.mjs"))],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            text=True,bufsize=1,env=env,
        )
    def ask(self, **payload:Any)->dict[str,Any]:
        if self.proc.poll() is not None:
            raise RuntimeError("SEVEN_BT_BRIDGE_EXITED")
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(json.dumps(payload,separators=(",",":"),allow_nan=False)+"\n")
        self.proc.stdin.flush()
        line=self.proc.stdout.readline()
        if not line:\n            stderr = self.proc.stderr.read()[-1400:] if self.proc.poll() is not None and self.proc.stderr else "UNKNOWN_NODE_BRIDGE_SHUTDOWN"\n            raise RuntimeError("SEVEN_BT_BRIDGE_NO_RESPONSE:" + stderr)
        parsed=json.loads(line)
        if parsed.get("ok") is not True:raise RuntimeError("SEVEN_BT_SOURCE:"+str(parsed.get("error")))
        return parsed["result"]
    def __enter__(self):return self
    def __exit__(self,*_):
        if self.proc.stdin:self.proc.stdin.close()
        try:self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=3)
        if self.proc.stderr:self.proc.stderr.close()


def fetch_sidecar_15m(data_root:Path,*,pace:float=0.18,
        start_ms:int=WARMUP,end_ms:int=END)->dict[str,Any]:
    """Acquire only Aster perpetuals and keep timestamped per-symbol gap evidence."""
    if pace<0:raise ValueError("INVALID_RATE_LIMIT_PACE")
    manifest_path=data_root/"sidecar-15m-acquisition.json"
    catalog=sources.fetch_instrument_catalog("aster")
    metadata={"schema":1,"baseline_live_sha":LIVE_FIVE_SHA,
              "seven_model_sha":SEVEN_RESEARCH_SHA,"venue":"ASTER_USDT_PERPETUAL",
              "interval":"15m","symbols":{},"listing_checked":True,
              "time_bounds_ms":{"start":start_ms,"end_exclusive":end_ms},
              "status":"COVERAGE_ONLY_NO_FILLS"}
    for symbol in ("BTCUSDT","HYPEUSDT","ZECUSDT"):
        native_raw=next((x for x in catalog.rows if x.get("symbol")==symbol),None)
        if native_raw is None:
            metadata["symbols"][symbol]={"status":"NOT_LISTED","rows":0}
            continue
        try:
            native=sources.verify_native_instrument("aster",symbol,native_raw)
        except ValueError as e:
            metadata["symbols"][symbol]={"status":"NOT_VERIFIABLE_INSTRUMENT",
                "reason":str(e),"rows":0}
            continue
        effective_start=max(start_ms,native.listed_from_ms)
        if effective_start>=end_ms:
            metadata["symbols"][symbol]={"status":"LISTED_AFTER_BT","rows":0,
                "listed_from_ms":native.listed_from_ms}
            continue
        try:
            if pace:time.sleep(pace)
            acquisition=sources.fetch_historical_klines("aster",symbol,effective_start,
                end_ms-1,interval="15m")
            rows=[to_bar(x,FIFTEEN) for x in acquisition.rows]
            if len({x["ts"] for x in rows})!=len(rows):
                raise ValueError("HYPE_ZEC_DUPLICATE_SOURCE_BARS")
            rows.sort(key=lambda x:x["ts"])
            n,gaps,duplicates=check_contiguous(rows,FIFTEEN)
            rel=f"normalized/aster/15m/{symbol}.jsonl"
            count,digest=save_jsonl(data_root/rel,rows)
            metadata["symbols"][symbol]={"status":"ACQUIRED" if count else "NO_ROWS",
                "rows":n,"gaps":gaps,"duplicates":duplicates,
                "listed_from_ms":native.listed_from_ms,
                "first_ms":rows[0]["ts"] if rows else None,
                "last_ms":rows[-1]["ts"] if rows else None,
                "raw_page_sha256":acquisition.page_hashes,
                "normalized_path":rel,"normalized_sha256":digest}
        except Exception as e:
            metadata["symbols"][symbol]={"status":"ACQUISITION_FAILED",
                "reason":type(e).__name__+":"+str(e)[:150],"rows":0}
        save(manifest_path,metadata)
    save(manifest_path,metadata)
    return metadata


def read_rows(path:Path) -> list[dict[str,Any]]:
    return [json.loads(z) for z in path.read_text(encoding="utf-8").splitlines() if z.strip()]


def _ema(window:list[dict[str,Any]])->float:
    value=0.0
    alpha=2/21
    for row in window:
        value=row["close"] if value==0 else row["close"]*alpha+value*(1-alpha)
    return value


def fifteen_minute_gates(btc:list[dict],sym:list[dict],rules:dict,
                         *,entry_ts:int)->tuple[bool,dict[str,Any]]:
    """Strict production gate prefilter; borderline values still go to live bridge."""
    if len(btc)<3 or len(sym)<3:
        return False,{"DATA":"INSUFFICIENT_PRIOR_15M"}
    a,b=btc[-1],sym[-1]
    if a["ts"]!=b["ts"] or a["ts"]+FIFTEEN!=entry_ts:
        return False,{"DATA":"BTC_SYMBOL_15M_NOT_ALIGNED"}
    for series in (btc,sym):
        if any(series[-i]["ts"]-series[-i-1]["ts"]!=FIFTEEN for i in (1,2)):
            return False,{"DATA":"15M_SERIES_GAP"}
    mv=lambda rows,k:(rows[k]["close"]/rows[k-1]["close"]-1)*10000
    bm=mv(btc,-1); ba=bm-mv(btc,-2)
    sm=mv(sym,-1); sa=sm-mv(sym,-2)
    dist=abs((b["close"]/max(_ema(sym),1e-7)-1)*10000)
    gate={"BTC_MOVE":bm,"BTC_ACCEL":ba,"SYMBOL_MOVE":sm,
          "SYMBOL_ACCEL":sa,"EMA20_DISTANCE":dist}
    # Compare with tolerant prefilter only. The frozen TS function makes all
    # final decisions, and acceptance cannot be inferred from Python alone.
    eps=1e-8
    passed=bm>=rules["btcMinMoveBps"]-eps and bm<=rules["btcMaxMoveBps"]+eps and (
        ba>=rules["btcMinAccelBps"]-eps and sm>=rules["symbolMinMoveBps"]-eps and
        sa>=rules["symbolMinAccelBps"]-eps and dist<=rules["symbolMaxDistanceBps"]+eps)
    return passed,gate


def acquire_minute_windows(data_root:Path,symbol:str,
            candidates:list[dict[str,Any]],*,pace:float=0.22)->tuple[dict[int,dict],dict[str,Any]]:
    """Fetch each required 12h group once; missing 1m history stays unverified."""
    bins=defaultdict(list)
    for candidate in candidates:
        bins[candidate["decision_ts_ms"]//HALF_DAY].append(candidate)
    minutes={}
    manifest={"symbol":symbol,"interval":"1m","windows":len(bins),
        "requested_candidates":len(candidates),"groups":[]}
    for group,rows in sorted(bins.items()):
        first=min(x["decision_ts_ms"] for x in rows)
        last=max(x["decision_ts_ms"] for x in rows)
        stop=last+min(10,max(x["confirm_minutes"] for x in rows))*MINUTE
        if stop-first>HALF_DAY+20*MINUTE:
            raise ValueError("SIDE_CAR_MINUTE_WINDOW_TOO_WIDE")
        cached=data_root/"normalized"/"aster"/"1m-windows"/symbol/(str(group)+".jsonl")
        if cached.is_file():
            bars=read_rows(cached)
            hashes=[sha256(cached.read_bytes()).hexdigest()]
            source="CACHED_NATIVE_ASTER"
        else:
            try:
                if pace:time.sleep(pace)
                received=sources.fetch_historical_klines("aster",symbol,first,stop,
                    interval="1m",max_pages=8)
                bars=[to_bar(x,MINUTE) for x in received.rows]
                bars.sort(key=lambda x:x["ts"])
                hashes=received.page_hashes
                save_jsonl(cached,bars)
                source="ASTER_NATIVE_FETCH"
            except Exception as e:
                manifest["groups"].append({"group":group,"status":"ACQUISITION_FAILED",
                    "requested_candidates":len(rows),"reason":type(e).__name__+":"+str(e)[:130]})
                continue
        n,gaps,dupes=check_contiguous(bars,MINUTE)
        if dupes:
            manifest["groups"].append({"group":group,"status":"DUPLICATE_BARS",
                "count":n,"duplicates":dupes})
            continue
        for bar in bars:minutes[int(bar["ts"])]=bar
        manifest["groups"].append({"group":group,"status":"ACQUIRED",
            "first_ms":first,"last_ms":stop,"count":n,"gaps":gaps,
            "page_sha256":hashes,"source":source})
    return minutes,manifest


def scan_seven_sidecars(data_root: str | Path,scan_root: str | Path,
                source_root: str | Path,*,start_ms:int=START,
                end_ms:int=END,pacing:float=0.22)->dict[str,Any]:
    data=Path(data_root).resolve()
    out=Path(scan_root).resolve()
    source_manifest=verify_seven_source(source_root)
    meta=json.loads((data/"sidecar-15m-acquisition.json").read_text())
    if (meta.get("baseline_live_sha")!=LIVE_FIVE_SHA or
            meta.get("seven_model_sha")!=SEVEN_RESEARCH_SHA):
        raise ValueError("SEVEN_BT_DATA_SOURCE_SHA_MISMATCH")
    catalog=meta["symbols"]
    outputs={}
    stats={}
    with SevenBridge(Path(source_root)) as bridge:
        audit=bridge.ask(op="audit")
        if audit["sourceSha"]!=SEVEN_RESEARCH_SHA or not audit["researchOnly"]:
            raise ValueError("SEVEN_BT_BRIDGE_NOT_FROZEN")
        if catalog.get("BTCUSDT",{}).get("status")!="ACQUIRED":
            raise ValueError("SEVEN_BT_BTC_15M_NOT_ACQUIRED")
        btc=read_rows(data/catalog["BTCUSDT"]["normalized_path"])
        bindex={int(row["ts"]):i for i,row in enumerate(btc)}
        for strategy,symbol in STRATEGIES.items():
            record=catalog.get(symbol,{})
            if record.get("status")!="ACQUIRED":
                stats[strategy]={"status":"NOT_VERIFIABLE","reason":record.get("status"),
                                 "candidate_count":None,"first_valid_ms":None}
                continue
            rows=read_rows(data/record["normalized_path"])
            rules=audit["policy"][strategy+"_LONG"]["signal"]
            possible=[]
            decisions=[]
            for i,row in enumerate(rows):
                ts=int(row["ts"])
                if not start_ms<=ts+FIFTEEN<end_ms:continue
                bi=bindex.get(ts)
                if bi is None or i<2 or bi<2:
                    decisions.append({"strategy_id":strategy,"symbol":symbol,
                        "decision_ts_ms":ts+FIFTEEN,"status":"NOT_VERIFIABLE",
                        "reason":"BTC_OR_SYMBOL_HISTORY_UNAVAILABLE",
                        "source_runtime_sha":SEVEN_RESEARCH_SHA})
                    continue
                bwindow=btc[max(0,bi-239):bi+1]
                swindow=rows[max(0,i-239):i+1]
                pass15,detail=fifteen_minute_gates(bwindow,swindow,rules,
                    entry_ts=ts+FIFTEEN)
                base={"strategy_id":strategy,"symbol":symbol,
                      "decision_ts_ms":ts+FIFTEEN,"reference_ts_ms":ts,
                      "source_runtime_sha":SEVEN_RESEARCH_SHA,
                      "baseline_live_sha":LIVE_FIVE_SHA,
                      "source_status":"HYPOTHETICAL_RESEARCH_NOT_LIVE",
                      "gate_status":detail}
                if not pass15:
                    decisions.append(dict(base,status="WAIT",reason="15M_PRE_ENTRY_GATE_NOT_MET"))
                    continue
                possible.append(dict(base,confirm_minutes=int(rules["breakoutConfirmMinutes"]),
                                     btc_history=bwindow,symbol_history=swindow))
            minute_bars, minute_meta=acquire_minute_windows(data,symbol,possible,pace=pacing)
            minute_path=out/"minute-coverage"/(strategy+".json")
            save(minute_path,minute_meta)
            confirmed=unverified=0
            for candidate in possible:
                entry_ts=candidate["decision_ts_ms"]
                rules=audit["policy"][strategy+"_LONG"]["signal"]
                # The live module enforces data freshness now-latest15m.ts<=20m,
                # limiting even ZEC's advertised 10-minute breakout window.
                # Never use an unfinished minute candle at a decision cutoff.
                effective=min(int(rules["breakoutConfirmMinutes"])+1,5)
                seen=[]
                missing=False
                accepted=None
                for minute in range(effective):
                    start=entry_ts+minute*MINUTE
                    bar=minute_bars.get(start)
                    if bar is None:
                        missing=True
                        break
                    seen.append(bar)
                    now=start+MINUTE
                    result=bridge.ask(op="evaluate",strategy=strategy,input={
                        "now":now,"btc15m":candidate["btc_history"],
                        "symbol15m":candidate["symbol_history"],
                        "symbol1m":seen,
                    })
                    if result["accepted"]:
                        accepted=(now,result)
                        break
                    if result["reason"] not in ("BREAKOUT_CONFIRMATION_NOT_MET",):
                        # E.g. stale BTC, stricter exact TS gate or invalid EMA.
                        candidate["bridge_rejected_reason"]=result["reason"]
                        break
                outrow={key:value for key,value in candidate.items()
                        if key not in ("btc_history","symbol_history","confirm_minutes")}
                if accepted:
                    now,result=accepted
                    outrow.update(status="SIGNAL",decision_ts_ms=now,
                        signal={"entryTs":now,"signalTs":result["signalTs"],
                            "side":"LONG","entryPrice":result["entryPrice"],
                            "stopPrice":result["stopPrice"],
                            "takeProfitPrice":result["takeProfitPrice"],
                            "reason":result["reason"]},
                        reason=result["reason"],data_cutoff_ms=now)
                    confirmed+=1
                elif missing:
                    outrow.update(status="NOT_VERIFIABLE",
                        reason="ASTER_1M_CONFIRMATION_GAP",data_cutoff_ms=entry_ts)
                    unverified+=1
                else:
                    outrow.update(status="WAIT",reason=outrow.get(
                        "bridge_rejected_reason","BREAKOUT_CONFIRMATION_NOT_MET"),
                        data_cutoff_ms=entry_ts+effective*MINUTE)
                decisions.append(outrow)
            decisions.sort(key=lambda x:(x["decision_ts_ms"],x["symbol"],x.get("reference_ts_ms",0)))
            out_file=out/"decisions"/(strategy+".jsonl")
            count,digest=save_jsonl(out_file,decisions)
            outputs[strategy]={"path":out_file.relative_to(out).as_posix(),
                "rows":count,"sha256":digest}
            stats[strategy]={"status":"RESEARCH_CANDIDATES_NOT_EXECUTABLE_BT",
                "fifteen_minute_checks":len(decisions),"passed_15m_gates":len(possible),
                "candidate_count":confirmed,"unverified_1m":unverified,
                "missing_15m":sum(x["status"]=="NOT_VERIFIABLE" for x in decisions),
                "first_valid_ms":min((r["decision_ts_ms"] for r in decisions
                    if r["status"]!="NOT_VERIFIABLE"),default=None),
                "minute_coverage_path":minute_path.relative_to(out).as_posix()}
    manifest={"schema_version":1,"runtime_sha":LIVE_FIVE_SHA,
        "sidecar_source_sha":SEVEN_RESEARCH_SHA,
        "production_status":"FIVE_LIVE_HYPE_ZEC_RESEARCH_ONLY",
        "status":"SIGNAL_SCAN_ONLY_NOT_BACKTEST",
        "source_hashes":{x["path"]:x["sha256"] for x in source_manifest["files"]},
        "period_start_ms":start_ms,"period_end_exclusive_ms":end_ms,
        "strategies":list(STRATEGIES),"outputs":outputs,"stats":stats,
        "signals_are_not_fills":True,"hype_zec_live_verified":False}
    save(out/"signal-scan-manifest.json",manifest)
    return manifest


def main(argv:list[str]|None=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data-root",required=True)
    p.add_argument("--output-root",required=True)
    p.add_argument("--source-root",required=True)
    p.add_argument("--acquire",action="store_true")
    p.add_argument("--scan",action="store_true")
    p.add_argument("--pace",type=float,default=0.22)
    args=p.parse_args(argv)
    if not(args.acquire or args.scan):p.error("at least one of --acquire or --scan required")
    if args.acquire:
        report=fetch_sidecar_15m(Path(args.data_root),pace=args.pace)
        print("SEVEN_BT_HZ_15M",json.dumps({k:{"status":v.get("status"),
            "rows":v.get("rows"),"gaps":v.get("gaps")} for k,v in
            report["symbols"].items()},sort_keys=True))
    if args.scan:
        report=scan_seven_sidecars(args.data_root,args.output_root,
            args.source_root,pacing=args.pace)
        print("SEVEN_BT_HZ_SCAN",json.dumps(report["stats"],sort_keys=True))
if __name__=="__main__":main()
