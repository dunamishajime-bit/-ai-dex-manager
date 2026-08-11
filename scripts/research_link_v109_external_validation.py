from __future__ import annotations

import json, os, time, urllib.parse, urllib.request
from pathlib import Path

import research_lab_pair_specific_v109 as v109

HOUR=v109.HOUR
DAY=24*HOUR
YEAR=365*DAY
WARMUP=1000*HOUR
SYMS=v109.SYMS
NORMAL_BPS=v109.NORMAL_BPS
STRESS_BPS=v109.STRESS_BPS
KIND='regime_wave'


def get_json(url, tries=6):
    err=None
    for k in range(tries):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'disdex-research-link-v109/1.0'})
            with urllib.request.urlopen(req,timeout=30) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:
            err=e; time.sleep(min(8,1.2*(k+1)))
    raise RuntimeError(f'HTTP_FAIL:{url}:{err}')


def normalize(rows,start,end):
    d={int(r['ts']):r for r in rows if start<=int(r['ts'])<end}
    return [d[t] for t in sorted(d)]


def bybit_symbol(s): return f'{s}USDT'

def okx_symbol(s): return f'{s}-USDT-SWAP'


def fetch_bybit(s,start,end):
    rows=[]; cursor=end
    while cursor>start:
        q=urllib.parse.urlencode({'category':'linear','symbol':bybit_symbol(s),'interval':'60','start':start,'end':cursor-1,'limit':1000})
        d=get_json('https://api.bybit.com/v5/market/kline?'+q)
        if d.get('retCode')!=0: raise RuntimeError(f'BYBIT:{s}:{d}')
        xs=d.get('result',{}).get('list',[])
        if not xs: break
        batch=[]
        for x in xs:
            ts=int(x[0])
            batch.append({'ts':ts,'open':x[1],'high':x[2],'low':x[3],'close':x[4],'volume':x[5] if len(x)>5 else '0'})
        rows.extend(batch)
        oldest=min(int(r['ts']) for r in batch)
        if oldest>=cursor: break
        cursor=oldest
        if oldest<=start: break
        time.sleep(.04)
    return normalize(rows,start,end)


def fetch_okx(s,start,end):
    rows=[]; cursor=end
    while cursor>start:
        q=urllib.parse.urlencode({'instId':okx_symbol(s),'bar':'1H','after':cursor,'limit':300})
        d=get_json('https://www.okx.com/api/v5/market/history-candles?'+q)
        if d.get('code')!='0': raise RuntimeError(f'OKX:{s}:{d}')
        xs=d.get('data',[])
        if not xs: break
        batch=[]
        for x in xs:
            ts=int(x[0])
            if len(x)>=9 and str(x[8])!='1':
                continue
            batch.append({'ts':ts,'open':x[1],'high':x[2],'low':x[3],'close':x[4],'volume':x[5] if len(x)>5 else '0'})
        if not batch: break
        rows.extend(batch)
        oldest=min(int(r['ts']) for r in batch)
        if oldest>=cursor: break
        cursor=oldest
        if oldest<=start: break
        time.sleep(.06)
    return normalize(rows,start,end)


def cache_file(venue,s,start,end):
    p=Path('.cache/link-v109-external');p.mkdir(parents=True,exist_ok=True)
    return p/f'{venue}-{s}-{start}-{end}.json'


def load_venue(venue,start,end):
    # Fetch extra past-only history solely so the frozen feature lookbacks are populated
    # from the first target-window bar. Metrics remain restricted to [start,end).
    fetch_start=start-WARMUP
    candles={}
    fetcher=fetch_bybit if venue=='BYBIT' else fetch_okx
    for s in SYMS:
        p=cache_file(venue,s,fetch_start,end)
        if p.exists():
            rows=json.loads(p.read_text())
        else:
            rows=fetcher(s,fetch_start,end);p.write_text(json.dumps(rows))
        candles[s]=rows
    idx={s:{int(r['ts']):i for i,r in enumerate(candles[s])} for s in SYMS}
    expected=(end-start)//HOUR
    coverage={s:sum(start<=int(r['ts'])<end for r in candles[s])/expected if expected else 0 for s in SYMS}
    warmup={s:sum(fetch_start<=int(r['ts'])<start for r in candles[s]) for s in SYMS}
    return candles,idx,coverage,warmup


