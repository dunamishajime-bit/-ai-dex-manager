#!/usr/bin/env python3
"""Research-only staged replay: exact archived engine plus source-native V12 signal inputs.

Uses original checksum-frozen integrated-engine.py, old Q102 frozen + V52 stock rows,
actual native COMBINED_FILTERED Q60 PENGU ledger, and current VPS native V12/FET
candidate exports. V12/FET *exits* inferred from H1 OHLC and config; not LIVE fills.
FET is exported standalone because old engine has no fifth sleeve or dynamic governor.
Never label output a fully current-VPS five-strategy backtest.
"""
import argparse,collections,datetime as dt,hashlib,importlib.util,json,pathlib,csv
H=3600000
START=int(dt.datetime(2025,8,10,tzinfo=dt.timezone.utc).timestamp()*1000)
END=int(dt.datetime(2026,8,10,tzinfo=dt.timezone.utc).timestamp()*1000)

def load(p): return json.loads(pathlib.Path(p).read_text())
def save(p,obj):
    p=pathlib.Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(obj,indent=2,ensure_ascii=False)+"\n")
def h2(raw):
    out={}
    for row in raw:
        t=int(row[0]); k=t//(2*H)*(2*H)
        b={'o':float(row[1]),'h':float(row[2]),'l':float(row[3]),'c':float(row[4]),'n':1}
        if k not in out:out[k]=b
        else:
            v=out[k];v['h']=max(v['h'],b['h']);v['l']=min(v['l'],b['l']);v['c']=b['c'];v['n']+=1
    return {t:b for t,b in out.items() if b['n']==2}

def current_v12_ledger(candidates,prices,mode):
    fee,slip=(.0005,0) if mode=="NORMAL" else (.001,.0005)
    signals=collections.defaultdict(list)
    for x in candidates:
        if START<=int(x['entryTs'])<END:signals[int(x['entryTs'])].append(x)
    active={};later={};cool={};trades=[];stats=collections.Counter()
    def exit_position(p,raw,ts,reason):
        px=raw*(1-p['side']*slip)
        net=p['side']*(px/p['entry']-1)-2*fee
        trades.append({'symbol':p['symbol'],'side':'long' if p['side']==1 else 'short',
          'entryTs':p['ts'],'exitTs':min(ts,END),'entryPrice':p['entry'],'exitPrice':px,
          'requestedGross':p['gross'],'netUnitReturn':net,'accountReturn':net*p['gross'],
          'rank':p['rank'],'entryQualityClass':p['class'],'exitReason':reason})
        cool[p['symbol']]=ts+2*H;stats['EXIT_'+reason]+=1
    for t in sorted(x for x in prices['BTC'] if START<=x<END):
        # Next H2 open fills scheduled by previously completed bar.
        for sym,reason in list(later.items()):
            p=active.pop(sym,None)
            if p:
                b=prices[sym].get(t)
                if not b:raise RuntimeError('MISSING_NEXT_H2_OPEN '+sym+' '+str(t))
                exit_position(p,b['o'],t,reason)
        later.clear()
        for s in sorted(signals.get(t,[]),key=lambda r:(r['rank'],r['symbol'])):
            sym=s['symbol'];bar=prices.get(sym,{}).get(t)
            if bar is None or sym in active or cool.get(sym,0)>t or len(active)>=3:
                stats['BLOCKED_SIGNAL']+=1;continue
            side=1 if s['side']=='LONG' else -1
            entry=bar['o']*(1+side*slip);stopdist=max(float(s['atr'])*2.477,entry*.005)
            rank=int(s['rank']); cap=.1 if rank==3 else (1.75 if s.get('entryQualityClass')=='HC175' else 1.0)
            gross=min(.0319/(stopdist/entry),cap)
            if gross<.01:stats['SMALL']+=1;continue
            active[sym]={'symbol':sym,'side':side,'entry':entry,'ts':t,'stop':entry-side*stopdist,
              'initialStop':entry-side*stopdist,'tp':entry+side*float(s['atr'])*3.1995,
              'atr':float(s['atr']),'peak':entry,'trough':entry,'gross':gross,'rank':rank,
              'class':s.get('entryQualityClass'),'bars':0}
            stats['ENTRY']+=1
        # OHLC approximation; source-native signals, but NOT source-native live fill/protection.
        for sym,p in list(active.items()):
            b=prices[sym].get(t)
            if not b:raise RuntimeError('ACTIVE_H2_GAP '+sym+' '+str(t))
            p['bars']+=1
            if b['l']<=p['stop'] if p['side']==1 else b['h']>=p['stop']:
                exit_position(p,p['stop'],t+2*H,'trail' if p['stop']!=p['initialStop'] else 'stop')
                active.pop(sym,None);continue
            if b['h']>=p['tp'] if p['side']==1 else b['l']<=p['tp']:
                exit_position(p,p['tp'],t+2*H,'tp');active.pop(sym,None);continue
            p['peak']=max(p['peak'],b['h']);p['trough']=min(p['trough'],b['l'])
            trailing=p['peak']-p['atr']*.4 if p['side']==1 else p['trough']+p['atr']*.4
            p['stop']=max(p['stop'],trailing) if p['side']==1 else min(p['stop'],trailing)
            if p['bars']>=23:later[sym]='max_hold'
            elif p['bars']>=20 and not any(s['symbol']==sym and
              (1 if s['side']=='LONG' else -1)==p['side'] for s in signals.get(t+2*H,[])):
                later[sym]='rotation'
    for sym,p in list(active.items()):
        t=max(x for x in prices[sym] if x<END)
        exit_position(p,prices[sym][t]['c'],END,'window_end')
    return sorted(trades,key=lambda x:(x['entryTs'],x['rank'],x['symbol'])),dict(stats)

