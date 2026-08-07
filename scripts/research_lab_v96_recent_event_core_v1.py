from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

UTC = dt.timezone.utc
REPO_ROOT = Path(__file__).resolve().parent.parent
RESEARCH_ROOT = REPO_ROOT / ".research-base"
sys.path.insert(0, str(RESEARCH_ROOT / "scripts"))

import research_lab_v96_volume50_turnover075_full_bt as crypto_bt

core = crypto_bt.core
v4 = core.v4
v32 = core.v32
v89 = crypto_bt.v89

START = dt.datetime(2025, 8, 13, tzinfo=UTC)
DEV_END = dt.datetime(2026, 1, 1, tzinfo=UTC)
HOLDOUT_START = dt.datetime(2026, 3, 11, tzinfo=UTC)
END = dt.datetime(2026, 8, 3, tzinfo=UTC)
START_MS = int(START.timestamp() * 1000)
DEV_END_MS = int(DEV_END.timestamp() * 1000)
HOLDOUT_START_MS = int(HOLDOUT_START.timestamp() * 1000)
END_MS = int(END.timestamp() * 1000)
SYMBOLS = ("BTC", "ETH", "BNB", "SOL", "LINK", "AVAX")
GROSS = 0.75


@dataclass(frozen=True)
class EventConfig:
    config_id: str
    family: str
    lookback_days: int
    threshold_pct: float
    confirm_pct: float
    hold_bars: int
    volume_floor: float = 0.0
    btc_filter_pct: float = 0.0


def rounded(value: Any):
    if isinstance(value, float): return round(value, 6)
    if isinstance(value, dict): return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, list): return [rounded(v) for v in value]
    return value


def compound(values: Iterable[float]) -> float:
    eq = 1.0
    for value in values: eq *= max(0.001, 1.0 + float(value))
    return eq - 1.0


def pf(values: Sequence[float]) -> Optional[float]:
    gains = sum(v for v in values if v > 0)
    losses = -sum(v for v in values if v < 0)
    return gains / losses if losses > 1e-15 else (999.0 if gains > 0 else None)


def metrics(rows: Sequence[dict], start: int, end: int, entries: Sequence[dict]) -> dict:
    active = [row for row in rows if start <= int(row['ts']) < end]
    values = [float(row['return']) for row in active]
    eq = peak = 1.0
    dd = 0.0
    months: Dict[str, List[float]] = {}
    for row, value in zip(active, values):
        eq *= max(0.001, 1.0 + value)
        peak = max(peak, eq)
        dd = min(dd, eq / peak - 1.0)
        key = dt.datetime.fromtimestamp(int(row['ts'])/1000, tz=UTC).strftime('%Y-%m')
        months.setdefault(key, []).append(value)
    month_returns = {k: compound(v) * 100.0 for k, v in months.items()}
    days = max(1e-9, (end-start)/86_400_000.0)
    years = days/365.25
    window_entries = [e for e in entries if start <= int(e['signalTs']) < end]
    return {
        'events': len(active),
        'tradeEpisodes': len(window_entries),
        'compoundedReturnPct': (eq-1.0)*100.0,
        'cagrPct': (eq**(1.0/years)-1.0)*100.0 if eq > 0 else None,
        'maxDrawdownPct': dd*100.0,
        'profitFactor': pf(values),
        'activeBucketRatio': sum(float(r.get('gross',0.0))>0.01 for r in active)/len(active) if active else 0.0,
        'positiveMonthRatio': sum(v>0 for v in month_returns.values())/len(month_returns) if month_returns else 0.0,
        'monthlyReturnsPct': month_returns,
    }


def configs() -> List[EventConfig]:
    out: List[EventConfig] = []
    # Pullback short: medium-term decline, short after a 12h rebound while still below 20d mean.
    for lb, thr, conf, hold in itertools.product((5,7,10), (5.0,8.0,12.0), (0.5,1.5), (2,4,6)):
        out.append(EventConfig(f'SHORT_PULLBACK_L{lb}_T{thr:g}_C{conf:g}_H{hold}', 'SHORT_PULLBACK', lb, thr, conf, hold))
    # Dip-reclaim long: medium-term washout, enter after a positive 12h reversal.
    for lb, thr, conf, hold in itertools.product((3,5,7), (5.0,8.0,12.0), (0.5,1.5), (2,4,6)):
        out.append(EventConfig(f'LONG_RECLAIM_L{lb}_T{thr:g}_C{conf:g}_H{hold}', 'LONG_RECLAIM', lb, thr, conf, hold))
    # Breakout/breakdown event families with volume confirmation.
    for lb, vol, hold, btc_filter in itertools.product((5,10,20), (0.8,1.0), (2,4,8), (-5.0,0.0)):
        out.append(EventConfig(f'LONG_BREAKOUT_L{lb}_V{vol:g}_H{hold}_B{btc_filter:g}', 'LONG_BREAKOUT', lb, 0.0, 0.0, hold, vol, btc_filter))
    for lb, vol, hold, btc_filter in itertools.product((5,10,20), (0.8,1.0), (2,4,8), (0.0,-3.0)):
        out.append(EventConfig(f'SHORT_BREAKDOWN_L{lb}_V{vol:g}_H{hold}_B{btc_filter:g}', 'SHORT_BREAKDOWN', lb, 0.0, 0.0, hold, vol, btc_filter))
    return out


