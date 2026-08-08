from __future__ import annotations

import hashlib, itertools, json, math, os, statistics
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import research_lab_parameter_bagged_rotation_v4 as v4

STRATEGY_ID = "NEXTGEN_INDEPENDENT_FAMILIES_V49"
SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]
ALTS = ["ETH", "BNB", "SOL", "LINK", "AVAX"]
HOUR = 3_600_000
DEV = (v4.START_2023, v4.START_2024)
VAL = (v4.START_2024, v4.START_2025)
CONF = (v4.START_2025, v4.START_2026)
FINAL = (v4.START_2026, v4.END)
NORMAL_BPS = 10.0
STRESS_BPS = 30.0

@dataclass(frozen=True)
class Variant:
    family: str
    variant_id: str
    params: dict

def pf(values: List[float]) -> Optional[float]:
    wins = sum(x for x in values if x > 0)
    losses = abs(sum(x for x in values if x < 0))
    if losses > 1e-12:
        return wins / losses
    return 999.0 if wins > 0 else None

def compound(values: Iterable[float]) -> float:
    eq = 1.0
    for x in values:
        eq *= max(0.001, 1.0 + x / 100.0)
    return (eq - 1.0) * 100.0

def dd(values: Iterable[float]) -> float:
    eq = peak = 1.0
    worst = 0.0
    for x in values:
        eq *= max(0.001, 1.0 + x / 100.0)
        peak = max(peak, eq)
        worst = min(worst, (eq / peak - 1.0) * 100.0)
    return worst

def metrics(hourly: List[float], cycles: List[float]) -> dict:
    p = pf(cycles)
    wins = [x for x in cycles if x > 0]
    best = max(wins) if wins else 0.0
    positive_sum = sum(wins)
    share = best / positive_sum * 100.0 if positive_sum > 0 else 0.0
    ex = list(cycles)
    if wins:
        ex.remove(best)
    return {"cycles": len(cycles), "winRatePct": (sum(1 for x in cycles if x > 0) / len(cycles) * 100.0) if cycles else 0.0, "compoundedReturnPct": compound(hourly), "profitFactor": p, "maxDrawdownPct": dd(hourly), "bestCycleProfitSharePct": share, "profitFactorWithoutBest": pf(ex)}

def round_obj(x):
    if isinstance(x, float): return round(x, 4)
    if isinstance(x, dict): return {k: round_obj(v) for k,v in x.items()}
    if isinstance(x, list): return [round_obj(v) for v in x]
    return x

def prepare(raw: Dict[str, dict]):
    rows = {s: {int(c["ts"]): c for c in raw[s]["candles"]} for s in SYMBOLS}
    common = sorted(set.intersection(*(set(rows[s]) for s in SYMBOLS)))
    common = [t for t in common if v4.START_2023 - 400*HOUR <= t < v4.END]
    closes = {s:[float(rows[s][t]["close"]) for t in common] for s in SYMBOLS}
    highs = {s:[float(rows[s][t]["high"]) for t in common] for s in SYMBOLS}
    lows = {s:[float(rows[s][t]["low"]) for t in common] for s in SYMBOLS}
    funding = {s:{} for s in SYMBOLS}
    for s in SYMBOLS:
        for p in raw[s].get("funding",[]): funding[s][int(p["ts"])] = float(p["rate"]) * 100.0
    return common, closes, highs, lows, funding

def pctret(closes, s, i, h):
    if i-h < 0 or closes[s][i-h] <= 0: return None
    return (closes[s][i]/closes[s][i-h]-1.0)*100.0

def log_returns(closes, s, i, h):
    if i-h < 0: return []
    return [math.log(closes[s][j]/closes[s][j-1]) for j in range(i-h+1,i+1) if closes[s][j-1]>0 and closes[s][j]>0]

def ann_vol(closes,s,i,h):
    vals=log_returns(closes,s,i,h)
    return statistics.pstdev(vals)*math.sqrt(24*365)*100 if len(vals)>=8 else None