def fet_independent(signals,raw,mode):
    # FET independent diagnostic only: no FET insertion into original four-sleeve router.
    fee,slip=(.0005,0) if mode=='NORMAL' else (.001,.0005)
    candles={int(r[0]):{'o':float(r[1]),'h':float(r[2]),'l':float(r[3]),'c':float(r[4])} for r in raw}
    bytime=collections.defaultdict(list)
    for s in signals:bytime[int(s['entryTs'])].append(s)
    active=None;rows=[];stats=collections.Counter()
    def exit_fet(t,price,reason):
        nonlocal active
        px=price*(1-slip); net=px/active['px']-1-2*fee
        rows.append({'symbol':'FET','entryTs':active['t'],'exitTs':min(t,END),
          'side':'long','entryPrice':active['px'],'exitPrice':px,'netUnitReturn':net,
          'requestedGross':2.25,'exitReason':reason})
        active=None;stats['EXIT_'+reason]+=1
    for t in sorted(x for x in candles if START<=x<END):
        b=candles[t]
        if active and t>=active['expiry']:exit_fet(t,b['o'],'24H_EXIT')
        for s in bytime.get(t,[]):
            if active:stats['BLOCK_HELD']+=1;continue
            px=b['o']*(1+slip);active={'t':t,'px':px,'stop':px*.95,
              'expiry':int(s['exitTs']),'floor':False}
            stats['ENTRY']+=1
        if not active:continue
        if b['l']<=active['stop']:
            exit_fet(t+H,active['stop'],'STOP_OR_FLOOR');continue
        if not active['floor'] and b['h']>=active['px']*1.05:
            active['floor']=True;active['stop']=active['px']*1.005;stats['FLOOR_ARMED']+=1
    if active:exit_fet(END,candles[max(candles)]['c'],'WINDOW_END')
    return rows,dict(stats)

