"""Research-only V12 momentum-onset entry study.

Rebuilds V12 entry timing around the first causal crossing of the existing
45xH2 (90h) momentum threshold +/-2.27%. Eligibility is event/price-structure
based; legacy V12 score is used only to rank simultaneous candidates.
No LIVE/Production code is changed.
"""
import json, math, statistics, collections
from pathlib import Path
import run_v12_logic_dissection as s
import run_v12_entry_phase as ep
import v12_entry_state_logic as m

ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-momentum-onset-20261008'
H=s.H
START=ep.START
END=ep.END
MID=s.MID
TH=0.0227
CASES=['BASELINE_Q_RET14','ONSET_RAW','ONSET_CONFIRM','ONSET_BREAK','ONSET_FAST_BTC']
POOLS={}
ACTIVE=None

def legacy_score(bs,mom):
    ps=[b['close'] for b in bs]
    if len(ps)<16:return 0.0
    rs=[math.log(ps[i]/ps[i-1]) for i in range(len(ps)-15,len(ps))]
    vol=statistics.stdev(rs) if len(rs)>=2 else 0.0
    scale=max(0.0001,vol*math.sqrt(45))
    raw=abs(mom)/scale
    return raw/(1+2.3953*vol*100)

def eligible_variant(c,name):
    f=c['features']; sg=c['sg']
    if name=='ONSET_RAW':
        return f['volume_ratio']>=0.80
    clv=f['clv_long'] if sg==1 else f['clv_short']
    confirm=(f['volume_ratio']>=0.80 and sg*f['ret6']>0 and sg*f['rel6']>=0 and clv>=0.60 and f['body_atr']>=0.20)
    if name=='ONSET_CONFIRM':
        return confirm
    if name=='ONSET_FAST_BTC':
        return confirm and sg*f['btc6']>=0
    if name=='ONSET_BREAK':
        if not confirm:return False
        return (f['close']>=f['level_high']+0.05*f['atr']) if sg==1 else (f['close']<=f['level_low']-0.05*f['atr'])
    return False

def build_pool(ordered,maps):
    raw=[]
    for sym,bsall in ordered.items():
        btc_all=ordered['BTCUSDT']
        for i in range(50,len(bsall)):
            b=bsall[i]; now=b['end']
            if now<START or now>=END:continue
            bi=maps['BTCUSDT'].get(now)
            if bi is None or bi<50:continue
            if i<46:continue
            mom=b['close']/bsall[i-45]['close']-1
            prev=bsall[i-1]['close']/bsall[i-46]['close']-1
            sg=1 if mom>=TH and prev<TH else -1 if mom<=-TH and prev>-TH else 0
            if not sg:continue
            ws=bsall[max(0,i-120):i+1]
            wb=btc_all[max(0,bi-120):bi+1]
            if len(ws)<50 or len(wb)<50:continue
            f=ep.frames(ws,wb)
            if not f:continue
            h1=s.w.bars.get(sym,{}).get(now)
            if not h1:continue
            side='LONG' if sg==1 else 'SHORT'
            entry=float(h1['open'])
            score=legacy_score(ws,mom)
            raw.append({
                'symbol':sym,'side':side,'sg':sg,'entry_ts_ms':now,'entry_price':entry,
                'atr':f['atr'],'score':score,'momentum90':mom,'previous_momentum90':prev,
                'route':'MOMENTUM_ONSET','setup_ts_ms':now,'decision_ts_ms':now,
                'signal_ts_ms':now,'structural_stop':f['low']-0.2*f['atr'] if sg==1 else f['high']+0.2*f['atr'],
                'features':f
            })
    pools={}
    for name in CASES[1:]:
        pools[name]=[c for c in raw if eligible_variant(c,name)]
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'raw-onset-pool.jsonl').write_text(''.join(json.dumps(c,sort_keys=True)+'\n' for c in raw),encoding='utf-8')
    for name,cs in pools.items():
        (OUT/f'{name.lower()}-pool.jsonl').write_text(''.join(json.dumps(c,sort_keys=True)+'\n' for c in cs),encoding='utf-8')
    return raw,pools

def select(pool):
    groups=collections.defaultdict(list)
    for c in pool:groups[c['entry_ts_ms']].append(c)
    out=[]
    for ts,cs in sorted(groups.items()):
        cs=sorted(cs,key=lambda c:(-c['score'],c['symbol']))
        for rank,c in enumerate(cs[:3],1):
            if rank==3 and c['score']<0.70:continue
            e=c['entry_price']; dist=max(2.477*c['atr'],e*0.005)
            gross=min(1.0,0.0319/(dist/e))
            if rank==3:gross=min(0.10,gross)
            out.append(dict(c,rank=rank,requested_gross=gross))
    return out

