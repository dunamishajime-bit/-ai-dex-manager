#!/usr/bin/env python3
import argparse,csv,json
from pathlib import Path
import research_pengu_cross_asset_router_a4 as a4


def breadth(ts,side,features):
    sign=1 if side=='L' else -1
    return sum(sign*features[s][ts]['ret24']>0 and sign*features[s][ts]['ret72']>0 for s in a4.UNIVERSE)/len(a4.UNIVERSE)

def btc_align(ts,side,btc_by):
    r=btc_by[ts]['close']/btc_by[ts-24*a4.HOUR]['close']-1
    return (r>0) if side=='L' else (r<0)

def run(p,candles,index,funding,features,btc_by):
    names=['CONSENSUS_FLIP_TOP1','CONSENSUS_FLIP_TOP2','CONSENSUS_HEDGE50','BTC_FLIP','BTC_HEDGE50']
    modes={}; rows=[]
    for mode,src in [('NORMAL','normal'),('SEVERE','stress')]:
      rr={k:[] for k in names};legs={k:[] for k in names}
      for i,e in enumerate(p['modes'][src]['trades'],1):
        side=e['side'];opp='L' if side=='S' else 'S';gross=float(e['requestedGross']);ts=int(e['signalTs'])
        br=breadth(ts,side,features);balign=btc_align(ts,side,btc_by)
        opp_rank,_=a4.ranks_at(ts,opp,features);top1=opp_rank[0][0];top2=opp_rank[1][0]
        pfull=[('PENGUUSDT',side,gross)]
        flip1=pfull if br>=.5 else [(top1,opp,gross)]
        flip2=pfull if br>=.5 else [(top1,opp,gross/2),(top2,opp,gross/2)]
        hedge=pfull if br>=.5 else [('PENGUUSDT',side,gross/2),(top1,opp,gross/2)]
        btcflip=pfull if balign else [('BTCUSDT',opp,gross)]
        btch=pfull if balign else [('PENGUUSDT',side,gross/2),('BTCUSDT',opp,gross/2)]
        combos={'CONSENSUS_FLIP_TOP1':flip1,'CONSENSUS_FLIP_TOP2':flip2,'CONSENSUS_HEDGE50':hedge,'BTC_FLIP':btcflip,'BTC_HEDGE50':btch}
        for k,spec in combos.items():
          ll=[a4.simulate_leg(s,sd,e,g,mode,candles,index,funding) for s,sd,g in spec]
          er=sum(x['accountReturn'] for x in ll);rr[k].append(er);legs[k].extend(x['accountReturn'] for x in ll)
          if mode=='NORMAL':rows.append({'eventIndex':i,'variant':k,'signalTs':ts,'side':side,'baselineReturn':float(e['accountReturn']),'eventReturn':er,'breadth':br,'btcAligned':balign,'used':'+'.join(f'{s}:{sd}' for s,sd,_ in spec),'legCount':len(ll)})
      modes[mode]={k:a4.metrics(rr[k],legs[k]) for k in names}
    return modes,rows

def fold(rows):
    import datetime as dt
    bounds={'EARLY':(dt.datetime(2025,8,23,15,tzinfo=dt.timezone.utc),dt.datetime(2026,1,1,tzinfo=dt.timezone.utc)),'MID':(dt.datetime(2026,1,1,tzinfo=dt.timezone.utc),dt.datetime(2026,5,1,tzinfo=dt.timezone.utc)),'LATE':(dt.datetime(2026,5,1,tzinfo=dt.timezone.utc),dt.datetime(2026,8,23,15,tzinfo=dt.timezone.utc))}
    out={};vars=sorted({r['variant'] for r in rows})
    for name,(lo,hi) in bounds.items():
      fr=[r for r in rows if lo.timestamp()*1000<=r['signalTs']<hi.timestamp()*1000];b={r['eventIndex']:r['baselineReturn'] for r in fr}
      z={'baseline':a4.metrics([b[x] for x in sorted(b)],[b[x] for x in sorted(b)]),'variants':{}}
      for v in vars:
        x=[r['eventReturn'] for r in fr if r['variant']==v];z['variants'][v]=a4.metrics(x,x)
      out[name]=z
    return out

