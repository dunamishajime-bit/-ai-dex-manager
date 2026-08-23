#!/usr/bin/env python3
import argparse,csv,json,datetime as dt
from pathlib import Path
import research_pengu_cross_asset_router_a4 as a4


def event_metrics(event_returns,leg_returns): return a4.metrics(event_returns,leg_returns)

def breadth_at(ts,side,features):
    sign=1 if side=='L' else -1
    good=0
    for sym in a4.UNIVERSE:
        f=features[sym][ts]
        if sign*f['ret24']>0 and sign*f['ret72']>0: good+=1
    return good/len(a4.UNIVERSE)

def btc_aligned(ts,side,btc_by):
    b=btc_by[ts]; old=btc_by[ts-24*a4.HOUR]
    r=b['close']/old['close']-1
    return r>0 if side=='L' else r<0

def run_variant_events(payload,candles,index,features,funding,btc_by):
    out={}
    for modekey,srcmode in [('NORMAL','normal'),('SEVERE','stress')]:
      evs=payload['modes'][srcmode]['trades']
      names=['ALL8_BASKET','ALT7_BASKET','PENGU50_ALT50','BREADTH_PAIR_SWITCH','BTC_PAIR_SWITCH','BREADTH_BASKET_SWITCH']
      rets={k:[] for k in names}; legs={k:[] for k in names}; rows=[]
      for i,e in enumerate(evs,1):
        side=e['side']; gross=float(e['requestedGross']); ts=int(e['signalTs'])
        ranking,_=a4.ranks_at(ts,side,features)
        long_rank,_=a4.ranks_at(ts,'L',features)
        strongest=long_rank[0][0]; weakest=long_rank[-1][0]
        alllegs=[a4.simulate_leg(sym,side,e,gross/len(a4.UNIVERSE),modekey,candles,index,funding) for sym in a4.UNIVERSE]
        alts=[s for s in a4.UNIVERSE if s!='PENGUUSDT']
        altlegs=[a4.simulate_leg(sym,side,e,gross/len(alts),modekey,candles,index,funding) for sym in alts]
        p50=a4.simulate_leg('PENGUUSDT',side,e,gross/2,modekey,candles,index,funding)
        alt50=[a4.simulate_leg(sym,side,e,(gross/2)/len(alts),modekey,candles,index,funding) for sym in alts]
        pair=[a4.simulate_leg(strongest,'L',e,gross/2,modekey,candles,index,funding),a4.simulate_leg(weakest,'S',e,gross/2,modekey,candles,index,funding)]
        pfull=[a4.simulate_leg('PENGUUSDT',side,e,gross,modekey,candles,index,funding)]
        breadth=breadth_at(ts,side,features); balign=btc_aligned(ts,side,btc_by)
        combos={
          'ALL8_BASKET':alllegs,
          'ALT7_BASKET':altlegs,
          'PENGU50_ALT50':[p50]+alt50,
          'BREADTH_PAIR_SWITCH':pfull if breadth>=0.5 else pair,
          'BTC_PAIR_SWITCH':pfull if balign else pair,
          'BREADTH_BASKET_SWITCH':pfull if breadth>=0.5 else alllegs,
        }
        for k,ll in combos.items():
            er=sum(x['accountReturn'] for x in ll); rets[k].append(er); legs[k].extend(x['accountReturn'] for x in ll)
            if modekey=='NORMAL': rows.append({'eventIndex':i,'variant':k,'signalTs':ts,'side':side,'baselineReturn':float(e['accountReturn']),'eventReturn':er,'breadth':breadth,'btcAligned':balign,'symbols':'+'.join(x['symbol'] for x in ll),'legCount':len(ll)})
      out[modekey]={k:event_metrics(rets[k],legs[k]) for k in names}
      if modekey=='NORMAL': out['rows']=rows
    return out

