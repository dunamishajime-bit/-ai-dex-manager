"""Descriptive regime diagnosis for the frozen V12 6h failed-break SHORT route.

Uses only pre-holdout data (2025-01-11..2026-08-10) to explain why the route works
in some regimes and fails badly in 2025-Q2. This is diagnosis, not a production rule.
The already-viewed 2026-08-11+ holdout is deliberately excluded from all feature selection.
"""
import collections, datetime as dt, json, math, statistics
from pathlib import Path
import run_v12_untouched_holdout as h

OUT=h.ROOT/'docs/research/results/v12-failed-break-regime-diagnosis-20261008'
FROZEN=Path(r'C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\market-Aster-H1-funding-and-manifests\normalized\aster\klines')
h.DATA=FROZEN
h.START=int(dt.datetime(2025,1,11,tzinfo=dt.timezone.utc).timestamp()*1000)
h.DATA_END=int(dt.datetime(2026,8,10,tzinfo=dt.timezone.utc).timestamp()*1000)
h.ENTRY_END=h.DATA_END-46*h.H

def q(vals,p):
    a=sorted(vals)
    if not a:return None
    i=(len(a)-1)*p;lo=int(i);hi=min(lo+1,len(a)-1);w=i-lo
    return a[lo]*(1-w)+a[hi]*w

def desc(rows,k):
    v=[x[k] for x in rows if x.get(k) is not None and math.isfinite(x[k])]
    return {'n':len(v),'mean':sum(v)/len(v) if v else None,'q25':q(v,.25),'median':q(v,.5),'q75':q(v,.75)} if v else {'n':0}

def perf(rows,cost=10):
    vals=[x['gross']-cost/10000 for x in rows];n=len(vals);pos=sum(max(v,0) for v in vals);neg=-sum(min(v,0) for v in vals)
    return {'n':n,'wr':sum(v>0 for v in vals)/n if n else None,'pf':pos/neg if neg else None,'mean':sum(vals)/n if n else None,'sum':sum(vals)}

def ret(ps,bars):
    return ps[-1]/ps[-1-bars]-1 if len(ps)>bars else None

def erx(ps,bars):
    if len(ps)<=bars:return None
    p=ps[-bars-1:];den=sum(abs(b-a) for a,b in zip(p,p[1:]))
    return abs(p[-1]-p[0])/den if den else 0.0

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    h1={s:h.load(s) for s in h.SYMS};h2={s:h.h2_series(h1[s]) for s in h.SYMS};maps={s:{b['end']:i for i,b in enumerate(a)} for s,a in h2.items()}
    events=h.select(h.build_events(h1,h2,maps))
    rows=[]
    for c in events:
        x=h.exit_legacy(c,h1[c['symbol']])
        if not x:continue
        t=c['entry_ts_ms'];sym=c['symbol'];i=maps[sym][t];bi=maps['BTCUSDT'][t];si=maps[sym][c['setup_ts_ms']]
        cur=h.frames(h2[sym][max(0,i-120):i+1],h2['BTCUSDT'][max(0,bi-120):bi+1])
        setup=h.frames(h2[sym][max(0,si-120):si+1],h2['BTCUSDT'][max(0,maps['BTCUSDT'][c['setup_ts_ms']]-120):maps['BTCUSDT'][c['setup_ts_ms']+0]+1])
        sps=[b['close'] for b in h2[sym][max(0,i-180):i+1]]
        bps=[b['close'] for b in h2['BTCUSDT'][max(0,bi-180):bi+1]]
        level=setup['level_high'];setup_atr=setup['atr']
        d=dt.datetime.fromtimestamp(t/1000,dt.timezone.utc)
        rows.append({
          'entry_ts_ms':t,'date':d.isoformat(),'period':'PRE' if t<int(dt.datetime(2025,8,10,tzinfo=dt.timezone.utc).timestamp()*1000) else 'DEV',
          'quarter':f'{d.year}-Q{(d.month-1)//3+1}','month':d.strftime('%Y-%m'),'symbol':sym,
          'gross':x['unit_gross_return'],'win10':x['unit_gross_return']-.001>0,'reason':x['reason'],
          'state_age_h':c['state_age_h'],'onset_mom90':c['onset_momentum90'],
          'fail_depth_setup_atr':(level-cur['close'])/setup_atr,
          'fail_clv_short':cur['clv_short'],'fail_body_atr':cur['body_atr'],'fail_volume_ratio':cur['volume_ratio'],
          'sym6':cur['ret6'],'rel6':cur['rel6'],'btc6':cur['btc6'],
          'btc12':ret(bps,6),'btc24':ret(bps,12),'btc48':ret(bps,24),'btc72':ret(bps,36),'btc168':ret(bps,84),
          'btc_er24':erx(bps,12),'btc_er72':erx(bps,36),'btc_er168':erx(bps,84),
          'sym24':ret(sps,12),'sym72':ret(sps,36),
          'rel24':(ret(sps,12)-ret(bps,12)) if ret(sps,12) is not None and ret(bps,12) is not None else None,
          'rel72':(ret(sps,36)-ret(bps,36)) if ret(sps,36) is not None and ret(bps,36) is not None else None,
          'setup_volume_ratio':setup['volume_ratio'],'setup_body_atr':setup['body_atr'],'setup_clv_long':setup['clv_long'],
          'setup_breakout_atr':(setup['close']-setup['level_high'])/setup['atr'],
        })
    (OUT/'diagnostic-rows.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in rows),encoding='utf-8')
    feats=['state_age_h','onset_mom90','fail_depth_setup_atr','fail_clv_short','fail_body_atr','fail_volume_ratio',
           'sym6','rel6','btc6','btc12','btc24','btc48','btc72','btc168','btc_er24','btc_er72','btc_er168',
           'sym24','sym72','rel24','rel72','setup_volume_ratio','setup_body_atr','setup_clv_long','setup_breakout_atr']
    groups={
      'ALL':rows,'PRE':[x for x in rows if x['period']=='PRE'],'DEV':[x for x in rows if x['period']=='DEV'],
      'PRE_Q1':[x for x in rows if x['quarter']=='2025-Q1'],'PRE_Q2':[x for x in rows if x['quarter']=='2025-Q2'],
      'WIN10':[x for x in rows if x['win10']],'LOSS10':[x for x in rows if not x['win10']],
      'DEV_WIN10':[x for x in rows if x['period']=='DEV' and x['win10']],
      'DEV_LOSS10':[x for x in rows if x['period']=='DEV' and not x['win10']],
      'PRE_Q2_WIN10':[x for x in rows if x['quarter']=='2025-Q2' and x['win10']],
      'PRE_Q2_LOSS10':[x for x in rows if x['quarter']=='2025-Q2' and not x['win10']],
    }
    rep={'research_only':True,'holdout_excluded':True,'performance':{k:{str(c):perf(v,c) for c in [10,20,30]} for k,v in groups.items()},
         'features':{k:{f:desc(v,f) for f in feats} for k,v in groups.items()}}
    (OUT/'summary.json').write_text(json.dumps(rep,indent=2),encoding='utf-8')
    print('PERFORMANCE')
    for k in ['PRE','PRE_Q1','PRE_Q2','DEV']:
        print(k,rep['performance'][k]['10'])
    print('\nQ2 LOSS vs DEV WIN feature medians')
    for f in feats:
        a=rep['features']['PRE_Q2_LOSS10'][f];b=rep['features']['DEV_WIN10'][f]
        print(f,'Q2loss',a.get('median'),'DEVwin',b.get('median'))
if __name__=='__main__':main()
