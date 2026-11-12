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
V52_MANAGE_WHEN_LATCHED=os.environ.get("DISDEX_V52_MANAGE_WHEN_LATCHED","OFF").strip().upper()=="ON"
V52_DAILY_TRIP_FLATTEN=os.environ.get("DISDEX_V52_DAILY_TRIP_FLATTEN","OFF").strip().upper()=="ON"
assert not (V52_MANAGE_WHEN_LATCHED and V52_DAILY_TRIP_FLATTEN)
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
 "STABLE3_V4BTC":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
 },
 "STABLE3_TAOATR17":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
 },
 "STABLE3_HYPE_HALF":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
 },
 "S3_HH_TH":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
 },
 "S3_HH_TH_RB":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
   ("Q102","RENDER|BRK168_H12_V1.2"),
 },
 "S3_HHTH_TI":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
 },
 "S3_HHTH_F0":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
 },
 "S3_HHTH_HB":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
 },
 "S3_HHTH_V4Q4":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
   ("V4","REC_G2_EARLY_BTC_OPPOSE_VOL"),
   ("V4","REC_G3_LATE_BTC_REL"),
   ("V4","REC_G5_SLOW_TREND"),
   ("V4","REC_X06_TIME_12H"),
 },
 "S3_HHTH_V52H":{
   ("PENGU","SHORT_V20"),
   ("Q102","AVAX|MR24_Z1.5_H24"),
   ("Q102","UNI|MR72_Z1.5_H24"),
 },
}
assert case in CASES,case
BLOCKS=CASES[case]
IDLE_REL=-0.04089204262472046
IDLE_VOL=1.2568362211142174
PENGU_BTC=0.011611625094354983
Q102_RET14=0.048722800378429465
RENDER_ATR_MAX=0.02244512414537602
RENDER_RET24_MAX=-0.05907928388746808
RENDER_GATE=(case=="STABLE3_RENDER")
V4_BTC_BLOCK=(case=="STABLE3_V4BTC")
TAO_ATR_GATE=(case=="STABLE3_TAOATR17")
TAO_ATR_MAX=0.01706380378807714
HYPE_HALF=(case in ("STABLE3_HYPE_HALF","S3_HH_TH","S3_HH_TH_RB","S3_HHTH_TI","S3_HHTH_F0","S3_HHTH_HB","S3_HHTH_V4Q4","S3_HHTH_V52H"))
TAO_HALF=(case in ("S3_HH_TH","S3_HH_TH_RB","S3_HHTH_TI","S3_HHTH_F0","S3_HHTH_HB","S3_HHTH_V4Q4","S3_HHTH_V52H"))
TIA_HALF=(case=="S3_HHTH_TI")
FET_GATE_OFF=(case=="S3_HHTH_F0")
RISK_HOLDBACK=(case in ("S3_HHTH_HB","S3_HHTH_V52H"))
V52_HALF=(case=="S3_HHTH_V52H")

