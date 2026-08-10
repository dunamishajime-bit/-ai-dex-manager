import json
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

base='https://api-futures.kucoin.com/api/v1/kline/query'
tests=[
 ('ms60',{'symbol':'PENGUUSDTM','granularity':60,'from':1786233600000,'to':1786237200000}),
 ('ms3600',{'symbol':'PENGUUSDTM','granularity':3600,'from':1786233600000,'to':1786320000000}),
 ('sec60',{'symbol':'PENGUUSDTM','granularity':60,'from':1786233600,'to':1786237200}),
 ('sec3600',{'symbol':'PENGUUSDTM','granularity':3600,'from':1786233600,'to':1786320000}),
]
for name,p in tests:
 u=base+'?'+urlencode(p)
 try:
  with urlopen(Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=20) as r:
   body=r.read().decode(); print(name,r.status,body[:500])
 except HTTPError as e:
  print(name,'HTTP',e.code,e.read().decode()[:500])
 except Exception as e: print(name,'ERR',repr(e))
