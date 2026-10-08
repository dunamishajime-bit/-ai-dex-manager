"""Three-stage V12 entry architecture: onset -> failed breakout -> causal confirmation.

Research-only and pre-holdout only. The already-seen 2026-08-11+ period is excluded
from selection. Purpose: distinguish genuine reversal from a single violent pullback.
"""
import collections, datetime as dt, json, math
from pathlib import Path
import run_v12_untouched_holdout as h

ROOT=h.ROOT
OUT=ROOT/'docs/research/results/v12-three-stage-confirmation-20261008'
FROZEN=Path(r'C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\market-Aster-H1-funding-and-manifests\normalized\aster\klines')
H=h.H
START=int(dt.datetime(2025,1,11,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2026,8,10,tzinfo=dt.timezone.utc).timestamp()*1000)
ENTRY_END=END-46*H
DEV_START=int(dt.datetime(2025,8,10,tzinfo=dt.timezone.utc).timestamp()*1000)
DEV_MID=int(dt.datetime(2026,2,9,tzinfo=dt.timezone.utc).timestamp()*1000)
VARIANTS=['CONF_CLOSE','CONF_CLOSE_BTC','CONF_LOWER_LOW','CONF_LOWER_HIGH_CLOSE']

def build(h1,h2,maps):
    allout={v:[] for v in VARIANTS}
    for variant in VARIANTS:
        states={s:None for s in h.SYMS};btcarr=h2['BTCUSDT']
        for now in range(START-240*H,ENTRY_END,2*H):
            bi=maps['BTCUSDT'].get(now)
            if bi is None or bi<60:continue
            btc=btcarr[max(0,bi-120):bi+1]
            for sym,arr in h2.items():
                i=maps[sym].get(now)
                if i is None or i<60:
                    states[sym]=None;continue
                bs=arr[max(0,i-120):i+1];f=h.frames(bs,btc)
                if not f:
                    states[sym]=None;continue
                st=states[sym]
                if st and st['kind']=='CONFIRM':
                    # exactly the next completed H2 after failure; no retrospective waiting.
                    if now!=st['fail_ts_ms']+2*H:
                        states[sym]=None;st=None
                    else:
                        clv=f['clv_short']
                        close_cont=f['close']<st['fail_close'] and clv>=.55
                        lower_low=f['close']<st['fail_low'] and clv>=.55
                        lower_high_close=f['high']<st['fail_high'] and f['close']<st['fail_close'] and clv>=.55
                        ok=(close_cont if variant=='CONF_CLOSE' else
                            close_cont and f['btc6']<=0 if variant=='CONF_CLOSE_BTC' else
                            lower_low if variant=='CONF_LOWER_LOW' else
                            lower_high_close)
                        if ok and now>=START:
                            bar=h1[sym].get(now)
                            if bar:
                                allout[variant].append({
                                  'symbol':sym,'side':'SHORT','sg':-1,'entry_ts_ms':now,'entry_price':bar['open'],
                                  'atr':f['atr'],'score':h.quality(f,-1) if hasattr(h,'quality') else max(.01,f['volume_ratio'])*max(.01,f['clv_short'])*max(.05,f['body_atr']),
                                  'route':variant,'setup_ts_ms':st['setup_ts_ms'],'fail_ts_ms':st['fail_ts_ms'],
                                  'decision_ts_ms':now,'state_age_h':(now-st['setup_ts_ms'])/H,
                                  'onset_momentum90':st['momentum90'],'confirm_btc6':f['btc6'],
                                  'confirm_sym6':f['ret6'],'confirm_rel6':f['rel6'],'confirm_clv_short':f['clv_short']
                                })
                        states[sym]=None;st=None
                st=states[sym]
                if st and st['kind']=='ONSET':
                    age=now-st['setup_ts_ms']
                    if age>6*H:
                        states[sym]=None;st=None
                    else:
                        sg=st['sg'];atr=st['atr'];level=st['level']
                        clv_same=f['clv_long'] if sg==1 else f['clv_short']
                        clv_opp=f['clv_short'] if sg==1 else f['clv_long']
                        touch=(f['low']<=level+.25*atr) if sg==1 else (f['high']>=level-.25*atr)
                        reclaim=(f['close']>=level+.05*atr) if sg==1 else (f['close']<=level-.05*atr)
                        same_bar=sg*(f['close']-f['open'])>0
                        retest=touch and reclaim and same_bar and clv_same>=.60 and f['body_atr']>=.15 and sg*f['btc6']>=-.005
                        if sg*(f['close']-f['prev_close'])<0:st['had_pullback']=True
                        clear_prev=(f['close']>=f['prev_high']+.05*f['atr']) if sg==1 else (f['close']<=f['prev_low']-.05*f['atr'])
                        reaccel=st['had_pullback'] and clear_prev and clv_same>=.65 and f['body_atr']>=.20 and sg*f['ret6']>0 and sg*f['rel6']>=0 and sg*f['btc6']>=-.005
                        fail=sg*(f['close']-level)<=-.15*atr and clv_opp>=.65 and f['body_atr']>=.20
                        if fail:
                            # Only upward-onset failure can become the candidate SHORT.
                            # Need one more H2 and total freshness <=6h, so failure must be <=4h.
                            if sg==1 and age<=4*H:
                                states[sym]={'kind':'CONFIRM','setup_ts_ms':st['setup_ts_ms'],'fail_ts_ms':now,
                                  'momentum90':st['momentum90'],'fail_close':f['close'],'fail_low':f['low'],
                                  'fail_high':f['high'],'level':level,'setup_atr':atr}
                            else:states[sym]=None
                            st=None
                        elif retest or reaccel:
                            states[sym]=None;st=None
                if states[sym] is None:
                    z=h.base_onset(bs,btc)
                    if z:
                        sg,mom,prev,of=z
                        level=of['level_high'] if sg==1 else of['level_low']
                        states[sym]={'kind':'ONSET','sg':sg,'setup_ts_ms':now,'atr':of['atr'],
                          'level':level,'momentum90':mom,'had_pullback':False}
    return allout

