"""Untouched V12 entry holdout for the frozen 6h failed-break-reversal SHORT rule.

Rule was frozen before this script touched any 2026-08-11+ outcomes.
Input is the separately refetched Aster H1 series whose pre-holdout overlap passed
14/14 exact OHLC/volume parity against the frozen historical dataset.
No LIVE/Production code or order path is touched.
"""
from __future__ import annotations
import collections, datetime as dt, json, math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/research/results/v12-untouched-holdout-20261008'
DATA=BASE/'data'/'klines'
H=3_600_000
START=int(dt.datetime(2026,8,11,tzinfo=dt.timezone.utc).timestamp()*1000)
DATA_END=int(dt.datetime(2026,10,8,tzinfo=dt.timezone.utc).timestamp()*1000)
ENTRY_END=DATA_END-46*H  # exclusive so every accepted trade has full 46h exit coverage
SYMS=['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','LINKUSDT','AVAXUSDT','DOGEUSDT','INJUSDT','XRPUSDT','ADAUSDT','LTCUSDT','ATOMUSDT','AAVEUSDT','NEARUSDT']

def load(sym):
    out={}
    for z in (DATA/f'{sym}.jsonl').read_text(encoding='utf-8').splitlines():
        if not z.strip(): continue
        x=json.loads(z);t=int(x['event_time_ms'])
        out[t]={'open':float(x['open']),'high':float(x['high']),'low':float(x['low']),'close':float(x['close']),'volume':float(x['base_volume'])}
    return out

def ema(a,n):
    x=a[0];alpha=2/(n+1)
    for p in a[1:]:x+=alpha*(p-x)
    return x

def er(a,n):
    p=a[-n-1:]
    return abs(p[-1]-p[0])/max(sum(abs(x-y) for x,y in zip(p,p[1:])),1e-20)

def h2_series(h1):
    a=[]
    for t in sorted(h1):
        if t%(2*H) or t+H not in h1: continue
        x,y=h1[t],h1[t+H]
        a.append({'ts':t,'end':t+2*H,'open':x['open'],'high':max(x['high'],y['high']),
                  'low':min(x['low'],y['low']),'close':y['close'],'volume':x['volume']+y['volume']})
    return a

def frames(bs,btc):
    ps=[b['close'] for b in bs];bp=[b['close'] for b in btc];c=bs[-1];p=bs[-2]
    tr=[max(b['high']-b['low'],abs(b['high']-q['close']),abs(b['low']-q['close'])) for b,q in zip(bs[1:],bs[:-1])]
    atr=sum(tr[-31:])/31;pa=sum(tr[-32:-1])/31;av=sum(b['volume'] for b in bs[-21:-1])/20
    if min(atr,pa,av)<=0:return None
    diff=ema(ps,6)-ema(ps,24);pd=ema(ps[:-1],6)-ema(ps[:-1],24)
    span=max(c['high']-c['low'],1e-20);clv=(c['close']-c['low'])/span
    return dict(now=c['end'],open=c['open'],high=c['high'],low=c['low'],close=c['close'],
      prev_close=p['close'],prev_high=p['high'],prev_low=p['low'],atr=atr,
      level_high=max(b['high'] for b in bs[-13:-1]),level_low=min(b['low'] for b in bs[-13:-1]),
      volume_ratio=c['volume']/av,clv_long=clv,clv_short=1-clv,
      compression=sum(tr[-7:-1])/6/pa,previous_er=er(ps[:-1],12),
      btc6=bp[-1]/bp[-4]-1,ret6=ps[-1]/ps[-4]-1,
      rel6=ps[-1]/ps[-4]-bp[-1]/bp[-4],
      cross=1 if diff>0 and pd<=0 else -1 if diff<0 and pd>=0 else 0,
      body_atr=abs(c['close']-c['open'])/atr)

def base_onset(bs,btc):
    if len(bs)<50 or len(btc)<50:return None
    f=frames(bs,btc)
    if not f:return None
    mom=bs[-1]['close']/bs[-46]['close']-1
    prev=bs[-2]['close']/bs[-47]['close']-1
    sg=1 if mom>=.0227 and prev<.0227 else -1 if mom<=-.0227 and prev>-.0227 else 0
    if not sg:return None
    clv=f['clv_long'] if sg==1 else f['clv_short']
    confirm=f['volume_ratio']>=.80 and sg*f['ret6']>0 and sg*f['rel6']>=0 and clv>=.60 and f['body_atr']>=.20
    br=(f['close']>=f['level_high']+.05*f['atr']) if sg==1 else (f['close']<=f['level_low']-.05*f['atr'])
    return (sg,mom,prev,f) if confirm and br else None

