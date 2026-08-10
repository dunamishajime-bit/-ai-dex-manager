from __future__ import annotations

import argparse, json, math, os, statistics
from pathlib import Path

import research_lab_six_pair_one_year_v98 as base

HOUR = base.HOUR
SYMS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]
NORMAL_BPS = 10.0
STRESS_BPS = 30.0

ret = base.ret
metric = base.metric
future_trade = base.future_trade


def mean(xs):
    return statistics.fmean(xs) if xs else 0.0


def stdev(xs):
    return statistics.pstdev(xs) if len(xs) > 1 else 0.0


def rsi_like(c, i, n=24):
    if i < n: return 50.0
    rs = [ret(c, j, 1) or 0.0 for j in range(i-n+1, i+1)]
    up = sum(max(x, 0.0) for x in rs)
    dn = sum(max(-x, 0.0) for x in rs)
    return 100.0 if dn <= 1e-12 else 100.0 - 100.0 / (1.0 + up / dn)


def realized_vol(c, i, n):
    if i < n: return None
    rs = [ret(c, j, 1) or 0.0 for j in range(i-n+1, i+1)]
    return stdev(rs)


def efficiency(c, i, n):
    if i < n: return None
    closes = [float(c[j]["close"]) for j in range(i-n, i+1)]
    path = sum(abs(closes[j]-closes[j-1]) for j in range(1, len(closes)))
    return abs(closes[-1]-closes[0]) / path if path > 1e-12 else 0.0


def breadth(candles, idx, ts, n=24):
    vals=[]
    for s in SYMS:
        i=idx[s].get(ts)
        if i is None: continue
        x=ret(candles[s], i, n)
        if x is not None: vals.append(x)
    return sum(x>0 for x in vals)/len(vals) if vals else 0.5


def market_impulse(candles, idx, ts, n=12):
    vals=[]
    for s in SYMS:
        i=idx[s].get(ts)
        if i is None: continue
        x=ret(candles[s], i, n)
        if x is not None: vals.append(x)
    return statistics.median(vals) if vals else 0.0


# Different assets get different candidate mechanisms. Selection is Development-only then frozen.
TEMPLATES = {
    "BTC": ["trend_quality", "vol_breakout", "exhaustion_fade", "shock_recovery"],
    "ETH": ["trend_quality", "relative_leadership", "vol_breakout", "pullback_resume"],
    "BNB": ["low_vol_breakout", "pullback_resume", "relative_leadership", "exhaustion_fade"],
    "SOL": ["vol_breakout", "shock_recovery", "exhaustion_fade", "trend_quality"],
    "LINK": ["relative_leadership", "pullback_resume", "shock_recovery", "vol_breakout"],
    "AVAX": ["shock_recovery", "exhaustion_fade", "vol_breakout", "relative_leadership"],
}

ARCH = {
  "A": {"risk":1.00,"cool":6,"trend":1.2,"shock":2.4,"breadth":0.50},
  "B": {"risk":0.85,"cool":8,"trend":1.6,"shock":2.8,"breadth":0.50},
  "C": {"risk":1.00,"cool":4,"trend":1.0,"shock":2.2,"breadth":0.34},
  "D": {"risk":0.75,"cool":10,"trend":1.8,"shock":3.0,"breadth":0.66},
}


