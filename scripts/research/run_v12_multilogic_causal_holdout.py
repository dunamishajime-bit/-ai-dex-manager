"""Causal external holdout for the frozen V12 multi-logic router.

Applies the frozen G/X/Y rule definitions themselves to exact buildV12Signals()
candidates from 2026-08-11 onward. No development candidate IDs are used.

This is V12-only price-model validation. It does not replay non-V12 ownership/funding.
No LIVE/Production changes.
"""
from pathlib import Path
import json, math, re, statistics, collections, datetime as dt

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/research/results/v12-multilogic-causal-holdout-20261009'
DATA=ROOT/'docs/research/results/v12-untouched-holdout-20261008/data/klines'
CORE_DIR=ROOT/'docs/research/results/v12-untouched-holdout-20261008'
S2=ROOT/'docs/research/results/v12-recovery-stage2-search-20261008/selected-stage2-routes.json'
S3=ROOT/'docs/research/results/v12-recovery-stage3-search-20261008/selected-stage3-routes.json'
H=3_600_000
START=int(dt.datetime(2026,8,11,tzinfo=dt.timezone.utc).timestamp()*1000)
DATA_END=int(dt.datetime(2026,10,8,tzinfo=dt.timezone.utc).timestamp()*1000)
ENTRY_END=DATA_END-74*H

def rows(p):
    return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]

candidates=rows(BASE/'baseline-candidates.jsonl')
stage2=json.loads(S2.read_text(encoding='utf-8'))[:14]
stage3=json.loads(S3.read_text(encoding='utf-8'))

symbols=sorted({c['symbol'] for c in candidates}|{'BTCUSDT'})
bars={}
for sym in symbols:
    p=DATA/f'{sym}.jsonl'
    if not p.exists():
        raise RuntimeError(f'missing holdout bars {sym}')
    bars[sym]={int(x['event_time_ms']):x for x in rows(p)}

def b(sym,t): return bars.get(sym,{}).get(int(t))
def closes(sym,t,n):
    out=[]
    for i in range(n,0,-1):
        x=b(sym,t-i*H)
        if x is None:return None
        out.append(float(x['close']))
    return out
def ret(sym,t,n):
    a=b(sym,t-H);z=b(sym,t-H-n*H)
    return None if a is None or z is None else float(a['close'])/float(z['close'])-1
def median(a): return statistics.median(a) if a else None
def ema(vals,n):
    if not vals:return None
    alpha=2/(n+1);e=vals[0]
    for v in vals[1:]:e=alpha*v+(1-alpha)*e
    return e
def atr(sym,t,n=14):
    seq=[];prev=None
    for i in range(n+1,0,-1):
        x=b(sym,t-i*H)
        if x is None:return None
        if prev is not None:
            hi=float(x['high']);lo=float(x['low']);pc=float(prev['close'])
            seq.append(max(hi-lo,abs(hi-pc),abs(lo-pc)))
        prev=x
    return sum(seq[-n:])/n if len(seq)>=n else None
def efficiency(sym,t,n):
    cs=closes(sym,t,n+1)
    if not cs:return None
    den=sum(abs(cs[i]-cs[i-1]) for i in range(1,len(cs)))
    return abs(cs[-1]-cs[0])/den if den>0 else 0

