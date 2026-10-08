"""Research-only two-stage entry state machine anchored to fresh 90h momentum breakout.

Stage 1: fresh +/-2.27% 45-H2 momentum onset with structural breakout.
Stage 2: wait causally for retest-reclaim, pullback-reacceleration, or breakout failure reversal.
No LIVE/Production changes. Legacy V12 exit is retained to isolate entry architecture.
"""
import json, math, statistics, collections, sys
import run_v12_logic_dissection as s
import run_v12_entry_phase as ep
import v12_entry_state_logic as m
import run_v12_momentum_onset as onset

ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-onset-state-machine-20261008'
H=s.H; START=ep.START; END=ep.END; MID=s.MID; TH=0.0227
ROUTES=['RETEST_RECLAIM','PULLBACK_REACCEL','FAILED_BREAK_REV']
CASES={
 'STATE_RETEST':['RETEST_RECLAIM'],
 'STATE_REACCEL':['PULLBACK_REACCEL'],
 'STATE_FAIL_REV':['FAILED_BREAK_REV'],
 'STATE_ADAPTIVE':ROUTES,
}
POOLS={}; ACTIVE=None

def base_onset(bs,btc):
    if len(bs)<50 or len(btc)<50:return None
    f=ep.frames(bs,btc)
    if not f:return None
    mom=bs[-1]['close']/bs[-46]['close']-1
    prev=bs[-2]['close']/bs[-47]['close']-1
    sg=1 if mom>=TH and prev<TH else -1 if mom<=-TH and prev>-TH else 0
    if not sg:return None
    clv=f['clv_long'] if sg==1 else f['clv_short']
    confirm=(f['volume_ratio']>=.80 and sg*f['ret6']>0 and sg*f['rel6']>=0 and clv>=.60 and f['body_atr']>=.20)
    br=(f['close']>=f['level_high']+.05*f['atr']) if sg==1 else (f['close']<=f['level_low']-.05*f['atr'])
    if not (confirm and br):return None
    return sg,mom,prev,f

def event_quality(f,sg):
    clv=f['clv_long'] if sg==1 else f['clv_short']
    return max(.01,f['volume_ratio'])*max(.01,clv)*max(.05,f['body_atr'])

def build(ordered,maps):
    states={sym:None for sym in ordered}
    events=[]
    for now in range(START-120*H,END,2*H):
        bi=maps['BTCUSDT'].get(now)
        if bi is None or bi<60:continue
        btc=ordered['BTCUSDT'][max(0,bi-120):bi+1]
        for sym,allbs in ordered.items():
            i=maps[sym].get(now)
            if i is None or i<60:
                states[sym]=None
                continue
            bs=allbs[max(0,i-120):i+1]
            f=ep.frames(bs,btc)
            if not f:
                states[sym]=None
                continue
            st=states.get(sym)
            # Consume or expire an existing state before creating a new onset.
            if st:
                age=now-st['setup_ts_ms']
                if age>8*H:
                    states[sym]=None; st=None
                else:
                    sg=st['sg']; atr=st['atr']; level=st['level']
                    clv_same=f['clv_long'] if sg==1 else f['clv_short']
                    clv_opp=f['clv_short'] if sg==1 else f['clv_long']
                    touch=(f['low']<=level+.25*atr) if sg==1 else (f['high']>=level-.25*atr)
                    reclaim=(f['close']>=level+.05*atr) if sg==1 else (f['close']<=level-.05*atr)
                    same_bar=sg*(f['close']-f['open'])>0
                    retest=touch and reclaim and same_bar and clv_same>=.60 and f['body_atr']>=.15 and sg*f['btc6']>=-.005
                    if sg*(f['close']-f['prev_close'])<0:
                        st['had_pullback']=True
                    clear_prev=(f['close']>=f['prev_high']+.05*f['atr']) if sg==1 else (f['close']<=f['prev_low']-.05*f['atr'])
                    reaccel=st['had_pullback'] and clear_prev and clv_same>=.65 and f['body_atr']>=.20 and sg*f['ret6']>0 and sg*f['rel6']>=0 and sg*f['btc6']>=-.005
                    fail=(sg*(f['close']-level)<=-.15*atr and clv_opp>=.65 and f['body_atr']>=.20)
                    route=None; outsg=sg
                    if fail:
                        route='FAILED_BREAK_REV'; outsg=-sg
                    elif retest:
                        route='RETEST_RECLAIM'
                    elif reaccel:
                        route='PULLBACK_REACCEL'
                    if route and now>=START:
                        h1=s.w.bars.get(sym,{}).get(now)
                        if h1:
                            events.append({
                              'symbol':sym,'side':'LONG' if outsg==1 else 'SHORT','sg':outsg,
                              'entry_ts_ms':now,'entry_price':float(h1['open']),'atr':f['atr'],
                              'score':event_quality(f,outsg),'route':route,'setup_ts_ms':st['setup_ts_ms'],
                              'decision_ts_ms':now,'signal_ts_ms':now,'structural_stop':f['low']-.2*f['atr'] if outsg==1 else f['high']+.2*f['atr'],
                              'features':f,'onset_features':st['features'],'onset_momentum90':st['momentum90'],
                              'state_age_h':age/H
                            })
                            states[sym]=None; st=None
            # New state only if none remains.
            if states.get(sym) is None:
                z=base_onset(bs,btc)
                if z:
                    sg,mom,prev,of=z
                    level=of['level_high'] if sg==1 else of['level_low']
                    states[sym]={'sg':sg,'setup_ts_ms':now,'atr':of['atr'],'level':level,
                                 'features':of,'momentum90':mom,'had_pullback':False}
    pools={r:[x for x in events if x['route']==r] for r in ROUTES}
    pools['ALL']=events
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'events.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in events),encoding='utf-8')
    return pools

