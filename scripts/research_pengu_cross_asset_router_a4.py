#!/usr/bin/env python3
import argparse, csv, json, math, time, urllib.parse, urllib.request
from collections import defaultdict
from pathlib import Path
from statistics import mean

HOUR=3_600_000
BASE_URL='https://fapi.asterdex.com'
FEE=0.0006
STRESS_SLIP=0.0035
UNIVERSE=['PENGUUSDT','ETHUSDT','SOLUSDT','BNBUSDT','LINKUSDT','AVAXUSDT','DOGEUSDT','XRPUSDT']
BTC='BTCUSDT'
SHORT={'maxHold':72,'hard':0.08,'activation':0.15,'retrace':0.04}
LONG={'maxHold':120,'hard':0.08,'activation':0.10,'retrace':0.03}


def fetch_json(path, params, retries=6):
    url=BASE_URL+path+'?'+urllib.parse.urlencode(params)
    last=None
    for attempt in range(retries):
        try:
            req=urllib.request.Request(url,headers={'accept':'application/json','user-agent':'DisDex-A4-CrossAsset-Router/1.0'})
            with urllib.request.urlopen(req,timeout=30) as r:
                payload=json.loads(r.read().decode())
            if not isinstance(payload,list): raise RuntimeError(f'non-list response {url}: {str(payload)[:200]}')
            return payload
        except Exception as e:
            last=e; time.sleep(0.5*(attempt+1))
    raise RuntimeError(f'download failed {url}: {last}')


def download_candles(symbol,start,end):
    out={}; cursor=start
    while cursor<end:
        batch=fetch_json('/fapi/v3/klines',{'symbol':symbol,'interval':'1h','startTime':cursor,'endTime':end-1,'limit':1500})
        if not batch: break
        for x in batch:
            ts=int(x[0])
            if start<=ts<end:
                out[ts]={'ts':ts,'open':float(x[1]),'high':float(x[2]),'low':float(x[3]),'close':float(x[4]),'volume':float(x[5])}
        nxt=int(batch[-1][0])+HOUR
        if nxt<=cursor: raise RuntimeError(f'{symbol} pagination stalled')
        cursor=nxt; time.sleep(0.03)
    rows=[out[k] for k in sorted(out)]
    if not rows: raise RuntimeError(f'no candles {symbol}')
    return rows


def download_funding(symbol,start,end):
    out={}; cursor=start
    while cursor<end:
        batch=fetch_json('/fapi/v3/fundingRate',{'symbol':symbol,'startTime':cursor,'endTime':end-1,'limit':1000})
        if not batch: break
        for x in batch:
            ts=int(x['fundingTime']); rate=float(x['fundingRate'])
            if start<=ts<end: out[ts]=rate
        nxt=int(batch[-1]['fundingTime'])+1
        if nxt<=cursor: raise RuntimeError(f'{symbol} funding pagination stalled')
        cursor=nxt; time.sleep(0.03)
    return sorted(out.items())


def ema(vals,span):
    alpha=2/(span+1); out=[]; cur=None
    for i,v in enumerate(vals):
        cur=v if cur is None else alpha*v+(1-alpha)*cur
        out.append(cur if i+1>=span else None)
    return out


def prepare(rows, btc_by):
    closes=[x['close'] for x in rows]
    e24=ema(closes,24); e72=ema(closes,72)
    by={x['ts']:i for i,x in enumerate(rows)}
    feats={}
    for i,x in enumerate(rows):
        if i<72 or x['ts'] not in btc_by: continue
        b=btc_by[x['ts']]
        b24=btc_by.get(x['ts']-24*HOUR)
        if not b24 or e24[i] is None or e72[i] is None: continue
        feats[x['ts']]={
            'ret6':x['close']/closes[i-6]-1,
            'ret24':x['close']/closes[i-24]-1,
            'ret72':x['close']/closes[i-72]-1,
            'rel24':(x['close']/closes[i-24]-1)-(b['close']/b24['close']-1),
            'trend24_72':e24[i]/e72[i]-1,
            'dist72':x['close']/e72[i]-1,
        }
    return by,feats


def percentile(values, val, higher=True):
    s=sorted(values)
    if len(s)==1:return 1.0
    less=sum(x<val for x in s); equal=sum(x==val for x in s)
    r=(less+(equal-1)/2)/(len(s)-1)
    return r if higher else 1-r