def features(c):
    sym=c['symbol'];t=int(c['entry_ts_ms']);sg=1 if c['side']=='LONG' else -1
    prev=b(sym,t-H)
    if prev is None:return None
    px=float(prev['close']);A=atr(sym,t,14)
    if not A or A<=0:return None
    x=dict(c)
    for n in [3,6,12,24,48]:
        sr=ret(sym,t,n);br=ret('BTCUSDT',t,n)
        x[f'sret{n}']=None if sr is None else sg*sr
        x[f'btc{n}']=None if br is None else sg*br
        x[f'rel{n}']=None if sr is None or br is None else sg*(sr-br)
    x['atr14_pct']=A/px
    x['er12']=efficiency(sym,t,12);x['er24']=efficiency(sym,t,24)
    cs=closes(sym,t,48)
    x['ema12_dist']=None if not cs else sg*(px-ema(cs[-24:],12))/A
    x['ema24_dist']=None if not cs else sg*(px-ema(cs,24))/A
    vols=[]
    for i in range(25,1,-1):
        z=b(sym,t-i*H)
        if z is not None:vols.append(float(z['quote_volume']))
    med=median(vols)
    x['vol_ratio']=float(prev['quote_volume'])/med if med and med>0 else None
    prior=[b(sym,t-i*H) for i in range(25,1,-1)]
    if all(z is not None for z in prior):
        hi=max(float(z['high']) for z in prior);lo=min(float(z['low']) for z in prior)
        x['break24_atr']=(px-hi)/A if sg==1 else (lo-px)/A
        x['range_loc24']=(px-lo)/(hi-lo) if hi>lo else .5
        if sg==-1:x['range_loc24']=1-x['range_loc24']
    else:
        x['break24_atr']=None;x['range_loc24']=None
    recent=[b(sym,t-i*H) for i in range(13,0,-1)]
    if all(z is not None for z in recent):
        fav=max(float(z['high']) for z in recent) if sg==1 else min(float(z['low']) for z in recent)
        x['pullback12_atr']=(fav-px)/A if sg==1 else (px-fav)/A
    else:x['pullback12_atr']=None
    a6=atr(sym,t,6);a24=atr(sym,t,24)
    x['compression']=a6/a24 if a6 and a24 else None
    o=float(prev['open']);hi=float(prev['high']);lo=float(prev['low']);cl=float(prev['close'])
    x['body_atr']=sg*(cl-o)/A
    x['clv']=((cl-lo)/(hi-lo) if hi>lo else .5)
    if sg==-1:x['clv']=1-x['clv']
    return x

def pred(x,p):
    v=lambda k:x.get(k)
    if p=='SIDE_SHORT':return x['side']=='SHORT'
    if p=='SIDE_LONG':return x['side']=='LONG'
    if p=='AGE_0_24':return v('age') is not None and 0<=v('age')<24
    if p=='AGE_24_48':return v('age') is not None and 24<=v('age')<48
    if p=='AGE_48_72':return v('age') is not None and 48<=v('age')<72
    if p=='AGE_72_97':return v('age') is not None and 72<=v('age')<97
    if p=='RET6_NEG':return v('sret6') is not None and v('sret6')<0
    if p=='RET6_0_05':return v('sret6') is not None and 0<=v('sret6')<.005
    if p=='RET6_05_15':return v('sret6') is not None and .005<=v('sret6')<.015
    if p=='RET6_15_30':return v('sret6') is not None and .015<=v('sret6')<.03
    if p=='RET6_GE30':return v('sret6') is not None and v('sret6')>=.03
    if p=='EMA_LT0':return v('ema12_dist') is not None and v('ema12_dist')<0
    if p=='EMA_0_05':return v('ema12_dist') is not None and 0<=v('ema12_dist')<.5
    if p=='EMA_05_10':return v('ema12_dist') is not None and .5<=v('ema12_dist')<1
    if p=='EMA_10_20':return v('ema12_dist') is not None and 1<=v('ema12_dist')<2
    if p=='EMA_GE20':return v('ema12_dist') is not None and v('ema12_dist')>=2
    if p=='BTC6_ALIGNED':return v('btc6') is not None and v('btc6')>=0
    if p=='BTC6_OPPOSE':return v('btc6') is not None and v('btc6')<0
    if p=='BTC24_ALIGNED':return v('btc24') is not None and v('btc24')>=0
    if p=='BTC24_OPPOSE':return v('btc24') is not None and v('btc24')<0
    if p=='REL12_POS':return v('rel12') is not None and v('rel12')>0
    if p=='REL12_NEG':return v('rel12') is not None and v('rel12')<=0
    if p=='REL24_POS':return v('rel24') is not None and v('rel24')>0
    if p=='REL24_NEG':return v('rel24') is not None and v('rel24')<=0
    if p=='BREAK24':return v('break24_atr') is not None and v('break24_atr')>=0
    if p=='NO_BREAK24':return v('break24_atr') is not None and v('break24_atr')<0
    if p=='VOL_GE1':return v('vol_ratio') is not None and v('vol_ratio')>=1
    if p=='VOL_LT1':return v('vol_ratio') is not None and v('vol_ratio')<1
    if p=='ER24_GE30':return v('er24') is not None and v('er24')>=.3
    if p=='ER24_LT30':return v('er24') is not None and v('er24')<.3
    if p=='RANGE_TOP25':return v('range_loc24') is not None and v('range_loc24')>=.75
    if p=='RANGE_NOT_TOP25':return v('range_loc24') is not None and v('range_loc24')<.75
    if p=='PULLBACK_025_15':return v('pullback12_atr') is not None and .25<=v('pullback12_atr')<=1.5
    if p=='PULLBACK_GT15':return v('pullback12_atr') is not None and v('pullback12_atr')>1.5
    if p=='BODY_FAVOR':return v('body_atr') is not None and v('body_atr')>0
    if p=='BODY_OPPOSE':return v('body_atr') is not None and v('body_atr')<=0
    if p=='CLV_FAVOR':return v('clv') is not None and v('clv')>=.6
    if p=='CLV_OPPOSE':return v('clv') is not None and v('clv')<=.4
    raise KeyError(p)

