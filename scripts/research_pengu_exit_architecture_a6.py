#!/usr/bin/env python3
import argparse,csv,json
from pathlib import Path
import research_pengu_cross_asset_router_a4 as a4


def fund(points,entry,exit_ts): return a4.funding_between(points,entry,exit_ts)

def simulate_event(event,mode,rows,index,funding,variant):
    side=event['side']; gross=float(event['requestedGross']); ei=index[int(event['entryTs'])]; vi=index[int(event['exitTs'])]
    cfg=a4.LONG if side=='L' else a4.SHORT; last=min(vi,ei+cfg['maxHold']-1,len(rows)-1)
    entry=rows[ei]['open']; cost=a4.FEE+(a4.STRESS_SLIP if mode=='SEVERE' else 0)
    threshold=cfg['activation']/2
    best=entry; tp_done=False; tp_ts=None; tp_price=None; final_price=None; final_i=None; final_reason='virtual_clock'
    be_armed=False
    for j in range(ei,last+1):
      c=rows[j]
      if not tp_done:
        if side=='L' and c['high']>=entry*(1+threshold):
          tp_done=True; tp_ts=c['ts']; tp_price=entry*(1+threshold); be_armed=variant in ('TP50_BE','BE_ONLY')
        elif side=='S' and c['low']<=entry*(1-threshold):
          tp_done=True; tp_ts=c['ts']; tp_price=entry*(1-threshold); be_armed=variant in ('TP50_BE','BE_ONLY')
      if side=='L':
        hard=entry*(1-cfg['hard'])
        stop=max(hard,entry) if be_armed else hard
        if c['low']<=stop:
          final_price=stop; final_i=j; final_reason='breakeven' if be_armed and stop==entry else 'hard'; break
        trailing=best*(1-cfg['retrace'])
        if best/entry-1>=cfg['activation'] and c['low']<=trailing:
          final_price=trailing; final_i=j; final_reason='trail'; break
        best=max(best,c['high'])
      else:
        hard=entry*(1+cfg['hard'])
        stop=min(hard,entry) if be_armed else hard
        if c['high']>=stop:
          final_price=stop; final_i=j; final_reason='breakeven' if be_armed and stop==entry else 'hard'; break
        trailing=best*(1+cfg['retrace'])
        if entry/best-1>=cfg['activation'] and c['high']>=trailing:
          final_price=trailing; final_i=j; final_reason='trail'; break
        best=min(best,c['low'])
    if final_i is None:
      final_i=last; final_price=rows[last]['close']; final_reason='virtual_clock' if last==vi else 'max_hold'
    final_ts=rows[final_i]['ts']
    def unit_return(exit_price,exit_ts):
      raw=exit_price/entry-1 if side=='L' else entry/exit_price-1
      fr=fund(funding,int(event['entryTs']),exit_ts); fu=-fr if side=='L' else fr
      return raw+fu-2*cost
    base_unit=unit_return(final_price,final_ts)
    if variant=='BASELINE' or variant=='BE_ONLY' or not tp_done:
      account=gross*base_unit; legs=[account]
    elif variant in ('TP50_RUNNER','TP50_BE'):
      tp_unit=unit_return(tp_price,tp_ts)
      legs=[gross/2*tp_unit,gross/2*base_unit]; account=sum(legs)
    elif variant=='TP33_33_RUNNER':
      target2=entry*(1+cfg['activation']) if side=='L' else entry*(1-cfg['activation'])
      second=False; second_i=None
      for j in range(ei,final_i+1):
        c=rows[j]
        if (side=='L' and c['high']>=target2) or (side=='S' and c['low']<=target2): second=True; second_i=j; break
      tp1=unit_return(tp_price,tp_ts)
      if second:
        tp2=unit_return(target2,rows[second_i]['ts']); legs=[gross/3*tp1,gross/3*tp2,gross/3*base_unit]
      else: legs=[gross/3*tp1,2*gross/3*base_unit]
      account=sum(legs)
    else: raise RuntimeError(variant)
    return {'accountReturn':account,'legs':legs,'tpDone':tp_done,'finalReason':final_reason,'entryTs':int(event['entryTs']),'signalTs':int(event['signalTs']),'side':side}

def metrics(rs,legs): return a4.metrics(rs,legs)

