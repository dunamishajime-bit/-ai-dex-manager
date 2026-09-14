#!/usr/bin/env python3
import argparse,csv,json,math
from pathlib import Path
import research_pengu_cross_asset_router_a4 as a4

EVAL_START=1755961200000  # 2025-08-23T15:00:00Z
EVAL_END=1787516400000    # 2026-08-23T15:00:00Z


def ema(vals,span):
    alpha=2/(span+1);out=[];cur=None
    for i,v in enumerate(vals):
        cur=v if cur is None else alpha*v+(1-alpha)*cur
        out.append(cur if i+1>=span else None)
    return out


def structural_features(rows):
    closes=[x['close'] for x in rows]; e24=ema(closes,24); e72=ema(closes,72)
    tr=[]
    for i,x in enumerate(rows):
        pc=closes[i-1] if i else x['close']; tr.append(max(x['high']-x['low'],abs(x['high']-pc),abs(x['low']-pc)))
    out={}
    for i,x in enumerate(rows):
        if i<72 or e24[i] is None or e72[i] is None: continue
        atr=sum(tr[i-23:i+1])/24
        prior18=rows[i-18:i]
        if atr<=0 or len(prior18)!=18: continue
        hi=max(z['high'] for z in prior18); lo=min(z['low'] for z in prior18); ar=atr/x['close']
        r24=x['close']/closes[i-24]-1; r72=x['close']/closes[i-72]-1
        long_ok=x['close']>hi and e24[i]>e72[i] and r24>0 and r72>0
        short_ok=x['close']<lo and e24[i]<e72[i] and r24<0 and r72<0
        long_score=((x['close']-hi)/atr + (e24[i]-e72[i])/atr + r24/ar/24 + r72/ar/72)/4
        short_score=((lo-x['close'])/atr + (e72[i]-e24[i])/atr + (-r24)/ar/24 + (-r72)/ar/72)/4
        out[x['ts']]={'long':long_ok,'short':short_ok,'longScore':long_score,'shortScore':short_score,'atrRatio':ar,'r24':r24,'r72':r72}
    return out


def gross_for_atr(ar): return min(.75,max(.60,.75*.02/ar)) if ar>0 else .60


def owners(ts,side,sf):
    key='long' if side=='L' else 'short'; sk='longScore' if side=='L' else 'shortScore'
    arr=[]
    for sym in a4.UNIVERSE:
        f=sf[sym].get(ts)
        if f and f[key]: arr.append((sym,f[sk]))
    return sorted(arr,key=lambda x:(-x[1],x[0]))


def event_clock_variants(payload,candles,index,funding,sf):
    names=['STRUCT_OWNER1','STRUCT_OWNER2','STRUCT_BASKET','PENGU_OWNER_SPLIT']
    out={}; normal_rows=[]
    for mode,src in [('NORMAL','normal'),('SEVERE','stress')]:
        rs={k:[] for k in names}; legs={k:[] for k in names}
        for i,e in enumerate(payload['modes'][src]['trades'],1):
            side=e['side']; gross=float(e['requestedGross']); ts=int(e['signalTs']); own=owners(ts,side,sf)
            fallback=[('PENGUUSDT',0.0)]
            chosen=own or fallback
            best=chosen[0][0]
            top2=[s for s,_ in chosen[:2]]
            eligible=[s for s,_ in chosen]
            best_alt=next((s for s,_ in own if s!='PENGUUSDT'),None)
            combos={
              'STRUCT_OWNER1':[(best,gross)],
              'STRUCT_OWNER2':[(s,gross/len(top2)) for s in top2],
              'STRUCT_BASKET':[(s,gross/len(eligible)) for s in eligible],
              'PENGU_OWNER_SPLIT':([('PENGUUSDT',gross/2),(best_alt,gross/2)] if best_alt else [('PENGUUSDT',gross)]),
            }
            for k,spec in combos.items():
                ll=[a4.simulate_leg(s,side,e,g,mode,candles,index,funding) for s,g in spec]
                er=sum(x['accountReturn'] for x in ll);rs[k].append(er);legs[k].extend(x['accountReturn'] for x in ll)
                if mode=='NORMAL':normal_rows.append({'eventIndex':i,'variant':k,'signalTs':ts,'side':side,'baselineReturn':float(e['accountReturn']),'eventReturn':er,'eligibleCount':len(own),'owners':'+'.join(s for s,_ in own),'used':'+'.join(s for s,_ in spec),'legCount':len(ll)})
        out[mode]={k:a4.metrics(rs[k],legs[k]) for k in names}
    return out,normal_rows