def quality(f,sg):
    clv=f['clv_long'] if sg==1 else f['clv_short']
    return max(.01,f['volume_ratio'])*max(.01,clv)*max(.05,f['body_atr'])

def build_events(h1,h2,maps):
    states={sym:None for sym in SYMS};events=[];btcarr=h2['BTCUSDT']
    # start far before holdout so a causal setup immediately before cutoff can mature after cutoff.
    loop_start=START-240*H
    for now in range(loop_start,ENTRY_END,2*H):
        bi=maps['BTCUSDT'].get(now)
        if bi is None or bi<60:continue
        btc=btcarr[max(0,bi-120):bi+1]
        for sym,arr in h2.items():
            i=maps[sym].get(now)
            if i is None or i<60:
                states[sym]=None;continue
            bs=arr[max(0,i-120):i+1]
            f=frames(bs,btc)
            if not f:
                states[sym]=None;continue
            st=states[sym]
            if st:
                age=now-st['setup_ts_ms']
                if age>6*H:
                    states[sym]=None;st=None
                else:
                    sg=st['sg'];atr=st['atr'];level=st['level']
                    clv_same=f['clv_long'] if sg==1 else f['clv_short']
                    clv_opp=f['clv_short'] if sg==1 else f['clv_long']
                    touch=(f['low']<=level+.25*atr) if sg==1 else (f['high']>=level-.25*atr)
                    reclaim=(f['close']>=level+.05*atr) if sg==1 else (f['close']<=level-.05*atr)
                    same_bar=sg*(f['close']-f['open'])>0
                    retest=touch and reclaim and same_bar and clv_same>=.60 and f['body_atr']>=.15 and sg*f['btc6']>=-.005
                    if sg*(f['close']-f['prev_close'])<0:st['had_pullback']=True
                    clear_prev=(f['close']>=f['prev_high']+.05*f['atr']) if sg==1 else (f['close']<=f['prev_low']-.05*f['atr'])
                    reaccel=st['had_pullback'] and clear_prev and clv_same>=.65 and f['body_atr']>=.20 and sg*f['ret6']>0 and sg*f['rel6']>=0 and sg*f['btc6']>=-.005
                    fail=sg*(f['close']-level)<=-.15*atr and clv_opp>=.65 and f['body_atr']>=.20
                    route=None;outsg=sg
                    # exact locked transition priority: failure, then retest, then reacceleration.
                    if fail:route='FAILED_BREAK_REV';outsg=-sg
                    elif retest:route='RETEST_RECLAIM'
                    elif reaccel:route='PULLBACK_REACCEL'
                    if route:
                        if route=='FAILED_BREAK_REV' and outsg==-1 and now>=START:
                            bar=h1[sym].get(now)
                            if bar:
                                events.append({'symbol':sym,'side':'SHORT','sg':-1,'entry_ts_ms':now,
                                  'entry_price':bar['open'],'atr':f['atr'],'score':quality(f,-1),
                                  'route':'FAILED_BREAK_REV_SHORT_6H','setup_ts_ms':st['setup_ts_ms'],
                                  'decision_ts_ms':now,'state_age_h':age/H,
                                  'onset_momentum90':st['momentum90']})
                        states[sym]=None;st=None
            if states[sym] is None:
                z=base_onset(bs,btc)
                if z:
                    sg,mom,prev,of=z
                    level=of['level_high'] if sg==1 else of['level_low']
                    states[sym]={'sg':sg,'setup_ts_ms':now,'atr':of['atr'],'level':level,
                                 'momentum90':mom,'had_pullback':False}
    return events

def select(events):
    groups=collections.defaultdict(list)
    for c in events:groups[c['entry_ts_ms']].append(c)
    out=[]
    for ts,cs in sorted(groups.items()):
        cs=sorted(cs,key=lambda c:(-c['score'],c['symbol']))
        for rank,c in enumerate(cs[:3],1):
            e=c['entry_price'];dist=max(2.477*c['atr'],e*.005);gross=min(1.,.0319/(dist/e))
            if rank==3:gross=min(.1,gross)
            out.append(dict(c,rank=rank,requested_gross=gross))
    return out