def one_bar_pct(rows: List[dict], idx: int) -> Optional[float]:
    if idx < 1 or float(rows[idx-1]['close']) <= 0: return None
    return (float(rows[idx]['close']) / float(rows[idx-1]['close']) - 1.0) * 100.0


def previous_high(rows: List[dict], idx: int, bars: int) -> Optional[float]:
    if idx-bars < 0: return None
    return max(float(row['high']) for row in rows[idx-bars:idx])


def previous_low(rows: List[dict], idx: int, bars: int) -> Optional[float]:
    if idx-bars < 0: return None
    return min(float(row['low']) for row in rows[idx-bars:idx])


def signal(config: EventConfig, ts: int, bars: Dict[str,List[dict]], indexes: Dict[str,Dict[int,int]]) -> Optional[Tuple[str,float,dict]]:
    btc_idx = indexes['BTC'].get(ts)
    if btc_idx is None: return None
    btc_mom_7d = v4.momentum(bars['BTC'], btc_idx, 14)
    if btc_mom_7d is None: return None
    candidates: List[Tuple[str,float,dict]] = []

    for symbol in SYMBOLS:
        idx = indexes[symbol].get(ts)
        if idx is None: continue
        rows = bars[symbol]
        move = v4.momentum(rows, idx, config.lookback_days*2)
        recent = one_bar_pct(rows, idx)
        if move is None or recent is None: continue
        close = float(rows[idx]['close'])

        if config.family == 'SHORT_PULLBACK':
            avg = v4.sma(rows, idx, 40)
            if avg is None: continue
            if move <= -config.threshold_pct and recent >= config.confirm_pct and close < avg:
                score = (-move) + 0.20 * recent
                candidates.append((symbol, score, {'movePct': move, 'confirmPct': recent, 'side': -1}))

        elif config.family == 'LONG_RECLAIM':
            # Avoid catching an accelerating BTC crash; require broad market not worse than -12%/7d.
            if btc_mom_7d <= -12.0: continue
            if move <= -config.threshold_pct and recent >= config.confirm_pct:
                score = (-move) + 0.30 * recent
                candidates.append((symbol, score, {'movePct': move, 'confirmPct': recent, 'side': 1}))

        elif config.family == 'LONG_BREAKOUT':
            if btc_mom_7d <= config.btc_filter_pct: continue
            high = previous_high(rows, idx, config.lookback_days*2)
            volume = v4.volume_ratio(rows, idx, 20, 80)
            if high is None or volume is None: continue
            if close > high and volume >= config.volume_floor:
                score = (move or 0.0) + min(3.0, volume)
                candidates.append((symbol, score, {'movePct': move, 'volumeRatio': volume, 'side': 1}))

        elif config.family == 'SHORT_BREAKDOWN':
            if btc_mom_7d >= config.btc_filter_pct: continue
            low = previous_low(rows, idx, config.lookback_days*2)
            volume = v4.volume_ratio(rows, idx, 20, 80)
            if low is None or volume is None: continue
            if close < low and volume >= config.volume_floor:
                score = -(move or 0.0) + min(3.0, volume)
                candidates.append((symbol, score, {'movePct': move, 'volumeRatio': volume, 'side': -1}))

    if not candidates: return None
    symbol, score, meta = max(candidates, key=lambda item: (item[1], item[0]))
    return symbol, float(meta['side']), {'score': score, **meta}