def independent_clock(candles,index,funding,sf):
    timestamps=sorted(set.intersection(*[set(sf[s]) for s in a4.UNIVERSE]))
    timestamps=[t for t in timestamps if EVAL_START<=t<EVAL_END-a4.HOUR]
    prev={s:{'L':False,'S':False} for s in a4.UNIVERSE}; trades=[]; blocked_until=0
    for ts in timestamps:
        candidates=[]
        for s in a4.UNIVERSE:
            f=sf[s][ts]
            nowL=f['long']; nowS=f['short']
            if ts>blocked_until:
                if nowL and not prev[s]['L']: candidates.append((f['longScore'],s,'L'))
                if nowS and not prev[s]['S']: candidates.append((f['shortScore'],s,'S'))
            prev[s]={'L':nowL,'S':nowS}
        if ts<=blocked_until or not candidates: continue
        score,sym,side=max(candidates,key=lambda x:(x[0],x[1],x[2]))
        entry_ts=ts+a4.HOUR
        if entry_ts>=EVAL_END or entry_ts not in index[sym]: continue
        last_ts=min(EVAL_END-a4.HOUR,entry_ts+(a4.LONG['maxHold'] if side=='L' else a4.SHORT['maxHold'])*a4.HOUR)
        if last_ts not in index[sym]:
            avail=[x for x in index[sym] if entry_ts<=x<EVAL_END]
            if not avail:continue
            last_ts=max(avail)
        ar=sf[sym][ts]['atrRatio'];gross=gross_for_atr(ar)
        event={'side':side,'signalTs':ts,'entryTs':entry_ts,'exitTs':last_ts,'requestedGross':gross}
        n=a4.simulate_leg(sym,side,event,gross,'NORMAL',candles,index,funding)
        s=a4.simulate_leg(sym,side,event,gross,'SEVERE',candles,index,funding)
        trades.append({'symbol':sym,'side':side,'signalTs':ts,'score':score,'gross':gross,'normal':n,'severe':s})
        blocked_until=n['exitTs']+6*a4.HOUR
    def m(mode):
        vals=[x[mode.lower()]['accountReturn'] for x in trades]
        z=a4.metrics(vals,vals)
        z.update({'longTrades':sum(x['side']=='L' for x in trades),'shortTrades':sum(x['side']=='S' for x in trades),'longWinRatePct':100*sum(x['side']=='L' and x[mode.lower()]['accountReturn']>0 for x in trades)/max(1,sum(x['side']=='L' for x in trades)),'shortWinRatePct':100*sum(x['side']=='S' and x[mode.lower()]['accountReturn']>0 for x in trades)/max(1,sum(x['side']=='S' for x in trades))})
        return z
    return {'NORMAL':m('NORMAL'),'SEVERE':m('SEVERE')},trades


