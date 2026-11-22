import gzip,hashlib,json,datetime as dt
from pathlib import Path
root=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
market=Path(r"C:\tmp\disdex-bt-20251001-20261001")
out=root/"P107_Q102_AVAX_BTC_H1_ASOF_INPUT_20261122.json"
targets=["2025-10-01T01:00:00+00:00","2026-08-03T01:00:00+00:00"]
times=[int(dt.datetime.fromisoformat(t).timestamp()*1000) for t in targets]
allrows={};inputs={}
for symbol in ["AVAXUSDT","BTCUSDT"]:
 rs=[];hashes=[]
 for folder in [market/"aster-public-v3-h1-early",market/"aster-public-v3-h1"]:
  p=next(folder.glob(symbol+"*.gz"))
  hashes.append({"source":p.name,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()})
  with gzip.open(p,"rt",encoding="utf8") as f:
   for line in f:
    z=json.loads(line)
    rs.append({"timestampMs":int(z[0]),"open":float(z[1]),"high":float(z[2]),"low":float(z[3]),"close":float(z[4]),"quoteVolume":float(z[7])})
 rs.sort(key=lambda x:x["timestampMs"])
 assert len({x["timestampMs"] for x in rs})==len(rs)
 assert all(b["timestampMs"]-a["timestampMs"]==3600000 for a,b in zip(rs,rs[1:]))
 allrows[symbol]=rs;inputs[symbol]=hashes
cases=[]
for t in times:
 history={s:[x for x in v if x["timestampMs"]<t] for s,v in allrows.items()}
 current={s:next(({"timestampMs":x["timestampMs"],"open":x["open"]} for x in v if x["timestampMs"]==t),None) for s,v in allrows.items()}
 assert all(v is not None for v in current.values())
 cases.append({"decisionTs":t,"history":{"candlesBySymbol":history,"entryOpenBySymbol":current},"sleeveOccupancy":{"activePosition":False,"unresolvedPendingEntry":False,"basePositionActive":False}})
out.write_text(json.dumps({"pin":"c7310d34ba1b6de07071d8883a2ed0de8dcce2a7","cases":cases,"sourceFiles":inputs},separators=(",",":"))+"\n",encoding="utf8")
print("INPUT_BYTES",out.stat().st_size,"CASE_TIMES",targets,"H1_ROWS",[(t,{s:len(v) for s,v in c["history"]["candlesBySymbol"].items()}) for t,c in zip(targets,cases)])