def raw_stats(pool):
    a=[]
    for c in select(pool):
        x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
        if x:a.append(x)
    def st(z,cost):
        return s.stat([x['unit_gross_return']-cost/10000 for x in z])
    return {
        'selected':len(a),
        'all':{str(cost):st(a,cost) for cost in [10,20,30]},
        'first':{str(cost):st([x for x in a if x['exit_ts_ms']<MID],cost) for cost in [10,20,30]},
        'second':{str(cost):st([x for x in a if x['entry_ts_ms']>=MID],cost) for cost in [10,20,30]},
        'LONG':{str(cost):st([x for x in a if x['side']=='LONG'],cost) for cost in [10,20,30]},
        'SHORT':{str(cost):st([x for x in a if x['side']=='SHORT'],cost) for cost in [10,20,30]},
    }

def read_table(strategy,variant='BASELINE'):
    return s.w.frozen_read(strategy,variant)

def filt(candidates,name):
    if name=='BASELINE_Q_RET14':return candidates
    out=[c for c in candidates if c['strategy_id']!='V12']
    for c in select(POOLS[name]):
        x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
        if x is None:continue
        d=s.w.base.candidate(x,'V12')
        d.update(route=name,entryQualityClass='MOMENTUM_ONSET',onset_features=c['features'],
                 setup_ts_ms=c['setup_ts_ms'],decision_ts_ms=c['decision_ts_ms'],
                 momentum90=c['momentum90'],previous_momentum90=c['previous_momentum90'])
        out.append(d)
    return out

def detail(a):
    d=s.w.stats(a)
    vals=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a if t.get('original_quantity') and t.get('entry_price')]
    d['unit_returns']=s.stat(vals)
    d['without_best_jpy']=sum(t['total_pnl_jpy'] for t in a)-max([t['total_pnl_jpy'] for t in a],default=0)
    return d

def main():
    global POOLS,ACTIVE
    OUT.mkdir(parents=True,exist_ok=True)
    protocol={
      'research_only':True,'live_changes':False,
      'period':'2025-08-10 through 2026-08-10 UTC; previously explored, not untouched holdout',
      'event':'First completed H2 where side-adjusted 45-H2 return crosses from below to >=2.27%. Entry at the immediately following H1 open.',
      'ranking':'Legacy V12 penalized score is used only for simultaneous ranking; it is not an eligibility threshold for rank1/rank2. Rank3 retains score>=0.70 and 0.10 gross cap.',
      'variants':{
        'ONSET_RAW':'onset + existing volume ratio >=0.80',
        'ONSET_CONFIRM':'RAW + signed6h>0 + signed relative-to-BTC6h>=0 + side CLV>=0.60 + body>=0.20ATR',
        'ONSET_BREAK':'CONFIRM + close clears prior12-H2 high/low by 0.05ATR',
        'ONSET_FAST_BTC':'CONFIRM + signed BTC6h >=0'
      },
      'exit':'Existing legacy V12 46h stop2.477ATR / TP3.1995ATR / 0.2ATR H2 trailing, to isolate entry timing.',
      'size':'Existing 3.19% risk sizing, rank3 cap0.10, aggregate/ownership/global portfolio constraints unchanged.',
      'costs_bps':[10,20,30],
      'note':'All variants were fixed before integrated replay; this is exploratory on a previously studied period and is not production approval.'
    }
    (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
    # Reuse Work's exact H2 construction and causal market alignment.
    _,ordered,maps=ep.prepare()
    raw,POOLS=build_pool(ordered,maps)
    screen={'raw_onset_events':len(raw),'variants':{name:{'pool':len(POOLS[name]),'stats':raw_stats(POOLS[name])} for name in CASES[1:]}}
    (OUT/'onset-screen.json').write_text(json.dumps(screen,indent=2),encoding='utf-8')
    print('SCREEN',json.dumps(screen),flush=True)

    s.w.OUT=OUT
    s.w.setup()
    s.w.base.read_table=read_table
    s.w.base._study_filter=filt
    results=[]
    for name in CASES:
        ACTIVE=name
        print('START',name,flush=True)
        r=s.w.base.run_study(name,'10,20,30')
        r['research_only']=True
        for sc in r['scenarios']:
            p=OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl'
            ts=s.rows(p); v=[x for x in ts if x['strategy_id']=='V12']
            sc['v12_details']={
                'all':detail(v),
                'first':detail([x for x in v if x['exit_ts_ms']<MID]),
                'second':detail([x for x in v if x['entry_ts_ms']>=MID]),
                'LONG':detail([x for x in v if x['side']=='LONG']),
                'SHORT':detail([x for x in v if x['side']=='SHORT'])
            }
        (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
        results.append(r)
        (OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print('DONE',name,flush=True)

if __name__=='__main__':
    main()
