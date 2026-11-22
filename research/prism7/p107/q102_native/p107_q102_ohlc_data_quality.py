#!/usr/bin/env python3
"""P107 exact OHLC data quality checks for Q102 pinned 11 symbol S34 and BTC."""
import gzip,hashlib,json,datetime as dt,subprocess,re
from pathlib import Path
ROOT=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
BASE=Path(r"C:\tmp\disdex-bt-20251001-20261001")
SHA="c7310d34ba1b6de07071d8883a2ed0de8dcce2a7"
repo=ROOT/"master-checkout"
z=subprocess.run(["git","-C",str(repo),"show",SHA+":config/disdexQuality102CausalV4Model.ts"],capture_output=True,text=True,timeout=12)
assert z.returncode==0
symbols=sorted(set(re.findall(r'\bsymbol:\s*"([A-Z0-9]+USDT)"',z.stdout))|{"BTCUSDT"})
def iso(ms):return dt.datetime.fromtimestamp(ms/1000,dt.timezone.utc).isoformat().replace("+00:00","Z")
rows={}
for symbol in symbols:
 inputs=[];candles={}
 for folder in [BASE/"aster-public-v3-h1-early",BASE/"aster-public-v3-h1"]:
  for f in folder.glob(symbol+"-1h-*.jsonl.gz"):
   inputs.append({"name":f.name,"folder":folder.name,"sha256":hashlib.sha256(f.read_bytes()).hexdigest()})
   with gzip.open(f,"rt",encoding="utf8") as stream:
    for line in stream:
     if not line.strip():continue
     x=json.loads(line)
     candle={"ts":int(x[0]),"open":float(x[1]),"high":float(x[2]),"low":float(x[3]),"close":float(x[4]),"quoteVolume":float(x[7])}
     if candle["ts"] in candles and candles[candle["ts"]]!=candle:
      raise ValueError("CONFLICTING_DUPLICATE_KLINE:"+symbol)
     candles[candle["ts"]]=candle
 unique=sorted(candles)
 bad=[]
 for ts in unique:
  c=candles[ts]
  if c["open"]<=0 or c["close"]<=0 or c["high"]<=0 or c["low"]<=0 or c["high"]<c["low"] or c["high"]<max(c["open"],c["close"]) or c["low"]>min(c["open"],c["close"]) or c["quoteVolume"]<0:
   bad.append({"timestamp":iso(ts),"open":c["open"],"high":c["high"],"low":c["low"],"close":c["close"]})
 gaps=[{"last":iso(t),"next":iso(t2),"deltaHours":round((t2-t)/3600000,6)} for t,t2 in zip(unique,unique[1:]) if t2-t!=3600000]
 rows[symbol]={"barCount":len(unique),"earliest":iso(unique[0]) if unique else None,"latest":iso(unique[-1]) if unique else None,"invalidOHLCCount":len(bad),"invalidOHLC_examples":bad[:8],"nonHourlyGapCount":len(gaps),"gapExamples":gaps[:5],"inputFiles":inputs}
result={"schema":"p107-Q102-S34+BTC-aster-H1-data-invalid-OHLC/v1","nativeSourceSha":SHA,"sourceReaderCandleValidation":"lib/disdex-quality102-causal-v1-signal.ts:assertClosedCausalHistory","symbols":symbols,"badSymbols":[k for k,v in rows.items() if v["invalidOHLCCount"]],"currentNativeFullParity":False,"all":[rows[s] for s in symbols],"rowsBySymbol":rows}
dest=ROOT/"P107_Q102_NATIVE_PIN_INVALID_OHLC_AUDIT_20261122.json"
dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
print("RESULT",len(symbols),"badSymbols",result["badSymbols"],[(k,rows[k]["invalidOHLCCount"]) for k in result["badSymbols"]])
for symbol in ["BTCUSDT","AVAXUSDT","FETUSDT","LDOUSDT","RENDERUSDT"]:
 print(symbol,rows[symbol]["earliest"],rows[symbol]["invalidOHLCCount"])
