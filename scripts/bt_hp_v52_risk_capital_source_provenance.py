#!/usr/bin/env python3
"""Explain V52 extreme loss% via archived model source capital denominator.

This is NOT a recommendation to alter live capital, order/risk limits or
optimizer gates. Uses model position marks as proxy for source's completed H1.
"""
from __future__ import annotations
import argparse,ast,csv,hashlib,json,math
from collections import Counter
from pathlib import Path

MINCAP=10000.0*5.0/62.50520405
EXPECTED_SYMBOLS={
 "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","LINKUSDT",
 "AVAXUSDT","DOGEUSDT","INJUSDT","XRPUSDT","ADAUSDT",
 "LTCUSDT","ATOMUSDT","AAVEUSDT","NEARUSDT","PENGUUSDT"
}
def hashfile(p:Path)->str:return hashlib.sha256(p.read_bytes()).hexdigest()
def records(p:Path):
 with p.open(encoding="utf-8-sig",newline="") as f:
  yield from csv.DictReader(f)
def near(a,b):return math.isclose(float(a),float(b),rel_tol=1e-10,abs_tol=1e-7)
def source_contract(path:Path)->dict:
 src=path.read_text(encoding="utf8")
 anchors=[
  "_mincap=10000.0*5.0/62.50520405",
  "_reserve=max(_mincap,.10*eq_v52)",
  "_capital=max(_mincap,eq_v52-_v96_notional-_reserve)",
  "if _q[\"s\"]==\"V52\" or _q[\"symbol\"] not in _V52_V96_SYMBOLS:continue",
  "v52_daily_audit.append(dict(utc=iso(t),event=\"TRIP\",loss_pct=100*_lpct,strategy_capital_jpy=_capital",
 ]
 for anchor in anchors:
  if src.count(anchor)!=1:raise ValueError("SOURCE_V52_CAPITAL_FORMULA_CHANGED")
 tree=ast.parse(src)
 found=[]
 for item in tree.body:
  if isinstance(item,ast.Assign) and len(item.targets)==1 and isinstance(item.targets[0],ast.Name):
   if item.targets[0].id=="_V52_V96_SYMBOLS":found.append(ast.literal_eval(item.value))
 if len(found)!=1 or found[0]!=EXPECTED_SYMBOLS:
  raise ValueError("SOURCE_V52_V96_SCOPE_SYMBOLS_CHANGED")
 return {"sha256":hashfile(path),"minCapitalJpy":MINCAP,
     "v96ScopeSymbols":sorted(found[0]),
     "scopeIsOtherNonV52ExistingPositions":True,
     "capitalFormula":"max(minCapital, currentModelEquity - v96ScopedOtherNotional - max(minCapital,10pctCurrentModelEquity))",
     "modelMarksMayDifferFromCompletedH1AtSameMoment":True}
def capital_proxy(equity,scoped):
 if not(math.isfinite(equity) and math.isfinite(scoped)) or equity<=0 or scoped<0:
  raise ValueError("V52_NONFINITE_OR_INVALID_CAPITAL_INPUT")
 reserve=max(MINCAP,.1*equity)
 return max(MINCAP,equity-scoped-reserve)