def fold_metrics(rows):
    bounds={
      'EARLY':(dt.datetime(2025,8,23,15,tzinfo=dt.timezone.utc),dt.datetime(2026,1,1,tzinfo=dt.timezone.utc)),
      'MID':(dt.datetime(2026,1,1,tzinfo=dt.timezone.utc),dt.datetime(2026,5,1,tzinfo=dt.timezone.utc)),
      'LATE':(dt.datetime(2026,5,1,tzinfo=dt.timezone.utc),dt.datetime(2026,8,23,15,tzinfo=dt.timezone.utc)),
    }
    variants=sorted({r['variant'] for r in rows}); out={}
    for name,(lo,hi) in bounds.items():
      fr=[r for r in rows if lo.timestamp()*1000<=r['signalTs']<hi.timestamp()*1000]
      base_by={r['eventIndex']:r['baselineReturn'] for r in fr}
      fm={'baseline':a4.metrics([base_by[k] for k in sorted(base_by)],[base_by[k] for k in sorted(base_by)]),'variants':{}}
      for v in variants:
        rr=[r['eventReturn'] for r in fr if r['variant']==v]
        fm['variants'][v]=a4.metrics(rr,rr)
      out[name]=fm
    return out

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--current',required=True); ap.add_argument('--out',required=True); args=ap.parse_args()
    payload=json.load(open(args.current)); outdir=Path(args.out); outdir.mkdir(parents=True,exist_ok=True)
    evs=payload['modes']['normal']['trades']; start=min(int(x['signalTs']) for x in evs)-200*a4.HOUR; end=max(int(x['exitTs']) for x in evs)+2*a4.HOUR
    candles={}; index={}; funding={}
    for s in a4.UNIVERSE+[a4.BTC]:
        rr=a4.download_candles(s,start,end); candles[s]=rr; index[s]={x['ts']:i for i,x in enumerate(rr)}; print('candles',s,len(rr),flush=True)
    for s in a4.UNIVERSE:
        funding[s]=a4.download_funding(s,start,end); print('funding',s,len(funding[s]),flush=True)
    btc_by={x['ts']:x for x in candles[a4.BTC]}; features={}
    for s in a4.UNIVERSE: _,features[s]=a4.prepare(candles[s],btc_by)
    for modekey,srcmode in [('NORMAL','normal'),('SEVERE','stress')]:
      diffs=[]
      for e in payload['modes'][srcmode]['trades']:
        l=a4.simulate_leg('PENGUUSDT',e['side'],e,float(e['requestedGross']),modekey,candles,index,funding); diffs.append(abs(l['accountReturn']-float(e['accountReturn'])))
      assert max(diffs)<=2e-6,(modekey,max(diffs))
    variants=run_variant_events(payload,candles,index,features,funding,btc_by); folds=fold_metrics(variants['rows'])
    baseN=a4.baseline_metrics(payload['modes']['normal']['trades']); baseS=a4.baseline_metrics(payload['modes']['stress']['trades'])
    promotion={}; loss_diag={}
    for v,x in variants['NORMAL'].items():
      if v=='rows': continue
      foldwin=sum(folds[f]['variants'][v]['eventWinRatePct']>=folds[f]['baseline']['eventWinRatePct'] for f in folds)
      checks={'eventCountPreserved':x['events']==baseN['events'],'winRatePlus5pp':x['eventWinRatePct']>=baseN['eventWinRatePct']+5,'returnNotLower':x['returnPct']>=baseN['returnPct'],'pfNotLower':(x['profitFactor'] or 0)>=(baseN['profitFactor'] or 0),'ddNoWorse':x['maxDrawdownPct']>=baseN['maxDrawdownPct'],'severeReturnPositive':variants['SEVERE'][v]['returnPct']>0,'atLeastTwoFoldsWinRateNoWorse':foldwin>=2,'atLeastTwoFoldsReturnPositive':sum(folds[f]['variants'][v]['returnPct']>0 for f in folds)>=2}
      promotion[v]={'promoted':all(checks.values()),'checks':checks}
      vr=[r for r in variants['rows'] if r['variant']==v and r['baselineReturn']<0]
      loss_diag[v]={'baselineLossEvents':len(vr),'convertedToWin':sum(r['eventReturn']>0 for r in vr),'stillLoss':sum(r['eventReturn']<=0 for r in vr)}
    result={'status':'PASS_RESEARCH_ONLY','schema':'pengu-a5-basket-regime-expression/v1','principle':'never delete a PENGU opportunity; change instrument expression via broad basket or coarse market-regime switch; aggregate event gross unchanged','baseline':{'NORMAL':baseN,'SEVERE':baseS},'variants':{'NORMAL':variants['NORMAL'],'SEVERE':variants['SEVERE']},'folds':folds,'lossConversion':loss_diag,'promotion':promotion,'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}}
    (outdir/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    with (outdir/'events.csv').open('w',newline='') as f:
      w=csv.DictWriter(f,fieldnames=variants['rows'][0].keys());w.writeheader();w.writerows(variants['rows'])
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