def select(pool):
    groups=collections.defaultdict(list)
    for c in pool:groups[c['entry_ts_ms']].append(c)
    out=[]
    for ts,cs in sorted(groups.items()):
        cs=sorted(cs,key=lambda c:(-c['score'],c['symbol']))
        for rank,c in enumerate(cs[:3],1):
            e=c['entry_price'];dist=max(2.477*c['atr'],e*.005);gross=min(1.,.0319/(dist/e))
            if rank==3:gross=min(.1,gross)
            out.append(dict(c,rank=rank,requested_gross=gross))
    return out

def perf(xs,c):
    vals=[x['unit_gross_return']-c/10000 for x in xs];n=len(vals);pos=sum(max(v,0) for v in vals);neg=-sum(min(v,0) for v in vals)
    return {'n':n,'wr':sum(v>0 for v in vals)/n if n else None,'pf':pos/neg if neg else None,
      'mean':sum(vals)/n if n else None,'sum':sum(vals),'without_best':sum(vals)-max(vals) if vals else None}

def main():
    h.DATA=FROZEN
    h1={s:h.load(s) for s in h.SYMS};h2={s:h.h2_series(h1[s]) for s in h.SYMS};maps={s:{b['end']:i for i,b in enumerate(a)} for s,a in h2.items()}
    pools=build(h1,h2,maps);OUT.mkdir(parents=True,exist_ok=True);report={}
    for v,pool in pools.items():
        sel=select(pool);tr=[]
        for c in sel:
            x=h.exit_legacy(c,h1[c['symbol']])
            if x:tr.append(x)
        segs={
          'ALL':tr,
          'PRE':[x for x in tr if x['entry_ts_ms']<DEV_START],
          'PRE_Q1':[x for x in tr if dt.datetime.fromtimestamp(x['entry_ts_ms']/1000,dt.timezone.utc).year==2025 and dt.datetime.fromtimestamp(x['entry_ts_ms']/1000,dt.timezone.utc).month<=3],
          'PRE_Q2':[x for x in tr if dt.datetime.fromtimestamp(x['entry_ts_ms']/1000,dt.timezone.utc).year==2025 and 4<=dt.datetime.fromtimestamp(x['entry_ts_ms']/1000,dt.timezone.utc).month<=6],
          'DEV':[x for x in tr if x['entry_ts_ms']>=DEV_START],
          'DEV_FIRST':[x for x in tr if DEV_START<=x['entry_ts_ms']<DEV_MID],
          'DEV_SECOND':[x for x in tr if x['entry_ts_ms']>=DEV_MID],
        }
        report[v]={'selected':len(sel),'segments':{k:{str(c):perf(z,c) for c in [10,20,30]} for k,z in segs.items()}}
        (OUT/f'{v.lower()}-trades.jsonl').write_text(''.join(json.dumps(x,sort_keys=True)+'\n' for x in tr),encoding='utf-8')
    meta={'status':'COMPLETE_PRE_HOLDOUT_THREE_STAGE_RESEARCH','research_only':True,'holdout_2026_08_11_plus_used_for_selection':False,
          'architecture':'fresh upward onset -> structural failure by <=4h -> one additional H2 confirmation -> next H1 SHORT',
          'variants':VARIANTS,'results':report}
    (OUT/'summary.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    for v in VARIANTS:
        print('\n',v)
        for k in ['PRE','PRE_Q1','PRE_Q2','DEV','DEV_FIRST','DEV_SECOND']:
            print(k,report[v]['segments'][k]['10'],'20',report[v]['segments'][k]['20'],'30',report[v]['segments'][k]['30'])
if __name__=='__main__':main()
