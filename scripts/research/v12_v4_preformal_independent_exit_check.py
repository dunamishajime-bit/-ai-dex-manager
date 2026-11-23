"""Independent Python H1 price-model cross-check of preformal candidate exits.
No venue activity, no code authorizations, no clean prospective sample claim.
"""
import json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/"docs/ops/v12-v4-cert-20261009/preformal-2025-native-route-coverage.json"
OUTPUT=ROOT/"docs/ops/v12-v4-cert-20261009/preformal-2025-independent-exit-check.json"
MARKET=Path("C:/tmp/bt-v12-score100-volume080-normalonly-20260928/extracted/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests/normalized/aster/klines")
H=3600000
report=json.loads(SOURCE.read_text(encoding="utf8"))
if report["clockCount"]<=0 or report["status"]!="READ_ONLY_PRE_FORMAL_ROUTE_OBSERVATION":raise SystemExit("PRE_FORMAL_EVIDENCE_NOT_READY")
candidates=report["candidateRecords"]
if len(candidates)!=178:raise SystemExit("CANDIDATE_SAMPLE_COUNT_CHANGED")
catalog={r["route"]:r["spec"] for r in json.loads((ROOT/"docs/research/results/v4-production-cert-20261009/exact-production-exit-catalog.json").read_text(encoding="utf8"))}
symbols={r["symbol"] for r in candidates}
raw={}
for symbol in symbols:
 raw[symbol]={int(x["event_time_ms"]):x for x in map(json.loads,(MARKET/(symbol+".jsonl")).read_text(encoding="utf8").splitlines())}
def value(symbol,clock,key):
 r=raw[symbol].get(clock)
 return float(r[key]) if r else None
def atr14(symbol,entry):
 records=[raw[symbol].get(entry-i*H) for i in range(15,0,-1)]
 if any(r is None for r in records):return None
 trs=[]
 for i in range(1,15):
  cur=records[i];prev=records[i-1];pc=float(prev["close"])
  trs.append(max(float(cur["high"])-float(cur["low"]),abs(float(cur["high"])-pc),abs(float(cur["low"])-pc)))
 return sum(trs)/14
errors=[];compared=0;kind_count={}
for c in candidates:
 spec=catalog[c["route"]]
 side=1 if c["side"]=="LONG" else -1
 start=c["entryTs"];symbol=c["symbol"]
 entry=value(symbol,start,"open")
 if entry is None:errors.append({"candidate":c,"reason":"ENTRY_H1_MISSING"});continue
 if spec["kind"]=="TIME":
  exitTs=start+spec["hours"]*H
  exitPrice=value(symbol,exitTs,"open")
  exitReason="TIME"
 else:
  if spec["kind"]!="ATR":raise SystemExit("UNEXPECTED_ROUTE_KIND")
  # Independent 14-period true range based only on bars closed at entry.
  atr=atr14(symbol,start)
  if atr is None or atr<=0:
   errors.append({"candidate":c,"reason":"ATR_NOT_AVAILABLE"});continue
  stop=entry-side*spec["sl"]*atr
  target=entry+side*spec["tp"]*atr
  exitTs=None;exitPrice=None;exitReason=None
  for t in range(start,start+spec["hours"]*H,H):
   row=raw[symbol].get(t)
   if not row:raise SystemExit("H1_GAP:"+symbol+":"+str(t))
   lo=float(row["low"]);hi=float(row["high"]);op=float(row["open"])
   # Stop-first when both are touched. Long/short gap is adverse.
   if (lo<=stop if side==1 else hi>=stop):
    exitTs=t+H;exitPrice=min(op,stop) if side==1 else max(op,stop);exitReason="STOP";break
   if (hi>=target if side==1 else lo<=target):
    exitTs=t+H;exitPrice=target;exitReason="TP";break
  if exitReason is None:
   exitTs=start+spec["hours"]*H
   exitPrice=value(symbol,exitTs,"open")
   exitReason="TIME"
 entryOk=abs(entry-c["entryPrice"])<=max(1e-9,entry*1e-9)
 tsOk=exitTs==c["exitTs"]
 reasonOk=exitReason==c["exitReason"]
 priceOk=exitPrice is not None and abs(exitPrice-c["exitPrice"])<=max(1e-9,abs(exitPrice)*1e-9)
 if not(entryOk and tsOk and reasonOk and priceOk):
  errors.append({"route":c["route"],"symbol":symbol,"entryTs":start,
                 "expected":{k:c[k] for k in ("entryPrice","exitPrice","exitTs","exitReason")},
                 "computed":{"entry":entry,"price":exitPrice,"ts":exitTs,"reason":exitReason}})
 else:compared+=1
 kind_count[spec["kind"]]=kind_count.get(spec["kind"],0)+1
result={"status":"PASS_PRE_FORMAL_INDEPENDENT_H1_EXITS" if not errors else "BLOCKED_PRE_FORMAL_INDEPENDENT_H1_EXITS",
 "target":"preformal 2025-01-13..2025-08-10 11 observed missing-external routes",
 "candidateCount":len(candidates),"matched":compared,"errors":errors[:100],
 "kindCounts":kind_count,
 "limitations":["Research retrospective, not pristine forward performance",
 "Non-event routes (five) still have no independent period observations",
 "Price model != signed broker STOP execution, does not attest order submission"],
 "sourceSha256":hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
 "marketSha256":{symbol:hashlib.sha256((MARKET/(symbol+".jsonl")).read_bytes()).hexdigest() for symbol in symbols},
 "ordersSent":0,"tradingMutation":0}
OUTPUT.write_text(json.dumps(result,indent=2)+"\n",encoding="utf8")
print(json.dumps({k:result[k] for k in ("status","candidateCount","matched","kindCounts","errors")},indent=2))
if errors:raise SystemExit(1)
