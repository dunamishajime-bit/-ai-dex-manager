"""Fetch research-only Aster H1 holdout data and verify overlap parity.

This script never writes to the frozen baseline. It fetches public, unauthenticated
Aster klines into a separate research directory and requires historical OHLC parity
on 2026-06-01..2026-08-10 before later data can be used as untouched holdout.
"""
from __future__ import annotations
import datetime as dt, json, math, time, urllib.parse, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/research/results/v12-untouched-holdout-20261008'
DATA=OUT/'data'/'klines'
FROZEN=Path(r'C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\market-Aster-H1-funding-and-manifests\normalized\aster\klines')
BASE='https://fapi.asterdex.com'
H=3_600_000
START=int(dt.datetime(2026,6,1,tzinfo=dt.timezone.utc).timestamp()*1000)
HOLDOUT=int(dt.datetime(2026,8,11,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2026,10,8,tzinfo=dt.timezone.utc).timestamp()*1000)
SYMS=['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','LINKUSDT','AVAXUSDT','DOGEUSDT','INJUSDT','XRPUSDT','ADAUSDT','LTCUSDT','ATOMUSDT','AAVEUSDT','NEARUSDT']

def req(path,params):
    url=BASE+path+'?'+urllib.parse.urlencode(params)
    r=urllib.request.Request(url,headers={'User-Agent':'DisDex-V12-Untouched-Holdout/1.0'})
    err=None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(r,timeout=30) as f:
                return json.loads(f.read().decode())
        except Exception as e:
            err=e
            if attempt<5: time.sleep(1.0*(attempt+1))
    raise RuntimeError(f'GET failed {url}: {err}')

def fetch(sym):
    rows=[]; cur=START
    while cur<END:
        p=req('/fapi/v1/klines',{'symbol':sym,'interval':'1h','startTime':cur,'endTime':END-1,'limit':1500})
        if not isinstance(p,list) or not p: break
        rows.extend(x for x in p if isinstance(x,list) and len(x)>=8)
        nxt=int(p[-1][0])+H
        if nxt<=cur: raise RuntimeError(f'non advancing {sym} {cur}')
        cur=nxt
        if len(p)<1500: break
        time.sleep(.12)
    ded={int(x[0]):x for x in rows}
    out=[]
    for t in sorted(ded):
        x=ded[t]
        if not START<=t<END: continue
        out.append({
          'base_volume':float(x[5]),'close':float(x[4]),'close_time_ms':int(x[6]),
          'event_time_ms':t,'exchange':'ASTER','high':float(x[2]),'instrument':sym,
          'interval':'1h','low':float(x[3]),'open':float(x[1]),
          'quote_volume':float(x[7]),'source':'aster-public-refetch-20261008'
        })
    return out

def load(path):
    return {int(x['event_time_ms']):x for x in (json.loads(z) for z in path.read_text(encoding='utf-8').splitlines() if z.strip())}

def parity(sym,new):
    old=load(FROZEN/f'{sym}.jsonl')
    newm={x['event_time_ms']:x for x in new}
    exp=[t for t in old if START<=t<HOLDOUT]
    common=sorted(set(exp)&set(newm))
    miss_old=sorted(set(exp)-set(newm)); extra=sorted(t for t in newm if START<=t<HOLDOUT and t not in old)
    bad=[]; max_abs={k:0.0 for k in ['open','high','low','close','base_volume','quote_volume']}
    for t in common:
        a,b=old[t],newm[t]
        rowbad={}
        for k in max_abs:
            av=float(a[k]);bv=float(b[k]);d=abs(av-bv);max_abs[k]=max(max_abs[k],d)
            tol=max(1e-12,abs(av)*1e-12)
            if d>tol: rowbad[k]={'old':av,'new':bv,'abs':d}
        if rowbad and len(bad)<20: bad.append({'t':t,'diff':rowbad})
    # Price OHLC parity is the hard gate. Volume revisions are reported separately.
    price_bad=0; vol_bad=0
    for t in common:
        a,b=old[t],newm[t]
        if any(abs(float(a[k])-float(b[k]))>max(1e-12,abs(float(a[k]))*1e-12) for k in ['open','high','low','close']): price_bad+=1
        if any(abs(float(a[k])-float(b[k]))>max(1e-12,abs(float(a[k]))*1e-12) for k in ['base_volume','quote_volume']): vol_bad+=1
    return {
      'expected_overlap_rows':len(exp),'common_rows':len(common),'missing_rows':len(miss_old),'extra_rows':len(extra),
      'price_mismatch_rows':price_bad,'volume_mismatch_rows':vol_bad,'max_abs_diff':max_abs,
      'sample_mismatches':bad,'pass_price_parity':not miss_old and price_bad==0
    }

def main():
    DATA.mkdir(parents=True,exist_ok=True)
    report={'research_only':True,'frozen_source':str(FROZEN),'public_endpoint':BASE+'/fapi/v1/klines',
      'fetch_start_utc':'2026-06-01T00:00:00Z','untouched_holdout_start_utc':'2026-08-11T00:00:00Z',
      'fetch_end_exclusive_utc':'2026-10-08T00:00:00Z','symbols':{},'hard_gate':'OHLC exact/float-roundoff parity plus no missing overlap rows'}
    for i,sym in enumerate(SYMS,1):
        print('FETCH',i,len(SYMS),sym,flush=True)
        rows=fetch(sym)
        (DATA/f'{sym}.jsonl').write_text(''.join(json.dumps(x,separators=(',',':'),sort_keys=True)+'\n' for x in rows),encoding='utf-8')
        pr=parity(sym,rows)
        pr['fetched_rows']=len(rows)
        pr['holdout_rows']=sum(HOLDOUT<=x['event_time_ms']<END for x in rows)
        report['symbols'][sym]=pr
        (OUT/'parity-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print('PARITY',sym,pr['pass_price_parity'],'common',pr['common_rows'],'price_bad',pr['price_mismatch_rows'],'vol_bad',pr['volume_mismatch_rows'],'holdout',pr['holdout_rows'],flush=True)
        time.sleep(.15)
    report['all_price_parity_pass']=all(x['pass_price_parity'] for x in report['symbols'].values())
    report['all_have_holdout']=all(x['holdout_rows']>0 for x in report['symbols'].values())
    report['status']='PASS_FETCH_AND_PRICE_PARITY' if report['all_price_parity_pass'] and report['all_have_holdout'] else 'BLOCKED_PARITY_OR_COVERAGE'
    (OUT/'parity-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('FINAL',report['status'],flush=True)
    if report['status']!='PASS_FETCH_AND_PRICE_PARITY': raise SystemExit(2)

if __name__=='__main__': main()