def exit_legacy(c,series):
    e=c['entry_price'];sg=-1;atr=c['atr'];t0=c['entry_ts_ms']
    dist=max(2.477*atr,e*.005);stop=e-sg*dist;tp=e+sg*3.1995*atr;peak=e;end=t0+46*H
    for t in range(t0,end,H):
        b=series.get(t)
        if b is None:return None
        px=None;reason=None
        if b['high']>=stop:px=max(stop,b['open']);reason='STATE_STOP'
        if px is None and b['low']<=tp:px=tp;reason='STATE_TP'
        if px is None and (t+H)%(2*H)==0:
            prev=series.get(t-H,b) if t-H>=t0 else b
            peak=min(peak,b['low'],prev['low']);n=series.get(t+H)
            proposed=min(stop,peak+.2*atr)
            if n and -1*(n['open']-proposed)<=0:px=n['open'];reason='STATE_TRAIL_CROSSED_QUOTE'
            stop=proposed
        if px is not None:return dict(c,exit_ts_ms=t+H,exit_price=px,reason=reason,unit_gross_return=-(px/e-1))
    b=series.get(end)
    return dict(c,exit_ts_ms=end,exit_price=b['open'],reason='STATE_TIME',unit_gross_return=-(b['open']/e-1)) if b else None

def stat(trades,cost):
    vals=[x['unit_gross_return']-cost/10000 for x in trades];n=len(vals)
    pos=sum(max(v,0) for v in vals);neg=-sum(min(v,0) for v in vals)
    return {'n':n,'win_rate':sum(v>0 for v in vals)/n if n else None,
      'pf':pos/neg if neg else (math.inf if pos else None),
      'mean':sum(vals)/n if n else None,'sum':sum(vals),
      'without_best':sum(vals)-max(vals) if vals else None,
      'best':max(vals) if vals else None,'worst':min(vals) if vals else None}

def iso(ms):return dt.datetime.fromtimestamp(ms/1000,dt.timezone.utc).isoformat()

def main():
    parity=json.loads((BASE/'parity-report.json').read_text(encoding='utf-8'))
    if parity.get('status')!='PASS_FETCH_AND_PRICE_PARITY':raise SystemExit('BLOCKED: parity gate not passed')
    h1={s:load(s) for s in SYMS};h2={s:h2_series(h1[s]) for s in SYMS};maps={s:{b['end']:i for i,b in enumerate(a)} for s,a in h2.items()}
    events=build_events(h1,h2,maps);chosen=select(events);trades=[]
    for c in chosen:
        x=exit_legacy(c,h1[c['symbol']])
        if x is None:raise RuntimeError(f'incomplete exit coverage {c}')
        trades.append(x)
    (BASE/'holdout-events.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in events),encoding='utf-8')
    (BASE/'holdout-selected.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in chosen),encoding='utf-8')
    (BASE/'holdout-trades.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in trades),encoding='utf-8')
    months=collections.defaultdict(list);symbols=collections.defaultdict(list);reasons=collections.Counter()
    for x in trades:
        months[iso(x['entry_ts_ms'])[:7]].append(x);symbols[x['symbol']].append(x);reasons[x['reason']]+=1
    report={
      'status':'COMPLETE_UNTOUCHED_HOLDOUT_V12_ONLY_PRICE_MODEL',
      'research_only':True,'live_changes':False,'production_changes':False,
      'rule_frozen_before_holdout_outcomes':True,
      'data_gate':{'price_volume_overlap_parity':'14/14 PASS, 1704 overlap H1 rows per symbol, zero mismatches',
                   'source':'Aster public /fapi/v1/klines, separately saved; frozen baseline untouched'},
      'period':{'entry_start_inclusive':iso(START),'entry_end_exclusive':iso(ENTRY_END),
                'data_end_exclusive':iso(DATA_END),'max_hold_hours':46},
      'rule':'Frozen FAILED_BREAK_REV_SHORT_6H exactly as specified in protocol; no holdout tuning.',
      'raw_events':len(events),'selected_events':len(chosen),'completed_trades':len(trades),
      'costs':{str(c):stat(trades,c) for c in [10,20,30]},
      'by_month':{m:{str(c):stat(a,c) for c in [10,20,30]} for m,a in sorted(months.items())},
      'by_symbol':{s:{str(c):stat(a,c) for c in [10,20,30]} for s,a in sorted(symbols.items())},
      'exit_reasons':dict(reasons),
      'limitations':['V12-only price-model holdout; does not replay fresh non-V12 portfolio/funding/ownership streams.',
                     'Holdout spans only about 56 days of eligible entries and may have few trades.',
                     'No parameter may be changed in response to this holdout without creating a new future validation requirement.']
    }
    (BASE/'holdout-report.json').write_text(json.dumps(report,indent=2,allow_nan=True),encoding='utf-8')
    print(json.dumps(report,indent=2,allow_nan=True))

if __name__=='__main__':main()
