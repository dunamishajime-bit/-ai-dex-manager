# -*- coding: utf-8 -*-
"""Causal pre-target stable route quarantine A/B on locked canonical + CAUSAL_THREE.
Research only. Route blocks were selected from pre-2025-10-01 evidence only.
"""
from pathlib import Path
import os,json,hashlib
HERE=Path(__file__).resolve().parent
CANON=HERE/"portfolio_effective_current_canonical_parity_20261111.py"
mode=os.environ["DISDEX_Q102_ADOPTED_MODE"].strip().upper()
assert mode=="ON"
case=os.environ["DISDEX_PRETARGET_STABLE_CASE"].strip().upper()
CASES={
 "STABLE3":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
 },
 "STABLE3_HYPE":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
   ("HYPE","HYPE_TREND_LONG_PINNED"),
 },
 "PENGU_ONLY":{("PENGU","SHORT_V20")},
 "Q102_WEAK2":{
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
 },
 "STABLE3_RENDER":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
 },
}
assert case in CASES,case
BLOCKS=CASES[case] - ({("PENGU","SHORT_V20")} if case=="STABLE3" else set())
IDLE_REL=-0.04089204262472046
IDLE_VOL=1.2568362211142174
PENGU_BTC=0.011611625094354983
Q102_RET14=0.048722800378429465
RENDER_ATR_MAX=0.02244512414537602
RENDER_RET24_MAX=-0.05907928388746808
RENDER_GATE=(case=="STABLE3_RENDER")

src=CANON.read_text(encoding="utf-8")
cut=src.index('print("CURRENT_PARITY_WRAPPER"')
ns={"__name__":"__canonical_stable_pretarget_prelude__","__file__":str(CANON)}
exec(compile(src[:cut],str(CANON)+"::STABLE_PRETARGET_PRELUDE","exec"),ns)
orig=ns["orig"];R=ns["R"];SRC=ns["SRC"];canonical_out=ns["out_name"]
out_name="S3_P3_HYPEWSIG_FORMALFREEENTRY_Q01365_RENDERWAIT_TAORISK12_CAUSAL_20261114"
assert canonical_out in orig
orig=orig.replace(canonical_out,out_name)
orig=orig.replace(
 'case="EFFECTIVE_CURRENT_CANONICAL_PARITY_Q102_ADOPTED_"+'+repr(mode),
 'case="EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_'+case+'_Q102_ADOPTED_"+'+repr(mode))
