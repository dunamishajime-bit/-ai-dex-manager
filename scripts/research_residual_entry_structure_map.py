"""Residual/OHLCV Entry Structure Map.

Research-only event study after Counter-Factor Entry was rejected.
Four structurally distinct entry motifs are frozen before results; all are common
across ETH/BNB/SOL/LINK/AVAX and use only causal OHLCV-derived inputs already
available in frozen V109/V15 research code.

1. RESIDUAL_IMPULSE
   Residual 12h and 48h agree in sign, the 12h residual is accelerating relative to
   the 48h residual, and its absolute residual strength is above the cross-sectional
   median at the timestamp.
2. PULLBACK_REACCELERATION
   Residual 48h defines the ownership side, 12h absolute return is opposite that
   side (pullback), and 3h + 6h absolute returns have resumed the 48h side.
3. COMPRESSION_EXPANSION
   24h/96h volatility ratio is below the cross-sectional median (compression), while
   normalized 6h return magnitude is above the cross-sectional median and agrees
   with the 24h return sign (expansion direction).
4. EXHAUSTION_REVERSAL
   Absolute normalized 72h move is above the cross-sectional median, 6h return has
   reversed that 72h direction, and current 96h range position lies on the expected
   half of the range (lower half for long reversal, upper half for short reversal).

No continuous threshold grid, no pair-specific values, no annual selector. The only
comparators are timestamp-local cross-sectional medians and sign relationships.
At every event measure predeclared 6h/24h/48h forward returns.
Normal = next-open + full 10bps/side roundtrip (20bps).
Stress = one-hour delayed entry + full 30bps/side roundtrip (60bps).
No Fresh OOS, VPS, LIVE, orders, deployment, or production mutation.
"""
from __future__ import annotations
import json, math, os, statistics
from collections import defaultdict
from pathlib import Path
import research_residual_market_ownership_v15 as v15
import research_lab_pair_specific_v109 as v109
import research_priority_router_v6_historical_robustness as hist

TRADE=v15.TRADE
OBS_HOURS=6
HORIZONS=(6,24,48)
STRUCTURES=('RESIDUAL_IMPULSE','PULLBACK_REACCELERATION','COMPRESSION_EXPANSION','EXHAUSTION_REVERSAL')
PERIODS=v15.PERIODS

def sgn(x):return 1 if x>0 else -1 if x<0 else 0

def med(xs):return statistics.median(xs) if xs else 0.0

def row_features(candles,idx,ts):
    residual=v15.ownership_states(candles,idx,ts)
    rows={}
    for s in TRADE:
        i=idx[s].get(ts)
        st=residual.get(s)
        if i is None or i<900 or st is None:continue
        c=candles[s];v168=v109.b.vol(c,i,168);v24=v109.b.vol(c,i,24);v96=v109.b.vol(c,i,96)
        if v168<=1e-12 or v96<=1e-12:continue
        r3=v109.b.ret(c,i,3) or 0.0;r6=v109.b.ret(c,i,6) or 0.0;r12=v109.b.ret(c,i,12) or 0.0;r24=v109.b.ret(c,i,24) or 0.0;r72=v109.b.ret(c,i,72) or 0.0
        norm6=r6/(v168*math.sqrt(6)+1e-12);norm72=r72/(v168*math.sqrt(72)+1e-12)
        rows[s]={'rr12':float(st['residual12']),'rr48':float(st['residual48']),'r3':float(r3),'r6':float(r6),'r12':float(r12),'r24':float(r24),'r72':float(r72),'norm6':float(norm6),'norm72':float(norm72),'volRatio':float(v24/v96),'rangePos':float(v109.b.range_position(c,i,96))}
    return rows

