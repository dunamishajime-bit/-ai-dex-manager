from __future__ import annotations

import itertools
import json
import math
import os
import statistics
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_nextgen_independent_families_v49 as core
import research_lab_parallel_relative_value_v52 as rv52

STRATEGY_ID = "ADAPTIVE_EDGE_DECAY_V54"
HOUR = 3_600_000
DEV = (v4.START_2023, v4.START_2024)
VAL = (v4.START_2024, v4.START_2025)
KNOWN_2025_DIAGNOSTIC = (v4.START_2025, v4.START_2026)
CONFIRMATION_2026H1 = (v4.START_2026, v4.END)

BASE_VARIANT = rv52.Variant(
    "funding_persistence_carry",
    "FP_F168_P72_T168_S0.02_G0.6_R24",
    dict(fundLb=168, persistGap=72, trend=168, spread=0.02, gross=0.6, rebalance=24, trendGuard=8),
)

@dataclass(frozen=True)
class MetaVariant:
    mechanism: str
    variant_id: str
    params: dict


def pf(values: List[float]) -> Optional[float]:
    wins = sum(x for x in values if x > 0)
    losses = abs(sum(x for x in values if x < 0))
    if losses > 1e-12:
        return wins / losses
    return 999.0 if wins > 0 else None


def trailing_dd(values: List[float]) -> float:
    eq = peak = 1.0
    worst = 0.0
    for x in values:
        eq *= max(0.001, 1.0 + x / 100.0)
        peak = max(peak, eq)
        worst = min(worst, (eq / peak - 1.0) * 100.0)
    return worst


def realized_base_hourly(times, closes, funding, targets, cost_bps=10.0):
    tidx = {t: i for i, t in enumerate(times)}
    portfolio: Dict[str, float] = {}
    values = [0.0] * len(times)
    active = [False] * len(times)
    for t in times[:-1]:
        i = tidx[t]
        desired = targets.get(t, {})
        turnover = sum(abs(desired.get(s, 0.0) - portfolio.get(s, 0.0)) for s in set(desired) | set(portfolio))
        portfolio = desired
        ret = -turnover * cost_bps / 100.0
        for s, w in portfolio.items():
            if closes[s][i] > 0:
                ret += w * (closes[s][i + 1] / closes[s][i] - 1.0) * 100.0
            ret -= w * funding[s].get(times[i + 1], 0.0)
        values[i + 1] = ret
        active[i + 1] = bool(portfolio)
    return values, active


def rolling_pf(hourly: List[float], active: List[bool], end_i: int, lookback: int):
    vals = [hourly[j] for j in range(max(0, end_i - lookback), end_i) if active[j]]
    return pf(vals), statistics.fmean(vals) if vals else 0.0, (sum(x > 0 for x in vals) / len(vals) if vals else 0.0), vals


def ann_vol(closes, symbol, i, lookback):
    if i - lookback < 0:
        return None
    vals = []
    for j in range(i - lookback + 1, i + 1):
        if closes[symbol][j - 1] > 0 and closes[symbol][j] > 0:
            vals.append(math.log(closes[symbol][j] / closes[symbol][j - 1]))
    return statistics.pstdev(vals) * math.sqrt(24 * 365) * 100.0 if len(vals) >= 24 else None


def pct(closes, symbol, i, h):
    if i - h < 0 or closes[symbol][i - h] <= 0:
        return None
    return (closes[symbol][i] / closes[symbol][i - h] - 1.0) * 100.0


def scale_target(target: Dict[str, float], scale: float):
    if scale <= 1e-12:
        return {}
    return {s: w * scale for s, w in target.items()}


