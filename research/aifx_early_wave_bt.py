from __future__ import annotations

import json, math, urllib.request
from pathlib import Path
from typing import Dict, List

import numpy as np
import pandas as pd

PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "GBPJPY"]
BASE = "https://raw.githubusercontent.com/ejtraderLabs/historical-data/main"
SPREAD_PIPS_2X = {"EURUSD":1.00,"GBPUSD":0.50,"USDJPY":0.60,"EURJPY":1.30,"GBPJPY":0.80}
FAMILIES=("IMPULSE_START","CONTINUATION","REVERSAL")
DIRECTIONS=("LONG","SHORT")
TIMEFRAMES=("M15","M30")

def pip_size(pair): return 0.01 if pair.endswith("JPY") else 0.0001
def point_scale(pair): return 1000.0 if pair.endswith("JPY") else 100000.0

def download_pair(pair,cache):
    cache.mkdir(parents=True,exist_ok=True); p=cache/f"{pair}m15.csv"
    if not p.exists():
        url=f"{BASE}/{pair}/{pair}m15.csv"; req=urllib.request.Request(url,headers={"User-Agent":"AIFX-EarlyWave-BT/1.0"})
        with urllib.request.urlopen(req,timeout=180) as r: p.write_bytes(r.read())
    f=pd.read_csv(p); reqcols={"Date","open","high","low","close"}
    if not reqcols.issubset(f.columns): raise RuntimeError(f"{pair}: unexpected schema {list(f.columns)}")
    f["Date"]=pd.to_datetime(f["Date"],errors="coerce",utc=True); f=f.dropna(subset=["Date"]).set_index("Date").sort_index(); sc=point_scale(pair)
    for c in ("open","high","low","close"): f[c]=pd.to_numeric(f[c],errors="coerce")/sc
    f=f.dropna(subset=["open","high","low","close"]); f=f[~f.index.duplicated(keep="last")]; f=f.rename(columns={c:f"mid_{c}" for c in ("open","high","low","close")})
    return f[["mid_open","mid_high","mid_low","mid_close"]]

def complete_years(frame):
    out=[]
    for y in sorted(set(frame.index.year)):
        p=frame[frame.index.year==y]
        if len(p)>=20000 and p.index.to_series().diff().max()<=pd.Timedelta(hours=96): out.append(int(y))
    return out

def add_exec(frame,pair):
    x=frame.copy(); sp=SPREAD_PIPS_2X[pair]*pip_size(pair)
    for fld in ("open","high","low","close"):
        m=x[f"mid_{fld}"]; x[f"exec_bid_{fld}"]=m-sp/2; x[f"exec_ask_{fld}"]=m+sp/2
    return x

def to_m30(m15):
    g=m15[["mid_open","mid_high","mid_low","mid_close"]].resample("30min",label="left",closed="left")
    a=g.agg({"mid_open":"first","mid_high":"max","mid_low":"min","mid_close":"last"}); c=g["mid_close"].count(); return a[c==2].dropna()
def true_range(h,l,c):
    pc=c.shift(1); return pd.concat([h-l,(h-pc).abs(),(l-pc).abs()],axis=1).max(axis=1)
def adx14(h,l,c):
    tr=true_range(h,l,c); atr=tr.ewm(alpha=1/14,adjust=False).mean().replace(0,np.nan); up=h.diff(); dn=-l.diff(); pdm=up.where((up>dn)&(up>0),0.0); mdm=dn.where((dn>up)&(dn>0),0.0)
    pdi=100*pdm.ewm(alpha=1/14,adjust=False).mean()/atr; mdi=100*mdm.ewm(alpha=1/14,adjust=False).mean()/atr; dx=100*(pdi-mdi).abs()/(pdi+mdi).replace(0,np.nan); return dx.ewm(alpha=1/14,adjust=False).mean()
