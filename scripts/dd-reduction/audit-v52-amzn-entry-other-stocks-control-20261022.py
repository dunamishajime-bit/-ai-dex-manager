#!/usr/bin/env python3
"""V52 SHORT AMZN ref-regime specificity: compare 4 other stock symbols."""
from __future__ import annotations
import bisect,collections,csv,datetime,hashlib,json
from pathlib import Path
from zoneinfo import ZoneInfo

REPO=Path(__file__).resolve().parents[2]
ROOT=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
OUT=REPO/"docs/research/results/v52-amzn-entry-20261022"
NY=ZoneInfo("America/New_York")

def sha(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for part in iter(lambda:f.read(1024*1024),b""):h.update(part)
 return h.hexdigest()

def main():
 original=json.loads((ROOT/"f8v52native/V52_NATIVE_TAPE_FULL8_20261022.json").read_text("utf-8"))
 source=original["cases"]["V52_AFTER_FET84_NO_CHANGE"]["costs"]["10"]
 p=next(x for x in (ROOT/"f8v52native/engine").rglob("portfolio-trades.jsonl") if sha(x)==source["ledgerSha256"])
 trades=[json.loads(x) for x in p.read_text("utf-8").splitlines() if x]
 short=sorted([x for x in trades if x["strategy_id"]=="V52" and x["side"]=="SHORT"],key=lambda t:t["entry_ts_ms"])
 assert len(short)==52
 refs={}
 for sym in {x["symbol"] for x in short}:
  f=ROOT/"v52_hourly_reference_recovery"/("yahoo-"+sym.replace("USDT","")+"-h1.jsonl")
  items=[json.loads(x) for x in f.read_text("utf-8").splitlines() if x]
  verify=json.loads((REPO/"docs/research/results/v52-after-fet-20261022/V52_YAHOO_ASTER_H1_SOURCE_PROVENANCE_20261022.json").read_text("utf-8"))["yahooH1"][sym.replace("USDT","")]
  assert sha(f)==verify["normalizedSha256"] and len(items)==int(verify["count"])
  refs[sym]=(items,[int(x["start_ms"])+3600000 for x in items])
 out=[];summary=collections.defaultdict(list)
 for x in short:
  items,ends=refs[x["symbol"]]
  k=bisect.bisect_right(ends,int(x["entry_ts_ms"]))-1
  assert k>=0 and ends[k]<=x["entry_ts_ms"]
  ny_entry=datetime.datetime.fromtimestamp(x["entry_ts_ms"]/1000,NY).date()
  previous=next((a for a in reversed(items[:k+1]) if datetime.datetime.fromtimestamp(int(a["start_ms"])/1000,NY).date()<ny_entry),None)
  assert previous
  ret=100*(float(items[k]["close"])/float(previous["close"])-1)
  row={"symbol":x["symbol"],"entryTsMs":x["entry_ts_ms"],"side":"SHORT",
       "priorSessionToLastCompletedYahooReturnPct":ret,"priorSessionRiseOver1Pct":ret>1,
       "win":x["total_pnl_jpy"]>0,
       "modeledSharedContributionJpy":x["modeled_realized_pnl_jpy_at_exit_fx"],
       "closedYahooBarEndMs":ends[k],
       "latestEntryUtc":datetime.datetime.fromtimestamp(x["entry_ts_ms"]/1000,datetime.timezone.utc).isoformat()}
  out.append(row)
  for group in ("ALL",x["symbol"],"AMZN" if x["symbol"]=="AMZNUSDT" else "NON_AMZN"):
   summary[(group,ret>1)].append(row)
 aggregated={}
 for (group,up),rows in sorted(summary.items()):
  aggregated.setdefault(group,{})["over1pct" if up else "notOver1pct"]={
   "trades":len(rows),"wins":sum(x["win"] for x in rows),
   "losses":sum(not x["win"] for x in rows),
   "modeledSharedContributionJpy":sum(x["modeledSharedContributionJpy"] for x in rows)}
 assert aggregated["AMZN"]["over1pct"]["trades"]==1
 assert aggregated["AMZN"]["over1pct"]["wins"]==0
 assert aggregated["NON_AMZN"]["over1pct"]["trades"]==12
 assert aggregated["NON_AMZN"]["over1pct"]["wins"]==11
 for r in out: assert r["closedYahooBarEndMs"]<=r["entryTsMs"]
 OUT.mkdir(parents=True,exist_ok=True)
 with (OUT/"V52_SHORT_52_YAHOO_ENTRY_NEGATIVE_CONTROL_20261022.csv").open("w",encoding="utf-8",newline="") as f:
  w=csv.DictWriter(f,fieldnames=list(out[0]),lineterminator="\n");w.writeheader();w.writerows(out)
 (OUT/"V52_SHORT_ENTRY_OTHER_STOCKS_NEGATIVE_CONTROL_20261022.json").write_text(
   json.dumps({"schema":"v52-short-52-negative-control-v1","period":"2025-08-10..2026-08-10",
    "researchStatus":"IN_SAMPLE_ONLY_NOT_LIVE","sourceV52LedgerSha256":source["ledgerSha256"],
    "note":"Do not apply AMZN-only regime to other V52 stock symbols: +1pct recent rise coexists with high SHORT winner count outside AMZN",
    "amznNotGeneralizableFromThisSample":True,
    "groups":aggregated},ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("AMZN_NEGATIVE_CONTROL",aggregated["AMZN"],"OTHER_STOCKS",aggregated["NON_AMZN"],flush=True)
if __name__=="__main__":main()