def main():
    a=argparse.ArgumentParser()
    for k in ('old_engine','old_result','new_pengu','stock_raw','v12_ledger','old_pengu_ledger',
              'quality102_frozen','native','output'):
        a.add_argument('--'+k.replace('_','-'),required=True)
    args=a.parse_args()
    oldmod=importlib.util.spec_from_file_location('prior_adapter','scripts/research/replace_pengu_in_archived_engine_20260926.py')
    prior=importlib.util.module_from_spec(oldmod);oldmod.loader.exec_module(prior)
    e=prior.get_engine(args.old_engine);res=load(args.old_result)
    pnew=load(args.new_pengu);oldv=load(args.v12_ledger);oldp=load(args.old_pengu_ledger)
    stock=load(args.stock_raw)
    with open(args.quality102_frozen,newline='') as f:qf=list(csv.DictReader(f))
    if len(qf)!=102:raise RuntimeError('Q102_FROZEN_COUNT_MISMATCH')
    prior.preload_original_price_evidence(e,res)
    native=pathlib.Path(args.native);candidate=load(native/'v12-candidates.json')
    fets=load(native/'fet-candidates.json');manifest=load(native/'summary.json')
    if manifest['sourceCommit']!='e1b58060d6263a3af7ced51bec854d3e211d2f35':
        raise RuntimeError('WRONG_CURRENT_VPS_SOURCE_SHA')
    if not candidate or min(int(s['entryTs']) for s in candidate)>START+2*H:
        # First few days can naturally be signal-free, but pre-2025-Aug-10 eligibility
        # must be satisfied in the producing workflow (tested via native warm-up fix).
        print('CHECK_FIRST_CANDIDATE_DATE',candidate[0]['entryTs'])
    prices={sym:h2(load(native/(sym+'USDT.json'))) for sym in
            ('BTC','ETH','BNB','SOL','LINK','AVAX','DOGE','INJ','XRP','ADA','LTC','ATOM','AAVE','NEAR')}
    output=pathlib.Path(args.output);output.mkdir(parents=True,exist_ok=True)
    summary={'schema':'frozen-original-engine-with-staged-current-V12-native-candidates/v1',
      'researchOnly':True,'tradingMutation':0,'fullFiveStrategyBTCompleted':False,
      'originalSha256':prior.EXPECTED_ENGINE_SHA256,'currentNativeSourceSha':manifest['sourceCommit'],
      'candidateCounts':manifest['candidateCounts'],'results':{},
      'notCurrent':['FET is standalone, not shared allocator','Q102 frozen historical, NOT current Causal V4',
                    'V52 historical restored, not independently verified current native',
                    'Gross caps static, dynamic margin governor NOT implemented',
                    'V12 exits derived from H1 OHLC; LIVE protection/partial fills not reproduced']}
    for mode in ('NORMAL','SEVERE'):
        cost=e.SCENARIOS[mode]['stockCostBps']
        oldtr=oldv['modes'][e.SCENARIOS[mode]['ledgerMode']]['trades']
        oldpeng=oldp['modes'][e.SCENARIOS[mode]['ledgerMode']]['trades']
        newpeng=prior.convert_new_pengu(pnew,mode)
        q102=prior.candidate_rows(e,qf,mode)
        baseline=e.simulate(oldtr,oldpeng,stock['v11'],stock['v50'],cost,q102)
        expected=prior.EXPECTED_NORMAL if mode=='NORMAL' else prior.EXPECTED_STRESS
        if abs(baseline['endingAssetJpy']-expected)>.02:
            raise RuntimeError('BASELINE_MISMATCH '+mode+' '+str(baseline['endingAssetJpy']))
        # Same old engine, only source-native new PENGU; then source-native V12 candidates.
        oldpengswap=e.PENGU_MAX_GROSS;e.PENGU_MAX_GROSS=1.
        pengu=e.simulate(oldtr,newpeng,stock['v11'],stock['v50'],cost,q102)
        print('PINNED_BASELINE_AND_PENGU',mode,baseline['endingAssetJpy'],
              pengu['endingAssetJpy'],flush=True)
        v12,vd=current_v12_ledger(candidate,prices,mode)
        f,fd=fet_independent(fets,load(native/'FETUSDT.json'),mode)
        save(output/(mode.lower()+'-native-V12-H1-exit-assumption.json'),v12)
        save(output/(mode.lower()+'-FET-independent-H1-exit-assumption.json'),f)
        summary['results'][mode]={'baseline':baseline['endingAssetJpy'],
          'penguOnly':pengu['endingAssetJpy'],
          'nativeV12Ledger':len(v12),'fetIndependentLedger':len(f),
          'V12StandaloneDiagnostics':vd,'FETStandaloneDiagnostics':fd}
        # Explicit frozen old-engine sensitivity, not current full-parity replay.
        e.V12_MAX_POSITIONS=3;e.V12_GROSS_CAP=2.0;e.V12_PER_POSITION_GROSS_CAP=1.75
        e.CRYPTO_GROSS_CAP=3.0;e.TOTAL_GROSS_CAP=3.5
        try:
            stage=e.simulate(v12,newpeng,stock['v11'],stock['v50'],cost,q102)
            gv=stage['grossVerification']
            if gv['maxV12Positions']>3 or gv['entryTimeMaxV12Gross']>2.00001:
                raise RuntimeError('GROSS_VIOLATION')
            if gv['supplementGrossConflicts']:raise RuntimeError('Q102_GROSS_CONFLICT')
            save(output/(mode.lower()+'-staged-original-engine.json'),stage)
            summary['results'][mode]['staged']={'status':'PARTIAL_SENSITIVITY_NOT_LIVE',
                'asset':stage['endingAssetJpy'],'PF':stage['profitFactor'],
                'DD':stage['maxDrawdownPctClosedEventTwr'],'trades':stage['trades'],
                'maxGross':gv,'bySleeve':stage['bySleeve'],'monthly':stage['monthly']}
            print('STAGED_ONLY',mode,stage['endingAssetJpy'],stage['profitFactor'],
                  stage['maxDrawdownPctClosedEventTwr'],flush=True)
        except Exception as ex:
            summary['results'][mode]['staged']={'status':'BLOCKED','reason':str(ex)}
            print('STAGED_REPLAY_BLOCKED',mode,str(ex),flush=True)
        finally:
            e.V12_MAX_POSITIONS=2;e.V12_GROSS_CAP=1.5;e.V12_PER_POSITION_GROSS_CAP=1.
            e.PENGU_MAX_GROSS=oldpengswap
    save(output/'summary.json',summary)
    print('NATIVE_SOURCE_STAGING_COMPLETE',json.dumps({
       x:{'ledgerV12':y['nativeV12Ledger'],'ledgerFET':y['fetIndependentLedger'],
          'staged':y['staged']['status']} for x,y in summary['results'].items()}),flush=True)
if __name__=='__main__':main()