def chronological_folds(rows):
    import datetime as dt
    bounds={'EARLY':(dt.datetime(2025,8,23,15,tzinfo=dt.timezone.utc),dt.datetime(2026,1,1,tzinfo=dt.timezone.utc)),'MID':(dt.datetime(2026,1,1,tzinfo=dt.timezone.utc),dt.datetime(2026,5,1,tzinfo=dt.timezone.utc)),'LATE':(dt.datetime(2026,5,1,tzinfo=dt.timezone.utc),dt.datetime(2026,8,23,15,tzinfo=dt.timezone.utc))}
    vars=sorted({r['variant'] for r in rows});out={}
    for name,(lo,hi) in bounds.items():
        fr=[r for r in rows if lo.timestamp()*1000<=r['signalTs']<hi.timestamp()*1000]; b={r['eventIndex']:r['baselineReturn'] for r in fr}
        fm={'baseline':a4.metrics([b[k] for k in sorted(b)],[b[k] for k in sorted(b)]),'variants':{}}
        for v in vars:
            rr=[r['eventReturn'] for r in fr if r['variant']==v];fm['variants'][v]=a4.metrics(rr,rr)
        out[name]=fm
    return out


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--current',required=True);ap.add_argument('--out',required=True);args=ap.parse_args();outdir=Path(args.out);outdir.mkdir(parents=True,exist_ok=True)
    p=json.load(open(args.current));evs=p['modes']['normal']['trades'];start=min(int(x['signalTs']) for x in evs)-220*a4.HOUR;end=EVAL_END
    candles={};index={};funding={};sf={}
    for sym in a4.UNIVERSE:
        rows=a4.download_candles(sym,start,end);candles[sym]=rows;index[sym]={x['ts']:i for i,x in enumerate(rows)};sf[sym]=structural_features(rows);print('candles',sym,len(rows),flush=True)
        funding[sym]=a4.download_funding(sym,start,end);print('funding',sym,len(funding[sym]),flush=True)
    # PENGU exact simulator parity before comparing structural ownership.
    for mode,src in [('NORMAL','normal'),('SEVERE','stress')]:
        dif=[]
        for e in p['modes'][src]['trades']:
            z=a4.simulate_leg('PENGUUSDT',e['side'],e,float(e['requestedGross']),mode,candles,index,funding);dif.append(abs(z['accountReturn']-float(e['accountReturn'])))
        assert max(dif)<=2e-6,(mode,max(dif))
    clock,rows=event_clock_variants(p,candles,index,funding,sf);ind,trades=independent_clock(candles,index,funding,sf);folds=chronological_folds(rows)
    baseN=a4.baseline_metrics(p['modes']['normal']['trades']);baseS=a4.baseline_metrics(p['modes']['stress']['trades']);promo={};conv={}
    for v,x in clock['NORMAL'].items():
        checks={'eventCountPreserved':x['events']==baseN['events'],'winRatePlus5pp':x['eventWinRatePct']>=baseN['eventWinRatePct']+5,'returnNotLower':x['returnPct']>=baseN['returnPct'],'pfNotLower':(x['profitFactor'] or 0)>=(baseN['profitFactor'] or 0),'ddNoWorse':x['maxDrawdownPct']>=baseN['maxDrawdownPct'],'severeReturnPositive':clock['SEVERE'][v]['returnPct']>0,'atLeastTwoFoldsWinRateNoWorse':sum(folds[f]['variants'][v]['eventWinRatePct']>=folds[f]['baseline']['eventWinRatePct'] for f in folds)>=2}
        promo[v]={'promoted':all(checks.values()),'checks':checks}
        lr=[r for r in rows if r['variant']==v and r['baselineReturn']<0];conv[v]={'baselineLosses':len(lr),'convertedToWin':sum(r['eventReturn']>0 for r in lr),'eventsWithAltStructuralOwner':sum(r['eligibleCount']>0 for r in lr)}
    independent_checks={'tradeCountAtLeastBaseline':ind['NORMAL']['events']>=baseN['events'],'winRateAtLeastBaselinePlus5pp':ind['NORMAL']['eventWinRatePct']>=baseN['eventWinRatePct']+5,'returnPositive':ind['NORMAL']['returnPct']>0,'pfAtLeast1p3':(ind['NORMAL']['profitFactor'] or 0)>=1.3,'severeReturnPositive':ind['SEVERE']['returnPct']>0,'ddAboveMinus20':ind['NORMAL']['maxDrawdownPct']>=-20}
    out={'status':'PASS_RESEARCH_ONLY','schema':'pengu-a7-multi-asset-signal-ownership/v1','principle':'do not filter PENGU opportunities; route only to assets that independently possess sign-only trend + 18h structural break ownership; also test a separate one-slot multi-asset clock whose own structural edges can add trades','structuralRule':'LONG: close>prior18h high, EMA24>EMA72, ret24>0, ret72>0. SHORT symmetric. Owner score uses ATR-normalized break distance, EMA spread, 24h and 72h momentum; no fitted thresholds.','baseline':{'NORMAL':baseN,'SEVERE':baseS},'eventClock':clock,'folds':folds,'lossConversion':conv,'promotion':promo,'independentMultiOwnerClock':ind,'independentChecks':{'promoted':all(independent_checks.values()),'checks':independent_checks},'independentTrades':[{'symbol':x['symbol'],'side':x['side'],'signalTs':x['signalTs'],'score':x['score'],'gross':x['gross'],'normalReturn':x['normal']['accountReturn'],'severeReturn':x['severe']['accountReturn']} for x in trades],'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}}
    (outdir/'result.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    with (outdir/'event_clock.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)
    print(json.dumps(out,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
