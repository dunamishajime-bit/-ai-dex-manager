"""Neighborhood sensitivity of V12 failed-break reversal SHORT state entry.
Research-only. Varies one causal threshold at a time around the discovered baseline,
while keeping competing retest/reacceleration state transitions fixed.
"""
import json, collections
import run_v12_logic_dissection as s
import run_v12_entry_phase as ep
import v12_entry_state_logic as m
import run_v12_onset_state_machine as sm

OUT=s.ROOT/'docs/research/results/v12-failed-break-short-20261008'
H=s.H; START=ep.START; END=ep.END; MID=s.MID

VARIANTS={
 'BASE':        {'depth':.15,'clv':.65,'body':.20,'window_h':8},
 'DEPTH_010':   {'depth':.10,'clv':.65,'body':.20,'window_h':8},
 'DEPTH_020':   {'depth':.20,'clv':.65,'body':.20,'window_h':8},
 'CLV_060':     {'depth':.15,'clv':.60,'body':.20,'window_h':8},
 'CLV_070':     {'depth':.15,'clv':.70,'body':.20,'window_h':8},
 'BODY_015':    {'depth':.15,'clv':.65,'body':.15,'window_h':8},
 'BODY_025':    {'depth':.15,'clv':.65,'body':.25,'window_h':8},
 'WINDOW_6H':   {'depth':.15,'clv':.65,'body':.20,'window_h':6},
 'WINDOW_10H':  {'depth':.15,'clv':.65,'body':.20,'window_h':10},
}

def quality(f,sg):
    clv=f['clv_long'] if sg==1 else f['clv_short']
    return max(.01,f['volume_ratio'])*max(.01,clv)*max(.05,f['body_atr'])

def build_all(ordered,maps):
    states={name:{sym:None for sym in ordered} for name in VARIANTS}
    events={name:[] for name in VARIANTS}
    for now in range(START-120*H,END,2*H):
        bi=maps['BTCUSDT'].get(now)
        if bi is None or bi<60: continue
        btc=ordered['BTCUSDT'][max(0,bi-120):bi+1]
        for sym,allbs in ordered.items():
            i=maps[sym].get(now)
            if i is None or i<60:
                for name in VARIANTS: states[name][sym]=None
                continue
            bs=allbs[max(0,i-120):i+1]
            f=ep.frames(bs,btc)
            if not f:
                for name in VARIANTS: states[name][sym]=None
                continue
            onset=sm.base_onset(bs,btc)
            for name,p in VARIANTS.items():
                st=states[name][sym]
                if st:
                    age=now-st['setup_ts_ms']
                    if age>p['window_h']*H:
                        states[name][sym]=None; st=None
                    else:
                        sg=st['sg']; atr=st['atr']; level=st['level']
                        clv_same=f['clv_long'] if sg==1 else f['clv_short']
                        clv_opp=f['clv_short'] if sg==1 else f['clv_long']
                        touch=(f['low']<=level+.25*atr) if sg==1 else (f['high']>=level-.25*atr)
                        reclaim=(f['close']>=level+.05*atr) if sg==1 else (f['close']<=level-.05*atr)
                        same_bar=sg*(f['close']-f['open'])>0
                        retest=touch and reclaim and same_bar and clv_same>=.60 and f['body_atr']>=.15 and sg*f['btc6']>=-.005
                        if sg*(f['close']-f['prev_close'])<0: st['had_pullback']=True
                        clear_prev=(f['close']>=f['prev_high']+.05*f['atr']) if sg==1 else (f['close']<=f['prev_low']-.05*f['atr'])
                        reaccel=st['had_pullback'] and clear_prev and clv_same>=.65 and f['body_atr']>=.20 and sg*f['ret6']>0 and sg*f['rel6']>=0 and sg*f['btc6']>=-.005
                        fail=(sg*(f['close']-level)<=-p['depth']*atr and clv_opp>=p['clv'] and f['body_atr']>=p['body'])
                        route=None; outsg=sg
                        if fail: route='FAILED_BREAK_REV'; outsg=-sg
                        elif retest: route='RETEST_RECLAIM'
                        elif reaccel: route='PULLBACK_REACCEL'
                        if route:
                            if route=='FAILED_BREAK_REV' and outsg==-1 and now>=START:
                                h1=s.w.bars.get(sym,{}).get(now)
                                if h1:
                                    events[name].append({
                                      'symbol':sym,'side':'SHORT','sg':-1,'entry_ts_ms':now,'entry_price':float(h1['open']),
                                      'atr':f['atr'],'score':quality(f,-1),'route':'FAILED_BREAK_REV_SHORT',
                                      'setup_ts_ms':st['setup_ts_ms'],'decision_ts_ms':now,'signal_ts_ms':now,
                                      'structural_stop':f['high']+.2*f['atr'],'features':f,'state_age_h':age/H
                                    })
                            states[name][sym]=None; st=None
                if states[name][sym] is None and onset:
                    sg,mom,prev,of=onset
                    level=of['level_high'] if sg==1 else of['level_low']
                    states[name][sym]={'sg':sg,'setup_ts_ms':now,'atr':of['atr'],'level':level,'had_pullback':False}
    return events

def select(pool):
    groups=collections.defaultdict(list)
    for c in pool: groups[c['entry_ts_ms']].append(c)
    out=[]
    for ts,cs in sorted(groups.items()):
        cs=sorted(cs,key=lambda c:(-c['score'],c['symbol']))
        for rank,c in enumerate(cs[:3],1):
            e=c['entry_price'];dist=max(2.477*c['atr'],e*.005);gross=min(1.,.0319/(dist/e))
            if rank==3:gross=min(.1,gross)
            out.append(dict(c,rank=rank,requested_gross=gross))
    return out

def stats(pool):
    trades=[]
    for c in select(pool):
        x=m.exit_trade(c,s.w.bars[c['symbol']],structured=False)
        if x: trades.append(x)
    def st(xs,cost): return s.stat([x['unit_gross_return']-cost/10000 for x in xs])
    return {
      'events':len(pool),'selected':len(trades),
      'all':{str(c):st(trades,c) for c in [10,20,30]},
      'first':{str(c):st([x for x in trades if x['exit_ts_ms']<MID],c) for c in [10,20,30]},
      'second':{str(c):st([x for x in trades if x['entry_ts_ms']>=MID],c) for c in [10,20,30]},
    }

_,ordered,maps=ep.prepare()
events=build_all(ordered,maps)
report={'variants':VARIANTS,'results':{name:stats(pool) for name,pool in events.items()}}
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'threshold-neighborhood.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
