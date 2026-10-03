import urllib.request,urllib.parse,json,datetime,pathlib,concurrent.futures,hashlib,time
ROOT=pathlib.Path('baseline/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests')
OUT=pathlib.Path('hype-source');OUT.mkdir(exist_ok=True)
START=int(datetime.datetime(2025,7,25,tzinfo=datetime.timezone.utc).timestamp()*1000)
END=int(datetime.datetime(2026,8,11,tzinfo=datetime.timezone.utc).timestamp()*1000)
def get(kind,a,b):
 params={'symbol':'HYPEUSDT','startTime':a,'endTime':b-1,'limit':1000}
 if kind=='klines':params['interval']='1h'
 url='https://fapi.asterdex.com/fapi/v1/'+kind+'?'+urllib.parse.urlencode(params)
 for attempt in range(3):
  try:
   with urllib.request.urlopen(url,timeout=35) as r:raw=r.read()
   rows=json.loads(raw);assert isinstance(rows,list)
   p=OUT/f'{kind}-{a}.json';p.write_bytes(raw)
   return {'url':url,'path':str(p),'sha256':hashlib.sha256(raw).hexdigest(),'rows':rows}
  except Exception:
   if attempt==2:raise
   time.sleep(1+attempt)
jobs=[(kind,a,min(a+30*86400000,END)) for kind in ['klines','fundingRate'] for a in range(START,END,30*86400000)]
responses=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for result in pool.map(lambda args:get(*args),jobs):
  print(result['path'],len(result['rows']),flush=True);responses.append(result)
for kind in ['klines','fundingRate']:
 records={}
 for r in responses:
  if '/'+kind+'?' not in r['url']:continue
  for row in r['rows']:
   if kind=='klines':
    value={'event_time_ms':int(row[0]),'open':float(row[1]),'high':float(row[2]),'low':float(row[3]),'close':float(row[4]),'base_volume':float(row[5]),'close_time_ms':int(row[6]),'quote_volume':float(row[7]),'source':'aster','exchange':'ASTER','instrument':'HYPEUSDT','interval':'1h'}
   else:value={'event_time_ms':int(row['fundingTime']),'funding_rate':float(row['fundingRate']),'source':'aster','exchange':'ASTER','instrument':'HYPEUSDT'}
   ts=value['event_time_ms']
   if ts in records:assert records[ts]==value
   records[ts]=value
 p=ROOT/'normalized/aster'/('klines' if kind=='klines' else 'funding')/'HYPEUSDT.jsonl'
 p.write_text(''.join(json.dumps(records[t],sort_keys=True)+'\n' for t in sorted(records)))
 print(kind,'total',len(records),'first',min(records) if records else None,'last',max(records) if records else None,flush=True)
manifest={'source':'ASTER_PUBLIC_GET','requested_start_ms':START,'requested_end_exclusive_ms':END,'requests':[{k:v for k,v in r.items() if k!='rows'}|{'row_count':len(r['rows'])} for r in responses]}
OUT.joinpath('manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