def match(x,rule):return all(pred(x,p) for p in rule)

GOOD=[
 ('REC_G1_MID_REL_LOWVOL',['SIDE_SHORT','RET6_05_15','REL12_POS','VOL_LT1']),
 ('REC_G2_EARLY_BTC_OPPOSE_VOL',['SIDE_SHORT','AGE_0_24','BTC6_OPPOSE','VOL_GE1']),
 ('REC_G3_LATE_BTC_REL',['SIDE_SHORT','AGE_72_97','BTC6_ALIGNED','REL12_POS']),
 ('REC_G4_MATURE_REL_RANGE',['SIDE_SHORT','AGE_48_72','REL24_POS','RANGE_NOT_TOP25']),
 ('REC_G5_SLOW_TREND',['SIDE_SHORT','RET6_0_05','BTC6_ALIGNED','ER24_LT30']),
]

def assign(x):
    # Frozen robust complement has priority, exactly as the development filter.
    if x['side']=='SHORT' and 24<=x['age']<48 and .005<=x['diag_ret6']<.015 and x['diag_ema']>=1:
        return 'CONT_SHORT_MID_AGE24_48','LEGACY'
    for name,rule in GOOD:
        if match(x,rule):return name,'LEGACY'
    for i,r in enumerate(stage2,1):
        if match(x,r['rule']):return f"REC_X{i:02d}_{r['exit']}",r['exit']
    for i,r in enumerate(stage3,1):
        if match(x,r['rule']):return f"REC_Y{i:02d}_{r['exit']}",r['exit']
    return None,None

def legacy_exit(c):
    sym=c['symbol'];e=float(c['entry_price']);A=float(c['atr']);sg=1 if c['side']=='LONG' else -1
    stop=e-sg*max(2.477*A,e*.005);peak=e;tp=e+sg*3.1995*A;t0=int(c['entry_ts_ms']);end=t0+46*H
    for t in range(t0,end,H):
        z=b(sym,t)
        if z is None:return None
        px=None;reason=None
        if (sg==1 and float(z['low'])<=stop) or (sg==-1 and float(z['high'])>=stop):
            px=min(stop,float(z['open'])) if sg==1 else max(stop,float(z['open']));reason='STOP'
        if px is None and ((sg==1 and float(z['high'])>=tp) or (sg==-1 and float(z['low'])<=tp)):
            px=tp;reason='TAKE_PROFIT'
        if px is None and (t+H)%(2*H)==0:
            prev=b(sym,t-H) or z
            peak=max(peak,float(z['high']),float(prev['high'])) if sg==1 else min(peak,float(z['low']),float(prev['low']))
            next_stop=max(stop,peak-.2*A) if sg==1 else min(stop,peak+.2*A)
            nxt=b(sym,t+H)
            if nxt is not None and ((sg==1 and float(nxt['open'])<=next_stop) or (sg==-1 and float(nxt['open'])>=next_stop)):
                px=float(nxt['open']);reason='TRAILING_CROSSED_BEFORE_REPLACEMENT'
            stop=next_stop
        if px is not None:
            return dict(c,exit_ts_ms=t+H,exit_price=px,exit_reason=reason,unit_gross_return=sg*(px/e-1))
    z=b(sym,end)
    if z is None:return None
    px=float(z['open'])
    return dict(c,exit_ts_ms=end,exit_price=px,exit_reason='TIME_EXIT',unit_gross_return=sg*(px/e-1))

