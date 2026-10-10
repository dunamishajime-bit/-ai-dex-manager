"""Independent 2025-2026 H1 Exit price-model audit for the 16 routes
absent from the later external sample. Read-only, no broker access.
"""
import json,hashlib
from pathlib import Path
P=Path(__file__).resolve().parents[2]
ROOT=P/"docs/research/results/v4-production-cert-20261009/bt-baseline/cases/V2_M150_D05_CORE_NATIVE"
E=P/"docs/ops/v12-v4-cert-20261009/native-route-parity-after.json"
O=P/"docs/ops/v12-v4-cert-20261009/historical-sixteen-independent-exit.json"
M=Path("C:/tmp/bt-v12-score100-volume080-normalonly-20260928/extracted/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests/normalized/aster/klines")
H=3600000
def read(path):
 with path.open(encoding="utf-8") as f:
  return [json.loads(x) for x in f if x.strip()]
def hash_file(path):
 return hashlib.sha256(path.read_bytes()).hexdigest()
catalog={x["route"]:x["spec"] for x in json.loads((P/"docs/research/results/v4-production-cert-20261009/exact-production-exit-catalog.json").read_text())}
external=json.loads(E.read_text())
assert external["status"]=="PASS_NATIVE_ROUTE_ENTRY_REPLAY"
missing=set(catalog)-set(x["route"] for x in external["actual"])
assert len(missing)==16
cfile=ROOT/"candidates/crypto-price-model-candidates.jsonl"
candidates=[x for x in read(cfile) if x["strategy_id"]=="V12"]
ledger=ROOT/"runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl"
accepted=[x for x in read(ledger) if x["strategy_id"]=="V12" and x["route"] in missing]
bykey={(c["route"],c["symbol"],c["side"],c["entry_ts_ms"]):c for c in candidates}
symbols={x["symbol"] for x in accepted}
bars={sym:{int(x["event_time_ms"]):x for x in read(M/(sym+".jsonl"))} for sym in symbols}
def tr(sym,t):
 values=[bars[sym].get(t-i*H) for i in range(15,0,-1)]
 if any(v is None for v in values):return None
 seq=[]
 for i in range(1,len(values)):
  b=values[i];prev=float(values[i-1]["close"])
  seq.append(max(float(b["high"])-float(b["low"]),abs(float(b["high"])-prev),abs(float(b["low"])-prev)))
 return sum(seq)/len(seq)
def close_decision(ref):
 c=bykey[ref["route"],ref["symbol"],ref["side"],ref["entry_ts_ms"]]
 spec=catalog[c["route"]];entry=int(c["entry_ts_ms"]);side=c["side"]
 s=1 if side=="LONG" else -1
 at=bars[c["symbol"]];entrybar=at.get(entry)
 if not entrybar:return None
 price=float(entrybar["open"])
 if spec["kind"]=="TIME":
  ts=entry+spec["hours"]*H;future=at.get(ts)
  if not future:return None
  return {"ts":ts,"price":float(future["open"]),"reason":"TIME","entry":price}
 if spec["kind"]!="ATR":raise ValueError("Unexpected type "+str(spec))
 a=tr(c["symbol"],entry)
 if not a or a<=0:return None
 stop=price-s*spec["sl"]*a;tp=price+s*spec["tp"]*a
 for i in range(spec["hours"]):
  t=entry+i*H;b=at.get(t)
  if not b:return None
  lo=float(b["low"]);hi=float(b["high"]);op=float(b["open"])
  if (lo<=stop if s==1 else hi>=stop):
   return {"ts":t+H,"price":min(stop,op) if s==1 else max(stop,op),"reason":"STOP","entry":price}
  if (hi>=tp if s==1 else lo<=tp):
   return {"ts":t+H,"price":tp,"reason":"TP","entry":price}
 ts=entry+spec["hours"]*H;future=at.get(ts)
 if not future:return None
 return {"ts":ts,"price":float(future["open"]),"reason":"TIME","entry":price}
result=[];errors=[]
for ref in accepted:
 c=bykey[ref["route"],ref["symbol"],ref["side"],ref["entry_ts_ms"]]
 got=close_decision(ref);spec=catalog[ref["route"]]
 expectedReason=("TIME" if spec["kind"]=="TIME" else
  ("STOP" if c["exit_reason"].endswith("_STOP") else "TP" if c["exit_reason"].endswith("_TP") else "UNKNOWN"))
 good=got is not None and got["ts"]==c["exit_ts_ms"] and got["reason"]==expectedReason and abs(got["price"]-c["exit_price"])<=max(1e-9,abs(c["exit_price"])*1e-9) and abs(got["entry"]-c["entry_price"])<=max(1e-9,abs(c["entry_price"])*1e-9)
 result.append({"route":ref["route"],"positionId":ref["position_id"],"matched":good})
 if not good:errors.append({"route":ref["route"],"positionId":ref["position_id"],"expected":{"entry":c["entry_price"],"exitTs":c["exit_ts_ms"],"exitPrice":c["exit_price"],"reason":c["exit_reason"]},"actual":got})
byroute=[{"route":rt,"expected":sum(x["route"]==rt for x in result),"matched":sum(x["route"]==rt and x["matched"] for x in result)}for rt in sorted(missing)]
out={"status":"PASS_SIXTEEN_HISTORICAL_H1_EXIT_PRICE_MODEL" if not errors else "BLOCKED_SIXTEEN_HISTORICAL_H1_EXIT_PRICE_MODEL",
 "scope":"Independent pure-Python H1 simulated Exit; original BT retrospective, not an unseen forward or venue STOP fill certificate",
 "expected":len(result),"matched":sum(x["matched"] for x in result),"byRoute":byroute,"errors":errors[:100],
 "inputSha256":{"candidates":hash_file(cfile),"ledger":hash_file(ledger),"external":hash_file(E)},
 "marketSha256":{s:hash_file(M/(s+".jsonl")) for s in symbols},
 "orderEnabled":False,"tradingMutation":0}
O.write_text(json.dumps(out,indent=2)+"\n",encoding="utf-8")
print(json.dumps({"status":out["status"],"expected":out["expected"],"matched":out["matched"],"byRoute":byroute,"errors":errors[:5]},indent=2))
if errors:raise SystemExit(1)