def select(pool,routes):
    groups=collections.defaultdict(list)
    for c in pool:
        if c['route'] in routes:groups[c['entry_ts_ms']].append(c)
    out=[]
    for ts,cs in sorted(groups.items()):
        cs=sorted(cs,key=lambda c:(-c['score'],ROUTES.index(c['route']),c['symbol']))
        seen=set(); u=[]
        for c in cs:
            if c['symbol'] in seen:continue
            seen.add(c['symbol']);u.append(c)
        for rank,c in enumerate(u[:3],1):
            e=c['entry_price'];dist=max(2.477*c['atr'],e*.005)
            gross=min(1.,.0319/(dist/e))
            if rank==3:gross=min(.1,gross)
            out.append(dict(c,rank=rank,requested_gross=gross))
    return out

def raw_stat(pool,routes):
    xs=[]
    for c in select(pool,routes):
        x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
        if x:xs.append(x)
    def st(a,cost):return s.stat([x['unit_gross_return']-cost/10000 for x in a])
    return {
      'selected':len(xs),
      'all':{str(c):st(xs,c) for c in [10,20,30]},
      'first':{str(c):st([x for x in xs if x['exit_ts_ms']<MID],c) for c in [10,20,30]},
      'second':{str(c):st([x for x in xs if x['entry_ts_ms']>=MID],c) for c in [10,20,30]},
      'LONG':{str(c):st([x for x in xs if x['side']=='LONG'],c) for c in [10,20,30]},
      'SHORT':{str(c):st([x for x in xs if x['side']=='SHORT'],c) for c in [10,20,30]},
    }

def read_table(strategy,variant='BASELINE'):return s.w.frozen_read(strategy,variant)

def filt(candidates,name):
    if name=='BASELINE_Q_RET14':return candidates
    out=[c for c in candidates if c['strategy_id']!='V12']
    for c in select(POOLS['ALL'],CASES[name]):
        x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
        if not x:continue
        d=s.w.base.candidate(x,'V12')
        d.update(route=c['route'],entryQualityClass='ONSET_STATE',setup_ts_ms=c['setup_ts_ms'],
                 decision_ts_ms=c['decision_ts_ms'],state_age_h=c['state_age_h'])
        out.append(d)
    return out

def detail(a):
    d=s.w.stats(a); vals=[t['total_pnl_jpy']/(t['original_quantity']*t['entry_price']) for t in a if t.get('original_quantity') and t.get('entry_price')]
    d['unit_returns']=s.stat(vals);d['without_best_jpy']=sum(t['total_pnl_jpy'] for t in a)-max([t['total_pnl_jpy'] for t in a],default=0)
    return d

def screen():
    global POOLS
    _,ordered,maps=ep.prepare()
    POOLS=build(ordered,maps)
    out={'research_only':True,'route_counts':{r:len(POOLS[r]) for r in ROUTES},
         'cases':{name:raw_stat(POOLS['ALL'],routes) for name,routes in CASES.items()}}
    (OUT/'screen.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    print(json.dumps(out,indent=2))

def run():
    global POOLS,ACTIVE
    _,ordered,maps=ep.prepare();POOLS=build(ordered,maps)
    protocol={
      'research_only':True,'live_changes':False,
      'stage1':'Fresh 45-H2 +/-2.27% onset + volume>=0.8 + signed6h and BTC-relative6h positive + CLV>=0.6 + body>=0.2ATR + prior12-H2 breakout 0.05ATR.',
      'stage2_window':'Next 2-8h completed H2 only; entry is next H1 open after the event.',
      'routes':{
        'RETEST_RECLAIM':'touch breakout level within 0.25ATR, reclaim by 0.05ATR, same-side candle/CLV, fast BTC not worse than -0.5%',
        'PULLBACK_REACCEL':'observed pullback then clear previous H2 extreme by 0.05ATR with CLV/relative6h/fast-BTC confirmation',
        'FAILED_BREAK_REV':'close fails original level by 0.15ATR with opposite CLV>=0.65; enter opposite direction'
      },
      'exit':'Legacy V12 46h exit retained to isolate entry architecture.',
      'costs_bps':[10,20,30],
      'period':'2025-08-10 through 2026-08-10 UTC; previously explored, not untouched holdout'
    }
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
    scr={'route_counts':{r:len(POOLS[r]) for r in ROUTES},'cases':{name:raw_stat(POOLS['ALL'],routes) for name,routes in CASES.items()}}
    (OUT/'screen.json').write_text(json.dumps(scr,indent=2),encoding='utf-8');print('SCREEN',json.dumps(scr),flush=True)
    s.w.OUT=OUT;s.w.setup();s.w.base.read_table=read_table;s.w.base._study_filter=filt
    results=[]
    for name in ['BASELINE_Q_RET14']+list(CASES):
        ACTIVE=name;print('START',name,flush=True);r=s.w.base.run_study(name,'10,20,30');r['research_only']=True
        for sc in r['scenarios']:
            ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl');v=[x for x in ts if x['strategy_id']=='V12']
            sc['v12_details']={'all':detail(v),'first':detail([x for x in v if x['exit_ts_ms']<MID]),'second':detail([x for x in v if x['entry_ts_ms']>=MID]),
                               'LONG':detail([x for x in v if x['side']=='LONG']),'SHORT':detail([x for x in v if x['side']=='SHORT']),
                               'routes':{route:detail([x for x in v if x.get('route')==route]) for route in ROUTES}}
        (OUT/'cases'/name/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8');results.append(r)
        (OUT/'comparison-summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8');print('DONE',name,flush=True)

if __name__=='__main__':
    {'screen':screen,'run':run}[sys.argv[1] if len(sys.argv)>1 else 'screen']()