def apply_edge_decay(v, times, closes, funding, base_targets, base_hourly, base_active):
    p = v.params
    out = {}
    for i, t in enumerate(times):
        if t < v4.START_2023:
            out[t] = {}
            continue
        rpf, mean, hit, vals = rolling_pf(base_hourly, base_active, i, p['lookback'])
        enabled = len(vals) >= p['minObs'] and (rpf or 0) >= p['minPF'] and mean >= p['minMean'] and hit >= p['minHit']
        out[t] = base_targets.get(t, {}) if enabled else {}
    return out


def apply_regime_gate(v, times, closes, funding, base_targets, base_hourly, base_active):
    p = v.params
    out = {}
    for i, t in enumerate(times):
        if t < v4.START_2023 or i < max(p['trendH'], p['volLb']):
            out[t] = {}
            continue
        btc_trend = pct(closes, 'BTC', i, p['trendH'])
        vol = ann_vol(closes, 'BTC', i, p['volLb'])
        breadth_vals = [pct(closes, s, i, p['trendH']) for s in rv52.ALTS]
        breadth_vals = [x for x in breadth_vals if x is not None]
        breadth = abs(statistics.fmean(breadth_vals)) if breadth_vals else 999.0
        enabled = btc_trend is not None and vol is not None and abs(btc_trend) <= p['maxTrend'] and vol <= p['maxVol'] and breadth <= p['maxBreadth']
        out[t] = base_targets.get(t, {}) if enabled else {}
    return out


def apply_ensemble_vote(v, times, closes, funding, base_targets, base_hourly, base_active):
    p = v.params
    out = {}
    for i, t in enumerate(times):
        if t < v4.START_2023 or i < max(p['lookback'], p['trendH'], p['volLb']):
            out[t] = {}
            continue
        rpf, mean, hit, vals = rolling_pf(base_hourly, base_active, i, p['lookback'])
        tr = pct(closes, 'BTC', i, p['trendH'])
        vol = ann_vol(closes, 'BTC', i, p['volLb'])
        votes = 0
        votes += int(len(vals) >= p['minObs'] and (rpf or 0) >= p['minPF'])
        votes += int(mean >= 0 and hit >= p['minHit'])
        votes += int(tr is not None and abs(tr) <= p['maxTrend'])
        votes += int(vol is not None and vol <= p['maxVol'])
        out[t] = base_targets.get(t, {}) if votes >= p['votes'] else {}
    return out


def apply_dynamic_allocation(v, times, closes, funding, base_targets, base_hourly, base_active):
    p = v.params
    out = {}
    last_scale = 0.0
    for i, t in enumerate(times):
        if t < v4.START_2023:
            out[t] = {}
            continue
        rpf, mean, _, vals = rolling_pf(base_hourly, base_active, i, p['lookback'])
        if len(vals) < p['minObs'] or (rpf or 0) < p['offPF'] or mean < 0:
            desired = 0.0
        elif (rpf or 0) < p['fullPF']:
            desired = p['midScale']
        else:
            desired = 1.0
        scale = min(desired, last_scale + p['step']) if desired > last_scale else max(desired, last_scale - p['step'])
        last_scale = scale
        out[t] = scale_target(base_targets.get(t, {}), scale)
    return out


def apply_drawdown_derisk(v, times, closes, funding, base_targets, base_hourly, base_active):
    p = v.params
    out = {}
    for i, t in enumerate(times):
        if t < v4.START_2023:
            out[t] = {}
            continue
        _, _, _, vals = rolling_pf(base_hourly, base_active, i, p['lookback'])
        dd = trailing_dd(vals) if vals else 0.0
        if len(vals) < p['minObs']:
            scale = 0.0
        elif dd <= -p['stopDD']:
            scale = 0.0
        elif dd <= -p['cutDD']:
            scale = p['cutScale']
        else:
            scale = 1.0
        out[t] = scale_target(base_targets.get(t, {}), scale)
    return out