def audit_case(folder:Path,bps:int)->dict:
 if bps not in (10,30):raise ValueError("BPS_NOT_10_OR_30")
 def source_file(suffix):
  files=list(folder.glob(f"*_{bps}BPS_{suffix}"))
  if len(files)!=1:raise ValueError("MODEL_SOURCE_CSV_MISSING_OR_AMBIGUOUS:"+suffix)
  return files[0]
 event_path=source_file("V52_DAILY_RISK_EVENTS.csv")
 position_path=source_file("POSITION_GROSS_SNAPSHOTS.csv")
 trips={}
 for row in records(event_path):
  if row["event"]=="TRIP":
   if row["utc"] in trips:raise ValueError("V52_TRIP_DUPLICATE_TIMESTAMP")
   trips[row["utc"]]=row
 if len(trips) not in (122,124):raise ValueError("V52_CASE_TRIP_POPULATION_UNKNOWN")
 observed={t:[] for t in trips}
 sentinel=Counter()
 for row in records(position_path):
  t=row["utc"]
  if t not in trips:continue
  if not row["trade_id"]:
   sentinel[t]+=1
   continue
  equity=float(row["account_equity_jpy"]);notional=float(row["current_notional_jpy"])
  if not math.isfinite(equity) or not math.isfinite(notional) or equity<=0 or notional<0:
   raise ValueError("POSITION_MODEL_MARK_OR_EQUITY_INVALID")
  observed[t].append({
      "logic":row["logic"],"symbol":row["symbol"],"notionalJpy":notional,
      "accountEquityJpy":equity})
 floor_count=0;floor_replay=0;extreme_count=0;unreproduced_floor=[]
 inspected=[];missing=[]
 for t,row in trips.items():
  pos=observed[t]
  if not pos:
   missing.append(t);continue
  eq=pos[0]["accountEquityJpy"]
  if any(not near(eq,x["accountEquityJpy"]) for x in pos):
   raise ValueError("POSITION_EQUITY_CONFLICT_WITHIN_TIMESTAMP")
  other=sum(x["notionalJpy"] for x in pos if x["logic"]!="V52" and x["symbol"] in EXPECTED_SYMBOLS)
  proxy=capital_proxy(eq,other)
  logged=float(row["strategy_capital_jpy"])
  loss=float(row["loss_pct"])
  if not all(math.isfinite(x) for x in (logged,loss)) or logged<=0:
   raise ValueError("INVALID_V52_TRIP_SOURCE_NUMERIC")
  is_floor=near(logged,MINCAP)
  is_proxy_floor=near(proxy,MINCAP)
  floor_count+=is_floor
  if is_floor:
   if not is_proxy_floor:
    unreproduced_floor.append(t)
   else:floor_replay+=1
  extreme_count+=int(loss>1000 and is_floor)
  inspected.append({
    "utc":t,"loggedCapitalJpy":logged,"sourceFloorJpy":MINCAP,
    "positionProxyCapitalJpy":proxy,
    "scopeNotionalJpyFrom5mPositions":other,
    "scopeGrossOverEquityX":other/eq,
    "equityJpy":eq,
    "loggedLossPercent":loss,
    "sourceFloorSelected":is_floor,
    "fiveMinutePositionProxyExplainsFloor":is_floor and is_proxy_floor})
 if missing:raise ValueError("V52_TRIP_HAS_NO_SOURCE_POSITION_SNAPSHOT")
 if unreproduced_floor:raise ValueError("V52_SOURCE_FLOOR_NOT_EXPLAINED_BY_POSITION_MARKS")
 return {"bps":bps,"trips":len(trips),
  "sourceFloorCapitalJpy":MINCAP,
  "loggedAtFloor":floor_count,"floorExplainedByIndependentPositionGross":floor_replay,
  "loggedExtreme1000pctAtFloor":extreme_count,
  "nonFloorLoggedEvents":len(trips)-floor_count,
  "sourceFiveMinuteMarksCanDifferFromH1":True,
  "largestEvent":max(inspected,key=lambda x:x["loggedLossPercent"]),
  "allAtFloorEventsExplainedByFiveMinutePositions":True,
  "observations":inspected,
  "sourceHashes":{"V52_DAILY_RISK_EVENTS":hashfile(event_path),
                  "POSITION_GROSS_SNAPSHOTS":hashfile(position_path)}}
def build(src:Path,folder:Path)->dict:
 evidence=source_contract(src)
 cases={str(b):audit_case(folder,b) for b in (10,30)}
 return {"schema":"disdex-bt-v52-risk-capital-denominator-provenance/v1",
  "status":"MODEL_V52_MINCAP_SOURCE_EXPLAINED_ECONOMIC_PARITY_UNCERTIFIED",
  "source":evidence,"costModels":cases,
  "resizingOrRiskCapChangeAuthorized":False,
  "shadowAlternativeReadyForProduction":False,
  "signedVenueProtectedLossCertified":False,
  "productionMutations":0}
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument("--source",type=Path,required=True)
 p.add_argument("--case-dir",type=Path,required=True)
 p.add_argument("--output",type=Path,required=True)
 a=p.parse_args();o=build(a.source,a.case_dir)
 a.output.write_text(json.dumps(o,ensure_ascii=False,indent=2,allow_nan=False)+"\n","utf8")
 print(json.dumps({"status":o["status"],
       "cases":{bp:{"trips":v["trips"],"sourceFloor":v["loggedAtFloor"],
        "floorExplained":v["floorExplainedByIndependentPositionGross"],
        "extremeFloor":v["loggedExtreme1000pctAtFloor"]}
        for bp,v in o["costModels"].items()}},ensure_ascii=False))
if __name__=="__main__":main()
