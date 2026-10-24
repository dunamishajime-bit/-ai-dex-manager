#!/usr/bin/env python3
"""Fetch ONLY public Binance Futures USD-M monthly M5 klines for older-period research.
Isolated C:/tmp scratch, never production datasets. Verify HTTPS, ZIP CRC, local SHA.
No keys, trades, venue credentials, or LIVE configuration used.
"""
import datetime,hashlib,json,os,time,urllib.request,urllib.error,zipfile
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
OUT=Path('C:/tmp/idle-render-independent-older-m5-20261024')
MANIFEST=REPO/'docs/research/results/idle-entry-three-20261024/IDLE_RENDER_OLDER_BINANCE_PUBLIC_M5_SOURCE_MANIFEST_20261024.json'
END_MONTH=datetime.date(2025,8,1)
BASE='https://data.binance.vision/data/futures/um/monthly/klines'
def months(start,end):
 year,month=start.year,start.month
 while (year,month)<(end.year,end.month):
  yield f'{year}-{month:02}'
  year=year+1 if month==12 else year
  month=1 if month==12 else month+1
def fetch(sym,month):
 relative=f'{sym}/5m/{sym}-5m-{month}.zip'
 url=BASE+'/'+relative
 dest=OUT/relative
 dest.parent.mkdir(parents=True,exist_ok=True)
 if not dest.exists():
  last_error=None
  for attempt in (1,2):
   try:
    req=urllib.request.Request(url,headers={'User-Agent':'DisDex-Research-Public-Historical-Bars/1.0'})
    with urllib.request.urlopen(req,timeout=18) as r:
     if r.status!=200:raise RuntimeError(('PUBLIC_READ_HTTP',r.status))
     data=r.read()
    if not 1000<len(data)<15000000:raise RuntimeError(('PUBLIC_ARCHIVE_SIZE_OUTSIDE_EXPECTED',sym,month,len(data)))
    part=dest.with_suffix('.zip.partial')
    part.write_bytes(data)
    os.replace(part,dest)
    break
   except urllib.error.HTTPError as ex:
    if ex.code==404:return {'symbol':sym,'month':month,'available':False,'status':404,'url':url}
    last_error=ex
   except Exception as ex:last_error=ex
   time.sleep(attempt)
  else:raise RuntimeError(('PUBLIC_ARCHIVE_UNAVAILABLE',sym,month,str(last_error)))
 digest=hashlib.sha256(dest.read_bytes()).hexdigest()
 with zipfile.ZipFile(dest) as z:
  bad=z.testzip()
  assert bad is None,('CORRUPT_ARCHIVE',dest,bad)
  members=[x for x in z.namelist() if x.endswith('.csv')]
  assert len(members)==1,('PUBLIC_CSV_MISSING',dest,z.namelist())
  first=None;last=None;count=0
  with z.open(members[0]) as raw:
   for line in raw:
    if not line[:1].isdigit():continue
    val=line.split(b',',1)[0];stamp=int(val)
    if first is None:first=stamp
    last=stamp;count+=1
  assert count>3000 and first is not None and last>first,(sym,month,count)
 report={'symbol':sym,'month':month,'available':True,'url':url,
     'size':dest.stat().st_size,'sha256':digest,'file':str(dest),
     'firstBarMs':first,'lastBarMs':last,'bars':count,'zipCrcPass':True}
 print('SOURCE_PASS',sym,month,'BARS',count,'SHA',digest[:16],flush=True)
 return report
def main():
 data={'status':'BINANCE_PUBLIC_USDM_M5_DOWNLOADED_VALIDATED_NOT_VENUE_SIGNED',
   'startMonth':'2024-08','endMonthExclusive':'2025-08',
   'symbols':['BTCUSDT','RENDERUSDT'],'files':[],'notes':[
       'Exchange-hosted published monthly historical archives are source data, not venue order certification.',
       'Files are for isolated pre-2025-08 research, no overlap with 2025-08-10 to 2026-08-10 strategy optimization.']}
 for sym in data['symbols']:
  for mon in months(datetime.date(2024,8,1),END_MONTH):
   x=fetch(sym,mon);data['files'].append(x)
   if not x['available']:print('SOURCE_ABSENT',sym,mon,flush=True)
 MANIFEST.parent.mkdir(parents=True,exist_ok=True)
 MANIFEST.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
 print('COMPLETE',len(data['files']),'AVAILABLE',sum(x['available'] for x in data['files']),
    'MANIFEST',MANIFEST,flush=True)
if __name__=='__main__':main()