def params(tf):
    if tf=="M15": return dict(atr=14,base=192,ema_fast=12,ema_slow=36,brk=16,disp=4,body=3,micro=4,prior_move=16,seed_window=12,max_hold=384,trail_swing=6)
    return dict(atr=7,base=96,ema_fast=6,ema_slow=18,brk=8,disp=2,body=2,micro=2,prior_move=8,seed_window=6,max_hold=192,trail_swing=3)
def h1_prior(frame):
    h1=frame.resample("1h",label="left",closed="left").agg({"mid_open":"first","mid_high":"max","mid_low":"min","mid_close":"last"}).dropna(); c=h1.mid_close; h=h1.mid_high; l=h1.mid_low
    h1["ema24"]=c.ewm(span=24,adjust=False).mean(); h1["ema96"]=c.ewm(span=96,adjust=False).mean(); h1["ema192"]=c.ewm(span=192,adjust=False).mean(); h1["adx"]=adx14(h,l,c)
    atr=true_range(h,l,c).ewm(alpha=1/14,adjust=False).mean(); ar=atr/atr.rolling(120,min_periods=60).median(); h1["old_up"]=(h1.ema24>h1.ema96)&(h1.ema96>h1.ema192)&(h1.adx>=17)&ar.between(.6,2.0); h1["old_down"]=(h1.ema24<h1.ema96)&(h1.ema96<h1.ema192)&(h1.adx>=17)&ar.between(.6,2.0)
    h1["prior_up"]=(h1.ema24>h1.ema96)&(h1.ema24.diff(4)>0); h1["prior_down"]=(h1.ema24<h1.ema96)&(h1.ema24.diff(4)<0); return h1[["old_up","old_down","prior_up","prior_down"]].shift(1)
