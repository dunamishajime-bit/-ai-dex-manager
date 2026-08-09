from __future__ import annotations

import json, math, os, statistics
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import research_lab_parameter_bagged_rotation_v4 as v4

STRATEGY_ID='VOL_BREAKOUT_BREADTH_V49'
SYMBOLS=['BTC','ETH','BNB','SOL','LINK','AVAX']
TRADE_SYMBOLS=['ETH','BNB','SOL','LINK','AVAX']

@dataclass(frozen=True)
class Variant:
    breakout_days:int; target_vol:int; breadth:float; max_gross:float; hold_bars:int
    @property
    def id(self): return f'BR{self.breakout_days}_TV{self.target_vol}_B{self.breadth}_G{self.max_gross}_H{self.hold_bars}'

def pf(xs):
    w=sum(x for x in xs if x>0); l=abs(sum(x for x in xs if x<0)); return w/l if l>1e-12 else (999.0 if w>0 else None)
def comp(xs):
    e=1.0
    for x in xs:e*=max(.001,1+x/100)
    return (e-1)*100
def dd(xs):
    e=p=1.; d=0.
    for x in xs:
        e*=max(.001,1+x/100); p=max(p,e); d=min(d,(e/p-1)*100)
    return d
def metric(xs):
    best=max(xs) if xs else 0.; ex=xs.copy()
    if ex: ex.remove(best)
    return {'n':len(xs),'returnPct':comp(xs),'profitFactor':pf(xs),'maxDrawdownPct':dd(xs),'bestTradePct':best,'profitFactorExBest':pf(ex),'bestProfitSharePct':(best/sum(x for x in xs if x>0)*100 if sum(x for x in xs if x>0)>0 else 0)}

def run(var,bars,indexes,funding,start,end,stress=False):
    times=[int(x['ts']) for x in bars['BTC'] if start<=int(x['ts'])<end]
    open_pos=None; entry_ts=0; held=0; out=[]
    cost_bps=30 if stress else 10
    delay=1 if stress else 0
    for k,ts in enumerate(times):
        sig_k=k-1-delay
        if sig_k<0: continue
        sig_ts=times[sig_k]
        if open_pos:
            sym,w,entry_px=open_pos; i=indexes[sym].get(ts)
            if i is None: continue
            held+=1; exit_now=held>=var.hold_bars
            if not exit_now:
                look=max(4,var.breakout_days)
                if i>=look:
                    sma=statistics.fmean(float(r['close']) for r in bars[sym][i-look+1:i+1]); exit_now=float(bars[sym][i]['close'])<sma
            if exit_now:
                px=float(bars[sym][i]['open']); gross=w*(px/entry_px-1)*100
                fund=w*v4.funding_pct(funding[sym],entry_ts,ts)
                net=gross-fund-(2*w*cost_bps/100)
                out.append(net); open_pos=None; held=0
            continue
        bi=indexes['BTC'].get(sig_ts)
        if bi is None or bi<100: continue
        btc=bars['BTC']; btc_sma=statistics.fmean(float(r['close']) for r in btc[bi-99:bi+1])
        if float(btc[bi]['close'])<=btc_sma: continue
        above=0; candidates=[]
        for sym in TRADE_SYMBOLS:
            i=indexes[sym].get(sig_ts)
            if i is None or i<max(var.breakout_days*2,40): continue
            rows=bars[sym]; ma=statistics.fmean(float(r['close']) for r in rows[i-39:i+1])
            if float(rows[i]['close'])>ma: above+=1
            n=var.breakout_days*2
            prev_high=max(float(r['high']) for r in rows[i-n:i])
            if float(rows[i]['close'])<=prev_high: continue
            vol=v4.realized_annual_vol(rows,i,40)
            if not vol or vol<=0: continue
            mom=float(rows[i]['close'])/float(rows[i-n]['close'])-1
            candidates.append((mom,sym,vol))
        if above/max(1,len(TRADE_SYMBOLS))<var.breadth or not candidates: continue
        _,sym,vol=max(candidates)
        j=indexes[sym].get(ts)
        if j is None: continue
        w=min(var.max_gross,var.target_vol/vol)
        if w<.1: continue
        open_pos=(sym,w,float(bars[sym][j]['open'])); entry_ts=ts; held=0
    if open_pos and times:
        sym,w,entry_px=open_pos; ts=times[-1]; i=indexes[sym].get(ts)
        if i is not None:
            px=float(bars[sym][i]['close']); out.append(w*(px/entry_px-1)*100-w*v4.funding_pct(funding[sym],entry_ts,ts)-(2*w*cost_bps/100))
    return metric(out)

