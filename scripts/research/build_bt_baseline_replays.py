#!/usr/bin/env python3
"""Export private, standalone historical BT model ledgers as source-labeled read-only replays.

Requires local existing bundle. Output remains outside the repository by default.
NEVER synthesizes real-world fills or promotes to an 8-runner integrated BT.
"""
from __future__ import annotations
import argparse, bisect, csv, gzip, hashlib, json, pathlib
from collections import defaultdict
from datetime import datetime, timezone, timedelta

START="2025-10-01T00:00:00Z"
END="2026-10-01T00:00:00Z"
BASE_JPY=10000.
SYMBOLS=("IDLE","FET","HYPE")
BPS=(10,30)
def sha(path):
    d=hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1<<20),b""):d.update(block)
    return d.hexdigest()
def iso_ms(ms):
    return datetime.fromtimestamp(ms/1000,tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def timestamp(text):
    if not text.endswith("Z"):raise ValueError("BAD_UTC_TIME "+text)
    return int(datetime.fromisoformat(text.replace("Z","+00:00")).timestamp()*1000)
def verify_bundle(folder):
    rec=json.loads((folder/"RECONCILIATION.json").read_text(encoding="utf-8-sig"))
    assert rec["period_utc_start_inclusive"]==START and rec["period_utc_end_exclusive"]==END
    assert rec.get("complete_integrated_eight_runner_final_equity_jpy") is None
    n=0
    for line in (folder/"SHA256SUMS.txt").read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():continue
        expected,filename=line.split(maxsplit=1)
        file=folder/filename.strip().lstrip("*")
        if not file.is_file() or file.parent.resolve()!=folder.resolve() or sha(file)!=expected.lower():
            raise ValueError("SOURCE_HASH_MISMATCH "+filename)
        n+=1
    if n<10:raise ValueError("INSUFFICIENT_HASH_EVIDENCE")
    return rec
def load_btc(path):
    candles=[]
    with gzip.open(path,"rt",encoding="utf-8") as f:
        for line in f:
            row=json.loads(line)
            ms=int(row[0])
            if ms<timestamp(START) or ms>=timestamp(END):continue
            o,h,l,c=map(float,row[1:5])
            if min(o,h,l,c)<=0 or h<max(o,c) or l>min(o,c):
                raise ValueError("INVALID_BTC_OHLC")
            candles.append({"time":iso_ms(ms),"closedAt":iso_ms(ms+3600000),
              "open":o,"high":h,"low":l,"close":c})
    candles.sort(key=lambda x:x["time"])
    assert len(candles)>5000, "INSUFFICIENT_SOURCE_BTC_H1"
    if any(candles[i]["closedAt"]>candles[i+1]["time"] for i in range(len(candles)-1)):
        raise ValueError("BTC_BAR_OVERLAP")
    return candles
def build_replay(strategy,bps,records,rec,btc,source_hashes,fill_lookup):
    rows=[r for r in records if r["strategy"]==strategy and int(r["scenario_roundtrip_cost_bps"])==bps]
    rows.sort(key=lambda r:(r["exit_utc"],r["model_trade_id"]))
    expected=rec["standalone_models"][f"{strategy}_{bps}bps"]
    if len(rows)!=int(expected["trades"]):raise ValueError("TRADE_COUNT_MISMATCH")
    if not rows:raise ValueError("NO_MODEL_TRADES")
    end_equity=float(rows[-1]["equity_after_jpy"])
    if abs(end_equity-float(expected["final_jpy"]))>0.000001:
        raise ValueError("EQUITY_RECONCILIATION_FAILED")
    for previous,current in zip(rows,rows[1:]):
        if abs(float(previous["equity_after_jpy"])-float(current["equity_before_jpy"]))>0.000001:
            raise ValueError("NONCONTIGUOUS_MODEL_EQUITY")
    # The source model curve is keyed to its own trade closes; never combine wallet funds.
    timeline=defaultdict(lambda:{"events":[],"close_equity":None})
    for row in rows:
        a,b=row["entry_utc"],row["exit_utc"]
        if not (START<=a<b<END):raise ValueError("MODELED_TIME_OUT_OF_WINDOW")
        meta=fill_lookup[(row["model_trade_id"],str(bps))]
        symbol=meta["symbol"]
        if not symbol.endswith("USDT"):raise ValueError("UNKNOWN_SYMBOL")
        timeline[a]["events"].append(
           f"MODEL ENTRY {strategy} {symbol} {meta['side']} / {row['model_trade_id']} (research model, not exchange fill)")
        timeline[b]["events"].append(
           f"MODEL EXIT {strategy} {symbol} {meta['exit_reason_model']} / {float(row['net_pnl_jpy']):+.2f} JPY (model)")
        timeline[b]["close_equity"]=float(row["equity_after_jpy"])
    # Each completed real BTC H1 bar supplies one chronological frame. Event timepoints
    # are also included, but no future/unfinished market bars are exposed.
    clocks=set([START])
    clocks.update(c["closedAt"] for c in btc)
    clocks.update(timeline)
    clocks.add("2026-09-30T23:59:59Z")
    closes=[c["closedAt"] for c in btc]
    equity=BASE_JPY
    frames=[]
    for time in sorted(clocks):
        if time>=END:continue
        entries=timeline.get(time)
        if entries and entries["close_equity"] is not None:
            equity=entries["close_equity"]
        n=bisect.bisect_right(closes,time)-1
        frames.append({"timestamp":time,"btc":btc[n]["close"] if n>=0 else None,
          "equity":equity,"realized":equity-BASE_JPY,
          "positions":[],"events":entries["events"] if entries else []})
    if abs(frames[-1]["equity"]-end_equity)>0.000001:raise ValueError("FINAL_FRAME_MISMATCH")
    return {"schema":"disdex-bt-portfolio-v1","mode":"EXTERNAL",
      "engineSha":"REUSABLE_STANDALONE_MODEL_UNCERTIFIED",
      "seed":0,"frames":frames,"btcCandles":btc,
      "limits":{"total":3.5,"crypto":3.0,"stock":1.5},
      "source":{"kind":"HISTORICAL_STANDALONE_MODEL_NOT_INTEGRATED",
        "equitySha256":source_hashes["curve"],"fillsSha256":source_hashes["fills"],
        "btcCandlesSha256":source_hashes["btc"],
        "note":f"2025-10-01..2026-10-01 UTC | {strategy} | {bps}bps | model fill ledger only; "
               "NO eight-runner shared wallet, NO LIVE execution parity, NO verified actual fills; "
               "HYPE/IDLE assumed active; no cash-flow or sizing modifications permitted."}}
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--bundle",type=pathlib.Path,required=True)
    p.add_argument("--btc-gz",type=pathlib.Path,required=True)
    p.add_argument("--output-dir",type=pathlib.Path,required=True)
    args=p.parse_args()
    rec=verify_bundle(args.bundle)
    btc=load_btc(args.btc_gz)
    curve=args.bundle/"EQUITY_CURVE_PER_STANDALONE_SCENARIO.csv"
    fills=args.bundle/"MODELED_EXECUTIONS_AND_PNL.csv"
    with curve.open(encoding="utf-8-sig",newline="") as f:rows=list(csv.DictReader(f))
    source_hashes={"curve":sha(curve),"fills":sha(fills),"btc":sha(args.btc_gz)}
    with fills.open(encoding="utf-8-sig",newline="") as f: fill_rows=list(csv.DictReader(f))
    fill_lookup={(r["model_trade_id"],r["scenario_roundtrip_cost_bps"]):r for r in fill_rows}
    args.output_dir.mkdir(parents=True,exist_ok=True)
    results=[]
    for strategy in SYMBOLS:
        for bps in BPS:
            replay=build_replay(strategy,bps,rows,rec,btc,source_hashes,fill_lookup)
            path=args.output_dir/f"disdex-baseline-20251001-20261001-{strategy.lower()}-{bps}bps-UNCERTIFIED.json"
            path.write_text(json.dumps(replay,separators=(",",":"),ensure_ascii=False)+"\n",encoding="utf-8")
            results.append({"strategy":strategy,"bps":bps,"file":path.name,"sha256":sha(path),
              "frames":len(replay["frames"]),"modeled_trades":rec["standalone_models"][f"{strategy}_{bps}bps"]["trades"]})
    manifest={"schema":"disdex-private-baseline-standalone-replays/v1",
      "period_start":START,"period_end_exclusive":END,
      "integrated_eight_runner":False,"production_parity_verified":False,
      "actual_exchange_fills_verified":False,"source_hashes":source_hashes,"exports":results}
    path=args.output_dir/"MANIFEST_UNCERTIFIED.json"
    path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(manifest,ensure_ascii=False,indent=2))
if __name__=="__main__":main()