#!/usr/bin/env python3
"""Research-only download official Binance Vision RENDER futures metrics,
funding and 5m kline archives with SHA256 and ZIP CRC. No broker access.
Permits missing assets but records them; never fabricates missing samples.
"""
from __future__ import annotations
import calendar,concurrent.futures,datetime as dt,hashlib,io,json,re,time,urllib.request,urllib.error,zipfile
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
CACHE=Path('C:/tmp/render-flow-raw-data-20261024')
OUT=REPO/'docs/research/results/render-orderflow-20261024'
OUT.mkdir(parents=True,exist_ok=True)
CACHE.mkdir(parents=True,exist_ok=True)
ROOT='https://data.binance.vision/data/futures/um'
START=dt.date(2024,8,1);END=dt.date(2026,9,1)
def days(a,b):
 while a<b:
  yield a
  a+=dt.timedelta(days=1)
def months(a,b):
 y,m=a.year,a.month
 while (y,m)<(b.year,b.month):
  yield f'{y:04d}-{m:02d}'
  m+=1
  if m==13:y,m=y+1,1
def tasks():
 for d in days(START,END):
  s=d.isoformat()
  yield ('metrics',s,f'daily/metrics/RENDERUSDT/RENDERUSDT-metrics-{s}.zip')
 for s in months(START,END):
  yield ('fundingRate',s,f'monthly/fundingRate/RENDERUSDT/RENDERUSDT-fundingRate-{s}.zip')
  if s>='2025-08':
   yield ('klines5m',s,f'monthly/klines/RENDERUSDT/5m/RENDERUSDT-5m-{s}.zip')
def fetch(kind,key,part):
 url=ROOT+'/'+part
 path=CACHE/part
 path.parent.mkdir(parents=True,exist_ok=True)
 def check(path):
  data=path.read_bytes()
  if len(data)<50:raise ValueError('ZIP_TOO_SHORT')
  with zipfile.ZipFile(io.BytesIO(data)) as z:
   assert z.testzip() is None
   names=[x for x in z.namelist() if x.endswith('.csv')]
   assert len(names)==1
   with z.open(names[0]) as f:
    lines=f.read().splitlines()
   assert len(lines)>1
   sample_first=lines[1][:120].decode('utf-8-sig')
   sample_last=lines[-1][:120].decode('utf-8-sig')
  return {'kind':kind,'key':key,'url':url,'file':str(path),'sha256':hashlib.sha256(data).hexdigest(),
   'zipCRC':True,'csvRows':len(lines)-1,'first':sample_first,'last':sample_last,'bytes':len(data)}
 if path.exists():
  try:return check(path)
  except Exception:path.unlink()
 err=None
 for retry in range(4):
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'DisDex-Research-ReadOnly/1.0'})
   with urllib.request.urlopen(req,timeout=18) as res:
    blob=res.read(16*1024*1024)
   assert len(blob)<16*1024*1024
   temp=path.with_suffix('.tmp')
   temp.write_bytes(blob)
   valid=check(temp)
   temp.replace(path)
   valid['file']=str(path)
   return valid
  except urllib.error.HTTPError as e:
   err=f'HTTP_{e.code}'
   if e.code in (403,404):break
  except Exception as e:err=type(e).__name__+':'+str(e)[:120]
  time.sleep(.6*(retry+1))
 return {'kind':kind,'key':key,'url':url,'error':err,'available':False}
def main():
 items=list(tasks());results=[]
 print('ARCHIVE_TASKS',len(items),'CACHE',CACHE,flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
  future={pool.submit(fetch,*v):v for v in items}
  for n,f in enumerate(concurrent.futures.as_completed(future),1):
   try:r=f.result()
   except Exception as e:r={'kind':future[f][0],'key':future[f][1],'error':repr(e)}
   results.append(r)
   if n%80==0 or n==len(items):
    print('DOWNLOAD',n,'/',len(items),'valid',sum('sha256' in z for z in results),
     'missing',sum('sha256' not in z for z in results),flush=True)
 results.sort(key=lambda x:(x['kind'],x['key']))
 summary={k:{'expected':sum(a[0]==k for a in items),'valid':sum(z['kind']==k and 'sha256' in z for z in results)}
  for k in ('metrics','fundingRate','klines5m')}
 manifest={'status':'OFFICIAL_BINANCE_VISION_SOURCE_ARCHIVE_INSPECTED_NOT_VENUE_SIGNED',
  'market':'USD-M futures RENDERUSDT','start':str(START),'endExclusive':str(END),
  'sourceRoot':ROOT,'zipCRCChecked':True,'localSha256':True,
  'warnings':['Metric create_time timestamps changed in June 2026; use 10 minute availability lag.',
   'Archive data is not exchange order lifecycle evidence.','No inferred or synthesized rows.'],
  'summary':summary,'files':results}
 output=OUT/'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json'
 output.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('FINAL',summary,'missing',[(z['kind'],z['key'],z.get('error')) for z in results if 'sha256' not in z][:30],
  'manifest',output,flush=True)
if __name__=='__main__':main()