def time_exit(c,hours):
    sym=c['symbol'];t=int(c['entry_ts_ms'])+hours*H;z=b(sym,t)
    if z is None:return None
    e=float(c['entry_price']);px=float(z['open']);sg=1 if c['side']=='LONG' else -1
    return dict(c,exit_ts_ms=t,exit_price=px,exit_reason=f'TIME_{hours}H',unit_gross_return=sg*(px/e-1))

def tpsl_exit(c,tp,sl,hold):
    sym=c['symbol'];t0=int(c['entry_ts_ms']);e=float(c['entry_price']);sg=1 if c['side']=='LONG' else -1
    A=atr(sym,t0,14)
    if not A:return None
    tp_px=e+sg*tp*A;sl_px=e-sg*sl*A
    for h in range(hold):
        t=t0+h*H;z=b(sym,t)
        if z is None:return None
        hi=float(z['high']);lo=float(z['low']);op=float(z['open'])
        hit_sl=(lo<=sl_px if sg==1 else hi>=sl_px)
        hit_tp=(hi>=tp_px if sg==1 else lo<=tp_px)
        if hit_sl:
            px=min(sl_px,op) if sg==1 else max(sl_px,op)
            return dict(c,exit_ts_ms=t+H,exit_price=px,exit_reason='TP_SL_STOP',unit_gross_return=sg*(px/e-1))
        if hit_tp:
            return dict(c,exit_ts_ms=t+H,exit_price=tp_px,exit_reason='TP_SL_TP',unit_gross_return=sg*(tp_px/e-1))
    return time_exit(c,hold)

def reverse_time_exit(c,delay,hold):
    sym=c['symbol'];orig_t=int(c['entry_ts_ms']);new_t=orig_t+delay*H
    ez=b(sym,new_t)
    if delay==0:
        e=float(c['entry_price'])
    else:
        if ez is None:return None
        e=float(ez['open'])
    z=b(sym,new_t+hold*H)
    if z is None:return None
    px=float(z['open']);new_side='SHORT' if c['side']=='LONG' else 'LONG';sg=1 if new_side=='LONG' else -1
    out=dict(c,source_side=c['side'],source_entry_ts_ms=orig_t,side=new_side,entry_ts_ms=new_t,entry_price=e,
             exit_ts_ms=new_t+hold*H,exit_price=px,exit_reason=f'REV_D{delay}_T{hold}',unit_gross_return=sg*(px/e-1))
    return out

def apply_exit(c,exit_name):
    if exit_name=='LEGACY':return legacy_exit(c)
    m=re.fullmatch(r'TIME_(\d+)H',exit_name)
    if m:return time_exit(c,int(m.group(1)))
    m=re.fullmatch(r'TP([\d.]+)_SL([\d.]+)_H(\d+)',exit_name)
    if m:return tpsl_exit(c,float(m.group(1)),float(m.group(2)),int(m.group(3)))
    m=re.fullmatch(r'REV_D(\d+)_T(\d+)',exit_name)
    if m:return reverse_time_exit(c,int(m.group(1)),int(m.group(2)))
    raise ValueError(exit_name)

def stat(trades,cost):
    vals=[x['unit_gross_return']-cost/10000 for x in trades]
    n=len(vals);pos=sum(max(v,0) for v in vals);neg=-sum(min(v,0) for v in vals);total=sum(vals)
    best=max(vals) if vals else None
    return {'n':n,'wr':sum(v>0 for v in vals)/n if n else None,
            'pf':pos/neg if neg else (math.inf if pos else None),
            'mean':total/n if n else None,'sum':total,
            'without_best':None if best is None else total-best,
            'best':best,'worst':min(vals) if vals else None}

features_list=[];route_trades=[];unassigned=[];incomplete=[]
for c0 in candidates:
    x=features(c0)
    if x is None:
        incomplete.append({'candidate':c0,'reason':'FEATURE_INCOMPLETE'});continue
    features_list.append(x)
    route,exit_name=assign(x)
    if route is None:
        unassigned.append(x);continue
    c=dict(x,route=route,route_exit=exit_name)
    z=apply_exit(c,exit_name)
    if z is None:
        incomplete.append({'candidate':c,'reason':'EXIT_INCOMPLETE'});continue
    route_trades.append(z)

