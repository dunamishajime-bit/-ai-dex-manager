import hashlib,json,urllib.parse,urllib.request,datetime
from pathlib import Path
ROOT=Path(r"C:\tmp\disdex-prism7-p107-parity-audit-20261122")
points=[("2025-04-01T00:00:00Z",1743465600000),("2025-10-01T00:00:00Z",1759276800000)]
res={"schema":"p107-official-aster-q102-three-symbol-early-h1-availability-probe-v1","read_only":True,"no_private_auth":True,"checked_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"rows":[]}
for symbol in ["FETUSDT","LDOUSDT","RENDERUSDT"]:
 for day,ts in points:
  q=urllib.parse.urlencode({"symbol":symbol,"interval":"1h","startTime":ts,"endTime":ts+7200000,"limit":3})
  url="https://fapi.asterdex.com/fapi/v3/klines?"+q
  row={"symbol":symbol,"time":day,"request_url":url}
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={"Accept":"application/json","User-Agent":"DisDex-P107-Historical-ReadOnly/1.0"},method="GET"),timeout=12) as http:
    b=http.read(6000);d=json.loads(b)
    row.update(httpCode=http.status,responseSha256=hashlib.sha256(b).hexdigest(),rows=len(d) if isinstance(d,list) else None,firstCandle=(d[0][:8] if isinstance(d,list) and d and isinstance(d[0],list) else None),dataType=type(d).__name__)
  except Exception as e:row.update(errorType=type(e).__name__)
  res["rows"].append(row)
  print("API",symbol,day,"rows",row.get("rows"),"http",row.get("httpCode"),"error",row.get("errorType"))
out=ROOT/"P107_Q102_OFFICIAL_EARLY_H1_AVAILABILITY_PROBE_20261122.json"
out.write_text(json.dumps(res,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