def ranks_at(ts, side, features):
    metrics=['ret6','ret24','ret72','rel24','trend24_72','dist72']
    available={s:features[s].get(ts) for s in UNIVERSE}
    if any(v is None for v in available.values()):
        missing=[s for s,v in available.items() if v is None]
        raise RuntimeError(f'missing features at {ts}: {missing}')
    out={}
    sign=1 if side=='L' else -1
    for sym,f in available.items():
        parts=[]
        for m in metrics:
            vals=[sign*available[s][m] for s in UNIVERSE]
            parts.append(percentile(vals,sign*f[m],True))
        out[sym]=sum(parts)/len(parts)
    return sorted(out.items(),key=lambda kv:(-kv[1],kv[0])),out


def funding_between(points,entry,exit_ts):
    return sum(rate for ts,rate in points if entry<ts<=exit_ts)


def simulate_leg(sym,side,event,alloc_gross,mode,candles_by,index_by,funding):
    rows=candles_by[sym]; idx=index_by[sym]
    entry_ts=int(event['entryTs']); virtual_exit=int(event['exitTs'])
    if entry_ts not in idx or virtual_exit not in idx:
        raise RuntimeError(f'{sym} missing entry/virtual exit {entry_ts}/{virtual_exit}')
    ei=idx[entry_ts]; vi=idx[virtual_exit]
    cfg=LONG if side=='L' else SHORT
    last=min(vi,ei+cfg['maxHold']-1,len(rows)-1)
    entry=rows[ei]['open']; best=entry; exit_price=None; exit_i=None; reason='virtual_clock'
    for j in range(ei,last+1):
        c=rows[j]
        if side=='L':
            hard=entry*(1-cfg['hard'])
            if c['low']<=hard:
                exit_price=hard; exit_i=j; reason='hard'; break
            trailing=best*(1-cfg['retrace'])
            if best/entry-1>=cfg['activation'] and c['low']<=trailing:
                exit_price=trailing; exit_i=j; reason='trail'; break
            best=max(best,c['high'])
        else:
            hard=entry*(1+cfg['hard'])
            if c['high']>=hard:
                exit_price=hard; exit_i=j; reason='hard'; break
            trailing=best*(1+cfg['retrace'])
            if entry/best-1>=cfg['activation'] and c['high']>=trailing:
                exit_price=trailing; exit_i=j; reason='trail'; break
            best=min(best,c['low'])
    if exit_i is None:
        exit_i=last; exit_price=rows[last]['close']; reason='virtual_clock' if last==vi else 'max_hold'
    exit_ts=rows[exit_i]['ts']
    raw=exit_price/entry-1 if side=='L' else entry/exit_price-1
    fr=funding_between(funding[sym],entry_ts,exit_ts)
    fund=-fr if side=='L' else fr
    cost=-2*(FEE+(STRESS_SLIP if mode=='SEVERE' else 0))
    unit=raw+fund+cost
    return {'symbol':sym,'side':side,'entryTs':entry_ts,'exitTs':exit_ts,'entryPrice':entry,'exitPrice':exit_price,'gross':alloc_gross,'raw':raw,'funding':fund,'cost':cost,'unitReturn':unit,'accountReturn':alloc_gross*unit,'exitReason':reason}


def metrics(event_returns, leg_returns):
    eq=1.0; peak=1.0; dd=0.0; gp=gl=0.0
    for r in event_returns:
        eq*=1+r; peak=max(peak,eq); dd=min(dd,eq/peak-1)
        if r>0: gp+=r
        elif r<0: gl-=r
    leg_gp=sum(r for r in leg_returns if r>0); leg_gl=-sum(r for r in leg_returns if r<0)
    return {
      'events':len(event_returns),'legs':len(leg_returns),'returnPct':(eq-1)*100,
      'eventWinRatePct':100*sum(r>0 for r in event_returns)/len(event_returns) if event_returns else None,
      'legWinRatePct':100*sum(r>0 for r in leg_returns)/len(leg_returns) if leg_returns else None,
      'profitFactor':gp/gl if gl>0 else None,'legProfitFactor':leg_gp/leg_gl if leg_gl>0 else None,
      'maxDrawdownPct':dd*100,
    }


def baseline_metrics(events):
    returns=[float(x['accountReturn']) for x in events]
    return metrics(returns,returns)


