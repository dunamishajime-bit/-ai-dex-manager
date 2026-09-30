#!/usr/bin/env python3
"""Frozen canonical baseline-state + Idle Gross admission diagnostic.

For every canonical accepted baseline trade intent, reconstruct the *original*
baseline state immediately before that entry using the immutable 1284-trade
ledger and original quantities. Add currently-open canonical Idle exposure at
1.00x per Idle position, then re-test only that accepted intent's capacity.
Prior diagnostic rejections do NOT mutate the baseline state. This tests the
historically plausible overlay contract without path-cascade or outcome tuning.
"""
from __future__ import annotations
import argparse,json,bisect
from pathlib import Path
from collections import Counter

CRYPTO_CAP=3.0
STOCK_CAP=4.0
TOTAL_CAP=4.25
CAP={"V12":2.0,"PENGU":1.0,"Q102":3.0,"FET":2.25,"V52":4.0}
FET_MIN=.05
HOUR=3_600_000

def jl(p):return [json.loads(x) for x in Path(p).read_text(encoding="utf-8").splitlines() if x.strip()]
def j(p):return json.loads(Path(p).read_text(encoding="utf-8"))

ap=argparse.ArgumentParser()
ap.add_argument("--baseline-trades",required=True)
ap.add_argument("--idle-intents",required=True)
ap.add_argument("--data-root",required=True)
ap.add_argument("--output",required=True)
a=ap.parse_args()
base=jl(a.baseline_trades);idle=j(a.idle_intents)
if len(base)!=1284 or len(idle)!=61:raise SystemExit("COUNT_MISMATCH")

symbols={x["symbol"] for x in base};root=Path(a.data_root);market={}
for sym in symbols:
    c=root/"normalized/aster/klines"/f"{sym}.jsonl";s=root/"normalized/aster_stock/klines"/f"{sym}.jsonl";p=c if c.is_file() else s
    rr=jl(p);rr.sort(key=lambda x:int(x["event_time_ms"]));market[sym]={"rows":rr,"times":[int(x["event_time_ms"]) for x in rr]}
def mark(sym,ts):
    q=market[sym];i=bisect.bisect_right(q["times"],ts)-1
    if i<0:return None
    r=q["rows"][i];start=int(r["event_time_ms"])
    if start==ts:return float(r["open"])
    if ts>=start+HOUR:return float(r["close"]) if ts==start+HOUR else None
    if i<1:return None
    prev=q["rows"][i-1]
    if int(prev["event_time_ms"])+HOUR!=start:return None
    return float(prev["close"])

base_sorted=sorted(base,key=lambda x:(int(x["entry_ts_ms"]),int(x["position_id"])))
outcomes=[]
for b in base_sorted:
    t=int(b["entry_ts_ms"]);pid=int(b["position_id"]);eq=float(b["entry_equity"])
    # Original baseline state before this candidate: positions entered earlier,
    # plus same-timestamp positions with lower canonical position_id.
    active=[]
    for p in base:
        pe=int(p["entry_ts_ms"]);px=int(p["exit_ts_ms"]);ppid=int(p["position_id"])
        if (pe<t or (pe==t and ppid<pid)) and t<px:
            active.append(p)
    idle_active=[x for x in idle if int(x["entry_ts_ms"])<t<int(x["exit_ts_ms"])]
    def g(p):
        m=mark(p["symbol"],t)
        if m is None:raise RuntimeError(f"MARK_MISSING:{p['symbol']}:{t}")
        return abs(float(p["original_quantity"])*m)/eq
    sg=sum(g(p) for p in active if p["strategy_id"]==b["strategy_id"])
    bg_total=sum(g(p) for p in active)
    bg_crypto=sum(g(p) for p in active if p["strategy_id"]!="V52")
    bg_stock=sum(g(p) for p in active if p["strategy_id"]=="V52")
    ig=float(len(idle_active))
    strat=b["strategy_id"]
    req=float(b.get("candidate_requested_gross") or b.get("accepted_gross"))
    strategy_room=max(0.0,CAP[strat]-sg)
    sleeve_room=max(0.0,(STOCK_CAP-bg_stock) if strat=="V52" else (CRYPTO_CAP-bg_crypto-ig))
    total_room=max(0.0,TOTAL_CAP-bg_total-ig)
    room=min(strategy_room,sleeve_room,total_room)
    ag=min(req,room)
    reason=None
    if strat=="PENGU" and ag+1e-9<req:reason="PENGU_NO_LOT_SHRINK"
    elif strat=="FET" and ag+1e-9<FET_MIN:reason="FET_RESIDUAL_LT_MIN"
    elif ag<=1e-9:reason="NO_GROSS_ROOM"
    outcomes.append({
      "candidate_id":b.get("candidate_id"),"position_id":pid,"strategy":strat,"symbol":b["symbol"],"ts":t,
      "idle_active":len(idle_active),"idle_symbols":[x["symbol"] for x in idle_active],
      "baseline_crypto_gross_before":bg_crypto,"baseline_stock_gross_before":bg_stock,"baseline_total_gross_before":bg_total,
      "strategy_gross_before":sg,"requested_gross":req,"original_accepted_gross":float(b["accepted_gross"]),
      "room_with_idle":room,"overlay_accepted_gross":ag,"rejected":reason is not None,"reason":reason
    })
rej=[x for x in outcomes if x["rejected"]]
changed=[x for x in outcomes if not x["rejected"] and abs(x["overlay_accepted_gross"]-x["original_accepted_gross"])>1e-8]
overlap=[x for x in outcomes if x["idle_active"]]
out={
 "status":"DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE",
 "model":"FROZEN_BASELINE_STATE_PLUS_IDLE_GROSS",
 "baseline_rows":len(base),"idle_rows":len(idle),"baseline_entries_during_idle":len(overlap),
 "baseline_rejected":len(rej),"baseline_retained":len(base)-len(rej),
 "combined_count_if_idle61":len(base)-len(rej)+len(idle),
 "rejections_by_strategy":dict(Counter(x["strategy"] for x in rej)),
 "rejections":rej,"accepted_size_changes_during_idle":[x for x in changed if x["idle_active"]],
 "overlap_decisions":overlap
}
Path(a.output).write_text(json.dumps(out,indent=2,sort_keys=True)+"\n",encoding="utf-8")
print(json.dumps({k:out[k] for k in ["model","baseline_entries_during_idle","baseline_rejected","baseline_retained","combined_count_if_idle61","rejections_by_strategy"]},sort_keys=True))
print("REJECTIONS="+json.dumps(rej,sort_keys=True))