def main():
  ap=argparse.ArgumentParser();ap.add_argument('--current',required=True);ap.add_argument('--out',required=True);args=ap.parse_args();od=Path(args.out);od.mkdir(parents=True,exist_ok=True)
  p=json.load(open(args.current)); ev=p['modes']['normal']['trades']; start=min(x['signalTs'] for x in ev)-220*a4.HOUR;end=max(x['exitTs'] for x in ev)+2*a4.HOUR
  symbols=a4.UNIVERSE+[a4.BTC];candles={};index={};funding={}
  for s in symbols:
    x=a4.download_candles(s,start,end);candles[s]=x;index[s]={r['ts']:i for i,r in enumerate(x)};print('candles',s,len(x),flush=True)
  for s in symbols:
    funding[s]=a4.download_funding(s,start,end);print('funding',s,len(funding[s]),flush=True)
  btc_by={x['ts']:x for x in candles[a4.BTC]};features={}
  for s in a4.UNIVERSE: _,features[s]=a4.prepare(candles[s],btc_by)
  # parity
  for mode,src in [('NORMAL','normal'),('SEVERE','stress')]:
    d=[]
    for e in p['modes'][src]['trades']:
      z=a4.simulate_leg('PENGUUSDT',e['side'],e,float(e['requestedGross']),mode,candles,index,funding);d.append(abs(z['accountReturn']-float(e['accountReturn'])))
    assert max(d)<=2e-6,(mode,max(d))
  modes,rows=run(p,candles,index,funding,features,btc_by);folds=fold(rows);baseN=a4.baseline_metrics(p['modes']['normal']['trades']);baseS=a4.baseline_metrics(p['modes']['stress']['trades']);promo={};conv={}
  for v,x in modes['NORMAL'].items():
    checks={'eventCountPreserved':x['events']==baseN['events'],'winRatePlus5pp':x['eventWinRatePct']>=baseN['eventWinRatePct']+5,'returnNotLower':x['returnPct']>=baseN['returnPct'],'pfNotLower':(x['profitFactor'] or 0)>=(baseN['profitFactor'] or 0),'ddNoWorse':x['maxDrawdownPct']>=baseN['maxDrawdownPct'],'severeReturnPositive':modes['SEVERE'][v]['returnPct']>0,'atLeastTwoFoldsWinRateNoWorse':sum(folds[f]['variants'][v]['eventWinRatePct']>=folds[f]['baseline']['eventWinRatePct'] for f in folds)>=2,'atLeastTwoFoldsReturnPositive':sum(folds[f]['variants'][v]['returnPct']>0 for f in folds)>=2}
    promo[v]={'promoted':all(checks.values()),'checks':checks}
    lr=[r for r in rows if r['variant']==v and r['baselineReturn']<0];conv[v]={'baselineLosses':len(lr),'convertedToWin':sum(r['eventReturn']>0 for r in lr),'changedEvents':sum((r['breadth']<.5 if v.startswith('CONSENSUS') else not r['btcAligned']) for r in lr)}
  out={'status':'PASS_RESEARCH_ONLY','schema':'pengu-a8-consensus-direction-arbitration/v1','principle':'never skip a PENGU opportunity; when cross-sectional/BTC direction disagrees, either flip full expression to the opposite market direction or split PENGU with an opposite hedge; no threshold search beyond fixed majority sign','baseline':{'NORMAL':baseN,'SEVERE':baseS},'variants':modes,'folds':folds,'lossConversion':conv,'promotion':promo,'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}}
  (od/'result.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
  with (od/'events.csv').open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)
  print(json.dumps(out,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