def folds(rows):
  import datetime as dt
  bounds={'EARLY':(dt.datetime(2025,8,23,15,tzinfo=dt.timezone.utc),dt.datetime(2026,1,1,tzinfo=dt.timezone.utc)),'MID':(dt.datetime(2026,1,1,tzinfo=dt.timezone.utc),dt.datetime(2026,5,1,tzinfo=dt.timezone.utc)),'LATE':(dt.datetime(2026,5,1,tzinfo=dt.timezone.utc),dt.datetime(2026,8,23,15,tzinfo=dt.timezone.utc))}
  out={}; vars=sorted({r['variant'] for r in rows})
  for name,(lo,hi) in bounds.items():
    fr=[r for r in rows if lo.timestamp()*1000<=r['signalTs']<hi.timestamp()*1000]; base_by={r['eventIndex']:r['baselineReturn'] for r in fr}
    fm={'baseline':a4.metrics([base_by[k] for k in sorted(base_by)],[base_by[k] for k in sorted(base_by)]),'variants':{}}
    for v in vars:
      rr=[r['eventReturn'] for r in fr if r['variant']==v]; fm['variants'][v]=a4.metrics(rr,rr)
    out[name]=fm
  return out

def main():
  ap=argparse.ArgumentParser();ap.add_argument('--current',required=True);ap.add_argument('--out',required=True);args=ap.parse_args();outdir=Path(args.out);outdir.mkdir(parents=True,exist_ok=True)
  p=json.load(open(args.current)); evs=p['modes']['normal']['trades']; start=min(x['signalTs'] for x in evs)-200*a4.HOUR; end=max(x['exitTs'] for x in evs)+2*a4.HOUR
  rows=a4.download_candles('PENGUUSDT',start,end); index={x['ts']:i for i,x in enumerate(rows)}; funding=a4.download_funding('PENGUUSDT',start,end)
  names=['BASELINE','TP50_RUNNER','TP50_BE','BE_ONLY','TP33_33_RUNNER']; result_modes={}; normal_rows=[]
  for mode,src in [('NORMAL','normal'),('SEVERE','stress')]:
    rets={k:[] for k in names}; legrets={k:[] for k in names}
    for i,e in enumerate(p['modes'][src]['trades'],1):
      for v in names:
        r=simulate_event(e,mode,rows,index,funding,v); rets[v].append(r['accountReturn']);legrets[v].extend(r['legs'])
        if mode=='NORMAL' and v!='BASELINE': normal_rows.append({'eventIndex':i,'variant':v,'signalTs':r['signalTs'],'side':r['side'],'baselineReturn':float(e['accountReturn']),'eventReturn':r['accountReturn'],'tpDone':r['tpDone'],'finalReason':r['finalReason']})
    result_modes[mode]={v:metrics(rets[v],legrets[v]) for v in names}
  assert abs(result_modes['NORMAL']['BASELINE']['returnPct']-a4.baseline_metrics(p['modes']['normal']['trades'])['returnPct'])<1e-9
  fd=folds(normal_rows); base=result_modes['NORMAL']['BASELINE']; promo={}; conv={}
  for v in names[1:]:
    x=result_modes['NORMAL'][v]
    checks={'eventCountPreserved':x['events']==base['events'],'winRatePlus5pp':x['eventWinRatePct']>=base['eventWinRatePct']+5,'returnNotLower':x['returnPct']>=base['returnPct'],'pfNotLower':(x['profitFactor'] or 0)>=(base['profitFactor'] or 0),'ddNoWorse':x['maxDrawdownPct']>=base['maxDrawdownPct'],'severeReturnPositive':result_modes['SEVERE'][v]['returnPct']>0,'atLeastTwoFoldsWinRateNoWorse':sum(fd[f]['variants'][v]['eventWinRatePct']>=fd[f]['baseline']['eventWinRatePct'] for f in fd)>=2,'atLeastTwoFoldsReturnPositive':sum(fd[f]['variants'][v]['returnPct']>0 for f in fd)>=2}
    promo[v]={'promoted':all(checks.values()),'checks':checks}
    lr=[r for r in normal_rows if r['variant']==v and r['baselineReturn']<0];conv[v]={'baselineLossEvents':len(lr),'convertedToWin':sum(r['eventReturn']>0 for r in lr),'lossesWithTP':sum(r['tpDone'] for r in lr)}
  out={'status':'PASS_RESEARCH_ONLY','schema':'pengu-a6-exit-architecture/v1','principle':'preserve every entry; derive profit-protection levels from existing trailing activation/hard-stop rather than search new thresholds','baseline':result_modes['NORMAL']['BASELINE'],'variants':{'NORMAL':{k:v for k,v in result_modes['NORMAL'].items() if k!='BASELINE'},'SEVERE':{k:v for k,v in result_modes['SEVERE'].items() if k!='BASELINE'}},'folds':fd,'lossConversion':conv,'promotion':promo,'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}}
  (outdir/'result.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
  with (outdir/'events.csv').open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=normal_rows[0].keys());w.writeheader();w.writerows(normal_rows)
  print(json.dumps(out,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
