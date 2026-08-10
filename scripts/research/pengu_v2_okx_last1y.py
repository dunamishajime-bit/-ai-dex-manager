import importlib.util, json, os
import pandas as pd

SRC='scripts/research/pengu_v2_okx_frozen.py'
spec=importlib.util.spec_from_file_location('frozen', SRC)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

# Data warmup only. Strategy parameters and execution logic remain frozen.
m.START=pd.Timestamp('2025-07-25T00:00:00Z')
m.END=pd.Timestamp('2026-08-10T00:00:00Z')
EVAL_START=pd.Timestamp('2025-08-10T00:00:00Z')
EVAL_END=pd.Timestamp('2026-08-10T00:00:00Z')
OUT='research/pengu-v2-okx-last1y'

def in_eval(trades):
    return [x for x in trades if EVAL_START <= pd.Timestamp(x['entryTime']) < EVAL_END]

def eval_waves(d,trades):
    cand=[]
    for i in range(250,len(d)-72,12):
        if not (EVAL_START <= pd.Timestamp(d.at[i,'t']) < EVAL_END):
            continue
        o=float(d.at[i,'open']); f=d.iloc[i:i+72]
        up=float(f.high.max()/o-1); dn=float(1-f.low.min()/o)
        if max(up,dn)>=.20:
            cand.append([i,i+71,'L' if up>=dn else 'S',max(up,dn)])
    merged=[]
    for c in cand:
        if merged and c[2]==merged[-1][2] and c[0]<=merged[-1][1]:
            merged[-1][1]=max(merged[-1][1],c[1]); merged[-1][3]=max(merged[-1][3],c[3])
        else:
            merged.append(c)
    cap=0; pnl=0.0; details=[]
    for a,b,s,strength in merged:
        ta=pd.Timestamp(d.at[a,'t']); tb=pd.Timestamp(d.at[min(b,len(d)-1),'t'])
        z=[x for x in trades if x['side']==s and pd.Timestamp(x['entryTime'])<=tb and pd.Timestamp(x['exitTime'])>=ta]
        wp=sum(x['pnl'] for x in z)*100
        if z: cap+=1; pnl+=wp
        details.append({'start':str(ta),'side':s,'strengthPct':strength*100,'pnlPct':wp,'n':len(z)})
    return {'waves':len(merged),'captured':cap,'capturePct':100*cap/len(merged) if merged else 0,'wavePnl':pnl,'details':details}

def eval_folds(trades,n=4):
    span=(EVAL_END-EVAL_START)/n; out=[]
    for k in range(n):
        a=EVAL_START+k*span; b=EVAL_END if k==n-1 else EVAL_START+(k+1)*span
        out.append({'start':str(a),'end':str(b),**m.metrics([x for x in trades if a<=pd.Timestamp(x['entryTime'])<b])})
    return out

def main():
    os.makedirs(OUT,exist_ok=True)
    p=m.candles('PENGU-USDT-SWAP'); b=m.candles('BTC-USDT-SWAP'); d=m.prep(p,b)
    base_all=m.sim(d); stress_all=m.sim(d,.0035); delay_all=m.sim(d,0,1); sd_all=m.sim(d,.0035,1)
    base=in_eval(base_all); stress=in_eval(stress_all); delay=in_eval(delay_all); sd=in_eval(sd_all)
    r={
      'strategy':'PENGU_DUAL_LS_V2_BALANCED',
      'source':'OKX USDT perpetual, frozen logic, exact last-1y evaluation, no tuning',
      'eval':{'start':str(EVAL_START),'endExclusive':str(EVAL_END),'days':365},
      'params':m.P,
      'data':{'rows':len(d),'first':str(d.t.iloc[0]),'last':str(d.t.iloc[-1])},
      'base':m.metrics(base),
      'stress35bpsSide':m.metrics(stress),
      'delay1h':m.metrics(delay),
      'stress35_delay1h':m.metrics(sd),
      'waves':eval_waves(d,base),
      'folds':eval_folds(base,4),
    }
    print('RESULT_JSON'); print(json.dumps(r,indent=2))
    json.dump(r,open(os.path.join(OUT,'result.json'),'w'),indent=2)
    pd.DataFrame(base).to_csv(os.path.join(OUT,'trades.csv'),index=False)

if __name__=='__main__': main()
