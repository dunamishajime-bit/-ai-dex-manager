#!/usr/bin/env python3
"""Acquire genuinely uninspected 2026-Sep/Oct RENDERUSDT/BTCUSDT futures M5,
RENDER OI metrics, Sep funding from Binance Vision, Oct historical funding from
public Binance FAPI. ZERO orders, no account credentials. Strict official
publishing SHA256 + ZIP CRC for all static vision files.
"""
from __future__ import annotations
import concurrent.futures,datetime as dt,hashlib,json,urllib.request
from pathlib import Path
from importlib import util
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OUT=ROOT/'docs/research/results/render-three-regime-20261024'
spec=util.spec_from_file_location('archivehelper',HERE/'acquire-render-rndr-2024-history-20261024.py')
dl=util.module_from_spec(spec);spec.loader.exec_module(dl)
dl.CACHE=Path('C:/tmp/render-2026-aug-oct-research-20261024')
dl.CACHE.mkdir(exist_ok=True,parents=True)
def want():
 v=[]
 for sym in ('RENDERUSDT','BTCUSDT'):
  v.append((sym,'klines5m','2026-09',f'monthly/klines/{sym}/5m/{sym}-5m-2026-09.zip'))
 v.append(('RENDERUSDT','fundingRate','2026-09','monthly/fundingRate/RENDERUSDT/RENDERUSDT-fundingRate-2026-09.zip'))
 for day in dl.days('2026-09-01','2026-10-22'):
  v.append(('RENDERUSDT','metrics',day,f'daily/metrics/RENDERUSDT/RENDERUSDT-metrics-{day}.zip'))
 for day in dl.days('2026-10-01','2026-10-22'):
  for sym in ('RENDERUSDT','BTCUSDT'):
   v.append((sym,'klines5m',day,f'daily/klines/{sym}/5m/{sym}-5m-{day}.zip'))
 return v
def funding():
 # Official public Binance FAPI endpoint; not a signed user account call.
 u='https://fapi.binance.com/fapi/v1/fundingRate?symbol=RENDERUSDT&startTime=1790812800000&endTime=1792713600000&limit=300'
 request=urllib.request.Request(u,headers={'User-Agent':'DisDex-Historic-Public-Research/1.0'})
 with urllib.request.urlopen(request,timeout=20) as resp: raw=resp.read(2*1024*1024)
 data=json.loads(raw)
 assert isinstance(data,list) and 100<=len(data)<=300
 times=[int(z['fundingTime']) for z in data]
 assert all(times[i]<times[i+1] for i in range(len(times)-1))
 assert times[0]>=1790812800000 and times[-1]<1792713600000
 assert all(z['symbol']=='RENDERUSDT' for z in data)
 return {'source':'Public Binance Futures FAPI /fapi/v1/fundingRate',
  'requestURL':u,'rawResponseSHA256':hashlib.sha256(raw).hexdigest(),
  'count':len(data),'first':times[0],'last':times[-1],
  'rows':[[int(z['fundingTime']),float(z['fundingRate'])] for z in data]}
def main():
 rows=want()
 results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
  fs=[executor.submit(dl.one,z) for z in rows]
  for f in concurrent.futures.as_completed(fs):
   results.append(f.result())
 results.sort(key=lambda x:(x['kind'],x['symbol'],x['key']))
 bad=[x for x in results if not x.get('publisherChecksumMatch')]
 print('VISION_VERIFIED',len(results)-len(bad),'OF',len(results),'BAD',
  [(x['kind'],x['key'],x.get('error'),x.get('missingStatus')) for x in bad[:10]],flush=True)
 pubfund=funding()
 print('OCT_FUNDING_FAPI',pubfund['count'],pubfund['first'],pubfund['last'],flush=True)
 src={'status':'HOLDOUT_INPUTS_READY' if not bad else 'MISSING_INPUT_DO_NOT_BACKTEST',
   'staticPublisherChecksumVerified':len(results)-len(bad),'staticRequested':len(rows),
   'staticBad':len(bad),'historyBoundary':{'start':'2026-08-10','maxEntryEnd':'2026-10-21',
   'noUseBeyond':'2026-10-23T00:00:00Z'},
   'fundingOctoberPublicApi':pubfund,'files':results,
   'warnings':['Historical period not used in model discovery up to Aug10; first recheck now Oct24',
    'Binance Vision official ZIP SHA+CRC, separate public funding API response SHA.',
    'Public Binance futures proxy is NOT Aster realized order venue']}
 path=OUT/'RENDER_POST_2026AUG_HELDOUT_PUBLIC_SOURCE_MANIFEST_20261024.json'
 path.write_text(json.dumps(src,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('OUTPUT',path,'STATUS',src['status'])
if __name__=='__main__':main()