def fp_neighbors():
    return [
        BASE_VARIANT,
        rv52.Variant('funding_persistence_carry','FP_NEIGHBOR_A',dict(fundLb=168,persistGap=168,trend=168,spread=0.02,gross=0.6,rebalance=24,trendGuard=8)),
        rv52.Variant('funding_persistence_carry','FP_NEIGHBOR_B',dict(fundLb=336,persistGap=72,trend=168,spread=0.02,gross=0.6,rebalance=24,trendGuard=8)),
        rv52.Variant('funding_persistence_carry','FP_NEIGHBOR_C',dict(fundLb=168,persistGap=72,trend=72,spread=0.05,gross=0.6,rebalance=24,trendGuard=8)),
    ]


def apply_champion_rotation(v, times, closes, funding, base_targets, base_hourly, base_active, neighbor_targets):
    p = v.params
    histories = {vid: realized_base_hourly(times, closes, funding, targets, 10.0) for vid, targets in neighbor_targets.items()}
    out = {}
    current = BASE_VARIANT.variant_id
    for i, t in enumerate(times):
        if t < v4.START_2023:
            out[t] = {}
            continue
        if (t // HOUR) % p['rebalanceHours'] == 0:
            ranked = []
            for vid, (h, a) in histories.items():
                rpf, mean, _, vals = rolling_pf(h, a, i, p['lookback'])
                if len(vals) >= p['minObs']:
                    ranked.append(((rpf or 0) + p['meanWeight'] * max(mean, -0.1), vid, rpf or 0, mean))
            if ranked:
                best = max(ranked)
                current = best[1] if best[2] >= p['minPF'] and best[3] >= 0 else ''
            else:
                current = ''
        out[t] = neighbor_targets.get(current, {}).get(t, {}) if current else {}
    return out


MECH_FNS = {
    'edge_decay': apply_edge_decay,
    'regime_gate': apply_regime_gate,
    'ensemble_vote': apply_ensemble_vote,
    'dynamic_allocation': apply_dynamic_allocation,
    'drawdown_derisk': apply_drawdown_derisk,
    'champion_rotation': apply_champion_rotation,
}


def variants():
    out = []
    for lb, mpf, mh in itertools.product([168, 336, 720], [0.9, 1.0, 1.1], [0.46, 0.50]):
        out.append(MetaVariant('edge_decay',f'ED_L{lb}_P{mpf}_H{mh}',dict(lookback=lb,minPF=mpf,minMean=0.0,minHit=mh,minObs=max(48,lb//4))))
    for th, mt, vl, mv, mb in itertools.product([168,336],[4,8,12],[168,336],[70,90],[5,10]):
        out.append(MetaVariant('regime_gate',f'RG_T{th}_{mt}_V{vl}_{mv}_B{mb}',dict(trendH=th,maxTrend=mt,volLb=vl,maxVol=mv,maxBreadth=mb)))
    for lb,mpf,mh,votes in itertools.product([168,336],[0.9,1.0],[0.46,0.50],[2,3]):
        out.append(MetaVariant('ensemble_vote',f'EV_L{lb}_P{mpf}_H{mh}_V{votes}',dict(lookback=lb,minPF=mpf,minHit=mh,minObs=max(48,lb//4),trendH=168,maxTrend=8,volLb=168,maxVol=90,votes=votes)))
    for lb,off,full,mid,step in itertools.product([168,336,720],[0.8,0.9],[1.1,1.2],[0.4,0.6],[0.25,0.5]):
        if full > off:
            out.append(MetaVariant('dynamic_allocation',f'DA_L{lb}_O{off}_F{full}_M{mid}_S{step}',dict(lookback=lb,offPF=off,fullPF=full,midScale=mid,step=step,minObs=max(48,lb//4))))
    for lb,cut,stop,scale in itertools.product([168,336,720],[3,5],[6,8,10],[0.25,0.5]):
        if stop > cut:
            out.append(MetaVariant('drawdown_derisk',f'DD_L{lb}_C{cut}_S{stop}_G{scale}',dict(lookback=lb,cutDD=cut,stopDD=stop,cutScale=scale,minObs=max(48,lb//4))))
    for lb,rb,mpf in itertools.product([720,1440,2160],[168,336,720],[0.9,1.0]):
        out.append(MetaVariant('champion_rotation',f'CR_L{lb}_R{rb}_P{mpf}',dict(lookback=lb,rebalanceHours=rb,minPF=mpf,minObs=max(96,lb//4),meanWeight=25.0)))
    return out


def build_targets(v, data, base_targets, base_hourly, base_active, neighbors):
    times, closes, _, _, funding = data
    if v.mechanism == 'champion_rotation':
        return MECH_FNS[v.mechanism](v,times,closes,funding,base_targets,base_hourly,base_active,neighbors)
    return MECH_FNS[v.mechanism](v,times,closes,funding,base_targets,base_hourly,base_active)


def eval_period(targets, data, period):
    times, closes, _, _, funding = data
    return {'normal':core.simulate(targets,times,closes,funding,*period,10,0),'stress':core.simulate(targets,times,closes,funding,*period,30,1)}


def dev_pass(x):
    n,s=x['normal'],x['stress']
    return n['cycles']>=24 and (n['profitFactor'] or 0)>=1.15 and n['compoundedReturnPct']>0 and n['maxDrawdownPct']>-20 and (s['profitFactor'] or 0)>1.0 and n['bestCycleProfitSharePct']<=40 and (n['profitFactorWithoutBest'] or 0)>1.0


def val_pass(x):
    n,s=x['normal'],x['stress']
    return n['cycles']>=18 and (n['profitFactor'] or 0)>=1.15 and n['compoundedReturnPct']>0 and n['maxDrawdownPct']>-20 and (s['profitFactor'] or 0)>1.0 and n['bestCycleProfitSharePct']<=40 and (n['profitFactorWithoutBest'] or 0)>1.0


def confirmation_pass(x):
    n,s=x['normal'],x['stress']
    return n['cycles']>=18 and (n['profitFactor'] or 0)>=1.20 and n['compoundedReturnPct']>0 and n['maxDrawdownPct']>-20 and (s['profitFactor'] or 0)>1.0 and s['compoundedReturnPct']>-10 and n['bestCycleProfitSharePct']<=35 and (n['profitFactorWithoutBest'] or 0)>1.0


def selection_score(dev, val):
    return min(dev['normal']['profitFactor'] or 0,val['normal']['profitFactor'] or 0)*10 + min(dev['normal']['compoundedReturnPct'],val['normal']['compoundedReturnPct'])*0.1 + min(dev['normal']['maxDrawdownPct'],val['normal']['maxDrawdownPct'])*0.05


def round_obj(x):
    if isinstance(x,float): return round(x,4)
    if isinstance(x,dict): return {k:round_obj(v) for k,v in x.items()}
    if isinstance(x,list): return [round_obj(v) for v in x]
    return x


def main():
    state=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')).resolve()
    cache=Path.cwd()/'.cache'/'perp-research-usdm'
    raw={s:v4.load_symbol(cache,s) for s in v4.SYMBOLS}
    data=core.prepare(raw)
    times,closes,highs,lows,funding=data
    base_targets=rv52.funding_persistence_carry(BASE_VARIANT,times,closes,highs,lows,funding)
    base_hourly,base_active=realized_base_hourly(times,closes,funding,base_targets,10.0)
    neighbors={v.variant_id:rv52.funding_persistence_carry(v,times,closes,highs,lows,funding) for v in fp_neighbors()}
    grouped={m:[] for m in MECH_FNS}
    for v in variants(): grouped[v.mechanism].append(v)
    result={'version':54,'strategyId':STRATEGY_ID,'status':'NO_ROBUST_IMPROVEMENT','robustCandidate':None,'chronology':{'development':'2023','validation':'2024','knownAdversarialDiagnostic':'2025 (not used for selection)','confirmation':'2026-01-01 through 2026-07-01','finalUntouchedHoldout':'requires post-2026-07-01 fresh data; opened only after confirmation passes'},'baseVariant':asdict(BASE_VARIANT),'mechanisms':{},'productionChanged':False,'realTradingEnabled':False,'limitations':['2025 Funding Persistence Carry failure was known before V54 and is diagnostic only, never a selection/tuning gate.','Long historical cache ends at 2026-07-01; final post-July holdout is intentionally not synthesized.']}
    any_confirmation_pass=False
    for mech,vs in grouped.items():
        dev_survivors=[]
        for v in vs:
            targets=build_targets(v,data,base_targets,base_hourly,base_active,neighbors)
            d=eval_period(targets,data,DEV)
            if dev_pass(d): dev_survivors.append((v,targets,d))
        val_survivors=[]
        for v,targets,d in dev_survivors:
            va=eval_period(targets,data,VAL)
            if val_pass(va): val_survivors.append((selection_score(d,va),v,targets,d,va))
        rec={'evaluatedVariants':len(vs),'developmentPassed':len(dev_survivors),'validationPassed':len(val_survivors),'selected':None,'status':'NO_VALIDATED_ADAPTIVE_EDGE','passed':False}
        if val_survivors:
            _,v,targets,d,va=max(val_survivors,key=lambda x:x[0])
            diagnostic=eval_period(targets,data,KNOWN_2025_DIAGNOSTIC)
            conf=eval_period(targets,data,CONFIRMATION_2026H1)
            cp=confirmation_pass(conf)
            any_confirmation_pass |= cp
            rec['selected']={'variant':asdict(v),'development':d,'validation':va,'known2025Diagnostic':diagnostic,'confirmation2026H1':conf,'confirmationPassed':cp}
            rec['status']='CONFIRMATION_PASS_AWAIT_FRESH_FINAL_HOLDOUT' if cp else '2026H1_CONFIRMATION_REJECTED'
        result['mechanisms'][mech]=round_obj(rec)
    result['status']='AWAITING_POST_2026_07_01_FINAL_HOLDOUT' if any_confirmation_pass else 'NO_ROBUST_IMPROVEMENT'
    result=round_obj(result)
    state.mkdir(parents=True,exist_ok=True)
    (state/'adaptive-edge-decay-v54.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['# Adaptive Edge Decay V54','',f"- Status: **{result['status']}**",'- 2025: known adversarial diagnostic only; never used for selection','- Production changed: NO','- Real trading: DISABLED','']
    for mech,rec in result['mechanisms'].items():
        lines += [f'## {mech}',f"- Evaluated: {rec['evaluatedVariants']}",f"- Development passed: {rec['developmentPassed']}",f"- Validation passed: {rec['validationPassed']}",f"- Status: **{rec['status']}**"]
        if rec.get('selected'):
            s=rec['selected']; c=s['confirmation2026H1']['normal']; st=s['confirmation2026H1']['stress']; d=s['known2025Diagnostic']['normal']
            lines += [f"- Selected: `{s['variant']['variant_id']}`",f"- Known 2025 diagnostic: N {d['cycles']} / PF {d['profitFactor']} / Return {d['compoundedReturnPct']}% / DD {d['maxDrawdownPct']}%",f"- 2026H1 confirmation: N {c['cycles']} / PF {c['profitFactor']} / Return {c['compoundedReturnPct']}% / DD {c['maxDrawdownPct']}%",f"- 2026H1 Stress: PF {st['profitFactor']} / Return {st['compoundedReturnPct']}% / DD {st['maxDrawdownPct']}%"]
        lines.append('')
    report='\n'.join(lines)
    (state/'adaptive-edge-decay-v54.md').write_text(report,encoding='utf-8')
    summary=os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary,'a',encoding='utf-8') as f: f.write('\n'+report+'\n')
    print(report)

if __name__=='__main__': main()
