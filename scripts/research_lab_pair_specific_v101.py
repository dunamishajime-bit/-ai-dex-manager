from __future__ import annotations

import argparse, json, math, os, statistics
from pathlib import Path

import research_lab_six_pair_one_year_v98 as base

HOUR=base.HOUR
SYMS=["BTC","ETH","BNB","SOL","LINK","AVAX"]
NORMAL_BPS=10.0
STRESS_BPS=30.0
ret=base.ret
metric=base.metric
future_trade=base.future_trade


def mean(xs): return statistics.fmean(xs) if xs else 0.0

def sd(xs): return statistics.pstdev(xs) if len(xs)>1 else 0.0

def rseries(c,i,n):
    if i<n:return []
    return [ret(c,j,1) or 0.0 for j in range(i-n+1,i+1)]

def corr(a,b):
    if len(a)<12 or len(a)!=len(b):return 0.0
    ma,mb=mean(a),mean(b); va=sum((x-ma)**2 for x in a); vb=sum((x-mb)**2 for x in b)
    if va<=1e-12 or vb<=1e-12:return 0.0
    return sum((x-ma)*(y-mb) for x,y in zip(a,b))/math.sqrt(va*vb)

def lag1(c,i,n=96):
    x=rseries(c,i,n)
    return corr(x[:-1],x[1:]) if len(x)>=12 else 0.0

def semivol_ratio(c,i,n=96):
    x=rseries(c,i,n)
    up=sum(v*v for v in x if v>0); dn=sum(v*v for v in x if v<0)
    return math.sqrt(dn/max(1,sum(v<0 for v in x)))/max(math.sqrt(up/max(1,sum(v>0 for v in x))),1e-9)

def efficiency(c,i,n=72):
    if i<n:return 0.0
    p=[float(c[j]["close"]) for j in range(i-n,i+1)]
    path=sum(abs(p[j]-p[j-1]) for j in range(1,len(p)))
    return abs(p[-1]-p[0])/path if path>1e-12 else 0.0

def vol(c,i,n): return sd(rseries(c,i,n))

def breadth(candles,idx,ts,n=24):
    xs=[]
    for s in SYMS:
        i=idx[s].get(ts)
        if i is not None:
            v=ret(candles[s],i,n)
            if v is not None:xs.append(v)
    return sum(v>0 for v in xs)/len(xs) if xs else .5

def market_median(candles,idx,ts,n):
    xs=[]
    for s in SYMS:
        i=idx[s].get(ts)
        if i is not None:
            v=ret(candles[s],i,n)
            if v is not None:xs.append(v)
    return statistics.median(xs) if xs else 0.0

def residual_vs_btc(candles,idx,s,ts,n=96):
    i=idx[s].get(ts); bi=idx["BTC"].get(ts)
    if i is None or bi is None or i<n or bi<n:return None
    ar=rseries(candles[s],i,n); br=rseries(candles["BTC"],bi,n)
    vb=sum(x*x for x in br)
    beta=sum(x*y for x,y in zip(ar,br))/vb if vb>1e-12 else 1.0
    return [a-beta*b for a,b in zip(ar,br)],beta