status_old='status="EFFECTIVE_CURRENT_CANONICAL_PARITY_V52_V50_PROXY_V11_MISSING"'
assert orig.count(status_old)==1
orig=orig.replace(status_old,'status="CAUSAL_THREE_PLUS_PRETARGET_STABLE_ROUTE_QUARANTINE_RESEARCH_ONLY"',1)
anchor='FORMAL_PRIORITY={"V4","Q102","PENGU","FET","V52"}'
assert orig.count(anchor)==1
gate=r'''_JUP_REL=__IDLE_REL__
_JUP_VOL_MIN=__IDLE_VOL__
_PENGU_V8_BTC_LIMIT=__PENGU_BTC__
_Q102_FET_RET14_MAX=__Q102_RET14__
_PRETARGET_BLOCKS=__BLOCKS__
_RENDER_GATE=__RENDER_GATE__
_RENDER_ATR_MAX=__RENDER_ATR__
_RENDER_RET24_MAX=__RENDER_RET24__
_HYPE_REDESIGN_PATH=R/"DIRECTION_RESEARCH_20261109"/"hype_causal_nextopen_fromscratch_v1_20261113.json"
_hype_research=json.load(open(_HYPE_REDESIGN_PATH,encoding="utf-8"))
_hb=next(x for x in _hype_research["results"] if int(x["horizon"])==48)
_hc=_hb["topPretargetSelected"][3]
assert _hc["side"]=="LONG"
assert _hc["rule"]==[['h12', '<=', 0.004297852251518686, 0.5], ['h24', '>=', 0.02047426596091347, 0.65]]
for _hi,_z in enumerate(_hc["targetRows"],1):
 _hf=_z["features"]
 if not (float(_hf["rel24"])<=0.026202553353817715):continue
 _t=int(_z["entryTs"]);_e=int(_z["exitTs"]);_ep=float(_z["entryPrice"]);_xp=float(_z["exitPrice"])
 _v={"route":"HYPE_REDESIGN_CAUSAL_H48R4_WSIG","requested_gross":1.0,"features":_z["features"],
     "signal_ts_ms":int(_z["signalTs"]),"entry_ts_ms":_t,"exit_ts_ms":_e}
 raw.append(dict(id="HYPER48R4_"+str(_hi).zfill(5),s="HYPE",t=_t,symbol="HYPEUSDT",
  side="LONG",route="HYPE_REDESIGN_CAUSAL_H48R4_WSIG",gross=1.0,v=_v,
  model=dict(entryTs=_t,entryPrice=_ep,exitTs=_e,exitPrice=_xp,exitReason="HYPE_REDESIGN_TIME48_NEXTOPEN"),
  funding=funding("HYPEUSDT",_t,_e,_ep,"LONG"),src=str(_HYPE_REDESIGN_PATH)))

# Q102 AVAX: local confidence hardening around QAON7. PRE/TARGET/FORWARD all pass.
_QAON_PATH=R/"DIRECTION_RESEARCH_20261109"/"q102_avax_qaon7_local_jitter_v1_20261113.json"
_qaon=json.load(open(_QAON_PATH,encoding="utf-8"))
_qc=next(x for x in _qaon["grid"] if abs(float(x["threshold"])-0.013)<1e-12 and abs(float(x["agree"])-0.65)<1e-12)
assert all(_qc["PRE30"][k]["mean"]>0 and _qc["PRE30"][k]["pf"]>1 for k in ("E1","E2","E3"))
assert _qc["TARGET30"]["mean"]>0 and _qc["TARGET30"]["pf"]>1
assert _qc["FORWARD30"]["mean"]>0 and _qc["FORWARD30"]["pf"]>1
for _qi,_z in enumerate(_qc["targetRows"],1):
 _t=int(_z["entryTs"]);_e=int(_z["exitTs"])
 if not START<=_t<END:continue
 _ep=float(_z["entryPrice"]);_xp=float(_z["exitPrice"]);_side=str(_z["side"])
 _route="Q102_AVAX_ONLINE_KNN_STOP5_TP3_Q01365"
 _v={"route":_route,"requestedGross":0.75,"redesign":True,"online":True,
     "selectionBasis":"qaon7-monotone-confidence-hardening-0.013-agree0.65"}
 raw.append(dict(id="Q102Q01365_"+str(_qi).zfill(5),s="Q102",t=_t,symbol="AVAXUSDT",side=_side,
  route=_route,gross=0.75,v=_v,
  model=dict(entryTs=_t,entryPrice=_ep,exitTs=_e,exitPrice=_xp,exitReason=str(_z.get("exitReason","TIME"))),
  funding=funding("AVAXUSDT",_t,_e,_ep,_side),src=str(_QAON_PATH)))

# IDLE TAO route is a risk-off sensor only. 12h equals the native holdHours.
_TAO_RISK_WINDOWS=[(int(_c["t"]),int(_c["t"])+12*3600000)
 for _c in raw if _c["s"]=="IDLE" and _c.get("route")=="IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2"]

_removed=collections.Counter()
def _keep(c):
 if c["s"]=="IDLE" and c.get("route")=="IDLE_RENDER_RELATIVE_SHORT":
  _removed["REDESIGN_IDLE_RENDER_PRETARGET_NO_ROBUST_WAIT"]+=1;return False
 if c["s"]=="IDLE" and any(_a<=int(c["t"])<_b for _a,_b in _TAO_RISK_WINDOWS):
  _removed["REDESIGN_IDLE_TAO_NATIVE12H_RISK_OFF"]+=1;return False
 if c["s"]=="PENGU" and c.get("route")=="SHORT_V20":
  _v=c["v"]
  if "pengu72h" not in _v or "btc24h" not in _v:raise RuntimeError("PENGU_V20_REGIME_FEATURE_MISSING")
  if not (float(_v["btc24h"])<=-0.010836782776818987 and float(_v["pengu72h"])<=-0.05237466490617382):
   _removed["REDESIGN_PENGU_V20_R3"]+=1;return False
 if c["s"]=="HYPE" and c.get("route")!="HYPE_REDESIGN_CAUSAL_H48R4_WSIG":
  _removed["REDESIGN_HYPE_OLD_REMOVED"]+=1;return False
 if c["s"]=="IDLE" and c.get("route")=="IDLE_JUP_RELATIVE_SHORT":
  f=c["v"].get("features") or {}
  if "rel24" not in f or "volumeRatio" not in f:raise RuntimeError("IDLE_JUP_FEATURE_MISSING")
  if float(f["rel24"])<_JUP_REL or float(f["volumeRatio"])<_JUP_VOL_MIN:
   _removed["CAUSAL_IDLE_JUP"]+=1;return False
 if _RENDER_GATE and c["s"]=="IDLE" and c.get("route")=="IDLE_RENDER_RELATIVE_SHORT":
  f=c["v"].get("features") or {}
  if "atrRatio" not in f or "ret24" not in f:raise RuntimeError("IDLE_RENDER_FEATURE_MISSING")
  if float(f["atrRatio"])>_RENDER_ATR_MAX or float(f["ret24"])>_RENDER_RET24_MAX:
   _removed["CAUSAL_IDLE_RENDER"]+=1;return False
 if c["s"]=="PENGU" and c.get("route")=="RECOVERY_V8":
  if "btc24h" not in c["v"]:raise RuntimeError("PENGU_V8_BTC24_MISSING")
  if float(c["v"]["btc24h"])>_PENGU_V8_BTC_LIMIT:
   _removed["CAUSAL_PENGU_V8"]+=1;return False
 if c["s"]=="Q102" and c.get("symbol")=="FETUSDT":
  if "ret14" not in c["v"]:raise RuntimeError("Q102_FET_RET14_MISSING")
  if float(c["v"]["ret14"])>_Q102_FET_RET14_MAX:
   _removed["CAUSAL_Q102_FET"]+=1;return False
 if (c["s"],c.get("route")) in _PRETARGET_BLOCKS:
  _removed["PRETARGET_"+c["s"]+"_"+str(c.get("route"))]+=1;return False
 return True
_before=len(raw)
raw=[c for c in raw if _keep(c)]
print("PRETARGET_STABLE_ROUTE_CASE",__CASE__,"REMOVED",dict(_removed),"TOTAL",_before-len(raw),flush=True)
'''
for a,b in [
 ("__IDLE_REL__",repr(IDLE_REL)),("__IDLE_VOL__",repr(IDLE_VOL)),
 ("__PENGU_BTC__",repr(PENGU_BTC)),("__Q102_RET14__",repr(Q102_RET14)),
 ("__BLOCKS__",repr(BLOCKS)),("__CASE__",repr(case)),
 ("__RENDER_GATE__",repr(RENDER_GATE)),("__RENDER_ATR__",repr(RENDER_ATR_MAX)),("__RENDER_RET24__",repr(RENDER_RET24_MAX))
]: gate=gate.replace(a,b)
orig=orig.replace(anchor,gate+anchor,1)