def rolling_beta(closes,s,i,h):
    a=log_returns(closes,s,i,h); b=log_returns(closes,"BTC",i,h)
    n=min(len(a),len(b))
    if n<24: return None
    a=a[-n:]; b=b[-n:]
    mb=statistics.fmean(b); ma=statistics.fmean(a)
    var=sum((x-mb)**2 for x in b)/n
    if var<=1e-15: return None
    cov=sum((a[k]-ma)*(b[k]-mb) for k in range(n))/n
    return cov/var

def normalize(weights: Dict[str,float], gross: float):
    g=sum(abs(x) for x in weights.values())
    if g<=1e-12: return {}
    return {s:w*gross/g for s,w in weights.items() if abs(w)>1e-12}

def expand_targets(times, signals):
    current={}; out={}
    for t in times:
        if t in signals: current=signals[t]
        out[t]=current
    return out

def volatility_breakout_targets(v,times,closes,highs,lows):
    p=v.params; out={}; step=p["rebalance"]
    for i,t in enumerate(times):
        if t < v4.START_2023 or i < max(p["window"],p["volLookback"])+2 or (t//HOUR)%step: continue
        pos=[]; neg=[]
        for s in ALTS:
            prev_hi=max(highs[s][i-p["window"]:i]); prev_lo=min(lows[s][i-p["window"]:i]); vol=ann_vol(closes,s,i,p["volLookback"])
            if not vol or vol<=0: continue
            if closes[s][i] > prev_hi: pos.append((s,(closes[s][i]/prev_hi-1)*100/vol,vol))
            elif closes[s][i] < prev_lo: neg.append((s,(prev_lo/closes[s][i]-1)*100/vol,vol))
        target={}
        if len(pos)>=p["breadth"]:
            selected=sorted(pos,key=lambda x:x[1],reverse=True)[:p["topK"]]; inv={s:1/max(vol,10) for s,_,vol in selected}; target=normalize(inv,min(1.0,p["targetVol"]/statistics.fmean([x[2] for x in selected])))
        elif len(neg)>=p["breadth"]:
            selected=sorted(neg,key=lambda x:x[1],reverse=True)[:p["topK"]]; inv={s:-1/max(vol,10) for s,_,vol in selected}; target=normalize(inv,min(1.0,p["targetVol"]/statistics.fmean([x[2] for x in selected])))
        out[t]=target
    return expand_targets(times,out)

def residual_regime_targets(v,times,closes,highs,lows):
    p=v.params; out={}
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<max(p["betaLookback"],p["horizon"],168)+2 or (t//HOUR)%p["rebalance"]: continue
        btc_h=pctret(closes,"BTC",i,p["horizon"]); btc_trend=pctret(closes,"BTC",i,168)
        if btc_h is None or btc_trend is None: continue
        vals=[]
        for s in ALTS:
            b=rolling_beta(closes,s,i,p["betaLookback"]); r=pctret(closes,s,i,p["horizon"])
            if b is not None and r is not None: vals.append((s,r-b*btc_h))
        if len(vals)<4: out[t]={}; continue
        vals=sorted(vals,key=lambda x:x[1]); loser,winner=vals[0],vals[-1]
        target={winner[0]:0.5,loser[0]:-0.5} if abs(btc_trend)>=p["trendSwitch"] else {loser[0]:0.5,winner[0]:-0.5}
        if winner[1]-loser[1] < p["minSpread"]: target={}
        out[t]=normalize(target,p["gross"])
    return expand_targets(times,out)

def funding_carry_targets(v,times,closes,highs,lows,funding):
    p=v.params; out={}; fvals={}
    for s in ALTS:
        arr=[]; cur=0.0
        for t in times: cur += funding[s].get(t,0.0); arr.append(cur)
        fvals[s]=arr
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<p["fundLookback"]+p["trendHorizon"]+2 or (t//HOUR)%p["rebalance"]: continue
        ranks=[]
        for s in ALTS:
            carry=fvals[s][i]-fvals[s][i-p["fundLookback"]]; mom=pctret(closes,s,i,p["trendHorizon"])
            if mom is not None: ranks.append((s,carry,mom))
        if len(ranks)<4: out[t]={}; continue
        low=min(ranks,key=lambda x:x[1]); high=max(ranks,key=lambda x:x[1]); spread=high[1]-low[1]
        ok=(spread>=p["minFundingSpread"] and low[2]>=-p["trendGuard"] and high[2]<=p["trendGuard"])
        out[t]=normalize({low[0]:0.5,high[0]:-0.5} if ok else {},p["gross"])
    return expand_targets(times,out)

def crash_rebound_targets(v,times,closes,highs,lows):
    p=v.params; events={}; active_until=-1; active={}
    for i,t in enumerate(times):
        if t<v4.START_2023 or i<max(p["crashWindow"],24)+2: continue
        if i<=active_until: events[t]=active; continue
        if (t//HOUR)%p["scanEvery"]: continue
        btc=pctret(closes,"BTC",i,p["crashWindow"])
        if btc is None or btc>p["crashPct"]: events[t]={}; continue
        neg=sum(1 for s in ALTS if (pctret(closes,s,i,p["crashWindow"]) or 0)<0); rebound=pctret(closes,"BTC",i,4)
        if neg<p["breadth"] or rebound is None or rebound<=p["stabilize4h"]: events[t]={}; continue
        scores=[]
        for s in ALTS:
            r4=pctret(closes,s,i,4); r24=pctret(closes,s,i,24)
            if r4 is not None and r24 is not None and r4>0: scores.append((s,r4-r24*0.15))
        if not scores: events[t]={}; continue
        selected=sorted(scores,key=lambda x:x[1],reverse=True)[:p["topK"]]; active=normalize({s:1.0 for s,_ in selected},p["gross"]); active_until=i+p["holdHours"]-1; events[t]=active
    return expand_targets(times,events)

def simulate(targets,times,closes,funding,start,end,cost_bps,delay_hours):
    tidx={t:i for i,t in enumerate(times)}; portfolio={}; hourly=[]; cycles=[]; cycle=[]
    active=[t for t in times if start<=t<end-HOUR and t+HOUR in tidx]
    for t in active:
        i=tidx[t]; source_i=i-delay_hours; desired=targets.get(times[source_i],{}) if source_i>=0 else {}
        turnover=sum(abs(desired.get(s,0)-portfolio.get(s,0)) for s in set(desired)|set(portfolio))
        if desired!=portfolio:
            if cycle: cycles.append(compound(cycle)); cycle=[]
            portfolio=desired
        ret=0.0
        for s,w in portfolio.items():
            if closes[s][i]>0: ret += w*(closes[s][i+1]/closes[s][i]-1.0)*100.0
            ret -= w*funding[s].get(times[i+1],0.0)
        ret -= turnover*cost_bps/100.0; hourly.append(ret)
        if portfolio: cycle.append(ret)
    if portfolio:
        g=sum(abs(w) for w in portfolio.values())
        if hourly:
            exit_cost=g*cost_bps/100.0; hourly[-1]-=exit_cost
            if cycle: cycle[-1]-=exit_cost
    if cycle: cycles.append(compound(cycle))
    return metrics(hourly,cycles)

def eval_variant(v, target_fn, data):
    times,closes,highs,lows,funding=data
    targets=target_fn(v,times,closes,highs,lows,funding) if v.family=="funding_carry" else target_fn(v,times,closes,highs,lows)
    def ev(period): return {"normal":simulate(targets,times,closes,funding,*period,NORMAL_BPS,0),"stress":simulate(targets,times,closes,funding,*period,STRESS_BPS,1)}
    return targets, {"development":ev(DEV),"validation":ev(VAL)}

def prelim_pass(e):
    def g(x,min_n):
        n=x["normal"]; s=x["stress"]
        return n["cycles"]>=min_n and (n["profitFactor"] or 0)>=1.10 and n["compoundedReturnPct"]>0 and n["maxDrawdownPct"]>-25 and (s["profitFactor"] or 0)>=0.95
    return g(e["development"],18) and g(e["validation"],12)

def selection_score(e):
    d=e["development"]["normal"]; v=e["validation"]["normal"]
    return min(d["profitFactor"] or 0,v["profitFactor"] or 0)*10 + min(d["compoundedReturnPct"],v["compoundedReturnPct"])*0.1 + min(d["maxDrawdownPct"],v["maxDrawdownPct"])*0.05

def final_gates(conf,final,combined):
    c=conf["normal"]; cs=conf["stress"]; f=final["normal"]; fs=final["stress"]; a=combined["normal"]; ass=combined["stress"]
    return {"confirmation": c["cycles"]>=12 and (c["profitFactor"] or 0)>1 and c["compoundedReturnPct"]>0 and c["maxDrawdownPct"]>-20 and (cs["profitFactor"] or 0)>1, "holdout": f["cycles"]>=8 and (f["profitFactor"] or 0)>1 and f["compoundedReturnPct"]>0 and f["maxDrawdownPct"]>-20 and (fs["profitFactor"] or 0)>1, "combinedRobust": a["cycles"]>=30 and (a["profitFactor"] or 0)>=1.20 and a["maxDrawdownPct"]>-20 and (ass["profitFactor"] or 0)>1 and a["bestCycleProfitSharePct"]<=40 and (a["profitFactorWithoutBest"] or 0)>1}

def variants():
    fam=[]
    for w,vl,b,tv,k,r in itertools.product([24,72],[72,168],[2,3],[40,60],[1,2],[12,24]):
        p=dict(window=w,volLookback=vl,breadth=b,targetVol=tv,topK=k,rebalance=r); fam.append(Variant("vol_breakout",f"VB_W{w}_V{vl}_B{b}_T{tv}_K{k}_R{r}",p))
    res=[]
    for bl,h,ts,sp,g,r in itertools.product([168,336],[24,72],[2.0,5.0],[2.0,4.0],[0.6,0.9],[12,24]):
        p=dict(betaLookback=bl,horizon=h,trendSwitch=ts,minSpread=sp,gross=g,rebalance=r); res.append(Variant("residual_regime",f"RR_B{bl}_H{h}_T{ts}_S{sp}_G{g}_R{r}",p))
    carry=[]
    for fl,th,mg,g,r,guard in itertools.product([168,336],[72,168],[0.03,0.06],[0.6,0.9],[8,24],[6.0,10.0]):
        p=dict(fundLookback=fl,trendHorizon=th,minFundingSpread=mg,gross=g,rebalance=r,trendGuard=guard); carry.append(Variant("funding_carry",f"FC_F{fl}_T{th}_M{mg}_G{g}_R{r}_Q{guard}",p))
    crash=[]
    for cw,cp,b,st,hh,k,g in itertools.product([24,72],[-6.0,-10.0],[3,4],[0.0,1.0],[24,48],[1,2],[0.5,0.8]):
        p=dict(crashWindow=cw,crashPct=cp,breadth=b,stabilize4h=st,holdHours=hh,topK=k,gross=g,scanEvery=4); crash.append(Variant("crash_rebound",f"CR_W{cw}_C{cp}_B{b}_S{st}_H{hh}_K{k}_G{g}",p))
    return {"vol_breakout":fam,"residual_regime":res,"funding_carry":carry,"crash_rebound":crash}
FNS={"vol_breakout":volatility_breakout_targets,"residual_regime":residual_regime_targets,"funding_carry":funding_carry_targets,"crash_rebound":crash_rebound_targets}

def main():
    state_dir=Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR",".research-state")).resolve(); state_dir.mkdir(parents=True,exist_ok=True)
    cache=Path.cwd()/".cache"/"perp-research-usdm"; raw={s:v4.load_symbol(cache,s) for s in SYMBOLS}
    times,closes,highs,lows,funding=prepare(raw); data=(times,closes,highs,lows,funding); results={}; robust=None
    for family,vs in variants().items():
        devval=[]
        for v in vs:
            targets,e=eval_variant(v,FNS[family],data)
            if prelim_pass(e): devval.append((selection_score(e),v,e,targets))
        devval.sort(key=lambda x:x[0],reverse=True)
        fr={"evaluatedVariants":len(vs),"developmentValidationPassed":len(devval),"selected":None,"status":"NO_DEVELOPMENT_VALIDATION_EDGE"}
        if devval:
            _,sel,e,targets=devval[0]
            conf={"normal":simulate(targets,times,closes,funding,*CONF,NORMAL_BPS,0),"stress":simulate(targets,times,closes,funding,*CONF,STRESS_BPS,1)}
            final={"normal":simulate(targets,times,closes,funding,*FINAL,NORMAL_BPS,0),"stress":simulate(targets,times,closes,funding,*FINAL,STRESS_BPS,1)}
            combined={"normal":simulate(targets,times,closes,funding,CONF[0],FINAL[1],NORMAL_BPS,0),"stress":simulate(targets,times,closes,funding,CONF[0],FINAL[1],STRESS_BPS,1)}
            gates=final_gates(conf,final,combined); passed=all(gates.values())
            fr.update({"selected":{"variant":asdict(sel),**e,"confirmation2025":conf,"final2026H1":final,"combined2025To2026H1":combined,"gates":gates},"status":"ROBUST_NEXTGEN_CANDIDATE" if passed else "HOLDOUT_REJECTED","passed":passed})
            if passed and robust is None: robust={"family":family,"variant":asdict(sel),"metrics":fr["selected"]}
        results[family]=fr
        if robust: break
    status="ROBUST_NEXTGEN_FOUND" if robust else "NO_ROBUST_IMPROVEMENT"
    result=round_obj({"version":49,"strategyId":STRATEGY_ID,"generatedAt":datetime.now(timezone.utc).isoformat(),"status":status,"robustCandidate":robust,"families":results,"periods":{"development":DEV,"validation":VAL,"confirmation2025":CONF,"final2026H1":FINAL},"costModel":{"normalBpsPerTurnover":NORMAL_BPS,"stressBpsPerTurnover":STRESS_BPS,"stressDelayHours":1,"actualFundingIncluded":True},"paperEligible":bool(robust),"liveEligible":False,"productionChanged":False,"realTradingEnabled":False,"constraints":["V6/Fresh Forward V9は変更しない。","V9の13 Forward cyclesは最適化に使用しない。","各familyはDevelopment+Validationだけで候補固定後、2025 Confirmationと2026H1 Finalを一度だけ評価する。","本番コード、VPS、.env、実売買runner、API key、注文、口座/position、realTradingEnabledを変更しない。"]})
    result["fingerprint"]=hashlib.sha256(json.dumps({"families":{k:[asdict(v) for v in vv] for k,vv in variants().items()},"periods":result["periods"],"cost":result["costModel"]},sort_keys=True).encode()).hexdigest()
    (state_dir/"nextgen-independent-families-v49.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    lines=["# Next-Gen Independent Families V49","",f"- Status: **{status}**","- Production changed: NO","- Real trading: DISABLED",""]
    for fam,fr in results.items():
        lines += [f"## {fam}",f"- Evaluated: {fr['evaluatedVariants']}",f"- Dev+Validation passed: {fr['developmentValidationPassed']}",f"- Status: **{fr['status']}**"]
        if fr.get("selected"):
            s=fr["selected"]; lines += [f"- Selected: `{s['variant']['variant_id']}`",f"- 2025 Normal: N {s['confirmation2025']['normal']['cycles']} / PF {s['confirmation2025']['normal']['profitFactor']} / Return {s['confirmation2025']['normal']['compoundedReturnPct']}% / DD {s['confirmation2025']['normal']['maxDrawdownPct']}%",f"- 2026H1 Normal: N {s['final2026H1']['normal']['cycles']} / PF {s['final2026H1']['normal']['profitFactor']} / Return {s['final2026H1']['normal']['compoundedReturnPct']}% / DD {s['final2026H1']['normal']['maxDrawdownPct']}%",f"- Combined Stress PF: {s['combined2025To2026H1']['stress']['profitFactor']}",f"- Gates: {s['gates']}"]
        lines.append("")
    (state_dir/"nextgen-independent-families-v49.md").write_text("\n".join(lines),encoding="utf-8")
    summary=os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary,"a",encoding="utf-8") as f: f.write("\n\n"+"\n".join(lines))
    print("\n".join(lines))
if __name__=="__main__": main()
