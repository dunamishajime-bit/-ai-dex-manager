from __future__ import annotations
import json, os
from pathlib import Path
import research_lab_pair_specific_v109 as v109

PAIR='SOL'; KIND='regime_wave'; CID='sol_v109_profit_extension_owner_v8'; HOUR=v109.HOUR


def summary(vals):
    m=v109.metric(vals)
    wins=sorted(vals, reverse=True)
    m['pfWithoutBest']=v109.metric(vals[1:] if vals and vals[0]==max(vals) else vals).get('pf') if vals else None
    m['top5ContributionPct']=(100*sum(wins[:5])/sum(vals)) if vals and abs(sum(vals))>1e-9 else None
    return m


def simulate(candles,idx,start,end,cost,delay,model,extended):
    c=candles[PAIR]; th=model['threshold']; state=0
    entry=peak=trough=None; ets=None; entry_i=None; life='CASH'; vals=[]; recs=[]
    for row in c:
        ts=int(row['ts'])
        if not(start<=ts<end): continue
        i=idx[PAIR].get(ts)
        if i is None or i<900: continue
        pr=v109.predict(KIND,PAIR,candles,idx,ts,model); px=float(c[i]['close'])
        v24=v109.b.vol(c,i,24); v336=v109.b.vol(c,i,336)
        if state:
            peak=max(peak,px); trough=min(trough,px); held=(ts-ets)//HOUR
            adverse=(px/peak-1)*100 if state>0 else (trough/px-1)*100
            predictor_decay=(state>0 and pr<.10*th) or (state<0 and pr>-.10*th)
            frozen_trail=adverse<=-v109.TRAIL[PAIR]
            frozen_maxhold=held>=144
            exit_reason=None
            if frozen_trail: exit_reason='FROZEN_TRAIL'
            elif frozen_maxhold: exit_reason='FROZEN_MAXHOLD'
            elif predictor_decay:
                if not extended:
                    exit_reason='PREDICTOR_DECAY'
                else:
                    current_gain=state*((px/entry)-1)*100
                    r12=v109.ret(c,i,12) or 0.0; r24=v109.ret(c,i,24) or 0.0
                    medium_owner=(r12*state>0 and r24*state>0)
                    if current_gain>0 and medium_owner:
                        life='PROFIT_EXTENSION_OWNER'
                    else:
                        exit_reason='PREDICTOR_DECAY_NO_OWNER'
            if extended and life=='PROFIT_EXTENSION_OWNER' and exit_reason is None:
                r12=v109.ret(c,i,12) or 0.0; r24=v109.ret(c,i,24) or 0.0
                if r12*state<=0 and r24*state<=0:
                    exit_reason='PROFIT_EXTENSION_DIRECTION_LOST'
                elif (state>0 and pr>=.10*th) or (state<0 and pr<=-.10*th):
                    life='CORE'
            if exit_reason:
                xi=min(i+1+delay,len(c)-1)
                if int(c[xi]['ts'])>=end: xi=i
                xp=float(c[xi]['open']) if xi!=i else float(c[i]['close'])
                pnl=(state*((xp/entry-1)*100)-cost/100)*v109.RISK[PAIR]
                favorable=(peak/entry-1)*100 if state>0 else (entry/trough-1)*100
                recs.append({'entryTs':ets,'exitTs':ts,'side':state,'pnl':pnl,'heldHours':held,'mfePct':favorable,'exitReason':exit_reason,'entryLifecycle':'V109_EXACT' if not extended else life})
                vals.append(pnl); state=0; entry=peak=trough=None; ets=None; entry_i=None; life='CASH'
        if state==0 and v336>1e-9 and v24<3.2*v336:
            d=1 if pr>=th else -1 if pr<=-th else 0
            if d:
                ei=i+1+delay
                if ei<len(c) and int(c[ei]['ts'])<end:
                    state=d; entry=float(c[ei]['open']); peak=entry; trough=entry; ets=ts; entry_i=ei; life='CORE'
    if state and ets is not None:
        last_ts=max(int(r['ts']) for r in c if start<=int(r['ts'])<end); i=idx[PAIR][last_ts]; xp=float(c[i]['close'])
        pnl=(state*((xp/entry-1)*100)-cost/100)*v109.RISK[PAIR]; vals.append(pnl)
        favorable=(peak/entry-1)*100 if state>0 else (entry/trough-1)*100
        recs.append({'entryTs':ets,'exitTs':last_ts,'side':state,'pnl':pnl,'heldHours':(last_ts-ets)//HOUR,'mfePct':favorable,'exitReason':'PERIOD_END','entryLifecycle':life})
    return vals,recs


def block(candles,idx,period,model,cost,delay):
    bv,br=simulate(candles,idx,*period,cost,delay,model,False)
    cv,cr=simulate(candles,idx,*period,cost,delay,model,True)
    b=summary(bv); c=summary(cv)
    c['returnRetentionPct']=(100*c.get('returnPct',0)/b.get('returnPct',1)) if abs(b.get('returnPct',0))>1e-9 else None
    c['tradeRetentionPct']=(100*c.get('trades',0)/b.get('trades',1)) if b.get('trades',0) else None
    return b,c,br,cr


def run():
    candles,idx,_=v109.b.base.load(); ps=v109.b.base.periods(candles)
    model=v109.train(KIND,PAIR,candles,idx,*ps['development'])
    bd,cd,bdr,cdr=block(candles,idx,ps['development'],model,v109.NORMAL_BPS,0)
    bv,cv,bvr,cvr=block(candles,idx,ps['validation'],model,v109.NORMAL_BPS,0)
    bs,cs,_,_=block(candles,idx,ps['validation'],model,v109.STRESS_BPS,1)
    status='PROFIT_EXPANSION_SURVIVOR' if (cd.get('returnPct',0)>=bd.get('returnPct',0) and cv.get('returnPct',0)>=bv.get('returnPct',0) and (cv.get('pf') or 0)>=1.2 and (cs.get('pf') or 0)>1 and cv.get('maxDDPct',-999)>-20 and cv.get('trades',0)>=6) else 'FAIL'
    out={'researchLine':'SOL_V109_PROFIT_EXPANSION_V8','candidate':CID,'pair':PAIR,'status':status,'objective':'preserve exact Frozen V109 opportunity set and improve profit capture only','frozen':{'sourceHash':'75a80eed073df2ef5e13ff3a297f94c533ac2aef','threshold':model['threshold'],'risk':v109.RISK[PAIR],'trailPct':v109.TRAIL[PAIR],'maxHoldHours':144,'entryChanged':False},'structuralChange':'Only on predictor decay: profitable trade with aligned 12h+24h direction may transfer from CORE to PROFIT_EXTENSION_OWNER; otherwise exact V109 exit. Frozen trail/maxhold unchanged.','development':{'baselineV109':bd,'candidate':cd},'validation':{'baselineV109':bv,'candidate':cv},'validationStress':{'baselineV109':bs,'candidate':cs},'periods':{'development':ps['development'],'validation':ps['validation'],'confirmation':'UNTOUCHED','holdout':'UNTOUCHED'},'antiOverfit':{'denseSweep':False,'thresholdRetune':False,'riskRetune':False,'trailRetune':False,'entryFilterAdded':False,'confirmationRead':False,'holdoutRead':False,'strictPeriodIsolation':True},'productionChanged':False,'realTradingEnabled':False}
    root=Path(os.environ.get('RESEARCH_AUTONOMOUS_STATE_DIR','.research-state')); root.mkdir(parents=True,exist_ok=True)
    (root/'sol-v109-profit-expansion-v8.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    (root/'sol-v109-profit-expansion-v8.md').write_text('# SOL V109 Profit Expansion V8\n\n```json\n'+json.dumps(out,indent=2)+'\n```\n',encoding='utf-8')
    print(json.dumps(out,indent=2))

if __name__=='__main__': run()