def signal(template, s, candles, idx, ts, cfg):
    c=candles[s]; i=idx[s].get(ts)
    if i is None or i < 800: return None
    r3=ret(c,i,3); r6=ret(c,i,6); r12=ret(c,i,12); r24=ret(c,i,24); r72=ret(c,i,72); r168=ret(c,i,168)
    if None in (r3,r6,r12,r24,r72,r168): return None
    v24=realized_vol(c,i,24); v168=realized_vol(c,i,168); eff=efficiency(c,i,72)
    if v24 is None or v168 is None or eff is None or v168 <= 1e-9: return None
    br=breadth(candles,idx,ts,24); mkt=market_impulse(candles,idx,ts,12)
    rs=r24-mkt
    rsi=rsi_like(c,i,24)
    # no-trade: abnormal noise without directional efficiency
    if v24 > v168*2.8 and eff < .12: return None

    if template=="trend_quality":
        # regime + direction + breadth + quality confirmation; exit horizon 30h
        if eff>.28 and abs(r72)>cfg["trend"] and ((r72>0 and br>=cfg["breadth"]) or (r72<0 and br<=1-cfg["breadth"])):
            if r12*r72>0 and abs(r12)>.35: return (1 if r72>0 else -1, 30, 1.0)
    elif template=="vol_breakout":
        # compression->expansion plus directional/breadth confirmation
        if v24>v168*1.18 and eff>.22 and abs(r12)>cfg["trend"]:
            if (r12>0 and br>=.50) or (r12<0 and br<=.50): return (1 if r12>0 else -1, 18, .9)
    elif template=="low_vol_breakout":
        # low-vol state followed by controlled impulse; avoids chasing high vol
        vold=realized_vol(c,i-24,96)
        if vold and vold<v168*.82 and v24>vold*1.12 and abs(r6)>.55 and eff>.18:
            return (1 if r6>0 else -1, 24, .8)
    elif template=="exhaustion_fade":
        # overextension + low path efficiency + short-term reversal confirmation
        if abs(r24)>cfg["shock"] and eff<.34 and ((r24>0 and rsi>68 and r3<0) or (r24<0 and rsi<32 and r3>0)):
            return (-1 if r24>0 else 1, 12, .65)
    elif template=="shock_recovery":
        # market shock then asset-specific stabilization/recovery
        if abs(mkt)>cfg["shock"] and abs(r24)>1.5:
            if mkt<0 and r3>0 and rs>.35: return (1,18,.75)
            if mkt>0 and r3<0 and rs<-.35: return (-1,18,.65)
    elif template=="relative_leadership":
        # cross-asset residual leadership only in a coherent market state
        if abs(rs)>.9 and eff>.20:
            if rs>0 and r12>0 and br>=.50: return (1,24,.85)
            if rs<0 and r12<0 and br<=.50: return (-1,18,.75)
    elif template=="pullback_resume":
        # established medium trend, counter-move, then resumption confirmation
        if abs(r168)>2.0 and eff>.20:
            if r168>0 and r24<-.6 and r3>.15 and rsi<55: return (1,30,.8)
            if r168<0 and r24>.6 and r3<-.15 and rsi>45: return (-1,24,.7)
    return None


def pair_events(template,s,candles,idx,start,end,costbps,delay,cfg):
    out=[]; last_exit=-1
    for row in candles[s]:
        ts=int(row["ts"])
        if ts<start or ts>=end or ts<=last_exit: continue
        sig=signal(template,s,candles,idx,ts,cfg)
        if not sig: continue
        side,hold,weight=sig
        v=future_trade(candles[s],idx[s],ts,side,hold,delay,costbps)
        if v is None: continue
        out.append((ts,v*weight*cfg["risk"]))
        last_exit=ts+hold*HOUR+cfg["cool"]*HOUR
    return out


def select_templates(candles,idx,period,cfg):
    start,end=period; chosen={}; diagnostics={}
    for s in SYMS:
        best=None
        for t in TEMPLATES[s]:
            ev=pair_events(t,s,candles,idx,start,end,NORMAL_BPS,0,cfg)
            vals=[v for _,v in ev]; m=metric(vals)
            # Development-only ranking; rewards return/PF/sample, penalizes DD/concentration.
            pf=m.get("pf") or 0.0; tr=m.get("trades") or 0; dd=abs(m.get("maxDDPct") or 0.0); retp=m.get("returnPct") or 0.0
            conc=m.get("bestSharePct") or 100.0
            score=(retp*1.5)+(min(pf,2.5)-1.0)*12+min(tr,40)*.18-dd*.35-max(0,conc-35)*.15
            rec={"template":t,"score":score,"metric":m}
            if best is None or score>best[0]: best=(score,t,m)
        chosen[s]=best[1]; diagnostics[s]={"template":best[1],"development":best[2]}
    return chosen,diagnostics


