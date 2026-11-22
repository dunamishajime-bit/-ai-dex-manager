from pathlib import Path
import gzip,json,collections,hashlib
ROOT=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
DATA=Path(r"C:\tmp\disdex-bt-20251001-20261001")
old=DATA/"V4_NATIVE_LIFECYCLE_EXIT_M5COMPLETE_20261109"/"v4-native-lifecycle-modeled-exits.jsonl"
all_trades=[json.loads(x) for x in old.read_text(encoding="utf8").splitlines() if x.strip()]
entries=[x for x in all_trades if x.get("exitSource")=="PRODUCTION_EXIT"]
assert len(entries)==1087
by=collections.defaultdict(list)
for x in entries:by[x["symbol"]].append(x)
H=3600000
out=[];missing=[];sha={}
for sym,trades in sorted(by.items()):
  first=min(x["entryTs"] for x in trades);last=max(x["exitTs"] for x in trades)
  h={};sha[sym]=[]
  for dirname in ["aster-public-v3-h1-early","aster-public-v3-h1"]:
    found=list((DATA/dirname).glob(sym+"-1h-*.jsonl.gz"));assert len(found)==1
    p=found[0];sha[sym].append({"file":dirname+"/"+p.name,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()})
    with gzip.open(p,"rt",encoding="utf8") as raw:
      for line in raw:
        if not line.strip():continue
        x=json.loads(line);t=int(x[0])
        if t<first or t>last:continue
        v={"openTs":t,"open":float(x[1]),"high":float(x[2]),"low":float(x[3]),"close":float(x[4])}
        if t in h and h[t]!=v:raise RuntimeError("H1_CONFLICT:"+sym)
        h[t]=v
  for trade in trades:
    start=int(trade["entryTs"]);end=int(trade["exitTs"])
    candles=[h.get(t) for t in range(start,end+H,H)]
    if any(x is None for x in candles):missing.append({"id":trade["id"],"missing":sum(x is None for x in candles)})
    out.append({"oldTrade":{"id":trade["id"],"symbol":sym,"side":trade["side"],"route":trade["route"],"entryTs":start,"exitTs":end,"entryPrice":trade["entryPrice"],"entryAtr":trade["entryAtr"],"exitPrice":trade["exitPrice"],"exitReason":trade["exitReason"],"exitSpec":trade["exitSpec"]},"h1":candles})
dest=ROOT/"P107_V4_PRODUCTION_EXIT_1087_NATIVE_H1_INPUT_20261123.json"
dest.write_text(json.dumps({"schema":"p107-v4-source-native-production-exit-1087-h1-price-input/v1","sha":"e788abc82e80f9fc7ab0e1ba83fdb8be267eb513","signedActualFills":0,"allRunnerParity":False,"inputHashes":sha,"missing":missing,"trades":out},separators=(",",":"))+"\n",encoding="utf8")
print("PREPARED",len(out),"missing",len(missing),"bytes",dest.stat().st_size,"max_hours",max(len(x["h1"]) for x in out))
