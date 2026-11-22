from pathlib import Path
import gzip,json,collections,hashlib
ROOT=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
DATA=Path(r"C:\tmp\disdex-bt-20251001-20261001")
old=DATA/"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109"/"v4-native-lifecycle-modeled-exits.jsonl"
records=[json.loads(x) for x in old.read_text(encoding="utf8").splitlines() if x.strip()]
subset=[x for x in records if x.get("exitSource")=="FOUR_RULE_H1"]
assert len(subset)==176
by=collections.defaultdict(list)
for x in subset:by[x["symbol"]].append(x)
M5=300000;H1=3600000
out=[];missing=[];provenance={}
for symbol,trades in sorted(by.items()):
 lo=min(x["entryTs"] for x in trades);hi=max(x["exitTs"] for x in trades)
 data5={};data1={};files=[]
 for folder,tag,template in [
 ("aster-public-v3-5m-prefix","m5","-5m-*.jsonl.gz"),
 ("aster-public-v3-5m-suffix","m5","-5m-*.jsonl.gz"),
 ("aster-public-v3-h1-early","h1","-1h-*.jsonl.gz"),
 ("aster-public-v3-h1","h1","-1h-*.jsonl.gz")
 ]:
  found=list((DATA/folder).glob(symbol+template))
  assert len(found)==1,(symbol,folder,len(found))
  p=found[0];files.append({"file":folder+"/"+p.name,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()})
  with gzip.open(p,"rt",encoding="utf8") as src:
   for line in src:
    if not line.strip():continue
    x=json.loads(line);t=int(x[0])
    if not lo<=t<hi:continue
    unit=M5 if tag=="m5" else H1
    v={"openTs":t,"open":float(x[1]),"high":float(x[2]),"low":float(x[3]),"close":float(x[4]),"observedAt":t+unit}
    data=data5 if tag=="m5" else data1
    if t in data and data[t]!=v:raise RuntimeError("HISTORICAL_DUPLICATE_CONFLICT:"+symbol+":"+str(t))
    data[t]=v
 provenance[symbol]=files
 for trade in trades:
  entry=int(trade["entryTs"]);exit=int(trade["exitTs"])
  samples5=[data5.get(t) for t in range(entry,exit,M5)]
  samples1=[data1.get(t) for t in range(entry,exit,H1)]
  if None in samples5 or None in samples1:
   missing.append({"id":trade["id"],"symbol":symbol,"missingM5":sum(x is None for x in samples5),"missingH1":sum(x is None for x in samples1)})
  out.append({"oldTrade":{"id":trade["id"],"symbol":symbol,"side":trade["side"],"route":trade["route"],"entryTs":entry,"exitTs":exit,"fillProxy":trade["entryPrice"],"exitPriceModel":trade["exitPrice"],"exitReasonModel":trade["exitReason"]},"m5":samples5,"h1":samples1})
dst=ROOT/"P107_V4_H1_FOUR_RULE_176_NATIVE_INPUT_20261123.json"
value={"schema":"p107-v4-native-176-four-rule-h1-market-candles/v1","sourceSHA":"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513","oldTapeSHA256":hashlib.sha256(old.read_bytes()).hexdigest(),"signedVenueFills":0,"fullSTABLE4Parity":False,"files":provenance,"missing":missing,"trades":out}
dst.write_text(json.dumps(value,separators=(",",":"))+"\n",encoding="utf8")
print("SOURCE_H1_INPUTS",len(out),"MISSING",len(missing),"JSON_BYTES",dst.stat().st_size,"MAX_M5_BARS",max(len(x["m5"]) for x in out))