def portfolio(chosen,candles,idx,start,end,costbps,delay,cfg):
    byts={}; pairvals={s:[] for s in SYMS}
    for s,t in chosen.items():
        ev=pair_events(t,s,candles,idx,start,end,costbps,delay,cfg)
        for ts,v in ev:
            byts.setdefault(ts,[]).append((s,v))
            pairvals[s].append(v)
    pvals=[]; contrib={s:0.0 for s in SYMS}
    # Portfolio allocator: cap simultaneous exposure, equal risk among active pair engines.
    for ts in sorted(byts):
        xs=sorted(byts[ts], key=lambda z:abs(z[1]), reverse=True)[:3]
        if not xs: continue
        scale=min(1.0, 1.8/len(xs))
        pv=sum(v*scale for _,v in xs)
        pvals.append(pv)
        for s,v in xs: contrib[s]+=v*scale
    return metric(pvals), {s:metric(pairvals[s]) for s in SYMS}, contrib


def robust(m, stress, hold=None, holdstress=None):
    if (m.get("pf") or 0)<1.20 or (m.get("maxDDPct") or -999)<=-20 or (stress.get("pf") or 0)<=1.0: return False
    if hold is not None:
        if (hold.get("pf") or 0)<=1.0 or (hold.get("returnPct") or 0)<=0 or (holdstress.get("pf") or 0)<=1.0: return False
    return True


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--arch",choices=ARCH,required=True); args=ap.parse_args(); cfg=ARCH[args.arch]
    candles,idx,_=base.load(); ps=base.periods(candles)
    chosen,devdiag=select_templates(candles,idx,ps["development"],cfg)
    dm,dp,dc=portfolio(chosen,candles,idx,*ps["development"],NORMAL_BPS,0,cfg)
    vm,vp,vc=portfolio(chosen,candles,idx,*ps["validation"],NORMAL_BPS,0,cfg)
    vs,_,_=portfolio(chosen,candles,idx,*ps["validation"],STRESS_BPS,1,cfg)
    result={"strategyId":f"PAIR_SPECIFIC_V100_{args.arch}","periods":ps,"chosenPairEngines":chosen,"development":dm,"validation":vm,"validationStress":vs,"pairDevelopmentSelection":devdiag,"productionChanged":False,"realTradingEnabled":False}
    # Fast funnel: only survivors consume untouched Confirmation/Holdout.
    if (dm.get("pf") or 0)<1.05 or (dm.get("returnPct") or 0)<=0 or (vm.get("pf") or 0)<1.05 or (vm.get("returnPct") or 0)<=0:
        result.update(status="FAIL",reason="FAST_FUNNEL")
    else:
        cm,cp,cc=portfolio(chosen,candles,idx,*ps["confirmation"],NORMAL_BPS,0,cfg)
        cs,_,_=portfolio(chosen,candles,idx,*ps["confirmation"],STRESS_BPS,1,cfg)
        result.update(confirmation=cm,confirmationStress=cs)
        if not robust(cm,cs):
            result.update(status="FAIL",reason="CONFIRMATION")
        else:
            hm,hp,hc=portfolio(chosen,candles,idx,*ps["holdout"],NORMAL_BPS,0,cfg)
            hs,_,_=portfolio(chosen,candles,idx,*ps["holdout"],STRESS_BPS,1,cfg)
            # Full one-year fixed-engine result for reporting only, never selection/tuning.
            ystart=ps["development"][0]; yend=ps["holdout"][1]
            ym,yp,yc=portfolio(chosen,candles,idx,ystart,yend,NORMAL_BPS,0,cfg)
            ys,_,_=portfolio(chosen,candles,idx,ystart,yend,STRESS_BPS,1,cfg)
            passall=robust(ym,ys,hm,hs) and (ym.get("returnPct") or 0)>=60 and all((yp[s].get("returnPct") or 0)>-10 for s in SYMS)
            result.update(holdout=hm,holdoutStress=hs,year=ym,yearStress=ys,yearPair=yp,yearContribution=yc,status="PASS" if passall else "FAIL",reason="PASS" if passall else "FINAL_TARGET")
    out=Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR",".research-state")); out.mkdir(parents=True,exist_ok=True)
    stem=f"pair-specific-v100-{args.arch.lower()}"; txt=json.dumps(result,indent=2)
    (out/f"{stem}.json").write_text(txt,encoding="utf-8"); (out/f"{stem}.md").write_text(f"# {result['strategyId']}\n\n```json\n{txt}\n```\n",encoding="utf-8")
    print(txt)

if __name__=="__main__": main()
