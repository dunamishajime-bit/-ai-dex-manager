#!/usr/bin/env python3
"""Read-only drawdown-window realized-trade diagnostics for research BT.

This is NOT a causal allocation of equity drawdown: MTM unrealized PnL,
portfolio orders, funding and currency effects can remain in open positions.
"""
from __future__ import annotations
import argparse,csv,json,math,hashlib
from collections import defaultdict
from pathlib import Path
from datetime import datetime,timezone

FAMILIES={"V4","Q102","PENGU","V52","HYPE","IDLE","FET"}
def one(folder:Path,bps:int,suffix:str)->Path:
    matches=list(folder.glob(f"*_{bps}BPS_{suffix}"))
    if len(matches)!=1:raise ValueError("EXPECTED_ONE_SOURCE_FILE:"+suffix)
    return matches[0]
def iso(value:str)->str:
    z=datetime.fromisoformat(value.replace("Z","+00:00"))
    if z.tzinfo is None:raise ValueError("NAIVE_MODEL_DATETIME")
    return z.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def directional_adverse(side:str,entry:float,exit:float)->bool:
    if side not in ("LONG","SHORT") or not math.isfinite(entry) or not math.isfinite(exit) or min(entry,exit)<=0:
        raise ValueError("BAD_MODEL_PRICE_OR_DIRECTION")
    return exit<entry if side=="LONG" else exit>entry
def analyze(folder:Path,bps:int)->dict:
    summary_path=one(folder,bps,"SUMMARY.json")
    summary=json.loads(summary_path.read_text("utf8"))
    trough_ts=iso(summary["dd_time_utc"])
    if summary.get("cost_bps_roundtrip")!=bps or not -100<float(summary["max_hourly_dd_pct"])<0:
        raise ValueError("MISSING_RESEARCH_DRAWDOWN_OR_COST_CONTRACT")
    peak_ts=None;peak_eq=-math.inf;trough_eq=None;observations=0
    equity_path=one(folder,bps,"EQUITY_30MIN.csv")
    with equity_path.open(encoding="utf-8-sig",newline="") as f:
        for row in csv.DictReader(f):
            t=iso(row["utc"])
            if t>trough_ts:break
            v=float(row["compounded_mtm_equity_jpy"])
            if not math.isfinite(v) or v<=0:raise ValueError("RESEARCH_MTM_EQUITY_INVALID")
            if v>peak_eq:peak_eq=v;peak_ts=t
            if t==trough_ts:trough_eq=v
            observations+=1
    if trough_eq is None or peak_ts is None or peak_ts>=trough_ts:
        raise ValueError("DRAWDOWN_TROUGH_OR_PEAK_MISSING")
    derived=(trough_eq/peak_eq-1)*100
    if abs(derived-float(summary["max_hourly_dd_pct"]))>1e-7:
        raise ValueError("DRAWDOWN_PEAK_TROUGH_SOURCE_MISMATCH")
    by_logic=defaultdict(lambda:{"closed":0,"negativeNet":0,"adversePriceMoves":0,"netModelPnlJpy":0.})
    by_symbol=defaultdict(lambda:{"closed":0,"negativeNet":0,"netModelPnlJpy":0.})
    seen=set()
    with one(folder,bps,"FILLS.csv").open(encoding="utf-8-sig",newline="") as f:
        for row in csv.DictReader(f):
            tid=row["trade_id"]
            if not tid or tid in seen:raise ValueError("DUPLICATE_MODEL_FILL_ID")
            seen.add(tid)
            t=iso(row["exit_utc"]);strat=row["strategy"];sym=row["symbol"]
            if strat not in FAMILIES:raise ValueError("UNKNOWN_MODEL_STRATEGY_FAMILY")
            if not peak_ts<t<=trough_ts:continue
            pnl=float(row["net_pnl_jpy"])
            if not math.isfinite(pnl):raise ValueError("NONFINITE_MODEL_CLOSED_PNL")
            adverse=directional_adverse(row["side"],float(row["model_entry_price"]),
                                        float(row["model_exit_price"]))
            for dest in (by_logic[strat],by_symbol[strat+"/"+sym]):
                dest["closed"]+=1;dest["negativeNet"]+=int(pnl<0);dest["netModelPnlJpy"]+=pnl
            by_logic[strat]["adversePriceMoves"]+=int(adverse)
    gross_path=one(folder,bps,"POSITION_GROSS_SNAPSHOTS.csv")
    pos={peak_ts:{"grossX":0.,"positions":0,"byLogic":{}},
         trough_ts:{"grossX":0.,"positions":0,"byLogic":{}}}
    with gross_path.open(encoding="utf-8-sig",newline="") as f:
        for row in csv.DictReader(f):
            t=row["utc"]
            if t not in pos or not row["trade_id"]:continue
            gross=float(row["current_gross_x"])
            if gross<0 or not math.isfinite(gross):raise ValueError("BAD_MODEL_GROSS")
            pos[t]["positions"]+=1;pos[t]["grossX"]+=gross
            logic=row["logic"]
            pos[t]["byLogic"][logic]=pos[t]["byLogic"].get(logic,0.)+gross
    return {"bps":bps,
      "status":"MTM_DRAWDOWN_WINDOW_RECONCILED_REALIZED_TRADES_NOT_CAUSAL_DECOMPOSITION",
      "peakUtc":peak_ts,"peakEquityJpy":peak_eq,
      "troughUtc":trough_ts,"troughEquityJpy":trough_eq,"maxDdPct":derived,
      "observationsUntilTrough":observations,
      "closedTradeAttributionByLogic":dict(sorted(by_logic.items())),
      "closedTradeAttributionBySymbol":dict(sorted(by_symbol.items())),
      "positionGrossAtPeak":pos[peak_ts],
      "positionGrossAtTrough":pos[trough_ts],
      "note":"Price-adverse counts use modeled entry-to-exit direction, not true false-signal labels. Closed model PnL within window cannot account for open MTM equity, so it must not be divided by DD to assign causal shares.",
      "sourceHashes":{"summary":hashlib.sha256(summary_path.read_bytes()).hexdigest(),
                      "equity":hashlib.sha256(equity_path.read_bytes()).hexdigest(),
                      "gross":hashlib.sha256(gross_path.read_bytes()).hexdigest()},
      "productionMutationCount":0}
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--native",type=Path,required=True)
    ap.add_argument("--no-hype",type=Path,required=True)
    ap.add_argument("--output",type=Path,required=True)
    a=ap.parse_args()
    data={"schema":"disdex-bt-native-hype-mtm-dd-window-attribution/v1",
          "cases":{name:{str(bp):analyze(root,bp) for bp in (10,30)}
            for name,root in (("native",a.native),("noHype",a.no_hype))},
          "historicalResearchOnly":True,"modelRealizedAttributionNotCausalDD":True}
    a.output.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
    print(json.dumps({name:{bp:{"maxDdPct":r["maxDdPct"],
        "closedByLogic":{key:{"negativeNet":v["negativeNet"],
           "netModelPnlJpy":round(v["netModelPnlJpy"],2)}
         for key,v in r["closedTradeAttributionByLogic"].items()}}
        for bp,r in v.items()} for name,v in data["cases"].items()},ensure_ascii=False))
if __name__=="__main__":main()
