#!/usr/bin/env python3
"""Official Binance Vision 2024 RNDR/RENDER perpetual archival data; separate contracts.
All files checked against publisher .CHECKSUM SHA-256 and ZIP CRC.
No synthetic splice across old RNDR settlement and new RENDER launch.
"""
from __future__ import annotations
import concurrent.futures,datetime as dt,hashlib,io,json,os,urllib.request,urllib.error,zipfile,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
OUT=REPO/'docs/research/results/render-three-regime-20261024'
CACHE=Path('C:/tmp/render-rndr-2024-history-20261024')
BASE='https://data.binance.vision/data/futures/um/'
OUT.mkdir(parents=True,exist_ok=True)
CACHE.mkdir(parents=True,exist_ok=True)
def days(start,end):
 d=dt.date.fromisoformat(start)
 stop=dt.date.fromisoformat(end)
 while d<=stop:
  yield d.isoformat();d+=dt.timedelta(days=1)
def wants():
 data=[]
 for month in range(1,8):
  ym=f'2024-{month:02d}'
  data.extend([
   ('RNDRUSDT','klines5m',ym,f'monthly/klines/RNDRUSDT/5m/RNDRUSDT-5m-{ym}.zip'),
   ('BTCUSDT','klines5m',ym,f'monthly/klines/BTCUSDT/5m/BTCUSDT-5m-{ym}.zip'),
   ('RNDRUSDT','fundingRate',ym,f'monthly/fundingRate/RNDRUSDT/RNDRUSDT-fundingRate-{ym}.zip')
  ])
 data.extend([
  ('RENDERUSDT','klines5m','2024-07','monthly/klines/RENDERUSDT/5m/RENDERUSDT-5m-2024-07.zip'),
  ('RENDERUSDT','fundingRate','2024-07','monthly/fundingRate/RENDERUSDT/RENDERUSDT-fundingRate-2024-07.zip'),
 ])
 for d in days('2024-01-01','2024-07-16'):
  data.append(('RNDRUSDT','metrics',d,f'daily/metrics/RNDRUSDT/RNDRUSDT-metrics-{d}.zip'))
 for d in days('2024-07-26','2024-07-31'):
  data.append(('RENDERUSDT','metrics',d,f'daily/metrics/RENDERUSDT/RENDERUSDT-metrics-{d}.zip'))
 return data
def one(row):
 sym,kind,key,path=row
 url=BASE+path
 target=CACHE/path
 target.parent.mkdir(parents=True,exist_ok=True)
 name=target.name
 def fetch(url,max_bytes):
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'DisDex-Historical-Research-ReadOnly/1.0'}),timeout=18) as r:
   data=r.read(max_bytes+1)
  assert len(data)<max_bytes,(len(data),url)
  return data
 try:
  data=target.read_bytes() if target.exists() else fetch(url,8*1024*1024)
  h=hashlib.sha256(data).hexdigest()
  check=fetch(url+'.CHECKSUM',1024).decode('ascii').split()
  assert len(check)>=2 and check[0].lower()==h and check[1].lstrip('*')==name,('PUB_CHECKSUM_MISMATCH',row)
  with zipfile.ZipFile(io.BytesIO(data)) as z:
   assert z.testzip() is None,('CRC_ERROR',row)
   files=[f for f in z.namelist() if f.endswith('.csv')]
   assert len(files)==1
   with z.open(files[0]) as fd:
    lines=fd.read().decode('utf-8-sig').splitlines()
   assert len(lines)>1
  if not target.exists():
   temp=target.with_suffix('.partial')
   temp.write_bytes(data)
   temp.replace(target)
  return {'symbol':sym,'kind':kind,'key':key,'file':str(target),'sourceURL':url,
   'sha256':h,'publisherChecksumMatch':True,'zipCRC':True,'csvRows':len(lines)-1,
   'first':lines[1][:190],'last':lines[-1][:190],'bytes':len(data)}
 except urllib.error.HTTPError as e:
  return {'symbol':sym,'kind':kind,'key':key,'sourceURL':url,
   'missingStatus':f'HTTP_{e.code}','expected':False}
 except Exception as e:
  return {'symbol':sym,'kind':kind,'key':key,'sourceURL':url,
   'error':type(e).__name__+':'+str(e)[:180],'expected':True}
def main():
 requested=wants()
 results=[]
 print('ARCHIVES_TOTAL',len(requested),flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
  future={pool.submit(one,z):z for z in requested}
  for i,f in enumerate(concurrent.futures.as_completed(future),1):
   z=f.result()
   results.append(z)
   if i%35==0 or i==len(requested):
    print('DOWNLOADED',i,'GOOD',sum(x.get('publisherChecksumMatch',False) for x in results),
     'MISSING',sum('missingStatus' in x for x in results),
     'ERRORS',sum(x.get('error') is not None for x in results),flush=True)
 results.sort(key=lambda z:(z['kind'],z['symbol'],z['key']))
 def by(sym,kind):
  good=[x for x in results if x['symbol']==sym and x['kind']==kind and 'sha256' in x]
  return {'verified':len(good),'rows':sum(x['csvRows'] for x in good),
    'firstKey':good[0]['key'] if good else None,'lastKey':good[-1]['key'] if good else None}
 summ={f'{sym}_{kind}':by(sym,kind) for sym in ('RNDRUSDT','RENDERUSDT','BTCUSDT')
  for kind in ('klines5m','metrics','fundingRate')}
 output={'status':'OFFICIAL_CHECKSUM_VERIFIED_IF_ALL_SOURCES_VALID' if not any(x.get('error') for x in results) else 'SOME_SOURCE_ERRORS',
   'contractSplit':{'RNDRUSDTperpetualExpiryUtc':'2024-07-16T09:00:00Z',
    'RENDERUSDTperpetualListingUtc':'2024-07-26T10:00:00Z',
    'noSpliceAcrossGap':True,'fundingRateContractSpecific':True,'OIContractSpecific':True},
   'sourceBase':BASE,'requestedN':len(requested),'goodN':sum('sha256' in z for z in results),
   'missingN':sum('missingStatus' in z for z in results),
   'errorN':sum('error' in z for z in results),
   'summary':summ,'files':results}
 file=OUT/'RENDER_RNDR_2024_OFFICIAL_CROSS_CONTRACT_SOURCE_MANIFEST_20261024.json'
 file.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('FINAL',output['goodN'],output['missingN'],output['errorN'],'STATS',summ,'FILE',file)
if __name__=='__main__':main()