def build_targets(config: EventConfig, times: Sequence[int], bars: Dict[str,List[dict]], indexes: Dict[str,Dict[int,int]]) -> Tuple[Dict[int,Dict[str,float]],List[dict]]:
    targets: Dict[int,Dict[str,float]] = {}
    entries: List[dict] = []
    current: Dict[str,float] = {}
    bars_left = 0
    for ts in times:
        if bars_left > 0:
            targets[ts] = dict(current)
            bars_left -= 1
            if bars_left == 0:
                current = {}
            continue
        found = signal(config, ts, bars, indexes)
        if found is None:
            targets[ts] = {}
            continue
        symbol, side, meta = found
        current = {symbol: side * GROSS}
        bars_left = config.hold_bars
        targets[ts] = dict(current)
        entries.append({'signalTs': ts, 'symbol': symbol, 'side': int(side), 'holdBars': config.hold_bars, **meta})
        bars_left -= 1
        if bars_left == 0: current = {}
    return targets, entries


def build_rows(config: EventConfig, raw: dict) -> Tuple[List[dict],List[dict],List[dict]]:
    times = [int(ts) for ts in raw['times'] if START_MS <= int(ts) < END_MS]
    targets, entries = build_targets(config, times, raw['bars'], raw['indexes'])
    normal_map = v32.core_series(targets, times, raw['bars'], raw['indexes'], raw['funding'], 10, 0, 0)
    severe_map = v32.core_series(targets, times, raw['bars'], raw['indexes'], raw['funding'], 50, 1, 3)
    normal = [{'ts':ts,'return':float(normal_map[ts]['return']),'gross':float(normal_map[ts]['exposure']),'maxGross':float(normal_map[ts]['exposure']),'regime':int(normal_map[ts]['regime'])} for ts in times]
    severe = [{'ts':ts,'return':float(severe_map[ts]['return']),'gross':float(severe_map[ts]['exposure']),'maxGross':float(severe_map[ts]['exposure']),'regime':int(severe_map[ts]['regime'])} for ts in times]
    return normal, severe, entries


def finite(value: Any, fallback: float=0.0) -> float:
    try: x=float(value)
    except (TypeError,ValueError): return fallback
    return x if math.isfinite(x) else fallback


def evaluate(config: EventConfig, raw: dict) -> Tuple[dict,List[dict],List[dict]]:
    normal,severe,entries=build_rows(config,raw)
    item={
      'variantId':config.config_id,'config':asdict(config),'tradeEpisodes':len(entries),
      'development':{'normal':metrics(normal,START_MS,DEV_END_MS,entries),'severe':metrics(severe,START_MS,DEV_END_MS,entries)},
      'validation':{'normal':metrics(normal,DEV_END_MS,HOLDOUT_START_MS,entries),'severe':metrics(severe,DEV_END_MS,HOLDOUT_START_MS,entries)},
      'holdout':{'normal':metrics(normal,HOLDOUT_START_MS,END_MS,entries),'severe':metrics(severe,HOLDOUT_START_MS,END_MS,entries)},
      'full':{'normal':metrics(normal,START_MS,END_MS,entries),'severe':metrics(severe,START_MS,END_MS,entries)},
    }
    dev=item['development']['normal']; devs=item['development']['severe']; val=item['validation']['normal']; vals=item['validation']['severe']
    item['selectionEligible']=bool(
      dev['tradeEpisodes']>=4 and val['tradeEpisodes']>=2
      and finite(dev['compoundedReturnPct'])>0 and finite(devs['compoundedReturnPct'])>-3
      and finite(val['compoundedReturnPct'])>0 and finite(vals['compoundedReturnPct'])>0
      and finite(val.get('profitFactor'))>1.05 and finite(val['maxDrawdownPct'],-99)>=-10
    )
    item['selectionScorePreHoldout']=(
      0.35*finite(dev['compoundedReturnPct'])+0.90*finite(val['compoundedReturnPct'])
      +0.20*finite(devs['compoundedReturnPct'])+0.50*finite(vals['compoundedReturnPct'])
      +4.0*max(0,min(2,finite(val.get('profitFactor'))-1))-0.20*abs(finite(val['maxDrawdownPct']))
    ) if item['selectionEligible'] else -1e12
    return item,normal,severe


def compact(item:dict)->dict:
    return {k:item[k] for k in ('variantId','config','tradeEpisodes','selectionEligible','selectionScorePreHoldout','development','validation','holdout','full')}