def shifted_periods(ps,shift):
    return {k:(v[0]+shift,v[1]+shift) if isinstance(v,(list,tuple)) and len(v)==2 else v for k,v in ps.items()}


def section_metrics(model,candles,idx,period):
    n,_=v109.pair_trades(KIND,'LINK',candles,idx,*period,NORMAL_BPS,0,model)
    s,_=v109.pair_trades(KIND,'LINK',candles,idx,*period,STRESS_BPS,1,model)
    return {'normal':v109.metric(n),'stress':v109.metric(s)}


def evaluate_model(model,candles,idx,ps):
    out={}
    for k in ('development','validation','confirmation','holdout'):
        out[k]=section_metrics(model,candles,idx,ps[k])
    whole=(ps['development'][0],ps['holdout'][1])
    out['year']=section_metrics(model,candles,idx,whole)
    return out


def main():
    # Reconstruct the exact current LINK REGIME_WAVE model using Binance Development only.
    bin_c,bin_i,_=v109.b.base.load(); cur=v109.b.base.periods(bin_c)
    frozen=v109.train(KIND,'LINK',bin_c,bin_i,*cur['development'])
    frozen_summary={'threshold':frozen['threshold'],'trainStart':frozen['trainStart'],'trainEnd':frozen['trainEnd'],'mu':frozen['mu'],'sd':frozen['sd'],'w':frozen['w']}
    start=cur['development'][0]; end=cur['holdout'][1]
    prior_start=start-YEAR; prior_end=end-YEAR; prior=shifted_periods(cur,-YEAR)
    result={'strategyId':'LINK_V109_REGIME_WAVE_EXTERNAL_VALIDATION','currentWindow':[start,end],'priorWindow':[prior_start,prior_end],'frozenModel':frozen_summary,'venues':{},'notes':['same-period external venue uses the exact Binance-Development-frozen model','prior-period replication uses the exact same architecture/training procedure but trains only inside that prior Development period; no current/future period is used','venue downloads include 1000 hours of past-only warmup; all metrics remain restricted to the declared target windows']}
    for venue in ('BYBIT','OKX'):
        cur_c,cur_i,cur_cov,cur_warm=load_venue(venue,start,end)
        venue_result={'coverageCurrent':cur_cov,'warmupCurrentHours':cur_warm}
        if min(cur_cov.values())<.97 or min(cur_warm.values())<900:
            venue_result['currentStatus']='DATA_INSUFFICIENT'
        else:
            venue_result['currentFrozenModel']=evaluate_model(frozen,cur_c,cur_i,cur)
            venue_result['currentStatus']='OK'
        pre_c,pre_i,pre_cov,pre_warm=load_venue(venue,prior_start,prior_end)
        venue_result['coveragePrior']=pre_cov;venue_result['warmupPriorHours']=pre_warm
        if min(pre_cov.values())<.97 or min(pre_warm.values())<900:
            venue_result['priorStatus']='DATA_INSUFFICIENT'
        else:
            prior_model=v109.train(KIND,'LINK',pre_c,pre_i,*prior['development'])
            venue_result['priorModel']={'threshold':prior_model['threshold'],'trainStart':prior_model['trainStart'],'trainEnd':prior_model['trainEnd']}
            venue_result['priorCausalReplication']=evaluate_model(prior_model,pre_c,pre_i,prior)
            venue_result['priorStatus']='OK'
        result['venues'][venue]=venue_result
    verdict='PASS_EXTERNAL_REPLICATION'
    for venue,vr in result['venues'].items():
        if vr.get('currentStatus')!='OK' or vr.get('priorStatus')!='OK': verdict='INCOMPLETE_DATA'; continue
        for block in (vr['currentFrozenModel'],vr['priorCausalReplication']):
            y=block['year']['normal']; h=block['holdout']['normal']
            if (y.get('returnPct') or 0)<=0 or (y.get('pf') or 0)<=1 or (h.get('returnPct') or 0)<=0 or (h.get('pf') or 0)<=1:
                verdict='FAIL_EXTERNAL_REPLICATION'
    result['verdict']=verdict
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state'));out.mkdir(parents=True,exist_ok=True)
    txt=json.dumps(result,indent=2)
    (out/'link-v109-external-validation.json').write_text(txt,encoding='utf-8')
    (out/'link-v109-external-validation.md').write_text('# LINK V109 External Validation\n\n```json\n'+txt+'\n```\n',encoding='utf-8')
    print(txt)

if __name__=='__main__': main()