src=CANON.read_text(encoding="utf-8")
cut=src.index('print("CURRENT_PARITY_WRAPPER"')
ns={"__name__":"__canonical_stable_pretarget_prelude__","__file__":str(CANON)}
exec(compile(src[:cut],str(CANON)+"::STABLE_PRETARGET_PRELUDE","exec"),ns)
orig=ns["orig"];R=ns["R"];SRC=ns["SRC"];canonical_out=ns["out_name"]
out_name=f"VPS_EFFECTIVE_CURRENT_CANONICAL_CAUSAL_THREE_PRETARGET_{case}_Q102_ADOPTED_{mode}_20261111"+("_V52_EXIT_WHEN_LATCHED" if V52_MANAGE_WHEN_LATCHED else "")+("_V52_TRIP_FLATTEN" if V52_DAILY_TRIP_FLATTEN else "")
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
_PRETARGET_BLOCKS=set(__BLOCKS__)
_RENDER_GATE=__RENDER_GATE__
_V4_BTC_BLOCK=__V4_BTC_BLOCK__
_TAO_ATR_GATE=__TAO_ATR_GATE__
_TAO_ATR_MAX=__TAO_ATR_MAX__
_HYPE_HALF=__HYPE_HALF__
_TAO_HALF=__TAO_HALF__
_TIA_HALF=__TIA_HALF__
_FET_GATE_OFF=__FET_GATE_OFF__
_RISK_HOLDBACK=__RISK_HOLDBACK__
_V52_HALF=__V52_HALF__
_RENDER_ATR_MAX=__RENDER_ATR__
_RENDER_RET24_MAX=__RENDER_RET24__
_removed=collections.Counter()
def _keep(c):
 if _V52_HALF and c["s"]=="V52":
  c["risk_scale"]=0.5
  _removed["PRETARGET_V52_HALF_RISK"]+=1
 if _HYPE_HALF and c["s"]=="HYPE":
  if _RISK_HOLDBACK:c["risk_scale"]=0.5
  else:c["gross"]=float(c["gross"])*0.5
  _removed["PRETARGET_HYPE_HALF_GROSS"]+=1
 if _TAO_HALF and c["s"]=="IDLE" and c.get("route")=="IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2":
  if _RISK_HOLDBACK:c["risk_scale"]=0.5
  else:c["gross"]=float(c["gross"])*0.5
  _removed["PRETARGET_TAO_HALF_GROSS"]+=1
 if _TIA_HALF and c["s"]=="IDLE" and c.get("route")=="IDLE_TIA_BREAKDOWN_SHORT_VOLCAP100":
  c["gross"]=float(c["gross"])*0.5
  _removed["PRETARGET_TIA_HALF_GROSS"]+=1
 if _V4_BTC_BLOCK and c["s"]=="V4" and c.get("symbol")=="BTCUSDT":
  _removed["PRETARGET_V4_BTC_BLOCK"]+=1;return False
 if _TAO_ATR_GATE and c["s"]=="IDLE" and c.get("route")=="IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2":
  f=c["v"].get("features") or {}
  if "atrRatio" not in f:raise RuntimeError("IDLE_TAO_ATR_MISSING")
  if float(f["atrRatio"])>_TAO_ATR_MAX:
   _removed["PRETARGET_IDLE_TAO_ATR17"]+=1;return False
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
 if (not _FET_GATE_OFF) and c["s"]=="Q102" and c.get("symbol")=="FETUSDT":
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
 ("__BLOCKS__",repr(tuple(sorted(BLOCKS)))),("__CASE__",repr(case)),
 ("__RENDER_GATE__",repr(RENDER_GATE)),("__V4_BTC_BLOCK__",repr(V4_BTC_BLOCK)),("__TAO_ATR_GATE__",repr(TAO_ATR_GATE)),("__TAO_ATR_MAX__",repr(TAO_ATR_MAX)),("__HYPE_HALF__",repr(HYPE_HALF)),("__TAO_HALF__",repr(TAO_HALF)),("__TIA_HALF__",repr(TIA_HALF)),("__FET_GATE_OFF__",repr(FET_GATE_OFF)),("__RISK_HOLDBACK__",repr(RISK_HOLDBACK)),("__V52_HALF__",repr(V52_HALF)),("__RENDER_ATR__",repr(RENDER_ATR_MAX)),("__RENDER_RET24__",repr(RENDER_RET24_MAX))
]: gate=gate.replace(a,b)
orig=orig.replace(anchor,gate+anchor,1)
if RISK_HOLDBACK:
    old_mtm='current_notional=float(q["notional"])*(float(mark)/float(q["entry"]))'
    assert orig.count(old_mtm)==1
    orig=orig.replace(old_mtm,'current_notional=float(q.get("reserve_notional",q["notional"]))*(float(mark)/float(q["entry"]))',1)
    old_enter='m=c["model"];notional=eq*g'
    assert orig.count(old_enter)==1
    orig=orig.replace(old_enter,'m=c["model"];exec_g=g*float(c.get("risk_scale",1.0));notional=eq*exec_g;reserve_notional=eq*g',1)
    old_q='equity=eq,notional=notional,original_notional=notional,gross=g,original_gross=g,fee=cost,funded=0.,'
    assert orig.count(old_q)==1
    new_q='equity=eq,notional=notional,original_notional=notional,reserve_notional=reserve_notional,gross=exec_g,original_gross=exec_g,reserve_gross=g,fee=cost,funded=0.,'
    orig=orig.replace(old_q,new_q,1)
if V52_MANAGE_WHEN_LATCHED:
    _old_v52_manage='if not v52_latched and v52_session_open(t):'
    assert orig.count(_old_v52_manage)==1,orig.count(_old_v52_manage)
    orig=orig.replace(_old_v52_manage,'if v52_session_open(t):',1)
if V52_DAILY_TRIP_FLATTEN:
    _trip_old='    if (not v52_latched) and _lpct>=.035:\n     v52_latched=True\n     v52_daily_audit.append(dict(utc=iso(t),event="TRIP",loss_pct=100*_lpct,strategy_capital_jpy=_capital,\n       realized_strategy_pnl_jpy=_real,unrealized_strategy_pnl_jpy=_unreal,symbol="",reason="V52_DAILY_LOSS_3P5"))'
    _trip_new='    if (not v52_latched) and _lpct>=.035:\n     v52_latched=True\n     v52_daily_audit.append(dict(utc=iso(t),event="TRIP",loss_pct=100*_lpct,strategy_capital_jpy=_capital,\n       realized_strategy_pnl_jpy=_real,unrealized_strategy_pnl_jpy=_unreal,symbol="",reason="V52_DAILY_LOSS_3P5"))\n     if v52_session_open(t):\n      for _trip_pid in list(opened.keys()):\n       if _trip_pid not in opened:continue\n       _trip_q=opened[_trip_pid]\n       if _trip_q["s"]!="V52":continue\n       _trip_px=v52_mark5(_trip_q["symbol"],t)\n       if _trip_px is None:_trip_px=v52_open5(_trip_q["symbol"],t)\n       if _trip_px is not None:\n        v52_daily_audit.append(dict(utc=iso(t),event="TRIP_FLATTEN",loss_pct=100*_lpct,strategy_capital_jpy=_capital,\n          realized_strategy_pnl_jpy=_real,unrealized_strategy_pnl_jpy=_unreal,symbol=_trip_q["symbol"],reason="V52_DAILY_LOSS_3P5_FLATTEN"))\n        close_modeled(_trip_pid,t,float(_trip_px),"V52_DAILY_LOSS_3P5_FLATTEN")'
    assert orig.count(_trip_old)==1,orig.count(_trip_old)
    orig=orig.replace(_trip_old,_trip_new,1)
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
 "productionMutation":False,"v52ManageDueExitWhenDailyLossLatched":V52_MANAGE_WHEN_LATCHED,"v52DailyTripFlatten":V52_DAILY_TRIP_FLATTEN
},indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("PRETARGET_STABLE_COMPLETE",case,flush=True)
