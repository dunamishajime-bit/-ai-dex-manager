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

REPO_ROOT = Path(__file__).resolve().parent.parent
RESEARCH_ROOT = REPO_ROOT / ".research-base"
sys.path.insert(0, str(RESEARCH_ROOT / "scripts"))

import research_lab_v96_volume50_turnover075_full_bt as crypto_bt

UTC = dt.timezone.utc
core = crypto_bt.core
START = dt.datetime(2025, 8, 13, tzinfo=UTC)
END = dt.datetime(2026, 8, 3, tzinfo=UTC)
F1 = dt.datetime(2025, 12, 1, tzinfo=UTC)
F2 = dt.datetime(2026, 3, 1, tzinfo=UTC)
F3 = dt.datetime(2026, 6, 1, tzinfo=UTC)
START_MS = int(START.timestamp()*1000)
END_MS = int(END.timestamp()*1000)
F1_MS = int(F1.timestamp()*1000)
F2_MS = int(F2.timestamp()*1000)
F3_MS = int(F3.timestamp()*1000)
HOUR = 3_600_000
BAR_HOURS = 4
BAR_MS = BAR_HOURS * HOUR
DAY_MS = 86_400_000
GROSS = 0.75
SYMBOLS = ("BTC","ETH","BNB","SOL","LINK","AVAX")
CACHE_ROOT = Path.cwd()/".cache"/"perp-research-usdm"
BENCHMARK = 86.139242


@dataclass(frozen=True)
class Config:
    config_id: str
    family: str
    lookback_days: int
    decline_pct: float
    bounce_hours: int
    bounce_pct: float
    rejection_pct: float
    hold_hours: int
    relative_min: float = 0.0
    volume_floor: float = 0.0
    long_breakout_days: int = 0
    long_mom7: float = 0.0
    btc_mom7: float = 0.0
    long_relative: float = 0.0


@dataclass
class Position:
    symbol: str
    side: int
    entry_ts: int
    entry_price: float
    bars_held: int
    max_bars: int


CACHE: Dict[Tuple[Any,...], Any] = {}


def rounded(v):
    if isinstance(v,float): return round(v,6)
    if isinstance(v,dict): return {k:rounded(x) for k,x in v.items()}
    if isinstance(v,list): return [rounded(x) for x in v]
    return v


def finite(v, fallback=0.0):
    try: x=float(v)
    except (TypeError,ValueError): return fallback
    return x if math.isfinite(x) else fallback


def compound(values: Iterable[float]) -> float:
    e=1.0
    for v in values: e*=max(0.001,1.0+float(v))
    return e-1.0


def pf(values: Sequence[float]) -> Optional[float]:
    w=sum(v for v in values if v>0); l=-sum(v for v in values if v<0)
    return w/l if l>1e-15 else (999.0 if w>0 else None)


