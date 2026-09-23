#!/usr/bin/env python3
"""Read-only loss attribution of research BT and available September 21-23 fill notifications.
Does not place orders, change runtime files, or claim September replay was verified."""
import json, math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
RESULT=Path(".research-state/v12-winrate-gates-20260923/result.json")
data=json.loads(RESULT.read_text())
R=data["results"]
def pack(xs):
  n=len(xs);wins=sum(x["net"]>0 for x in xs)
  gp=sum(max(0,x["net"]) for x in xs);gl=-sum(min(0,x["net"]) for x in xs)
  return {"n":n,"losses":n-wins,"wr":round(100*wins/n,2) if n else None,"pf":round(gp/gl,3) if gl else None,
    "sumNet":round(sum(x["net"] for x in xs),2),"avgPct":round(sum(x["pct"] for x in xs)/n,3) if n else None}
def report(v,mode):
  result=R[v][mode];xs=result.get("trades") or []
  print("CASE",v,mode,"END",round(result["finalEquity"]),"WR",round(result["winRatePct"],2),
    "PF",round(result["profitFactor"],3),"DD",round(result["maxDrawdownPct"],2),"N",result["tradeCount"])
  print("BY_ROUTE",json.dumps({k:pack([x for x in xs if x["route"]==k]) for k in sorted(set(x["route"] for x in xs))}))
  print("HC_VS_OTHER",json.dumps({str(k):pack([x for x in xs if x["isHC"]==k]) for k in [False,True]}))
  print("BY_RANK",json.dumps({str(k):pack([x for x in xs if x["rank"]==k]) for k in [1,2,3]}))
  print("SYMBOLS_LOSS_COUNT",json.dumps({k:pack([x for x in xs if x["symbol"]==k]) for k in sorted(set(x["symbol"] for x in xs))}))
  print("EXIT_REASONS",json.dumps({k:pack([x for x in xs if x["reason"]==k]) for k in sorted(set(x["reason"] for x in xs))}))
  def cls(x):
    if x["isHC"]:return "HC"
    if x["rank"]==2 and x["score"]<.35:return "nonHC_lowRank2"
    if x["btc12h"]<0 and x["btc24h"]<0:return "nonHC_BTC12+24_adverse"
    if x["ret2h"]>0.03:return "nonHC_entry_2h_overextended"
    return "nonHC_other"
  print("PRIORITY_BUCKET",json.dumps({k:pack([x for x in xs if cls(x)==k]) for k in sorted(set(cls(x) for x in xs))}))
  print("BTC_DIRECTION",json.dumps({k:pack([x for x in xs if (x["btc12h"]<0 and x["btc24h"]<0)==k]) for k in [False,True]}))
  print("SCORE_BINS",json.dumps({k:pack([x for x in xs if (("low" if x["score"]<.35 else "mid" if x["score"]<.7 else "hi")==k)]) for k in ["low","mid","hi"]}))
  print("FOUR_MONTH_SPLIT",json.dumps({str(j):pack([x for x in xs if [1754784000000,1765296000000,1775808000000][j]<=x["entryTs"]<[1765296000000,1775808000000,1786320000000][j]]) for j in range(3)}))
  late=[x for x in xs if x["net"]<0];late.sort(key=lambda x:x["net"])
  print("LARGEST_LOSSES",json.dumps([{k:x.get(k) for k in ["symbol","entryTs","exitTs","route","rank","score","isHC","btc6h","btc12h","btc24h","ret2h","ret6h","ret24h","volumeRatio","prevVolumeRatio","net","pct","reason"]} for x in late[:8]]))
for v in ["HC175_LOCKED","HC175_EARLY_004_008_SCORE035","HC175_EARLY_007_012_SCORE045","HC175_EARLY_010_015_SCORE055"]:
  for mode in ["NORMAL","SEVERE"]:report(v,mode)
print("VARIANT_BRIEF")
for key,by_mode in R.items():
  print(key,json.dumps({mode:{"end":round(row["finalEquity"]),"WR":round(row["winRatePct"],2),"PF":round(row["profitFactor"],3),"DD":round(row["maxDrawdownPct"],2),"count":row["tradeCount"],"early":row.get("routeStats",{}).get("EARLY_FAST_BTC",{})} for mode,row in by_mode.items()}))
# Read only actual sent notifications; these are not an independently reconciled exchange ledger.
inbox=Path("/var/lib/disdex/shared/trade-fill-notifications/inbox.jsonl")
if inbox.is_file():
  rows=[]
  with inbox.open() as f:
    for line in f:
      if not any(x in line for x in ["2026-09-21","2026-09-22","2026-09-23"]):continue
      try:e=json.loads(line)
      except json.JSONDecodeError:continue
      typ=str(e.get("strategyId") or e.get("strategy") or e.get("logic") or e.get("strategyKey") or "")
      if "V12" not in line and "v12" not in line:continue
      fields=("eventType","kind","type","strategyId","strategy","symbol","side","positionSide","price","quantity","qty","pnl","realizedPnl","realizedPnlUsdt","orderType","ts","timestamp","createdAt","observedAt","filledAt","closedAt","reason")
      rows.append({k:v for k,v in e.items() if k in fields})
  print("RECENT_V12_NOTIFICATIONS_MATCHED",len(rows))
  for x in rows[-35:]:print("RECENT_NOTIFICATION",json.dumps(x,ensure_ascii=False))
else:print("RECENT_NOTIFICATIONS_UNAVAILABLE")
