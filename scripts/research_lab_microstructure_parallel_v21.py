from __future__ import annotations
import datetime as dt, json, math, os, statistics
from dataclasses import dataclass
from pathlib import Path

STATE=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')).resolve()
HISTORY=STATE/'aster-market-intelligence-v19'/'history'
SYMBOLS=['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','LINKUSDT','AVAXUSDT']
FAMILY=os.environ.get('MICROSTRUCTURE_FAMILY','PREMIUM_SHOCK')
MIN_HOURS=720.0; MIN_DAYS=30; NORMAL_FLOOR=7.0; STRESS_FLOOR=30.0

@dataclass(frozen=True)
class Variant:
    variant_id:str; hold_seconds:int; threshold:float; aux:float; mode:str

def f(v,d=0.0):
    try:
        x=float(v); return x if math.isfinite(x) else d
    except (TypeError,ValueError): return d

def percentile(xs,q):
    xs=sorted(x for x in xs if math.isfinite(x))
    if not xs:return None
    p=(len(xs)-1)*q; a=math.floor(p); b=math.ceil(p)
    return xs[a] if a==b else xs[a]*(b-p)+xs[b]*(p-a)

def load_rows():
    out=[]
    if not HISTORY.exists(): return out
    for p in sorted(HISTORY.glob('*.ndjson')):
        for line in p.read_text(encoding='utf-8').splitlines():
            try:
                r=json.loads(line)
                if r.get('symbol') in SYMBOLS and f(r.get('mid'))>0: out.append(r)
            except Exception: pass
    return sorted(out,key=lambda r:(int(r.get('timestamp',0)),str(r.get('symbol',''))))

def split(rows):
    ts=sorted({int(r['timestamp']) for r in rows}); s,e=ts[0],ts[-1]+1; span=e-s
    a=s+int(span*.40); b=s+int(span*.65); c=s+int(span*.85)
    return {'development':(s,a),'validation':(a,b),'confirmation':(b,c),'holdout':(c,e)}

def inside(r,p): return p[0]<=int(r['timestamp'])<p[1]

def pf(xs):
    w=sum(x for x in xs if x>0); l=abs(sum(x for x in xs if x<0))
    return w/l if l>1e-12 else (999.0 if w>0 else None)

def metrics(trades):
    xs=[t['netPct'] for t in trades]; eq=peak=1.0; dd=0.0
    for x in xs:
        eq*=max(.001,1+x/100); peak=max(peak,eq); dd=min(dd,(eq/peak-1)*100)
    pos=[x for x in xs if x>0]; best=max(pos) if pos else 0.0; total=sum(pos); share=best/total*100 if total>0 else 0.0
    ex=xs.copy()
    if best>0: ex.remove(best)
    return {'trades':len(xs),'winRatePct':sum(x>0 for x in xs)/len(xs)*100 if xs else 0.0,'returnPct':(eq-1)*100,'profitFactor':pf(xs),'maxDrawdownPct':dd,'bestTradeProfitSharePct':share,'profitFactorWithoutBest':pf(ex),'meanTradePct':statistics.fmean(xs) if xs else 0.0}

def dev_params(rows,periods):
    d=[r for r in rows if inside(r,periods['development'])]
    basis=[abs(f(r.get('basisBps'))) for r in d]
    funding=[abs(f(r.get('fundingRate'))*10000) for r in d]
    depth=[]; spread=[]
    for r in d:
        bd=f(r.get('bidDepth10Bps')); ad=f(r.get('askDepth10Bps')); total=bd+ad
        if total>0: depth.append(abs(bd-ad)/total)
        spread.append(max(f(r.get('spreadBps')),f(r.get('roundTrip1000Bps'))))
    return {'basis90':percentile(basis,.90) or 8.0,'basis95':percentile(basis,.95) or 10.0,'fund90':percentile(funding,.90) or .5,'fund95':percentile(funding,.95) or 1.0,'depth90':percentile(depth,.90) or .5,'depth95':percentile(depth,.95) or .65,'liq90':percentile(spread,.90) or 10.0,'liq95':percentile(spread,.95) or 15.0}

def variants(q):
    if FAMILY=='PREMIUM_SHOCK': return [Variant('PREM_CONT_P90_H60',60,q['basis90'],0,'continuation'),Variant('PREM_REV_P95_H300',300,q['basis95'],0,'reversal')]
    if FAMILY=='FUNDING_SQUEEZE': return [Variant('FUND_CONT_P90_H300',300,q['fund90'],.20,'continuation'),Variant('FUND_REV_P95_H900',900,q['fund95'],.25,'reversal')]
    if FAMILY=='DEPTH_PERSISTENCE': return [Variant('DEPTH_CONT_P90_H60',60,q['depth90'],.15,'continuation'),Variant('DEPTH_REV_P95_H300',300,q['depth95'],.20,'reversal')]
    if FAMILY=='LIQUIDITY_SHOCK': return [Variant('LIQSHOCK_REV_P90_H60',60,q['liq90'],.20,'reversal'),Variant('LIQSHOCK_CONT_P95_H300',300,q['liq95'],.25,'continuation')]
    raise RuntimeError('unknown family')