def resample(candles: Sequence[dict]) -> List[dict]:
    groups: Dict[int,List[dict]]={}
    for r in candles:
        ts=int(r['ts']); groups.setdefault(ts//BAR_MS*BAR_MS,[]).append(r)
    out=[]
    for ts,rows in sorted(groups.items()):
        rows=sorted(rows,key=lambda r:int(r['ts']))
        if len(rows)!=BAR_HOURS: continue
        out.append({'ts':ts,'open':float(rows[0]['open']),'high':max(float(r['high']) for r in rows),'low':min(float(r['low']) for r in rows),'close':float(rows[-1]['close']),'volume':sum(float(r.get('volume',0)) for r in rows)})
    return out


def load_market():
    core.v4.END=END_MS; core.CORE_END=END_MS
    raw={s:core.load_aster_symbol(CACHE_ROOT,s) for s in SYMBOLS}
    bars={s:resample(raw[s]['candles']) for s in SYMBOLS}
    indexes={s:{int(r['ts']):i for i,r in enumerate(rows)} for s,rows in bars.items()}
    funding={}
    for s in SYMBOLS:
        b={}
        for p in raw[s].get('funding',[]):
            ts=int(p['ts']); bucket=ts//BAR_MS*BAR_MS; b[bucket]=b.get(bucket,0.0)+float(p['rate'])
        funding[s]=b
    times=[int(r['ts']) for r in bars['BTC'] if START_MS-45*DAY_MS<=int(r['ts'])<END_MS]
    return {'bars':bars,'indexes':indexes,'funding':funding,'times':times}


def mom(rows,idx,n):
    key=('m',id(rows),idx,n)
    if key in CACHE: return CACHE[key]
    j=idx-n; val=None
    if j>=0 and float(rows[j]['close'])>0: val=(float(rows[idx]['close'])/float(rows[j]['close'])-1)*100
    CACHE[key]=val; return val


def sma(rows,idx,n):
    key=('s',id(rows),idx,n)
    if key in CACHE:return CACHE[key]
    val=None if idx-n+1<0 else sum(float(r['close']) for r in rows[idx-n+1:idx+1])/n
    CACHE[key]=val; return val


def volratio(rows,idx,recent=12,base=48):
    key=('v',id(rows),idx,recent,base)
    if key in CACHE:return CACHE[key]
    val=None
    if idx-base+1>=0:
        a=[float(r.get('volume',0)) for r in rows[idx-recent+1:idx+1]]; b=[float(r.get('volume',0)) for r in rows[idx-base+1:idx-recent+1]]
        d=sum(b)/len(b) if b else 0
        if d>0: val=(sum(a)/len(a))/d
    CACHE[key]=val;return val


def prior_high(rows,idx,n):
    key=('h',id(rows),idx,n)
    if key in CACHE:return CACHE[key]
    val=None if idx-n<0 else max(float(r['high']) for r in rows[idx-n:idx])
    CACHE[key]=val;return val


def configs():
    out=[]
    # Failed-bounce short: downtrend -> bounce over 8/12h -> current 4h rejection.
    for lb,decl,bh,bounce,rej,hold,rel,vol in itertools.product(
        (8,10,12),(5.0,6.0,7.0,8.0),(8,12),(0.5,0.75,1.0,1.25),(0.0,0.25,0.5),(48,60,72,84),(0.0,2.0),(0.0,0.8)
    ):
        out.append(Config(f'FB_L{lb}_D{decl:g}_B{bh}_{bounce:g}_R{rej:g}_H{hold}_RW{rel:g}_V{vol:g}','FAILED_BOUNCE',lb,decl,bh,bounce,rej,hold,rel,vol))
    # Faster pullback baseline on 4h to test timing alone.
    for lb,decl,bh,bounce,hold in itertools.product((8,10,12),(5.0,6.0,7.0),(4,8),(0.5,0.75,1.0),(48,60,72,84)):
        out.append(Config(f'SP4_L{lb}_D{decl:g}_B{bh}_{bounce:g}_H{hold}','SHORT_PULLBACK',lb,decl,bh,bounce,0.0,hold))
    # Regime-aware hybrid: failed-bounce short in weak/neutral market, strict long breakout in strong BTC regime.
    for decl,bounce,rej,hold,bd,lmom,bm,lr in itertools.product((5.0,6.0,7.0),(0.5,0.75,1.0),(0.25,0.5),(60,72),(5,10),(6.0,8.0),(3.0,5.0),(1.0,3.0)):
        out.append(Config(f'HY_D{decl:g}_B{bounce:g}_R{rej:g}_H{hold}_BD{bd}_LM{lmom:g}_BM{bm:g}_LR{lr:g}','HYBRID',10,decl,8,bounce,rej,hold,2.0,0.8,bd,lmom,bm,lr))
    return out


def short_signal(cfg,ts,mkt,require_rejection):
    bidx=mkt['indexes']['BTC'].get(ts)
    if bidx is None:return None
    btc=mkt['bars']['BTC']; candidates=[]
    lbars=int(cfg.lookback_days*24/BAR_HOURS)
    for s in SYMBOLS:
        idx=mkt['indexes'][s].get(ts)
        if idx is None:continue
        rows=mkt['bars'][s]
        move=mom(rows,idx,lbars); bounce=mom(rows,idx,max(1,cfg.bounce_hours//BAR_HOURS)); current=mom(rows,idx,1); avg=sma(rows,idx,int(20*24/BAR_HOURS)); bm=mom(btc,bidx,lbars); vr=volratio(rows,idx)
        if None in (move,bounce,current,avg,bm,vr):continue
        relative=move-bm; close=float(rows[idx]['close'])
        ok=move<=-cfg.decline_pct and bounce>=cfg.bounce_pct and close<avg and relative<=-cfg.relative_min and vr>=cfg.volume_floor
        if require_rejection: ok=ok and current<=-cfg.rejection_pct
        if ok:
            score=-move+0.3*(-relative)+0.2*bounce+0.4*(-current if current<0 else 0)+0.2*vr
            candidates.append((score,s,{'signalFamily':'FAILED_BOUNCE' if require_rejection else 'SHORT_PULLBACK','movePct':move,'bouncePct':bounce,'current4hPct':current,'relativePct':relative,'volumeRatio':vr}))
    if not candidates:return None
    score,s,meta=max(candidates,key=lambda x:(x[0],x[1]));return s,-1,{'score':score,**meta}


def long_signal(cfg,ts,mkt):
    bidx=mkt['indexes']['BTC'].get(ts)
    if bidx is None:return None
    btc=mkt['bars']['BTC']; btc7=mom(btc,bidx,int(7*24/BAR_HOURS)); avg=sma(btc,bidx,int(20*24/BAR_HOURS))
    if btc7 is None or avg is None or btc7<cfg.btc_mom7 or float(btc[bidx]['close'])<=avg:return None
    candidates=[]
    for s in ('ETH','BNB','SOL','LINK','AVAX'):
        idx=mkt['indexes'][s].get(ts)
        if idx is None:continue
        rows=mkt['bars'][s]; m7=mom(rows,idx,int(7*24/BAR_HOURS)); hi=prior_high(rows,idx,int(cfg.long_breakout_days*24/BAR_HOURS)); vr=volratio(rows,idx)
        if None in (m7,hi,vr):continue
        rel=m7-btc7; close=float(rows[idx]['close'])
        if close>hi and m7>=cfg.long_mom7 and rel>=cfg.long_relative and vr>=1.0:
            candidates.append((m7+0.35*rel+0.5*vr,s,{'signalFamily':'LONG_BREAKOUT','mom7Pct':m7,'relativePct':rel,'volumeRatio':vr}))
    if not candidates:return None
    score,s,meta=max(candidates,key=lambda x:(x[0],x[1]));return s,1,{'score':score,**meta}


def signal(cfg,ts,mkt):
    if cfg.family=='SHORT_PULLBACK': return short_signal(cfg,ts,mkt,False)
    if cfg.family=='FAILED_BOUNCE': return short_signal(cfg,ts,mkt,True)
    bidx=mkt['indexes']['BTC'].get(ts)
    if bidx is None:return None
    btc=mkt['bars']['BTC']; b7=mom(btc,bidx,int(7*24/BAR_HOURS)); avg=sma(btc,bidx,int(20*24/BAR_HOURS))
    strong=b7 is not None and avg is not None and b7>=cfg.btc_mom7 and float(btc[bidx]['close'])>avg
    return long_signal(cfg,ts,mkt) if strong else short_signal(cfg,ts,mkt,True)


def simulate(cfg,mkt,severe=False):
    times=[t for t in mkt['times'] if START_MS<=t<END_MS]; pos=None; pending=None; rows=[]; entries=[]; prev={}; cost=50 if severe else 10; adverse=3 if severe else 0
    for ts in times:
        if pos is None and pending is not None:
            s,side,meta=pending; idx=mkt['indexes'][s].get(ts)
            if idx is not None:
                pos=Position(s,side,ts,float(mkt['bars'][s][idx]['open']),0,max(1,cfg.hold_hours//BAR_HOURS)); entries.append({'entryTs':ts,'symbol':s,'side':side,**meta})
            pending=None
        w={}; value=0.0
        if pos is not None:
            w[pos.symbol]=pos.side*GROSS; idx=mkt['indexes'][pos.symbol].get(ts)
            if idx is not None:
                bar=mkt['bars'][pos.symbol][idx]; value+=pos.side*GROSS*(float(bar['close'])/float(bar['open'])-1); value-=pos.side*GROSS*mkt['funding'][pos.symbol].get(ts,0.0)
                if severe:value-=GROSS*adverse/10000
        turnover=sum(abs(w.get(s,0)-prev.get(s,0)) for s in set(w)|set(prev)); value-=turnover*cost/10000; gross=sum(abs(x) for x in w.values()); rows.append({'ts':ts,'return':value,'gross':gross,'maxGross':gross,'regime':-1 if any(x<0 for x in w.values()) else 1 if any(x>0 for x in w.values()) else 0});prev=dict(w)
        if pos is not None:
            pos.bars_held+=1
            if pos.bars_held>=pos.max_bars:pos=None
        if pos is None and pending is None: pending=signal(cfg,ts,mkt)
    return rows,entries


def metrics(rows,entries,start,end):
    act=[r for r in rows if start<=int(r['ts'])<end]; vals=[float(r['return']) for r in act];eq=peak=1.0;dd=0;months={}
    for r in act:
        eq*=max(0.001,1+float(r['return']));peak=max(peak,eq);dd=min(dd,eq/peak-1);key=dt.datetime.fromtimestamp(int(r['ts'])/1000,tz=UTC).strftime('%Y-%m');months.setdefault(key,[]).append(float(r['return']))
    mr={k:compound(v)*100 for k,v in months.items()}; eps=sum(1 for e in entries if start<=int(e['entryTs'])<end);years=max(1e-9,(end-start)/(365.25*DAY_MS))
    return {'tradeEpisodes':eps,'compoundedReturnPct':(eq-1)*100,'cagrPct':(eq**(1/years)-1)*100 if eq>0 else None,'maxDrawdownPct':dd*100,'profitFactor':pf(vals),'positiveMonthRatio':sum(x>0 for x in mr.values())/len(mr) if mr else 0,'monthlyReturnsPct':mr}


def evaluate(cfg,mkt):
    n,e=simulate(cfg,mkt,False);s,se=simulate(cfg,mkt,True);ranges={'fold1':(START_MS,F1_MS),'fold2':(F1_MS,F2_MS),'fold3':(F2_MS,F3_MS),'lateEvaluation':(F3_MS,END_MS),'full':(START_MS,END_MS)};out={'variantId':cfg.config_id,'config':asdict(cfg)}
    for name,(a,b) in ranges.items():out[name]={'normal':metrics(n,e,a,b),'severe':metrics(s,se,a,b)}
    ns=[out[x]['normal'] for x in ('fold1','fold2','fold3')];ss=[out[x]['severe'] for x in ('fold1','fold2','fold3')];pre=compound([finite(x['compoundedReturnPct'])/100 for x in ns])*100;pres=compound([finite(x['compoundedReturnPct'])/100 for x in ss])*100;pn=sum(finite(x['compoundedReturnPct'])>0 for x in ns);ps=sum(finite(x['compoundedReturnPct'])>0 for x in ss);tr=sum(int(x['tradeEpisodes']) for x in ns);worst=min(finite(x['maxDrawdownPct'],-99) for x in ns);apf=sum(min(5,finite(x['profitFactor'])) for x in ns)/3
    elig=tr>=12 and pn==3 and ps>=2 and pre>=30 and pres>=10 and worst>=-15 and apf>=1.1;score=pre+0.6*pres+5*(pn+ps)+4*max(0,apf-1)-0.2*abs(worst) if elig else -1e12;out['preSelection']={'eligible':elig,'score':score,'compoundedReturnPct':pre,'severeCompoundedReturnPct':pres,'positiveFolds':pn,'positiveSevereFolds':ps,'tradeEpisodes':tr,'worstFoldDrawdownPct':worst,'averageFoldProfitFactor':apf};return out,n,s


def compact(r):return {k:r[k] for k in ('variantId','config','preSelection','fold1','fold2','fold3','lateEvaluation','full')}


def main():
    p=argparse.ArgumentParser();p.add_argument('--output-dir',default='.research-state/v96-recent-event-core-v6');args=p.parse_args();outdir=Path(args.output_dir);outdir.mkdir(parents=True,exist_ok=True);mkt=load_market();results=[];replays={}
    for cfg in configs():
        r,n,s=evaluate(cfg,mkt);results.append(r);replays[r['variantId']]=(n,s)
    elig=sorted((r for r in results if r['preSelection']['eligible']),key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True);ranked=sorted(results,key=lambda r:(r['preSelection']['score'],r['variantId']),reverse=True);sel=elig[0] if elig else ranked[0];n,s=replays[sel['variantId']];full=sel['full']['normal'];fs=sel['full']['severe'];late=sel['lateEvaluation']['normal'];ls=sel['lateEvaluation']['severe'];latepass=int(late['tradeEpisodes'])>=3 and finite(late['compoundedReturnPct'])>0 and finite(ls['compoundedReturnPct'])>0 and finite(late['maxDrawdownPct'],-99)>=-10 and finite(late['profitFactor'])>1.05;beats=finite(full['compoundedReturnPct'])>BENCHMARK and finite(fs['compoundedReturnPct'])>20 and finite(full['maxDrawdownPct'],-99)>=-15 and finite(full['profitFactor'])>1.2;status='V96_RECENT_EVENT_CORE_V6_PASS' if sel['preSelection']['eligible'] and latepass and beats else 'V96_RECENT_EVENT_CORE_V6_DIAGNOSTIC';topfull=sorted(results,key=lambda r:finite(r['full']['normal']['compoundedReturnPct'],-1e12),reverse=True)
    payload=rounded({'version':6,'strategyId':'V96_RECENT_EVENT_CORE_V6_4H_FAILED_BOUNCE_HYBRID','status':status,'architecture':{'barHours':4,'gross':GROSS,'onePositionMaximum':True,'families':['FAILED_BOUNCE','SHORT_PULLBACK','HYBRID_STRICT_LONG'],'completedBarSignalNextOpen':True},'benchmark':{'V5DiagnosticBestPct':BENCHMARK},'candidateCounts':{'tested':len(results),'eligible':len(elig)},'selected':compact(sel),'selectedPassesLateEvaluation':latepass,'selectedBeats86p139':beats,'topPreSelection':[compact(r) for r in ranked[:20]],'topFullDiagnosticOnly':[compact(r) for r in topfull[:20]],'selectionPolicy':{'rankingUsesOnlyFirstThreeFolds':True,'lateEvaluationUsedForRanking':False,'fullPeriodUsedForRanking':False,'target':'beat 86.139242% at gross0.75 with severe >20%, DD >= -15%, positive late Normal and Severe'},'selectedReplay':{'strategyId':'V96_RECENT_EVENT_CORE_V6_4H_FAILED_BOUNCE_HYBRID','variantId':sel['variantId'],'normal':n,'severe':s},'safety':{'mode':'RESEARCH_ONLY','ordersSent':False,'liveChanged':False,'vpsChanged':False,'productionChanged':False}});(outdir/'v96-recent-event-core-v6.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');lines=['# V96 Recent Event Core V6 — 4h Failed Bounce Hybrid','',f"- Status: **{status}**",f"- Tested: **{len(results)}** / Eligible: **{len(elig)}**",f"- Selected: **{sel['variantId']}**",f"- Full: **{full['compoundedReturnPct']}%** / Severe **{fs['compoundedReturnPct']}%** / DD **{full['maxDrawdownPct']}%** / PF **{full['profitFactor']}**",f"- Late: **{late['compoundedReturnPct']}%** / Severe **{ls['compoundedReturnPct']}%** / PF **{late['profitFactor']}**",f"- Beats 86.139242: **{beats}** / Late pass: **{latepass}**",f"- Best full diagnostic: **{topfull[0]['variantId']} = {topfull[0]['full']['normal']['compoundedReturnPct']}%** (diagnostic only)",'- Production / LIVE / VPS / orders changed: **NO**'];(outdir/'v96-recent-event-core-v6.md').write_text('\n'.join(lines)+'\n');print('\n'.join(lines))

if __name__=='__main__':main()
