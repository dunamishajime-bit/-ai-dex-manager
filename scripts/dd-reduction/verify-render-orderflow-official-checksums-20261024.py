#!/usr/bin/env python3
"""Verify downloaded research archives against publisher's SHA256 CHECKSUM.
Does not redownload binaries or modify existing ZIP archives.
"""
import concurrent.futures,hashlib,json,re,time,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/research/results/render-orderflow-20261024'
source=json.loads((BASE/'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json').read_text('utf8'))
def verify(item):
 url=item['url']+'.CHECKSUM';name=Path(item['file']).name
 error=None
 for attempt in range(3):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'DisDex-Research-ReadOnly/1.0'}),timeout=18) as res:
    data=res.read(500).decode('ascii').strip()
   fields=data.split()
   assert len(fields)>=2 and re.fullmatch('[a-fA-F0-9]{64}',fields[0]),('INVALID_REMOTE_SHA',data[:200])
   assert fields[1].strip('*')==name,('WRONG_FILENAME',fields[1],name)
   remote=fields[0].lower();local=item['sha256'].lower()
   return {'kind':item['kind'],'key':item['key'],'remoteSha256':remote,
    'matchesOfficial':remote==local,'sourceChecksumURL':url}
  except Exception as e:
   error=type(e).__name__+':'+str(e)[:140];time.sleep(.6*(attempt+1))
 return {'kind':item['kind'],'key':item['key'],'matchesOfficial':False,'error':error}
def main():
 result=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
  for n,x in enumerate(pool.map(verify,source['files']),1):
   result.append(x)
   if n%100==0:print('CHECKSUM',n,'/',len(source['files']),
    'OK',sum(z['matchesOfficial'] for z in result),flush=True)
 ok=sum(z['matchesOfficial'] for z in result)
 report={'status':'OFFICIAL_CHECKSUM_PARITY_VERIFIED' if ok==len(result) else 'FAILED_OFFICIAL_CHECKSUM_PARITY',
  'filesChecked':len(result),'matching':ok,'failed':len(result)-ok,
  'failures':[x for x in result if not x['matchesOfficial']],
  'publisher':'https://data.binance.vision','sourceManifest':'RENDER_ORDERFLOW_SOURCE_MANIFEST_20261024.json',
  'checksums':result}
 p=BASE/'RENDER_ORDERFLOW_PUBLISHER_CHECKSUM_PARITY_20261024.json'
 p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print('RESULT',report['status'],'MATCHED',ok,'FAILED',len(result)-ok,'EVIDENCE',p)
if __name__=='__main__':main()