def raw_signal(r,v):
    if FAMILY=='PREMIUM_SHOCK':
        x=f(r.get('basisBps'))
        if abs(x)<v.threshold:return 0
        raw=1 if x>0 else -1
    elif FAMILY=='FUNDING_SQUEEZE':
        fund=f(r.get('fundingRate'))*10000; taker=f(r.get('takerImbalance')); basis=f(r.get('basisBps'))
        if abs(fund)<v.threshold or abs(taker)<v.aux or fund*taker<=0:return 0
        raw=1 if fund>0 else -1
        if basis*raw<0:return 0
    elif FAMILY=='DEPTH_PERSISTENCE':
        bd=f(r.get('bidDepth10Bps')); ad=f(r.get('askDepth10Bps')); total=bd+ad
        imb=(bd-ad)/total if total>0 else 0.0; taker=f(r.get('takerImbalance'))
        if abs(imb)<v.threshold or abs(taker)<v.aux or imb*taker<=0:return 0
        raw=1 if imb>0 else -1
    else:
        shock=max(f(r.get('spreadBps')),f(r.get('roundTrip1000Bps'))); taker=f(r.get('takerImbalance'))
        if shock<v.threshold or abs(taker)<v.aux:return 0
        raw=1 if taker>0 else -1
    return -raw if v.mode=='reversal' else raw

def simulate(rows,v,period,stress):
    rr=[r for r in rows if inside(r,period)]; rr.sort(key=lambda r:int(r['timestamp'])); by={int(r['timestamp']):r for r in rr}; out=[]; cooldown=-1; hold=v.hold_seconds*1000
    for r in rr:
        ts=int(r['timestamp'])
        if ts<cooldown: continue
        side=raw_signal(r,v)
        if not side: continue
        fut=by.get(ts+hold)
        if fut is None: continue
        a=f(r.get('mid')); b=f(fut.get('mid'))
        if a<=0 or b<=0: continue
        gross=side*(b/a-1)*100; observed=f(r.get('roundTrip1000Bps'),NORMAL_FLOOR); normal=max(NORMAL_FLOOR,observed); cost=max(STRESS_FLOOR,normal+15) if stress else normal
        funding=side*f(r.get('fundingRate'))*(v.hold_seconds/28800)*100; net=gross-cost/100-funding
        out.append({'entryTs':ts,'symbol':r['symbol'],'side':side,'netPct':net}); cooldown=ts+hold
    return out

def pooled(rows,v,p,stress):
    out=[]
    for s in SYMBOLS: out.extend(simulate([r for r in rows if r['symbol']==s],v,p,stress))
    return sorted(out,key=lambda x:x['entryTs'])

def gate(m,stress=False):
    return m['trades']>=20 and (m['profitFactor'] or 0)>=(1.0 if stress else 1.2) and m['returnPct']>0 and m['maxDrawdownPct']>-20 and m['bestTradeProfitSharePct']<35 and (m['profitFactorWithoutBest'] or 0)>=1.0

def main():
    rows=load_rows(); outdir=STATE/f'microstructure-{FAMILY.lower()}-v21'; outdir.mkdir(parents=True,exist_ok=True)
    if not rows: result={'status':'NO_V19_HISTORY','family':FAMILY,'robustCandidate':None}
    else:
        periods=split(rows); q=dev_params(rows,periods); items=[]
        for v in variants(q):
            n={k:metrics(pooled(rows,v,p,False)) for k,p in periods.items()}; s={k:metrics(pooled(rows,v,p,True)) for k,p in periods.items()}; items.append({'variant':v.__dict__,'normal':n,'stress':s})
        eligible=[x for x in items if gate(x['normal']['development']) and gate(x['stress']['development'],True)]; eligible.sort(key=lambda x:((x['normal']['development']['profitFactor'] or 0),x['normal']['development']['returnPct']),reverse=True); selected=eligible[0] if eligible else None
        ts=[int(r['timestamp']) for r in rows]; hours=(max(ts)-min(ts))/3600000; days=len({dt.datetime.fromtimestamp(t/1000,tz=dt.timezone.utc).date() for t in ts}); ready=hours>=MIN_HOURS and days>=MIN_DAYS
        robust=None
        if ready and selected and all(gate(selected['normal'][p]) and gate(selected['stress'][p],True) for p in ['validation','confirmation','holdout']): robust=selected
        status='ROBUST_MICROSTRUCTURE_CANDIDATE' if robust else ('MICROSTRUCTURE_ROBUST_GATE_PENDING_30D' if not ready else 'NO_ROBUST_IMPROVEMENT')
        result={'version':21,'strategyId':f'MICROSTRUCTURE_{FAMILY}_V21','generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'family':FAMILY,'status':status,'coverage':{'observationHours':hours,'calendarDays':days,'rows':len(rows),'robustDataReady':ready},'periods':periods,'developmentOnlyThresholds':q,'variants':items,'selectedDevelopmentOnly':selected,'robustCandidate':robust,'rules':{'normalPf':1.2,'stressPf':1.0,'maxDdPct':-20,'bestTradeProfitSharePctMax':35,'minimumObservationHours':720,'minimumCalendarDays':30},'productionChanged':False,'realTradingEnabled':False,'limitations':['Public V19 market data only; no credentials/orders/accounts/positions.','Thresholds and selection use Development only.','Confirmation/Holdout never used for retuning.','Exact future buckets required; collection gaps are never bridged.','No synthetic OI/liquidation history.']}
    stem=f'microstructure-{FAMILY.lower()}-v21'; (outdir/f'{stem}.json').write_text(json.dumps(result,indent=2),encoding='utf-8'); (outdir/f'{stem}.md').write_text(f"# {FAMILY} Microstructure V21\n\n- Status: **{result['status']}**\n- Robust candidate: **{'YES' if result.get('robustCandidate') else 'NO'}**\n- Production changed: NO\n- Real trading: DISABLED\n",encoding='utf-8'); print(json.dumps(result,indent=2))
if __name__=='__main__': main()