def gate(m, stress=False):
    return m['n']>=20 and (m['profitFactor'] or 0)>=(1.0 if stress else 1.15) and m['maxDrawdownPct']>-20 and m['bestProfitSharePct']<45 and (m['profitFactorExBest'] or 0)>=1.0

def main():
    root=Path.cwd()/'.cache/perp-research-usdm'; state=Path(os.getenv('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); state.mkdir(exist_ok=True)
    raw={s:v4.load_symbol(root,s) for s in SYMBOLS}; bars={s:v4.resample_12h(raw[s]['candles']) for s in SYMBOLS}; indexes={s:{int(r['ts']):i for i,r in enumerate(rows)} for s,rows in bars.items()}; funding={s:raw[s]['funding'] for s in SYMBOLS}
    variants=[Variant(a,b,c,d,e) for a in [10,20,30] for b in [20,30,40] for c in [.5,.7,.9] for d in [.5,.75,1.0] for e in [2,4,8]]
    passed=[]
    for x in variants:
        dev=run(x,bars,indexes,funding,v4.START_2023,v4.START_2024); val=run(x,bars,indexes,funding,v4.START_2024,v4.START_2025); vs=run(x,bars,indexes,funding,v4.START_2024,v4.START_2025,True)
        if gate(dev) and gate(val) and gate(vs,True): passed.append((min(dev['profitFactor'] or 0,val['profitFactor'] or 0),x,dev,val,vs))
    passed.sort(key=lambda z:z[0],reverse=True); selected=None; confirm=final=None; robust=False
    if passed:
        _,x,dev,val,vs=passed[0]; confirm=run(x,bars,indexes,funding,v4.START_2025,v4.START_2026); cs=run(x,bars,indexes,funding,v4.START_2025,v4.START_2026,True)
        if gate(confirm) and gate(cs,True) and confirm['returnPct']>0:
            final=run(x,bars,indexes,funding,v4.START_2026,v4.END); fs=run(x,bars,indexes,funding,v4.START_2026,v4.END,True)
            robust=(final['n']>=10 and final['returnPct']>0 and (final['profitFactor'] or 0)>1.0 and final['maxDrawdownPct']>-20 and (fs['profitFactor'] or 0)>1.0 and final['bestProfitSharePct']<50)
        selected={'variant':x.__dict__|{'id':x.id},'development':dev,'validation':val,'validationStress':vs,'confirmation2025':confirm,'confirmationStress':cs,'final2026H1':final,'finalStress':fs if final else None}
    status='ROBUST_NEXT_GEN_CANDIDATE' if robust else 'NO_ROBUST_VOL_BREAKOUT_EDGE'
    result={'version':49,'strategyId':STRATEGY_ID,'generatedAt':datetime.now(timezone.utc).isoformat(),'status':status,'evaluatedVariants':len(variants),'developmentValidationPassed':len(passed),'selected':selected,'paperEligible':robust,'liveEligible':False,'productionChanged':False,'realTradingEnabled':False,'constraints':['V6/V9条件不使用','2023 Development -> 2024 Validation -> 2025 Confirmation -> 2026H1 untouched final','Normal 10bps/side equivalent turnover cost, Stress 30bps plus 12h signal delay, actual funding','best-trade concentration and PF ex-best checked','research only; no production/VPS/env/trading changes']}
    (state/'vol-breakout-breadth-v49.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    md=[f'# Volatility Breakout Breadth V49','',f'- Status: **{status}**',f'- Evaluated: {len(variants)}',f'- Development + Validation + Stress passed: {len(passed)}',f'- Selected: **{selected["variant"]["id"] if selected else "NONE"}**',f'- Paper eligible: **{"YES" if robust else "NO"}**','- Production changed: NO','- Real trading: DISABLED']
    (state/'vol-breakout-breadth-v49.md').write_text('\n'.join(md),encoding='utf-8'); print('\n'.join(md))
if __name__=='__main__': main()
