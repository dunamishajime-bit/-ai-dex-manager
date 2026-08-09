from __future__ import annotations

import argparse, json, math, os, statistics
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import research_lab_parameter_bagged_rotation_v4 as v4

HOUR=v4.HOUR
SYMS=v4.SYMBOLS
TRADE=["ETH","BNB","SOL","LINK","AVAX"]
PERIODS={"development":(v4.START_2023,v4.START_2024),"validation":(v4.START_2024,v4.START_2025),"confirmation":(v4.START_2025,v4.START_2026),"holdout":(v4.START_2026,v4.END)}
NORMAL_BPS=10.0; STRESS_BPS=30.0


def pf(xs):
    w=sum(x for x in xs if x>0); l=abs(sum(x for x in xs if x<0)); return (w/l if l>1e-12 else (999.0 if w>0 else None))
def prod(xs):
    e=1.0
    for x in xs:e*=max(.001,1+x/100)
    return (e-1)*100
def dd(xs):
    e=p=1.; m=0.
    for x in xs:
        e*=max(.001,1+x/100); p=max(p,e); m=min(m,(e/p-1)*100)
    return m
def metric(xs):
    if not xs:return {"trades":0,"returnPct":0,"pf":None,"maxDDPct":0,"winRatePct":0,"bestSharePct":0,"pfWithoutBest":None}
    best=max(xs); wins=sum(x for x in xs if x>0); share=(best/wins*100 if wins>0 else 0)
    ys=list(xs); ys.remove(best)
    return {"trades":len(xs),"returnPct":prod(xs),"pf":pf(xs),"maxDDPct":dd(xs),"winRatePct":sum(x>0 for x in xs)/len(xs)*100,"bestSharePct":share,"pfWithoutBest":pf(ys)}

def ret(c,i,n):
    if i-n<0:return None
    a=float(c[i-n]["close"]); b=float(c[i]["close"]); return (b/a-1)*100 if a>0 else None
def vol(c,i,n):
    if i-n<0:return None
    xs=[]
    for j in range(i-n+1,i+1):
        a=float(c[j-1]["close"]); b=float(c[j]["close"])
        if a>0 and b>0: xs.append(math.log(b/a))
    return statistics.pstdev(xs)*math.sqrt(24*365)*100 if len(xs)>1 else None
def zscore(xs,x):
    if len(xs)<10:return None
    s=statistics.pstdev(xs); return (x-statistics.fmean(xs))/s if s>1e-12 else 0