def main()->None:
    parser=argparse.ArgumentParser(); parser.add_argument('--output-dir',default='.research-state/v96-recent-event-core-v1'); args=parser.parse_args()
    out=Path(args.output_dir); out.mkdir(parents=True,exist_ok=True)
    core.CORE_END=END_MS; core.v4.END=END_MS
    raw=v89.build_raw()
    results=[]; replay={}
    for cfg in configs():
        item,n,s=evaluate(cfg,raw); results.append(item); replay[item['variantId']]=(n,s)
    eligible=sorted((r for r in results if r['selectionEligible']), key=lambda r:(r['selectionScorePreHoldout'],r['variantId']), reverse=True)
    ranked=sorted(results,key=lambda r:(r['selectionScorePreHoldout'],r['variantId']),reverse=True)
    selected=eligible[0] if eligible else ranked[0]
    normal,severe=replay[selected['variantId']]
    hold=selected['holdout']['normal']; holds=selected['holdout']['severe']; full=selected['full']['normal']; fulls=selected['full']['severe']
    passed=bool(selected['selectionEligible'] and hold['tradeEpisodes']>=3 and finite(hold['compoundedReturnPct'])>=5 and finite(holds['compoundedReturnPct'])>0 and finite(hold.get('profitFactor'))>1.05 and finite(hold['maxDrawdownPct'],-99)>=-12 and finite(full['compoundedReturnPct'])>=15 and finite(fulls['compoundedReturnPct'])>0)
    status='V96_RECENT_EVENT_CORE_V1_PASS' if passed else 'NO_ROBUST_EVENT_CORE_IMPROVEMENT'
    payload=rounded({
      'version':1,'strategyId':'V96_RECENT_EVENT_CORE_V1','status':status,
      'period':{'startInclusive':START.isoformat(),'developmentEndExclusive':DEV_END.isoformat(),'holdoutStartInclusive':HOLDOUT_START.isoformat(),'endExclusive':END.isoformat()},
      'selectionPolicy':{'holdoutUsedForRanking':False,'rankingData':'2025-08-13 through 2026-03-10 only','holdout':'2026-03-11 through 2026-08-02','architecture':'One-position low-frequency event Core; Short Pullback / Long Reclaim / Long Breakout / Short Breakdown; next 12h execution, fixed hold.'},
      'candidateCounts':{'totalVariants':len(results),'selectionEligible':len(eligible),'byFamily':{fam:sum(r['config']['family']==fam for r in results) for fam in sorted({r['config']['family'] for r in results})}},
      'selected':compact(selected),'selectedPassesFreshHoldout':passed,'topPreHoldoutCandidates':[compact(r) for r in ranked[:30]],
      'selectedReplay':{'strategyId':'V96_RECENT_EVENT_CORE_V1','variantId':selected['variantId'],'normal':normal,'severe':severe,'diagnostics':{'legacyPenguIncluded':False,'config':selected['config']}},
      'checks':{'holdoutNotUsedForRanking':True,'selectedValidationPositive':finite(selected['validation']['normal']['compoundedReturnPct'])>0,'selectedFreshHoldoutPositive':finite(hold['compoundedReturnPct'])>0,'selectedFreshHoldoutSeverePositive':finite(holds['compoundedReturnPct'])>0},
      'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False},
      'limitations':['Independent research Core; current V96 is unchanged.','The final holdout is excluded from ranking, although these dates have been observed elsewhere in the wider project.','Normal uses 10bps turnover cost. Severe uses 50bps turnover cost plus one 12h bucket delay and 3bps adverse stress.','Fixed-hold 12h event simulation does not model intrabar stop/limit execution.']
    })
    (out/'v96-recent-event-core-v1.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    lines=['# V96 Recent Event Core V1','',f'- Status: **{status}**',f"- Variants: {len(results)} / pre-holdout eligible: {len(eligible)}",f"- Selected: **{selected['variantId']}**",f"- Family: **{selected['config']['family']}**",'',f"- Development: {selected['development']['normal']['compoundedReturnPct']}% / Severe {selected['development']['severe']['compoundedReturnPct']}% / trades {selected['development']['normal']['tradeEpisodes']}",f"- Validation: {selected['validation']['normal']['compoundedReturnPct']}% / Severe {selected['validation']['severe']['compoundedReturnPct']}% / trades {selected['validation']['normal']['tradeEpisodes']}",f"- Fresh Holdout: **{hold['compoundedReturnPct']}%** / PF {hold.get('profitFactor')} / DD {hold['maxDrawdownPct']}% / Severe **{holds['compoundedReturnPct']}%** / trades {hold['tradeEpisodes']}",f"- Full: **{full['compoundedReturnPct']}%** / PF {full.get('profitFactor')} / DD {full['maxDrawdownPct']}% / Severe **{fulls['compoundedReturnPct']}%** / trades {full['tradeEpisodes']}",f"- Fresh Holdout pass: **{'YES' if passed else 'NO'}**",'','- Production / LIVE / VPS / orders changed: **NO**']
    (out/'v96-recent-event-core-v1.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('\n'.join(lines))

if __name__=='__main__': main()