def motifs(rows):
    if not rows:return []
    med_abs_rr12=med([abs(r['rr12']) for r in rows.values()]);med_abs_n6=med([abs(r['norm6']) for r in rows.values()]);med_abs_n72=med([abs(r['norm72']) for r in rows.values()]);med_vr=med([r['volRatio'] for r in rows.values()])
    out=[]
    for s,r in rows.items():
        rrside=sgn(r['rr48']);r72side=sgn(r['r72'])
        # 1 residual impulse
        if rrside and sgn(r['rr12'])==rrside and abs(r['rr12'])>=abs(r['rr48']) and abs(r['rr12'])>=med_abs_rr12:
            out.append(('RESIDUAL_IMPULSE',s,rrside))
        # 2 pullback reacceleration
        if rrside and sgn(r['r12'])==-rrside and sgn(r['r3'])==rrside and sgn(r['r6'])==rrside:
            out.append(('PULLBACK_REACCELERATION',s,rrside))
        # 3 compression expansion
        side6=sgn(r['r6'])
        if r['volRatio']<=med_vr and side6 and side6==sgn(r['r24']) and abs(r['norm6'])>=med_abs_n6:
            out.append(('COMPRESSION_EXPANSION',s,side6))
        # 4 exhaustion reversal
        if r72side and abs(r['norm72'])>=med_abs_n72 and sgn(r['r6'])==-r72side:
            rev=-r72side
            if (rev>0 and r['rangePos']<=0.5) or (rev<0 and r['rangePos']>=0.5):
                out.append(('EXHAUSTION_REVERSAL',s,rev))
    return out

def fwd(candles,idx,s,ts,side,h,delay):
    i=idx[s].get(ts)
    if i is None:return None
    ei=i+1+delay;xi=ei+h
    if xi>=len(candles[s]):return None
    ep=float(candles[s][ei]['open']);xp=float(candles[s][xi]['open'])
    if ep<=0:return None
    return side*(xp/ep-1)*100

def summary(xs):
    if not xs:return {'count':0,'meanPct':None,'medianPct':None,'pf':None,'winRatePct':None,'sumPctPoints':0.0}
    g=sum(max(0,x) for x in xs);l=sum(max(0,-x) for x in xs)
    return {'count':len(xs),'meanPct':statistics.fmean(xs),'medianPct':statistics.median(xs),'pf':g/l if l>1e-12 else (999.0 if g>0 else None),'winRatePct':100*sum(x>0 for x in xs)/len(xs),'sumPctPoints':sum(xs)}

def diagnose(candles,idx,start,end):
    times=[int(r['ts']) for r in candles['BTC'] if start<=int(r['ts'])<end][::OBS_HOURS];samples=defaultdict(lambda:{'gross':[],'normal':[],'stress':[]})
    for ts in times:
        rows=row_features(candles,idx,ts)
        for kind,s,side in motifs(rows):
            for h in HORIZONS:
                g0=fwd(candles,idx,s,ts,side,h,0);g1=fwd(candles,idx,s,ts,side,h,1)
                if g0 is None or g1 is None:continue
                key=(kind,h);samples[key]['gross'].append(g0);samples[key]['normal'].append(g0-.20);samples[key]['stress'].append(g1-.60)
    out={}
    for (kind,h),vals in sorted(samples.items()):out.setdefault(kind,{})[f'{h}h']={'gross':summary(vals['gross']),'normalRoundTrip':summary(vals['normal']),'stressDelay1RoundTrip':summary(vals['stress'])}
    return out

def main():
    candles,idx,_=v109.b.base.load()
    if v15.END_2026>hist.DATA_END:raise RuntimeError('HISTORICAL_BOUNDARY_EXCEEDS_FROZEN_DATA')
    periods={k:diagnose(candles,idx,a,b) for k,(a,b) in PERIODS.items()}
    out={'researchLine':'RESIDUAL_ENTRY_STRUCTURE_MAP','researchOnly':True,'instrumentationOnly':True,'strategyChanged':False,'structuresFrozenBeforeResults':list(STRUCTURES),'horizonsFrozenBeforeResultsHours':list(HORIZONS),'normalRoundTripCostPct':0.20,'stressRoundTripCostPct':0.60,'pairSpecificParameters':False,'parameterGrid':False,'productionChanged':False,'vpsChanged':False,'liveChanged':False,'realTradingEnabled':False,'freshOosRead':False,'post20260701DataUsed':False,'periods':periods,'nextAction':'ONLY_REPRODUCIBLE_ENTRY_STRUCTURE_MAY_FEED_NEXT_OWNERSHIP_ENGINE'}
    root=Path(os.environ.get('RESEARCH_STATE_DIR','.research-state'));root.mkdir(parents=True,exist_ok=True);(root/'residual-entry-structure-map.json').write_text(json.dumps(out,indent=2,sort_keys=True),encoding='utf-8');print(json.dumps(out,indent=2,sort_keys=True))
if __name__=='__main__':main()