# Add the independently generated FAILED_BREAK core for the same conservative entry window.
core=[]
for x in rows(CORE_DIR/'holdout-trades.jsonl'):
    if START<=int(x['entry_ts_ms'])<ENTRY_END:
        y=dict(x,route='FAILED_BREAK_REV_SHORT_6H',unit_gross_return=float(x['unit_gross_return']))
        core.append(y)

# Development filter adds Core only if exact symbol/side/entry token is not already present.
tokens={(x['symbol'],x['side'],int(x['entry_ts_ms'])) for x in route_trades}
core_added=[];core_overlaps=[]
for x in core:
    k=(x['symbol'],x['side'],int(x['entry_ts_ms']))
    if k in tokens:core_overlaps.append(x)
    else:
        core_added.append(x);tokens.add(k)
all_trades=route_trades+core_added
all_trades.sort(key=lambda x:(int(x['entry_ts_ms']),x['symbol'],x.get('route','')))

route_groups=collections.defaultdict(list);months=collections.defaultdict(list)
for x in all_trades:
    route_groups[x['route']].append(x)
    months[dt.datetime.fromtimestamp(int(x['entry_ts_ms'])/1000,dt.timezone.utc).strftime('%Y-%m')].append(x)

report={
 'status':'COMPLETE_CAUSAL_MULTILOGIC_EXTERNAL_HOLDOUT',
 'research_only':True,'live_changes':False,'production_changes':False,
 'route_rules_frozen_before_holdout_run':True,
 'development_identity_keys_used_for_routing':False,
 'data_gate':'Separate Aster H1 refetch; pre-holdout overlap parity 14/14 symbols, 1704 H1 rows/symbol, zero mismatches.',
 'candidate_engine':'Exact current buildV12Signals() extraction.',
 'period':{'entry_start_inclusive':dt.datetime.fromtimestamp(START/1000,dt.timezone.utc).isoformat(),
           'entry_end_exclusive':dt.datetime.fromtimestamp(ENTRY_END/1000,dt.timezone.utc).isoformat(),
           'data_end_exclusive':dt.datetime.fromtimestamp(DATA_END/1000,dt.timezone.utc).isoformat()},
 'baseline_candidate_count':len(candidates),
 'feature_complete_count':len(features_list),
 'assigned_baseline_routes':len(route_trades),
 'unassigned_baseline_candidates':len(unassigned),
 'failed_break_core_candidates':len(core),
 'failed_break_core_added':len(core_added),
 'failed_break_exact_overlaps':len(core_overlaps),
 'total_v12_logic_trades_before_portfolio_ownership':len(all_trades),
 'costs':{str(c):stat(all_trades,c) for c in [10,20,30]},
 'by_route':{r:{str(c):stat(a,c) for c in [10,20,30]} for r,a in sorted(route_groups.items())},
 'by_month':{m:{str(c):stat(a,c) for c in [10,20,30]} for m,a in sorted(months.items())},
 'route_counts':dict(sorted((r,len(a)) for r,a in route_groups.items())),
 'limitations':[
   'V12-only causal route-edge holdout; fresh non-V12 portfolio ownership/funding streams are not replayed.',
   'Logical Virtual Leg gross-cap and venue-min orchestration are not replayed here; this tests route selection and price exits.',
   'The date range has been viewed previously for older V12 core research, so treat as post-selection external validation rather than pristine project-level OOS.',
   'Only about 55 days of entry opportunities are available after reserving 74h for the longest frozen exit.',
   'No rule threshold is changed in response to these results.'
 ]
}
BASE.mkdir(parents=True,exist_ok=True)
(BASE/'causal-features.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in features_list),encoding='utf-8')
(BASE/'causal-trades.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in all_trades),encoding='utf-8')
(BASE/'unassigned.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in unassigned),encoding='utf-8')
(BASE/'causal-holdout-report.json').write_text(json.dumps(report,indent=2,allow_nan=True),encoding='utf-8')
print(json.dumps(report,indent=2,allow_nan=True))
