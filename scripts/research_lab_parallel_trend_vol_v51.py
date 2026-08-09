from __future__ import annotations

import json, math, os, statistics
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_nextgen_independent_families_v49 as base

FAMILY=os.environ.get("TREND_VOL_FAMILY", "all")
H=base.HOUR
SYMS=base.SYMBOLS
ALTS=base.ALTS
DEV,VAL,CONF,FINAL=base.DEV,base.VAL,base.CONF,base.FINAL
NORMAL_BPS,STRESS_BPS=base.NORMAL_BPS,base.STRESS_BPS


def sma(xs,i,n):
    return statistics.fmean(xs[i-n+1:i+1]) if i>=n-1 else None

def rv(closes,s,i,n):
    return base.ann_vol(closes,s,i,n)

def normalize(w,g): return base.normalize(w,g)
def expand(times,sig): return base.expand_targets(times,sig)

def hold_targets(times, entries):
    out={}; active={}; until=-1
    idx={t:i for i,t in enumerate(times)}
    for t in times:
        i=idx[t]
        if i>until: active={}
        if t in entries:
            active,hold=entries[t]
            until=i+hold-1 if active else -1
        out[t]=active
    return out

def compression_expansion(v,times,closes,highs,lows):
    p=v.params; entries={}
    for i,t in enumerate(times):
        need=max(p['slowVol'],p['breakout'])+2
        if t<base.DEV[0] or i<need or (t//H)%p['scanEvery']: continue
        triggers=[]
        for s in ALTS:
            fast=rv(closes,s,i,p['fastVol']); slow=rv(closes,s,i,p['slowVol'])
            if not fast or not slow or fast/slow>p['compressRatio']: continue
            hi=max(highs[s][i-p['breakout']:i]); lo=min(lows[s][i-p['breakout']:i])
            if closes[s][i]>hi: triggers.append((s,1,(closes[s][i]/hi-1)*100/max(fast,1)))
            elif closes[s][i]<lo: triggers.append((s,-1,(lo/closes[s][i]-1)*100/max(fast,1)))
        longs=[x for x in triggers if x[1]>0]; shorts=[x for x in triggers if x[1]<0]
        side=longs if len(longs)>=p['breadth'] else shorts if len(shorts)>=p['breadth'] else []
        if side:
            sel=sorted(side,key=lambda x:x[2],reverse=True)[:p['topK']]
            entries[t]=(normalize({s:sgn for s,sgn,_ in sel},p['gross']),p['hold'])
    return hold_targets(times,entries)

def trend_acceleration(v,times,closes,highs,lows):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<DEV[0] or i<p['slow']+2 or (t//H)%p['rebalance']: continue
        vals=[]
        for s in ALTS:
            rfast=base.pctret(closes,s,i,p['fast']); rslow=base.pctret(closes,s,i,p['slow'])
            if rfast is None or rslow is None: continue
            accel=rfast-rslow*(p['fast']/p['slow'])
            vals.append((s,accel,rslow))
        pos=[x for x in vals if x[1]>=p['minAccel'] and x[2]>0]
        neg=[x for x in vals if x[1]<=-p['minAccel'] and x[2]<0]
        target={}
        if len(pos)>=p['breadth']:
            sel=sorted(pos,key=lambda x:x[1],reverse=True)[:p['topK']]; target=normalize({s:1 for s,_,__ in sel},p['gross'])
        elif len(neg)>=p['breadth']:
            sel=sorted(neg,key=lambda x:x[1])[:p['topK']]; target=normalize({s:-1 for s,_,__ in sel},p['gross'])
        sig[t]=target
    return expand(times,sig)

def breadth_momentum(v,times,closes,highs,lows):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<DEV[0] or i<max(p['horizon'],p['btcTrend'])+2 or (t//H)%p['rebalance']: continue
        btc=base.pctret(closes,'BTC',i,p['btcTrend']); vals=[]
        if btc is None: continue
        for s in ALTS:
            r=base.pctret(closes,s,i,p['horizon'])
            if r is not None: vals.append((s,r))
        pos=sum(r>0 for _,r in vals); neg=sum(r<0 for _,r in vals); target={}
        if btc>p['btcMin'] and pos>=p['breadth']:
            sel=sorted(vals,key=lambda x:x[1],reverse=True)[:p['topK']]; target=normalize({s:1 for s,_ in sel if _>0},p['gross'])
        elif btc<-p['btcMin'] and neg>=p['breadth']:
            sel=sorted(vals,key=lambda x:x[1])[:p['topK']]; target=normalize({s:-1 for s,_ in sel if _<0},p['gross'])
        sig[t]=target
    return expand(times,sig)

def downside_cash_hedge(v,times,closes,highs,lows):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<DEV[0] or i<p['slowMA']+2 or (t//H)%p['rebalance']: continue
        ma=sma(closes['BTC'],i,p['slowMA']); mom=base.pctret(closes,'BTC',i,p['momentum'])
        if ma is None or mom is None: continue
        riskoff=closes['BTC'][i] < ma*(1-p['maBuffer']/100) and mom < -p['momMin']
        sig[t]={'BTC':-p['gross']} if riskoff else {}
    return expand(times,sig)

def vol_regime_rotation(v,times,closes,highs,lows):
    p=v.params; sig={}
    for i,t in enumerate(times):
        if t<DEV[0] or i<max(p['volLookback'],p['slowH'])+2 or (t//H)%p['rebalance']: continue
        bv=rv(closes,'BTC',i,p['volLookback'])
        if not bv: continue
        horizon=p['fastH'] if bv>=p['highVol'] else p['slowH'] if bv<=p['lowVol'] else p['midH']
        vals=[]
        for s in ALTS:
            r=base.pctret(closes,s,i,horizon)
            if r is not None: vals.append((s,r))
        if not vals: continue
        pos=[x for x in vals if x[1]>p['minMom']]; neg=[x for x in vals if x[1]<-p['minMom']]; target={}
        if len(pos)>=p['breadth']:
            sel=sorted(pos,key=lambda x:x[1],reverse=True)[:p['topK']]; target=normalize({s:1 for s,_ in sel},p['gross'])
        elif len(neg)>=p['breadth']:
            sel=sorted(neg,key=lambda x:x[1])[:p['topK']]; target=normalize({s:-1 for s,_ in sel},p['gross'])
        sig[t]=target
    return expand(times,sig)

def session_breakout(v,times,closes,highs,lows):
    p=v.params; entries={}
    for i,t in enumerate(times):
        if t<DEV[0] or i<p['rangeHours']+2: continue
        hour=(t//H)%24
        if hour!=p['entryHour']: continue
        trig=[]
        for s in ALTS:
            hi=max(highs[s][i-p['rangeHours']:i]); lo=min(lows[s][i-p['rangeHours']:i]); c=closes[s][i]
            if c>hi: trig.append((s,1,(c/hi-1)*100))
            elif c<lo: trig.append((s,-1,(lo/c-1)*100))
        longs=[x for x in trig if x[1]>0]; shorts=[x for x in trig if x[1]<0]
        side=longs if len(longs)>=p['breadth'] else shorts if len(shorts)>=p['breadth'] else []
        if side:
            sel=sorted(side,key=lambda x:x[2],reverse=True)[:p['topK']]
            entries[t]=(normalize({s:sgn for s,sgn,_ in sel},p['gross']),p['hold'])
    return hold_targets(times,entries)

FNS={'compression_expansion':compression_expansion,'trend_acceleration':trend_acceleration,'breadth_momentum':breadth_momentum,'downside_cash_hedge':downside_cash_hedge,'vol_regime_rotation':vol_regime_rotation,'session_breakout':session_breakout}

def variants(f):
    V=base.Variant; out=[]
    if f=='compression_expansion':
        for cr in [0.45,0.60]:
          for bo in [24,48]:
           for h in [12,24]: out.append(V(f,f'CE_C{cr}_B{bo}_H{h}',dict(fastVol=24,slowVol=168,compressRatio=cr,breakout=bo,breadth=2,topK=2,gross=.8,hold=h,scanEvery=4)))
    elif f=='trend_acceleration':
        for fast in [12,24]:
         for slow in [72,168]:
          for a in [1.0,2.0]: out.append(V(f,f'TA_F{fast}_S{slow}_A{a}',dict(fast=fast,slow=slow,minAccel=a,breadth=2,topK=2,gross=.8,rebalance=12)))
    elif f=='breadth_momentum':
        for hz in [48,96,168]:
         for bt in [168,336]: out.append(V(f,f'BM_H{hz}_B{bt}',dict(horizon=hz,btcTrend=bt,btcMin=1.0,breadth=3,topK=2,gross=.8,rebalance=12)))
    elif f=='downside_cash_hedge':
        for ma in [336,720]:
         for m in [24,72]:
          for mm in [1.0,2.0]: out.append(V(f,f'DH_MA{ma}_M{m}_Q{mm}',dict(slowMA=ma,momentum=m,momMin=mm,maBuffer=.5,gross=.5,rebalance=12)))
    elif f=='vol_regime_rotation':
        for lv,hv in [(35,70),(45,85)]:
         for mm in [1.0,2.0]: out.append(V(f,f'VR_L{lv}_H{hv}_M{mm}',dict(volLookback=168,lowVol=lv,highVol=hv,fastH=24,midH=72,slowH=168,minMom=mm,breadth=2,topK=2,gross=.8,rebalance=12)))
    elif f=='session_breakout':
        for eh in [0,8,16]:
         for rh in [8,16]:
          for hold in [8,16]: out.append(V(f,f'SB_E{eh}_R{rh}_H{hold}',dict(entryHour=eh,rangeHours=rh,breadth=2,topK=2,gross=.7,hold=hold)))
    return out

def period_eval(targets,data,period):
    times,closes,_,__,funding=data
    return {'normal':base.simulate(targets,times,closes,funding,*period,NORMAL_BPS,0),'stress':base.simulate(targets,times,closes,funding,*period,STRESS_BPS,1)}

def devval_gate(e):
    for name,minn in [('development',18),('validation',12)]:
        n=e[name]['normal']; s=e[name]['stress']
        if n['cycles']<minn or (n['profitFactor'] or 0)<1.10 or n['compoundedReturnPct']<=0 or n['maxDrawdownPct']<=-25 or (s['profitFactor'] or 0)<.95: return False
    return True

def score(e):
    d=e['development']['normal']; v=e['validation']['normal']
    return min(d['profitFactor'] or 0,v['profitFactor'] or 0)*10+min(d['compoundedReturnPct'],v['compoundedReturnPct'])*.1

def confirmation_gate(c):
    n=c['normal']; s=c['stress']
    return n['cycles']>=12 and (n['profitFactor'] or 0)>1 and n['compoundedReturnPct']>0 and n['maxDrawdownPct']>-20 and (s['profitFactor'] or 0)>1

def robust_gate(conf,hold,combined):
    h=hold['normal']; hs=hold['stress']; a=combined['normal']; ass=combined['stress']
    return confirmation_gate(conf) and h['cycles']>=8 and (h['profitFactor'] or 0)>1 and h['compoundedReturnPct']>0 and h['maxDrawdownPct']>-20 and (hs['profitFactor'] or 0)>1 and a['cycles']>=30 and (a['profitFactor'] or 0)>=1.20 and a['maxDrawdownPct']>-20 and (ass['profitFactor'] or 0)>1 and a['bestCycleProfitSharePct']<=40 and (a['profitFactorWithoutBest'] or 0)>1

def main():
    fam=FAMILY
    if fam not in FNS: raise SystemExit(f'unknown family {fam}')
    state=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')).resolve(); state.mkdir(parents=True,exist_ok=True)
    cache=Path.cwd()/'.cache'/'perp-research-usdm'; raw={s:v4.load_symbol(cache,s) for s in SYMS}; data=base.prepare(raw); times,closes,highs,lows,funding=data
    rows=[]
    for v in variants(fam):
        targets=FNS[fam](v,times,closes,highs,lows)
        ev={'development':period_eval(targets,data,DEV),'validation':period_eval(targets,data,VAL)}
        if devval_gate(ev): rows.append((score(ev),v,ev,targets))
    rows.sort(key=lambda x:x[0],reverse=True)
    result={'version':51,'strategyId':'PARALLEL_TREND_VOL_V51','family':fam,'generatedAt':datetime.now(timezone.utc).isoformat(),'evaluatedVariants':len(variants(fam)),'developmentValidationPassed':len(rows),'status':'NO_DEVELOPMENT_VALIDATION_EDGE','selected':None,'productionChanged':False,'realTradingEnabled':False}
    if rows:
        _,v,ev,targets=rows[0]
        conf=period_eval(targets,data,CONF)
        selected={'variant':asdict(v),**ev,'confirmation2025':conf}
        if confirmation_gate(conf):
            hold=period_eval(targets,data,FINAL)
            combined={'normal':base.simulate(targets,times,closes,funding,CONF[0],FINAL[1],NORMAL_BPS,0),'stress':base.simulate(targets,times,closes,funding,CONF[0],FINAL[1],STRESS_BPS,1)}
            passed=robust_gate(conf,hold,combined); selected.update({'final2026H1':hold,'combined2025To2026H1':combined,'passed':passed})
            result['status']='ROBUST_TREND_VOL_CANDIDATE' if passed else 'HOLDOUT_REJECTED'
        else:
            selected['passed']=False; result['status']='CONFIRMATION_REJECTED'
        result['selected']=selected
    out=state/f'parallel-trend-vol-v51-{fam}.json'; out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    md=[f'# Parallel Trend/Vol V51 — {fam}','',f"- Status: **{result['status']}**",f"- Evaluated: {result['evaluatedVariants']}",f"- Dev+Validation passed: {result['developmentValidationPassed']}",'- Production changed: NO','- Real trading: DISABLED']
    if result['selected']:
        s=result['selected']; md += ['',f"- Selected: `{s['variant']['variant_id']}`",f"- Confirmation: N {s['confirmation2025']['normal']['cycles']} / PF {s['confirmation2025']['normal']['profitFactor']} / Return {s['confirmation2025']['normal']['compoundedReturnPct']}% / DD {s['confirmation2025']['normal']['maxDrawdownPct']}%"]
        if 'final2026H1' in s: md += [f"- Holdout: N {s['final2026H1']['normal']['cycles']} / PF {s['final2026H1']['normal']['profitFactor']} / Return {s['final2026H1']['normal']['compoundedReturnPct']}% / DD {s['final2026H1']['normal']['maxDrawdownPct']}%",f"- Passed: {s['passed']}"]
    (state/f'parallel-trend-vol-v51-{fam}.md').write_text('\n'.join(md),encoding='utf-8')
    summ=os.environ.get('GITHUB_STEP_SUMMARY')
    if summ:
        with open(summ,'a',encoding='utf-8') as fh: fh.write('\n\n'+'\n'.join(md))
    print('\n'.join(md))
if __name__=='__main__': main()
