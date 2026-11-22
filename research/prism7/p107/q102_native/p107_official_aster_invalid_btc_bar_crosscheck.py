import hashlib,json,urllib.parse,urllib.request,datetime
from pathlib import Path
ROOT=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
TS=1757768400000
args={"symbol":"BTCUSDT","interval":"1h","startTime":TS,"endTime":TS+3600000,"limit":2}
out={"schema":"p107-official-aster-h1-source-btc-open-over-high-v1","observed_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"instrument":"BTCUSDT","bar_ts":TS,"http_get_only":True,"authorization_used":False,"endpoints":[]}
for vers in ("v1","v3"):
 url="https://fapi.asterdex.com/fapi/"+vers+"/klines?"+urllib.parse.urlencode(args)
 request=urllib.request.Request(url,headers={"Accept":"application/json","User-Agent":"DisDex-P107-Source-ReadOnly/1.0"},method="GET")
 with urllib.request.urlopen(request,timeout=18) as r:
  http=r.status;data=r.read(25000)
 rows=json.loads(data)
 assert http==200 and isinstance(rows,list) and len(rows)>=1
 row=next(x for x in rows if int(x[0])==TS)
 valid=all(float(row[2])>=float(x) for x in (row[1],row[4]))
 assert not valid and float(row[1])>float(row[2]),"EXCHANGE_BAR_UNEXPECTEDLY_REPAIRED"
 out["endpoints"].append({"endpoint":url,"http_status":http,"response_sha256":hashlib.sha256(data).hexdigest(),"first_bar":row,"ohlc_valid":valid})
assert out["endpoints"][0]["response_sha256"]==out["endpoints"][1]["response_sha256"]
dest=ROOT/"P107_OFFICIAL_ASTER_BTC_INVALID_BAR_CROSSCHECK_20261122.json"
dest.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
print("SOURCE_CHECK_PASS",out["endpoints"][0]["response_sha256"],"OUTPUT",dest)