def run_period(name,payload,candles_by,index_by,features,funding):
    events=payload['modes']['normal']['trades']
    severe_events=payload['modes']['stress']['trades']
    if len(events)!=len(severe_events): raise RuntimeError('normal/stress event count mismatch')
    parity={}
    for mode,src in [('NORMAL',events),('SEVERE',severe_events)]:
        diffs=[]
        for e in src:
            leg=simulate_leg('PENGUUSDT',e['side'],e,float(e['requestedGross']),mode,candles_by,index_by,funding)
            diffs.append(abs(leg['accountReturn']-float(e['accountReturn'])))
        parity[mode]={'maxAbsAccountReturnDiff':max(diffs) if diffs else 0,'meanAbsDiff':mean(diffs) if diffs else 0}
        if parity[mode]['maxAbsAccountReturnDiff']>2e-6:
            raise RuntimeError(f'PENGU parity failed {name} {mode}: {parity[mode]}')

    variants={}; event_rows=[]; oracle_rows=[]
    for mode,src in [('NORMAL',events),('SEVERE',severe_events)]:
        buckets={k:[] for k in ['TOP1_ROUTE','TOP2_SPLIT','PENGU_ALT_SPLIT','DISPERSION_PAIR']}
        legb={k:[] for k in buckets}
        for n,e in enumerate(src):
            side=e['side']; gross=float(e['requestedGross']); signal_ts=int(e['signalTs'])
            ranking,scores=ranks_at(signal_ts,side,features)
            top1=ranking[0][0]; top2=ranking[1][0]
            best_alt=next(sym for sym,_ in ranking if sym!='PENGUUSDT')
            l1=simulate_leg(top1,side,e,gross,mode,candles_by,index_by,funding)
            l21=simulate_leg(top1,side,e,gross/2,mode,candles_by,index_by,funding)
            l22=simulate_leg(top2,side,e,gross/2,mode,candles_by,index_by,funding)
            lp=simulate_leg('PENGUUSDT',side,e,gross/2,mode,candles_by,index_by,funding)
            la=simulate_leg(best_alt,side,e,gross/2,mode,candles_by,index_by,funding)
            long_rank,_=ranks_at(signal_ts,'L',features)
            strongest=long_rank[0][0]; weakest=long_rank[-1][0]
            lg=simulate_leg(strongest,'L',e,gross/2,mode,candles_by,index_by,funding)
            sh=simulate_leg(weakest,'S',e,gross/2,mode,candles_by,index_by,funding)
            combos={'TOP1_ROUTE':[l1],'TOP2_SPLIT':[l21,l22],'PENGU_ALT_SPLIT':[lp,la],'DISPERSION_PAIR':[lg,sh]}
            for k,legs in combos.items():
                er=sum(x['accountReturn'] for x in legs); buckets[k].append(er); legb[k].extend(x['accountReturn'] for x in legs)
                if mode=='NORMAL':
                    event_rows.append({'period':name,'eventIndex':n+1,'variant':k,'signalTs':signal_ts,'side':side,'baselineReturn':float(e['accountReturn']),'eventReturn':er,'symbols':'+'.join(x['symbol'] for x in legs),'scores':'+'.join(f"{x['symbol']}:{scores.get(x['symbol'],float('nan')):.3f}" for x in legs),'legReturns':'+'.join(f"{100*x['accountReturn']:.4f}" for x in legs)})
            if mode=='NORMAL' and float(e['accountReturn'])<0:
                alllegs=[]
                for sym in UNIVERSE:
                    leg=simulate_leg(sym,side,e,gross,mode,candles_by,index_by,funding); alllegs.append((sym,leg['accountReturn']))
                positives=[x for x in alllegs if x[1]>0]; best=max(alllegs,key=lambda x:x[1])
                oracle_rows.append({'period':name,'eventIndex':n+1,'signalTs':signal_ts,'side':side,'baselineReturnPct':100*float(e['accountReturn']),'positiveSubstitutes':len(positives)-int(dict(alllegs)['PENGUUSDT']>0),'bestOracleSymbol':best[0],'bestOracleReturnPct':100*best[1],'entryKnownTop1':top1,'entryKnownTop1ReturnPct':100*l1['accountReturn'],'top1ConvertedToWin':l1['accountReturn']>0})
        variants[mode]={k:metrics(buckets[k],legb[k]) for k in buckets}
    base={'NORMAL':baseline_metrics(events),'SEVERE':baseline_metrics(severe_events)}
    return {'baseline':base,'variants':variants,'parity':parity,'events':len(events),'eventRows':event_rows,'oracleRows':oracle_rows}


