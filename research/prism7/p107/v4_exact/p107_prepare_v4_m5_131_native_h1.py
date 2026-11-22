from pathlib import Path
import gzip,json,collections,hashlib,sys
ROOT=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
DATA=Path(r"C:\tmp\disdex-bt-20251001-20261001")
old=DATA/"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109"/"v4-native-lifecycle-modeled-exits.jsonl"
records=[json.loads(x) for x in old.read_text(encoding="utf8").splitlines() if x.strip()]
subset=[x for x in records if x.get("exitSource")=="FOUR_RULE_M5"]
assert len(subset)==131
by=collections.defaultdict(list)
for r in subset:by[r["symbol"]].append(r)
H=300000
rows=[];provenance={};incomplete=[]
for symbol,trades in sorted(by.items()):
 candles={};files=[]
 for dir in ["aster-public-v3-5m-prefix","aster-public-v3-5m-suffix"]:
  matched=list((DATA/dir).glob(symbol+"-5m-*.jsonl.gz"))
  assert len(matched)==1,(symbol,dir,len(matched))
  f=matched[0];files.append({"file":dir+"/"+f.name,"sha256":hashlib.sha256(f.read_bytes()).hexdigest()})
  with gzip.open(f,"rt",encoding="utf8") as inp:
   for line in inp:
    if not line.strip():continue
    z=json.loads(line)
    t=int(z[0])
    row={"openTs":t,"open":float(z[1]),"high":float(z[2]),"low":float(z[3]),"close":float(z[4]),"observedAt":t+H}
    if t in candles and candles[t]!=row:raise RuntimeError("CONFLICTING_M5_KLINE:"+symbol+":"+str(t))
    candles[t]=row
 provenance[symbol]=files
 for trade in trades:
  start=int(trade["entryTs"]);end=int(trade["exitTs"])
  ts=list(range(start,end,H))
  m5=[candles.get(t) for t in ts]
  if None in m5:incomplete.append({"id":trade["id"],"symbol":symbol,"missing":sum(x is None for x in m5)})
  rows.append({"oldTrade":{"id":trade["id"],"symbol":trade["symbol"],"route":trade["route"],"side":trade["side"],"entryTs":start,"exitTs":end,"fillProxy":trade["entryPrice"],"exitPriceModel":trade["exitPrice"],"exitReasonModel":trade["exitReason"]},"m5":m5})
 assert len(by[symbol])>0
out={"schema":"p107-v4-four-rule-M5-candidate-131-source-asof-prices/v1","sourceSHA":"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513","oldTapeSHA256":hashlib.sha256(old.read_bytes()).hexdigest(),"signedActualFills":0,"allRunnersP107FullParity":False,"dataFiles":provenance,"missingTradePaths":incomplete,"trades":rows}
p=ROOT/"P107_V4_M5_FOUR_RULE_131_NATIVE_INPUT_20261123.json"
p.write_text(json.dumps(out,separators=(",",":"))+"\n",encoding="utf8")
print("INPUT_CREATED",len(rows),"missing",len(incomplete),"bytes",p.stat().st_size)
print("M5_CANDIDATE_EXAMPLE",rows[0]["oldTrade"],"BARS",len(rows[0]["m5"]))