def session(ts): return (ts//HOUR)%24

# Mechanisms here are deliberately distinct from V100's trend-quality/pullback/shock templates.
CANDIDATES={
 "BTC":["serial_state_switch","downside_asymmetry_recovery","session_persistence"],
 "ETH":["btc_residual_release","serial_state_switch","session_persistence"],
 "BNB":["variance_term_structure","downside_asymmetry_recovery","btc_residual_release"],
 "SOL":["serial_state_switch","variance_term_structure","downside_asymmetry_recovery"],
 "LINK":["btc_residual_release","session_persistence","variance_term_structure"],
 "AVAX":["downside_asymmetry_recovery","btc_residual_release","serial_state_switch"],
}
ARCH={
 "A":{"risk":1.0,"cool":6,"maxslots":3},
 "B":{"risk":.85,"cool":8,"maxslots":4},
 "C":{"risk":1.05,"cool":5,"maxslots":2},
 "D":{"risk":.75,"cool":10,"maxslots":3},
}

def signal(mech,s,candles,idx,ts,cfg):
    c=candles[s]; i=idx[s].get(ts)
    if i is None or i<850:return None
    r3=ret(c,i,3); r6=ret(c,i,6); r12=ret(c,i,12); r24=ret(c,i,24); r72=ret(c,i,72)
    if None in (r3,r6,r12,r24,r72):return None
    v24=vol(c,i,24); v96=vol(c,i,96); v336=vol(c,i,336); eff=efficiency(c,i,72); br=breadth(candles,idx,ts,24)
    if v336<=1e-9:return None
    # common no-trade gate: pathological noise or broad market conflict
    if v24>3.2*v336 and eff<.10:return None

    if mech=="serial_state_switch":
        old=lag1(c,i-72,168); new=lag1(c,i,72)
        if old<-.04 and new>.06 and abs(r6)>.55 and eff>.16:
            return (1 if r6>0 else -1,18,.80)
        if old>.08 and new<-.04 and abs(r12)>1.0 and eff<.32:
            return (-1 if r12>0 else 1,12,.65)

    elif mech=="downside_asymmetry_recovery":
        old=semivol_ratio(c,i-48,168); new=semivol_ratio(c,i,48)
        # state transition from downside-dominant risk into stabilization, or inverse for shorts
        if old>1.20 and new<.92 and r3>0 and r24<0 and br>=.34:
            return (1,24,.75)
        if old<.82 and new>1.18 and r3<0 and r24>0 and br<=.66:
            return (-1,18,.65)

    elif mech=="btc_residual_release":
        rr=residual_vs_btc(candles,idx,s,ts,192)
        if rr is None:return None
        resid,beta=rr; oldsd=sd(resid[:144]); newsd=sd(resid[-24:]); impulse=sum(resid[-6:])
        if oldsd>1e-9 and newsd>oldsd*1.45 and abs(impulse)>.65:
            # only act if residual release is not simply broad market direction
            m=market_median(candles,idx,ts,6)
            if abs(impulse-m)>.35:return (1 if impulse>0 else -1,18,.75)

    elif mech=="variance_term_structure":
        # transition in realized-vol term structure; direction confirmed only after transition
        old=vol(c,i-24,24)/max(vol(c,i-24,168),1e-9)
        new=v24/max(vol(c,i,168),1e-9)
        if old<.72 and new>1.08 and abs(r6)>.55 and eff>.17:
            return (1 if r6>0 else -1,18,.80)
        if old>1.55 and new<1.05 and abs(r24)>1.6 and r3*r24<0:
            return (-1 if r24>0 else 1,12,.55)

    elif mech=="session_persistence":
        h=session(ts)
        # fixed UTC transition windows; direction must be earned from within-pair recent persistence
        if h not in (0,1,7,8,13,14,16,17):return None
        ac=lag1(c,i,72)
        if ac>.05 and abs(r3)>.35 and eff>.15:return (1 if r3>0 else -1,9,.55)
        if ac<-.06 and abs(r3)>.55 and eff<.25:return (-1 if r3>0 else 1,6,.45)
    return None

def events(mech,s,candles,idx,start,end,cost,delay,cfg):
    out=[]; last=-1
    for row in candles[s]:
        ts=int(row["ts"])
        if not(start<=ts<end) or ts<=last:continue
        sg=signal(mech,s,candles,idx,ts,cfg)
        if not sg:continue
        side,hold,w=sg
        x=future_trade(candles[s],idx[s],ts,side,hold,delay,cost)
        if x is None:continue
        out.append((ts,x*w*cfg["risk"])); last=ts+(hold+cfg["cool"])*HOUR
    return out

def choose(candles,idx,period,cfg):
    chosen={}; diag={}
    for s in SYMS:
        best=None
        for mech in CANDIDATES[s]:
            vals=[v for _,v in events(mech,s,candles,idx,*period,NORMAL_BPS,0,cfg)]
            m=metric(vals); pf=m.get("pf") or 0; tr=m.get("trades") or 0; rp=m.get("returnPct") or 0; dd=abs(m.get("maxDDPct") or 0); conc=m.get("bestSharePct") or 100
            score=1.7*rp+10*(min(pf,2.5)-1)+.20*min(tr,45)-.30*dd-.12*max(0,conc-35)
            if best is None or score>best[0]:best=(score,mech,m)
        chosen[s]=best[1]; diag[s]={"mechanism":best[1],"development":best[2]}
    return chosen,diag

def portfolio(chosen,candles,idx,start,end,cost,delay,cfg):
    byts={}; pair={s:[] for s in SYMS}
    for s,m in chosen.items():
        for ts,v in events(m,s,candles,idx,start,end,cost,delay,cfg):
            byts.setdefault(ts,[]).append((s,v)); pair[s].append(v)
    vals=[]; contrib={s:0.0 for s in SYMS}
    for ts in sorted(byts):
        xs=sorted(byts[ts],key=lambda z:abs(z[1]),reverse=True)[:cfg["maxslots"]]
        if not xs:continue
        scale=min(1.0,1.8/len(xs)); p=sum(v*scale for _,v in xs); vals.append(p)
        for s,v in xs:contrib[s]+=v*scale
    return metric(vals),{s:metric(pair[s]) for s in SYMS},contrib

def gate(m,stress):
    return (m.get("pf") or 0)>=1.20 and (m.get("returnPct") or 0)>0 and (m.get("maxDDPct") or -999)>-20 and (stress.get("pf") or 0)>1.0

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--arch",choices=ARCH,required=True); a=ap.parse_args(); cfg=ARCH[a.arch]
    candles,idx,_=base.load(); ps=base.periods(candles); chosen,diag=choose(candles,idx,ps["development"],cfg)
    dm,_,_=portfolio(chosen,candles,idx,*ps["development"],NORMAL_BPS,0,cfg)
    vm,_,_=portfolio(chosen,candles,idx,*ps["validation"],NORMAL_BPS,0,cfg)
    vs,_,_=portfolio(chosen,candles,idx,*ps["validation"],STRESS_BPS,1,cfg)
    result={"strategyId":f"PAIR_SPECIFIC_V101_{a.arch}","periods":ps,"chosenPairEngines":chosen,"selection":diag,"development":dm,"validation":vm,"validationStress":vs,"productionChanged":False,"realTradingEnabled":False}
    if (dm.get("pf") or 0)<1.05 or (dm.get("returnPct") or 0)<=0 or (vm.get("pf") or 0)<1.05 or (vm.get("returnPct") or 0)<=0:
        result.update(status="FAIL",reason="FAST_FUNNEL")
    else:
        cm,_,_=portfolio(chosen,candles,idx,*ps["confirmation"],NORMAL_BPS,0,cfg); cs,_,_=portfolio(chosen,candles,idx,*ps["confirmation"],STRESS_BPS,1,cfg)
        result.update(confirmation=cm,confirmationStress=cs)
        if not gate(cm,cs):result.update(status="FAIL",reason="CONFIRMATION")
        else:
            hm,hp,hc=portfolio(chosen,candles,idx,*ps["holdout"],NORMAL_BPS,0,cfg); hs,_,_=portfolio(chosen,candles,idx,*ps["holdout"],STRESS_BPS,1,cfg)
            y0=ps["development"][0]; y1=ps["holdout"][1]; ym,yp,yc=portfolio(chosen,candles,idx,y0,y1,NORMAL_BPS,0,cfg); ys,_,_=portfolio(chosen,candles,idx,y0,y1,STRESS_BPS,1,cfg)
            ok=gate(ym,ys) and (hm.get("pf") or 0)>1 and (hm.get("returnPct") or 0)>0 and (hs.get("pf") or 0)>1 and (ym.get("returnPct") or 0)>=60 and sum((yp[s].get("returnPct") or 0)>0 for s in SYMS)>=4
            result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,yearPair=yp,yearContribution=yc,status="PASS" if ok else "FAIL",reason="PASS" if ok else "FINAL_TARGET")
    out=Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR",".research-state")); out.mkdir(parents=True,exist_ok=True); stem=f"pair-specific-v101-{a.arch.lower()}"; txt=json.dumps(result,indent=2)
    (out/f"{stem}.json").write_text(txt,encoding="utf-8"); (out/f"{stem}.md").write_text(f"# {result['strategyId']}\n\n```json\n{txt}\n```\n",encoding="utf-8"); print(txt)
if __name__=="__main__":main()