def promotion(current,prior):
    b=current['baseline']['NORMAL']; out={}
    for k,v in current['variants']['NORMAL'].items():
        pv=prior['variants']['NORMAL'][k]; pb=prior['baseline']['NORMAL']
        checks={'currentEventCountPreserved':v['events']>=b['events'],'currentWinRatePlus5pp':v['eventWinRatePct']>=b['eventWinRatePct']+5,'currentReturnNotLower':v['returnPct']>=b['returnPct'],'currentPFNotLower':(v['profitFactor'] or 0)>=(b['profitFactor'] or 0),'currentDDNoWorse':v['maxDrawdownPct']>=b['maxDrawdownPct'],'priorWinRateNoWorse':pv['eventWinRatePct']>=pb['eventWinRatePct'],'priorReturnPositive':pv['returnPct']>0,'severeReturnPositive':current['variants']['SEVERE'][k]['returnPct']>0}
        out[k]={'promoted':all(checks.values()),'checks':checks}
    return out


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--current',required=True); ap.add_argument('--prior',required=True); ap.add_argument('--out',required=True)
    args=ap.parse_args(); outdir=Path(args.out); outdir.mkdir(parents=True,exist_ok=True)
    current=json.load(open(args.current)); prior=json.load(open(args.prior))
    all_events=current['modes']['normal']['trades']+prior['modes']['normal']['trades']
    start=min(int(x['signalTs']) for x in all_events)-200*HOUR; end=max(int(x['exitTs']) for x in all_events)+2*HOUR
    symbols=UNIVERSE+[BTC]; candles_by={}; index_by={}; funding={}
    for sym in symbols:
        rows=download_candles(sym,start,end); candles_by[sym]=rows; index_by[sym]={x['ts']:i for i,x in enumerate(rows)}; print('candles',sym,len(rows),flush=True)
    for sym in UNIVERSE:
        funding[sym]=download_funding(sym,start,end); print('funding',sym,len(funding[sym]),flush=True)
    btc_by={x['ts']:x for x in candles_by[BTC]}; features={}
    for sym in UNIVERSE:
        _,features[sym]=prepare(candles_by[sym],btc_by)
    cur=run_period('CURRENT_365D',current,candles_by,index_by,features,funding); pri=run_period('PRIOR',prior,candles_by,index_by,features,funding)
    promo=promotion(cur,pri); cur_losses=cur['oracleRows']; prior_losses=pri['oracleRows']
    diag={'currentBaselineLosses':len(cur_losses),'currentLossesWithAtLeastOneProfitableAlternative':sum(r['positiveSubstitutes']>0 for r in cur_losses),'currentEntryKnownTop1ConvertsLossToWin':sum(r['top1ConvertedToWin'] for r in cur_losses),'priorBaselineLosses':len(prior_losses),'priorLossesWithAtLeastOneProfitableAlternative':sum(r['positiveSubstitutes']>0 for r in prior_losses),'priorEntryKnownTop1ConvertsLossToWin':sum(r['top1ConvertedToWin'] for r in prior_losses)}
    result={'status':'PASS_RESEARCH_ONLY','schema':'pengu-a4-cross-asset-opportunity-router/v1','universe':UNIVERSE,'score':'equal-weight cross-sectional percentile of side-adjusted 6h/24h/72h return, 24h BTC-relative return, EMA24/EMA72 trend, close/EMA72 distance; no threshold filters; always routes','architecture':{'TOP1_ROUTE':'same PENGU opportunity clock and gross; route full gross to highest entry-known directional score','TOP2_SPLIT':'same opportunity clock/gross; split gross equally across top two directional scores','PENGU_ALT_SPLIT':'same opportunity clock/gross; half PENGU, half highest-ranked non-PENGU','DISPERSION_PAIR':'same opportunity clock/gross; half long strongest cross-sectional asset + half short weakest asset','exit':'candidate uses same side-specific hard/trailing/max-hold as PENGU; any remaining leg is closed by the observable virtual-PENGU exit clock so next opportunity count is preserved'},'current':{k:v for k,v in cur.items() if k not in ('eventRows','oracleRows')},'prior':{k:v for k,v in pri.items() if k not in ('eventRows','oracleRows')},'diagnostic':diag,'promotion':promo,'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}}
    (outdir/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    with open(outdir/'events.csv','w',newline='') as f:
        rows=cur['eventRows']+pri['eventRows']; w=csv.DictWriter(f,fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
    with open(outdir/'loss_opportunity.csv','w',newline='') as f:
        rows=cur['oracleRows']+pri['oracleRows']; w=csv.DictWriter(f,fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
