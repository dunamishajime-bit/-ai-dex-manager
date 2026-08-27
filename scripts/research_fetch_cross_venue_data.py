import json, os, time, urllib.parse, urllib.request
from pathlib import Path

HOUR=3_600_000
WARM=int(os.environ.get('PENGU_CROSS_WARM_MS','1778803200000'))  # 2026-05-15 UTC
START=int(os.environ.get('PENGU_CROSS_START_MS','1780272000000')) # 2026-06-01 UTC
END=int(os.environ.get('PENGU_CROSS_END_MS','1786320000000'))     # 2026-08-10 UTC
VENUE=os.environ['PENGU_CROSS_VENUE'].upper()
OUT=Path(os.environ.get('PENGU_LOCAL_DATA_DIR','.research-state/cross-input'))
OUT.mkdir(parents=True,exist_ok=True)

def get(url, params, tries=6):
    q=url+'?'+urllib.parse.urlencode(params)
    last=None
    for i in range(tries):
        try:
            req=urllib.request.Request(q,headers={'Accept':'application/json','User-Agent':'DisDex-PENGU-CrossVenue/1.0'})
            with urllib.request.urlopen(req,timeout=30) as r: return json.loads(r.read().decode())
        except Exception as e:
            last=e; time.sleep(.5*(i+1))
    raise RuntimeError(f'{VENUE} request failed {q}: {last}')

def candle_obj(r):
    ts=int(r[0]); return {'openTime':ts,'open':float(r[1]),'high':float(r[2]),'low':float(r[3]),'close':float(r[4]),'volume':float(r[5]),'closeTime':ts+HOUR-1}

def okx_candles(inst):
    by={}; cursor=END
    for _ in range(150):
        p=get('https://www.okx.com/api/v5/market/history-candles',{'instId':inst,'bar':'1H','after':str(cursor),'limit':'100'})
        if p.get('code')!='0': raise RuntimeError(str(p)[:500])
        rows=p.get('data') or []
        if not rows: break
        vals=[]
        for r in rows:
            c=candle_obj(r); vals.append(c['openTime'])
            if WARM<=c['openTime']<END and (len(r)<9 or str(r[8])=='1'): by[c['openTime']]=c
        old=min(vals); cursor=old-1
        if old<=WARM: break
        time.sleep(.08)
    return sorted(by.values(),key=lambda x:x['openTime'])

def okx_funding(inst):
    by={}; cursor=END
    for _ in range(20):
        p=get('https://www.okx.com/api/v5/public/funding-rate-history',{'instId':inst,'after':str(cursor),'limit':'400'})
        if p.get('code')!='0': raise RuntimeError(str(p)[:500])
        rows=p.get('data') or []
        if not rows: break
        vals=[]
        for r in rows:
            ts=int(r['fundingTime']); vals.append(ts)
            if START<=ts<END: by[ts]={'fundingTime':ts,'fundingRate':float(r.get('realizedRate') or r['fundingRate'])}
        old=min(vals); cursor=old-1
        if old<=START: break
        time.sleep(.12)
    return sorted(by.values(),key=lambda x:x['fundingTime'])

def bitget_candles(symbol):
    by={}; cursor=END-1
    for _ in range(100):
        chunk_start=max(WARM,cursor-199*HOUR)
        p=get('https://api.bitget.com/api/v2/mix/market/history-candles',{'symbol':symbol,'productType':'USDT-FUTURES','granularity':'1H','startTime':str(chunk_start),'endTime':str(cursor),'limit':'200'})
        if p.get('code')!='00000': raise RuntimeError(str(p)[:500])
        rows=p.get('data') or []
        if not rows:
            if chunk_start<=WARM: break
            cursor=chunk_start-1; continue
        vals=[]
        for r in rows:
            c=candle_obj(r); vals.append(c['openTime'])
            if WARM<=c['openTime']<END: by[c['openTime']]=c
        old=min(vals); cursor=old-1
        if old<=WARM: break
        time.sleep(.08)
    return sorted(by.values(),key=lambda x:x['openTime'])

def bitget_funding(symbol):
    by={}
    for page in range(1,80):
        p=get('https://api.bitget.com/api/v2/mix/market/history-fund-rate',{'symbol':symbol,'productType':'USDT-FUTURES','pageSize':'100','pageNo':str(page)})
        if p.get('code')!='00000': raise RuntimeError(str(p)[:500])
        rows=p.get('data') or []
        if not rows: break
        oldest=10**30
        for r in rows:
            ts=int(r['fundingTime']); oldest=min(oldest,ts)
            if START<=ts<END: by[ts]={'fundingTime':ts,'fundingRate':float(r['fundingRate'])}
        if oldest<=START: break
        time.sleep(.08)
    return sorted(by.values(),key=lambda x:x['fundingTime'])

if VENUE=='OKX':
    pengu=okx_candles('PENGU-USDT-SWAP'); btc=okx_candles('BTC-USDT-SWAP'); funding=okx_funding('PENGU-USDT-SWAP')
elif VENUE=='BITGET':
    pengu=bitget_candles('PENGUUSDT'); btc=bitget_candles('BTCUSDT'); funding=bitget_funding('PENGUUSDT')
else: raise SystemExit('unsupported venue')

if len(pengu)<1500 or len(btc)<1500: raise RuntimeError(f'insufficient candles: PENGU={len(pengu)} BTC={len(btc)}')
# Full hourly overlap is required across the evaluation interval.
ps={x['openTime'] for x in pengu}; bs={x['openTime'] for x in btc}
expected=list(range(START,END,HOUR)); missing=[t for t in expected if t not in ps or t not in bs]
if missing: raise RuntimeError(f'missing evaluation hourly bars={len(missing)} first={missing[:3]}')
if not funding: raise RuntimeError('no venue funding rows in evaluation interval')
(OUT/'PENGUUSDT-candles.json').write_text(json.dumps(pengu))
(OUT/'BTCUSDT-candles.json').write_text(json.dumps(btc))
(OUT/'PENGUUSDT-funding.json').write_text(json.dumps(funding))
meta={'venue':VENUE,'warmMs':WARM,'startMs':START,'endMs':END,'penguRows':len(pengu),'btcRows':len(btc),'fundingRows':len(funding),'firstPengu':pengu[0]['openTime'],'lastPengu':pengu[-1]['openTime'],'firstFunding':funding[0]['fundingTime'],'lastFunding':funding[-1]['fundingTime']}
(OUT/'meta.json').write_text(json.dumps(meta,indent=2))
print('CROSS_DATA='+json.dumps(meta,separators=(',',':')))