def load():
    root=Path.cwd()/'.cache/perp-research-usdm'
    raw={s:v4.load_symbol(root,s) for s in SYMS}
    candles={s:raw[s]["candles"] for s in SYMS}
    idx={s:{int(r["ts"]):i for i,r in enumerate(candles[s])} for s in SYMS}
    fund={s:raw[s].get("funding",[]) for s in SYMS}
    fby={}
    for s in SYMS:
        d={}
        for p in fund[s]: d[int(p["ts"]//HOUR*HOUR)]=float(p["rate"])*100
        fby[s]=d
    return candles,idx,fby

def future_trade(c,idx,ts,side,hold,delay,costbps):
    i=idx.get(ts)
    if i is None:return None
    a=i+1+delay; b=a+hold
    if b>=len(c):return None
    entry=float(c[a]["open"]); exit=float(c[b]["open"])
    if entry<=0:return None
    return side*((exit/entry-1)*100)-costbps/100

def variants(fam):
    if fam=='crash_rebound': return [(a,h,b) for a in [-6,-8,-10] for h in [6,12,24] for b in [2,3]]
    if fam=='failed_breakout': return [(n,k,h) for n in [24,48,96] for k in [.2,.5,1.] for h in [6,12,24]]
    if fam=='volume_exhaustion': return [(z,r,h) for z in [2,2.5,3] for r in [3,5,8] for h in [6,12,24]]
    if fam=='funding_shock': return [(z,h,mode) for z in [1.5,2,2.5] for h in [8,16,24] for mode in ['fade','follow']]
    if fam=='btc_shock_propagation': return [(x,h,mode) for x in [2,3,4] for h in [3,6,12] for mode in ['fade','follow']]
    if fam=='correlation_break': return [(n,z,h) for n in [72,168,336] for z in [1.5,2,2.5] for h in [6,12,24]]
    if fam=='weekend_session': return [(hour,wd,h) for hour in [0,8,16] for wd in [4,5,6] for h in [4,8,12]]
    if fam=='panic_breadth': return [(k,x,h) for k in [3,4,5] for x in [-3,-5,-7] for h in [6,12,24]]
    raise ValueError(fam)

def generate(fam,p,candles,idx,fby,start,end,costbps,delay):
    btc=candles['BTC']; out=[]; last_exit=-1
    times=[int(r['ts']) for r in btc if start<=int(r['ts'])<end]
    for ts in times:
        bi=idx['BTC'].get(ts)
        if bi is None or bi<400 or ts<=last_exit: continue
        picks=[]
        if fam=='crash_rebound':
            shock,hold,bars=p; rr=ret(btc,bi,24)
            if rr is not None and rr<=shock:
                recent=[(float(btc[j]['close'])/float(btc[j]['open'])-1)*100 for j in range(max(0,bi-bars+1),bi+1)]
                if recent and recent[-1]>0: picks=[('BTC',1,hold)]
        elif fam=='failed_breakout':
            n,k,hold=p
            for s in TRADE:
                i=idx[s].get(ts); c=candles[s]
                if i is None or i<n+2: continue
                prev_hi=max(float(x['high']) for x in c[i-n:i]); prev_lo=min(float(x['low']) for x in c[i-n:i]); close=float(c[i]['close']); high=float(c[i]['high']); low=float(c[i]['low'])
                rng=max(1e-12,prev_hi-prev_lo)
                if high>prev_hi and close<prev_hi-k*rng/100: picks.append((s,-1,hold))
                elif low<prev_lo and close>prev_lo+k*rng/100: picks.append((s,1,hold))
        elif fam=='volume_exhaustion':
            zz,move,hold=p
            for s in TRADE:
                i=idx[s].get(ts); c=candles[s]
                if i is None or i<169:continue
                vols=[float(x.get('volume',0)) for x in c[i-168:i]]; vz=zscore(vols,float(c[i].get('volume',0))); r=ret(c,i,8)
                if vz is not None and r is not None and vz>=zz and abs(r)>=move: picks.append((s,-1 if r>0 else 1,hold))
        elif fam=='funding_shock':
            zz,hold,mode=p
            for s in TRADE:
                hist=[]
                for h in range(1,121):
                    val=fby[s].get(ts-h*HOUR)
                    if val is not None: hist.append(val)
                cur=fby[s].get(ts)
                z=zscore(hist,cur) if cur is not None else None
                if z is not None and abs(z)>=zz: picks.append((s,(-1 if z>0 else 1)*(1 if mode=='fade' else -1),hold))
        elif fam=='btc_shock_propagation':
            x,hold,mode=p; r=ret(btc,bi,1)
            if r is not None and abs(r)>=x:
                side=(1 if r>0 else -1)*(1 if mode=='follow' else -1)
                picks=[(s,side,hold) for s in TRADE]
        elif fam=='correlation_break':
            n,zz,hold=p
            br=[ret(btc,j,1) or 0 for j in range(bi-n+1,bi+1)]
            for s in TRADE:
                i=idx[s].get(ts); c=candles[s]
                if i is None or i<n:continue
                sr=[ret(c,j,1) or 0 for j in range(i-n+1,i+1)]
                beta=(sum(a*b for a,b in zip(br,sr))/max(1e-12,sum(a*a for a in br)))
                residuals=[b-beta*a for a,b in zip(br[:-1],sr[:-1])]; cur=sr[-1]-beta*br[-1]; z=zscore(residuals,cur)
                if z is not None and abs(z)>=zz:picks.append((s,-1 if z>0 else 1,hold))
        elif fam=='weekend_session':
            hour,wd,hold=p
            import datetime
            d=datetime.datetime.fromtimestamp(ts/1000,tz=datetime.timezone.utc)
            if d.hour==hour and d.weekday()==wd:
                r=ret(btc,bi,24)
                if r is not None and abs(r)>.5:picks=[('BTC',1 if r>0 else -1,hold)]
        elif fam=='panic_breadth':
            k,x,hold=p; down=[]
            for s in SYMS:
                i=idx[s].get(ts); r=ret(candles[s],i,24) if i is not None else None
                if r is not None and r<=x: down.append(s)
            if len(down)>=k:picks=[(s,1,hold) for s in TRADE if s in down]
        if not picks: continue
        vals=[]
        for s,side,hold in picks:
            v=future_trade(candles[s],idx[s],ts,side,hold,delay,costbps)
            if v is not None: vals.append(v)
        if vals:
            out.append(sum(vals)/len(vals)); last_exit=ts+max(q[2] for q in picks)*HOUR
    return out

def pass_gate(m,stage):
    mintr=25 if stage!='holdout' else 12
    return m['trades']>=mintr and (m['pf'] or 0)>=1.05 and m['returnPct']>0 and m['maxDDPct']>-20 and m['bestSharePct']<50

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--family',required=True); args=ap.parse_args(); fam=args.family
    candles,idx,fby=load(); candidates=[]
    for p in variants(fam):
        dev=metric(generate(fam,p,candles,idx,fby,*PERIODS['development'],NORMAL_BPS,0))
        if dev['trades']>=30 and (dev['pf'] or 0)>=1.15 and dev['maxDDPct']>-20 and dev['bestSharePct']<45:
            val=metric(generate(fam,p,candles,idx,fby,*PERIODS['validation'],NORMAL_BPS,0))
            if pass_gate(val,'validation'): candidates.append((p,dev,val))
    candidates.sort(key=lambda x:((x[1]['pf'] or 0)+(x[2]['pf'] or 0),x[1]['trades']+x[2]['trades']),reverse=True)
    selected=None; confirmation=None; stress_conf=None; hold=None; stress_hold=None
    for p,dev,val in candidates[:5]:
        conf=metric(generate(fam,p,candles,idx,fby,*PERIODS['confirmation'],NORMAL_BPS,0))
        sconf=metric(generate(fam,p,candles,idx,fby,*PERIODS['confirmation'],STRESS_BPS,1))
        if conf['trades']>=25 and (conf['pf'] or 0)>=1.2 and conf['returnPct']>0 and conf['maxDDPct']>-20 and conf['bestSharePct']<45 and (conf['pfWithoutBest'] or 0)>1 and (sconf['pf'] or 0)>1 and sconf['returnPct']>0:
            selected=(p,dev,val); confirmation=conf; stress_conf=sconf; break
    robust=False
    if selected:
        p=selected[0]
        hold=metric(generate(fam,p,candles,idx,fby,*PERIODS['holdout'],NORMAL_BPS,0)); stress_hold=metric(generate(fam,p,candles,idx,fby,*PERIODS['holdout'],STRESS_BPS,1))
        robust=hold['trades']>=12 and (hold['pf'] or 0)>1 and hold['returnPct']>0 and hold['maxDDPct']>-20 and hold['bestSharePct']<50 and (stress_hold['pf'] or 0)>1
    result={"strategyId":"PARALLEL_EVENT_REGIME_V53","family":fam,"tested":len(variants(fam)),"devValidationPasses":len(candidates),"selectedParams":selected[0] if selected else None,"development":selected[1] if selected else None,"validation":selected[2] if selected else None,"confirmation":confirmation,"stressConfirmation":stress_conf,"holdout":hold,"stressHoldout":stress_hold,"robust":robust,"status":"ROBUST_PASS" if robust else "NO_ROBUST_IMPROVEMENT","productionChanged":False,"realTradingEnabled":False,"limitations":["No fabricated liquidation/order-book/OI history.","Holdout opened only after fixed Confirmation pass.","Research-only; V6/V9 and production untouched."]}
    out=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); out.mkdir(parents=True,exist_ok=True)
    stem=f"parallel-event-regime-v53-{fam}"; (out/f'{stem}.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    lines=[f"# Event Regime V53 — {fam}","",f"- Status: **{result['status']}**",f"- Tested: {result['tested']}",f"- Development+Validation passes: {result['devValidationPasses']}",f"- Robust: **{robust}**","",json.dumps(result,indent=2)]
    (out/f'{stem}.md').write_text('\n'.join(lines),encoding='utf-8'); print('\n'.join(lines))
if __name__=='__main__':main()