def features(frame,tf):
    p=params(tf); x=frame.copy(); c=x.mid_close; h=x.mid_high; l=x.mid_low; tr=true_range(h,l,c); x["atr"]=tr.ewm(alpha=1/p["atr"],adjust=False).mean(); x["atr_ratio"]=x.atr/x.atr.rolling(p["base"],min_periods=p["base"]//2).median(); x["ema_fast"]=c.ewm(span=p["ema_fast"],adjust=False).mean(); x["ema_slow"]=c.ewm(span=p["ema_slow"],adjust=False).mean(); x["prior_high"]=h.shift(1).rolling(p["brk"]).max(); x["prior_low"]=l.shift(1).rolling(p["brk"]).min(); x["micro_high"]=h.shift(1).rolling(p["micro"]).max(); x["micro_low"]=l.shift(1).rolling(p["micro"]).min(); x["swing_high"]=h.shift(1).rolling(p["trail_swing"]).max(); x["swing_low"]=l.shift(1).rolling(p["trail_swing"]).min(); hp=h1_prior(frame).reindex(x.index,method="ffill")
    for col in hp.columns: x[col]=hp[col].fillna(False)
    return x
def build_signals(x,tf,direction):
    p=params(tf); side=1 if direction=="LONG" else -1; c=x.mid_close; o=x.mid_open; atr=x.atr.replace(0,np.nan); d=p["disp"]; b=p["body"]; disp=side*(c-c.shift(d))/atr; ext=x.prior_high if side==1 else x.prior_low; prox=side*(c-ext)/atr; body=(side*(c-o)>0).astype(float).rolling(b).sum()>=max(1,math.ceil(b*2/3)); aa=x.atr/x.atr.shift(d); mn=side*(c-c.shift(d))/atr; mp=side*(c.shift(d)-c.shift(2*d))/x.atr.shift(d).replace(0,np.nan); ma=mn-mp; fs=side*(x.ema_fast-x.ema_fast.shift(d))/atr; wa=x.prior_up if side==1 else x.prior_down; wo=x.prior_down if side==1 else x.prior_up
    score=(disp>=.65).astype(float)+(prox>=-.15).astype(float)+body.astype(float)+(aa>=1.02).astype(float)+(ma>=.10).astype(float)+(fs>0).astype(float)+.5*wa.astype(float)-.25*wo.astype(float); q=x.atr_ratio.between(.55,2.5)&np.isfinite(atr); seed=(q&(score>=4.0)).fillna(False); fresh=seed&(~seed.shift(1,fill_value=False)|~seed.shift(2,fill_value=False)); strong=(q&(score>=5.0)).fillna(False)
    recent=fresh.shift(1,fill_value=False).rolling(p["seed_window"],min_periods=1).max().astype(bool); counter=(side*(c-o)<0).shift(1,fill_value=False).rolling(max(2,p["micro"]*2),min_periods=1).max().astype(bool); renew=(c>x.micro_high) if side==1 else (c<x.micro_low); nc=(x.atr_ratio>=.70)&(x.atr>=x.atr.shift(d)*.85); ret=c.diff(); dm=(side*ret).clip(lower=0).rolling(max(2,d*2)).sum(); cm=(-side*ret).clip(lower=0).rolling(max(2,d*2)).sum(); speed=dm>cm*1.25; shallow=(x.mid_low>x.ema_fast-.55*x.atr) if side==1 else (x.mid_high<x.ema_fast+.55*x.atr); cont=(q&recent&counter&renew&nc&speed&shallow).fillna(False); cont=cont&(~cont.shift(1,fill_value=False))
    pm=p["prior_move"]; po=-side*(c.shift(d)-c.shift(pm))/atr; rd=side*(c-c.shift(d))/atr; mb=(c>x.micro_high) if side==1 else (c<x.micro_low); rev=(q&(po>=1.35)&(rd>=.60)&mb&body&(ma>=.05)).fillna(False); rev=rev&(~rev.shift(1,fill_value=False)); return {"IMPULSE_START":fresh.to_numpy(bool),"CONTINUATION":cont.to_numpy(bool),"REVERSAL":rev.to_numpy(bool),"STRONG":strong.to_numpy(bool),"SEED_ANY":fresh.to_numpy(bool)}
def simulate(x,sig,opp,pair,tf,fam,direction,start_y,end_y):
    side=1 if direction=="LONG" else -1; p=params(tf); pip=pip_size(pair); idx=x.index; atr=x.atr.to_numpy(); n=len(x); bo=x.exec_bid_open.to_numpy(); ao=x.exec_ask_open.to_numpy(); bl=x.exec_bid_low.to_numpy(); ah=x.exec_ask_high.to_numpy(); bc=x.exec_bid_close.to_numpy(); ac=x.exec_ask_close.to_numpy(); mh=x.mid_high.to_numpy(); ml=x.mid_low.to_numpy(); mc=x.mid_close.to_numpy(); ef=x.ema_fast.to_numpy(); sh=x.swing_high.to_numpy(); sl=x.swing_low.to_numpy(); st=pd.Timestamp(f"{start_y}-01-01",tz="UTC"); en=pd.Timestamp(f"{end_y}-01-01",tz="UTC"); cand=np.flatnonzero((idx>=st)&(idx<en)&sig); rows=[]; last=-10**9; cool=max(2,p["disp"])
    for i in cand:
        if i<=last+cool or i+1>=n or not np.isfinite(atr[i]) or atr[i]<=0: continue
        expected=pd.Timedelta(minutes=15 if tf=="M15" else 30)
        if idx[i+1]-idx[i]>expected*2: continue
        ei=i+1; entry=ao[ei] if side==1 else bo[ei]; risk=float(atr[i])*1.25; stop=entry-side*risk; xi=None; xp=None; reason=None; maxj=min(ei+p["max_hold"],n-1); runhi=mh[ei]; runlo=ml[ei]
        for j in range(ei,maxj+1):
            if j>ei:
                prev=j-1; runhi=max(runhi,mh[prev]); runlo=min(runlo,ml[prev])
                if side==1: stop=max(stop,runhi-2.20*atr[prev],(sl[prev]-.10*atr[prev]) if np.isfinite(sl[prev]) else -np.inf)
                else: stop=min(stop,runlo+2.20*atr[prev],(sh[prev]+.10*atr[prev]) if np.isfinite(sh[prev]) else np.inf)
                ex=bo[j] if side==1 else ao[j]
                if (side==1 and ex<=stop) or (side==-1 and ex>=stop): xi=j; xp=ex; reason="STOP_GAP"; break
                br=(mc[prev]<ef[prev] and mc[prev]<sl[prev]) if side==1 else (mc[prev]>ef[prev] and mc[prev]>sh[prev])
                if opp[prev] or bool(br): xi=j; xp=ex; reason="REVERSAL_OR_STRUCTURE"; break
            hit=bl[j]<=stop if side==1 else ah[j]>=stop
            if hit: xi=j; xp=stop; reason="TRAIL_STOP" if j>ei else "INITIAL_STOP"; break
        if xi is None: xi=maxj; xp=bc[xi] if side==1 else ac[xi]; reason="FAILSAFE_MAX_HOLD"
        r=side*(float(xp)-float(entry))/risk; rows.append({"pair":pair,"timeframe":tf,"family":fam,"direction":direction,"entry_time":idx[ei].isoformat(),"exit_time":idx[xi].isoformat(),"net_r":float(r),"net_pips":float(side*(xp-entry)/pip),"reason":reason}); last=xi
    return rows
def metrics(rows):
    if not rows: return {"trades":0,"net_r":0.0,"pf":0.0,"max_dd_r":0.0,"net_pips":0.0,"win_rate":0.0}
    rows=sorted(rows,key=lambda r:r["exit_time"]); a=np.array([r["net_r"] for r in rows],float); g=a[a>0].sum(); l=-a[a<0].sum(); cv=np.r_[0,np.cumsum(a)]; dd=cv-np.maximum.accumulate(cv); return {"trades":len(a),"net_r":float(a.sum()),"pf":float(g/l) if l>0 else (99.0 if g>0 else 0.0),"max_dd_r":float(dd.min()),"net_pips":float(sum(r["net_pips"] for r in rows)),"win_rate":float((a>0).mean())}
def by_year(rows,years): return {str(y):metrics([r for r in rows if pd.Timestamp(r["entry_time"]).year==y]) for y in years}
def zigzag_legs(frame,year,pair,mult=6.0):
    sub=frame[(frame.index>=pd.Timestamp(f"{year}-01-01",tz="UTC"))&(frame.index<pd.Timestamp(f"{year+1}-01-01",tz="UTC"))]; h1=sub.resample("1h",label="left",closed="left").agg({"mid_high":"max","mid_low":"min","mid_close":"last"}).dropna()
    if len(h1)<100: return []
    atr=true_range(h1.mid_high,h1.mid_low,h1.mid_close).ewm(alpha=1/14,adjust=False).mean(); th=float(atr.median())*mult; vals=h1.mid_close.to_numpy(); times=h1.index; piv=[]; hi=lo=float(vals[0]); hii=loi=0; direction=0
    for i in range(1,len(vals)):
        v=float(vals[i])
        if direction==0:
            if v>hi: hi,hii=v,i
            if v<lo: lo,loi=v,i
            if hi-lo>=th:
                if hii>loi: piv.append((loi,lo)); direction=1; hi,hii=v,i
                else: piv.append((hii,hi)); direction=-1; lo,loi=v,i
        elif direction==1:
            if v>hi: hi,hii=v,i
            elif hi-v>=th: piv.append((hii,hi)); direction=-1; lo,loi=v,i
        else:
            if v<lo: lo,loi=v,i
            elif v-lo>=th: piv.append((loi,lo)); direction=1; hi,hii=v,i
    if direction==1: piv.append((hii,hi))
    elif direction==-1: piv.append((loi,lo))
    out=[]; pip=pip_size(pair)
    for a,b in zip(piv[:-1],piv[1:]):
        de=b[1]-a[1]; out.append({"start":times[a[0]],"end":times[b[0]],"start_px":a[1],"end_px":b[1],"direction":"LONG" if de>0 else "SHORT","pips":abs(de)/pip})
    return out
def detection_lag(frame,sidx,years,pair,direction):
    lags=[]; total=miss=0; c=frame.mid_close
    for y in years:
        for leg in zigzag_legs(frame,y,pair):
            if leg["direction"]!=direction: continue
            total+=1; hits=sidx[(sidx>=leg["start"])&(sidx<=leg["end"])]
            if len(hits)==0: miss+=1; continue
            px=float(c.asof(hits[0])); den=abs(leg["end_px"]-leg["start_px"]); prog=((px-leg["start_px"])*(1 if direction=="LONG" else -1))/den if den else 0; lags.append(max(0.0,min(1.0,float(prog))))
    return {"legs":total,"detected":len(lags),"missed_pct":100*miss/total if total else 0.0,"median_lag_pct":100*float(np.median(lags)) if lags else None,"p75_lag_pct":100*float(np.percentile(lags,75)) if lags else None}
def swing_capture(frame,rows,years,pair,direction):
    opp=rel=0.0
    for y in years:
        for leg in zigzag_legs(frame,y,pair): opp+=leg["pips"]; rel+=leg["pips"] if leg["direction"]==direction else 0
    net=sum(r["net_pips"] for r in rows); return {"major_swing_pips":opp,"direction_swing_pips":rel,"net_pips":net,"net_capture_ratio_pct":100*net/opp if opp else 0.0,"direction_capture_ratio_pct":100*net/rel if rel else 0.0}
def main():
    cache=Path(".aifx_m15_cache"); mids={p:download_pair(p,cache) for p in PAIRS}; common=None; py={p:complete_years(f) for p,f in mids.items()}
    for p,ys in py.items(): common=set(ys) if common is None else common&set(ys)
    years=sorted(common or []); oos=years[-2:]; val=years[-4:-2]; dev=years[:-4]
    if len(years)<7 or len(dev)<3: raise RuntimeError(f"insufficient common complete years {years}")
    result={"status":"EARLY_WAVE_PROXY","cost_stress":"2x configured proxy spread","complete_years":years,"development_years":dev,"validation_years":val,"oos_years":oos,"source":"ejtraderLabs/historical-data M15 mid proxy; timezone unverified; no session rules","selection_uses_oos":False,"pairs":{}}; prep={}; ft={}; sg={}
    for p in PAIRS:
        prep[(p,"M15")]=add_exec(mids[p],p); prep[(p,"M30")]=add_exec(to_m30(mids[p]),p)
        for tf in TIMEFRAMES:
            ft[(p,tf)]=features(prep[(p,tf)],tf)
            for d in DIRECTIONS: sg[(p,tf,d)]=build_signals(ft[(p,tf)],tf,d)
    diag=dev+val
    for p in PAIRS:
        pr={"directions":{}}
        for d in DIRECTIONS:
            pertf={}
            for tf in TIMEFRAMES:
                x=ft[(p,tf)]; sd=sg[(p,tf,d)]; od=sg[(p,tf,"SHORT" if d=="LONG" else "LONG")]; cand=[]
                for fam in FAMILIES:
                    rows=simulate(x,sd[fam],od["STRONG"],p,tf,fam,d,dev[0],dev[-1]+1); yy=by_year(rows,dev); met=metrics(rows); pos=sum(yy[str(y)]["net_r"]>0 for y in dev); worst=min(yy[str(y)]["net_r"] for y in dev); cand.append((pos,worst,met["net_r"],met["pf"],fam,rows,yy,met))
                cand.sort(reverse=True,key=lambda z:z[:4]); pos,worst,_,_,fam,rows,yy,met=cand[0]; req=max(2,math.ceil(len(dev)*.67)); dg=pos>=req and met["net_r"]>0 and met["trades"]>=80 and met["pf"]>=1.02; vr=[]; vby={}
                if dg: vr=simulate(x,sd[fam],od["STRONG"],p,tf,fam,d,val[0],val[-1]+1); vby=by_year(vr,val)
                vm=metrics(vr); vg=bool(dg and all(vby[str(y)]["net_r"]>0 for y in val) and vm["trades"]>=40 and vm["pf"]>=1.05); pertf[tf]={"chosen_family":fam,"development":met,"development_by_year":yy,"positive_dev_years":pos,"worst_dev_year_r":worst,"development_gate":dg,"validation":vm,"validation_by_year":vby,"validation_gate":vg}
            passing=[tf for tf in TIMEFRAMES if pertf[tf]["validation_gate"]]; sel=None
            if len(passing)==1: sel=passing[0]
            elif len(passing)==2:
                a,b=passing; ar=pertf[a]["validation"]["net_r"]/len(val); br=pertf[b]["validation"]["net_r"]/len(val)
                if abs(ar-br)>5: sel=a if ar>br else b
                else:
                    ad=abs(pertf[a]["validation"]["max_dd_r"]); bd=abs(pertf[b]["validation"]["max_dd_r"])
                    if abs(ad-bd)>1e-12: sel=a if ad<bd else b
                    else:
                        ap=pertf[a]["validation"]["pf"]; bp=pertf[b]["validation"]["pf"]; sel=a if ap>bp else (b if bp>ap else "M30")
            orows=[]; oby={}; om=metrics([]); opass=False; cap=None; olag=None
            if sel:
                fam=pertf[sel]["chosen_family"]; x=ft[(p,sel)]; sd=sg[(p,sel,d)]; od=sg[(p,sel,"SHORT" if d=="LONG" else "LONG")]; orows=simulate(x,sd[fam],od["STRONG"],p,sel,fam,d,oos[0],oos[-1]+1); oby=by_year(orows,oos); om=metrics(orows); opass=bool(all(oby[str(y)]["net_r"]>0 for y in oos) and om["pf"]>=1.05); cap=swing_capture(prep[(p,sel)],orows,oos,p,d); olag=detection_lag(prep[(p,sel)],x.index[sd["SEED_ANY"]],oos,p,d)
            xm=ft[(p,"M15")]; old=(xm.old_up if d=="LONG" else xm.old_down).to_numpy(bool); oe=old&~np.r_[False,old[:-1]]; ld={"old_h1_hard_gate":detection_lag(prep[(p,"M15")],xm.index[oe],diag,p,d),"early_seed":detection_lag(prep[(p,"M15")],xm.index[sg[(p,"M15",d)]["SEED_ANY"]],diag,p,d)}; pr["directions"][d]={"timeframes":pertf,"selected_timeframe_pre_oos":sel,"oos":om,"oos_by_year":oby,"oos_pass":opass,"oos_swing_capture":cap,"wave_detection_lag":ld,"oos_early_seed_lag":olag}
        result["pairs"][p]=pr
    result["oos_passed_directions"]=[f"{p}:{d}" for p,pr in result["pairs"].items() for d,dr in pr["directions"].items() if dr["oos_pass"]]; result["status"]="EARLY_WAVE_PROMISING" if result["oos_passed_directions"] else "EARLY_WAVE_REJECT"; Path("early_wave_results.json").write_text(json.dumps(result,indent=2)); summary={"status":result["status"],"complete_years":years,"development_years":dev,"validation_years":val,"oos_years":oos,"oos_passed_directions":result["oos_passed_directions"],"pairs":{}}
    for p,pr in result["pairs"].items():
        summary["pairs"][p]={}
        for d,dr in pr["directions"].items(): summary["pairs"][p][d]={"selected_timeframe":dr["selected_timeframe_pre_oos"],"oos":dr["oos"],"oos_by_year":dr["oos_by_year"],"oos_pass":dr["oos_pass"],"swing_capture":dr["oos_swing_capture"],"lag":dr["wave_detection_lag"],"timeframes":{tf:{k:v for k,v in tr.items() if k in ("chosen_family","development","positive_dev_years","worst_dev_year_r","development_gate","validation","validation_by_year","validation_gate")} for tf,tr in dr["timeframes"].items()}}
    print("AIFX_EARLY_WAVE_RESULT_BEGIN"); print(json.dumps(summary,separators=(",",":"))); print("AIFX_EARLY_WAVE_RESULT_END")
if __name__=="__main__": main()