# Research-only HYPE redesign: V4 can preempt HYPE only when the V4 candidate
# passes the same V4-specific eligibility tests with HYPE excluded.
_hp_old=' def mark_current(t):\n'
_hp_new=''' def preempt_hype_for_v4(t,reason):
  ids=[pid for pid,pos in opened.items() if pos["s"]=="HYPE"]
  for pid in ids:
   q=opened[pid]
   price=priority_price(q["symbol"],t)
   if price is None:raise RuntimeError("HYPE_V4_PREEMPT_QUOTE_UNAVAILABLE:"+q["symbol"]+":"+iso(t))
   close_modeled(pid,t,price,reason)
 def mark_current(t):
'''
assert orig.count(_hp_old)==1,("HYPE_PREEMPT_HELPER",orig.count(_hp_old))
orig=orig.replace(_hp_old,_hp_new,1)

_hp_loop='   if (s in FORMAL_PRIORITY and any(v["s"]=="RESIDUAL" for v in opened.values())\n'
_hp_code='''   if (s=="V4" and any(v["s"]=="HYPE" for v in opened.values())
       and include_v4 and eq is not None and not daily and not v4_mtm_overcap and g>0
       and c["model"] is not None):
    _ho=[v for v in opened.values() if v["s"]!="HYPE"]
    _hgs=mtm_gross_state(t,eq,_ho)
    _hcap=False
    if _hgs is not None:
     _hoc=_hgs["crypto"];_hot=_hgs["total"];_hov4=_hgs["v4"];_hov4r=_hgs.get("v4_recovery",0.0)
     _hforeign=any(v["s"]!="V4" and v["symbol"]==c["symbol"] for v in _ho)
     _hopp=any(v["s"]=="V4" and v["symbol"]==c["symbol"] and v["side"]!=c["side"] for v in _ho)
     _hroutebusy=str(c.get("family","")).startswith("RECOVERY_") and sum(v["s"]=="V4" and v["route"]==c["route"] for v in _ho)>=16
     _hcap=(not _hforeign and not _hopp and not _hroutebusy and v4_max_dd<=0.21+1e-12
      and not (c["side"]=="SHORT" and t<v4_short_cooldown_until.get(c["symbol"],0))
      and g<=1.0+1e-8 and _hov4+g<=3.0+1e-8
      and (not str(c.get("family","")).startswith("RECOVERY_") or _hov4r+g<=2.5+1e-8)
      and _hoc+g<=3.0+1e-8 and _hot+g<=4.75+1e-8)
    if _hcap:
     preempt_hype_for_v4(t,"FORMAL_PRIORITY")
     eq=mark_current(t)
     gs=mtm_gross_state(t,eq)
     if gs is None:
      used_crypto=used_stock=used_total=usedv4=usedv4rec=float("inf")
     else:
      used_crypto=gs["crypto"];used_stock=gs["stock"];used_total=gs["total"];usedv4=gs["v4"];usedv4rec=gs.get("v4_recovery",0.0)
     snap=shared_crypto_risk_snapshot(t)
     if snap is not None and not latched and snap["loss"]>=.075:
      latched=True
      shared_risk_audit.append(dict(utc=iso(t),event="TRIP",loss_pct=100*snap["loss"],
       reference_equity_jpy=snap["reference"],settled_crypto_pnl_jpy=snap["settled"],
       unrealized_crypto_pnl_jpy=snap["unrealized"],strategy="",symbol="",exit_price_proxy=""))
     if latched and snap is not None:
      flatten_shared_risk_positions(t,snap);eq=mark_current(t)
     daily=(snap is None) or latched
   if (s in FORMAL_PRIORITY and any(v["s"]=="RESIDUAL" for v in opened.values())
'''
assert orig.count(_hp_loop)==1,("HYPE_PREEMPT_LOOP",orig.count(_hp_loop))
orig=orig.replace(_hp_loop,_hp_code,1)
_hc1='elif s=="HYPE" and used_crypto+1.5>CRYPTO_CAP+1e-8:reason="HYPE_FULL_1P5_CRYPTO_CAP_GATE"'
_hc2='elif s=="HYPE" and used_total+1.5>TOTAL_CAP+1e-8:reason="HYPE_FULL_1P5_TOTAL_CAP_GATE"'
assert orig.count(_hc1)==1 and orig.count(_hc2)==1
orig=orig.replace(_hc1,'elif s=="HYPE" and any(v["s"] in FORMAL_PRIORITY for v in opened.values()):reason="HYPE_FORMAL_BASELINE_OPEN_GATE"\n   elif s=="HYPE" and used_crypto+g>CRYPTO_CAP+1e-8:reason="HYPE_REDESIGN_1P0_CRYPTO_CAP_GATE"',1)
orig=orig.replace(_hc2,'elif s=="HYPE" and used_total+g>TOTAL_CAP+1e-8:reason="HYPE_REDESIGN_1P0_TOTAL_CAP_GATE"',1)
assert "STEP=300000" in orig and "V52_STRATEGY_DAILY_LOSS_3P5_GATE" in orig
compile(orig,str(SRC)+"::PRETARGET_STABLE_CHECK","exec")
print("PRETARGET_STABLE_WRAPPER",case,"CANON_SHA",hashlib.sha256(CANON.read_bytes()).hexdigest(),
      "GENERATED_SHA",hashlib.sha256(orig.encode("utf-8")).hexdigest(),flush=True)
exec(compile(orig,str(SRC)+"::PRETARGET_STABLE_"+case,"exec"),{"__name__":"__main__"})
O=R/out_name
(O/"PRETARGET_STABLE_ROUTE_ATTESTATION.json").write_text(json.dumps({
 "status":"CAUSAL_PRETARGET_STABLE_ROUTE_QUARANTINE_RESEARCH_ONLY",
 "case":case,"base":"CAUSAL_THREE",
 "blocks":[{"strategy":s,"route":r} for s,r in sorted(BLOCKS)],
 "selectionUsesTargetYear":False,
 "selectionBasis":"2025-10-01 pre-target route-health policy jitter; STABLE3 routes blocked in >=75% of eligible pretarget policies and selected without target outcomes. HYPE is separate sensitivity because not stable in jitter.",
 "productionMutation":False
},indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("PRETARGET_STABLE_COMPLETE",case,flush=True)
