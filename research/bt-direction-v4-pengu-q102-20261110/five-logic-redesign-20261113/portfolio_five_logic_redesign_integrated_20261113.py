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
design=os.environ["DISDEX_REDESIGN_CASE"].strip().upper()
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
BLOCKS=CASES[case] - ({("PENGU","SHORT_V20")} if design!="BASE" else set())
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
out_name="FIVEBT_"+design+"_20261113"
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

_DESIGN=__DESIGN__
# New Q102 candidates are pretarget-selected; old AVAX/UNI MR routes stay quarantined.
_QMAP={
 "A12R2_U24R15":("AVAX_H12_R2","UNI_H24_R15"),
 "A12R2_U48R18":("AVAX_H12_R2","UNI_H48_R18"),
 "A24R7_U24R15":("AVAX_H24_R7","UNI_H24_R15"),
 "A24R7_U48R18":("AVAX_H24_R7","UNI_H48_R18"),
 "A48R3_U48R18":("AVAX_H48_R3","UNI_H48_R18"),
 "A24R7_ONLY":("AVAX_H24_R7",),
 "U24R15_ONLY":("UNI_H24_R15",),
 "U48R18_ONLY":("UNI_H48_R18",),
}
_qsel=None
for _k,_v in _QMAP.items():
 if _k in _DESIGN:_qsel=_v;break
if _qsel:
 _qp=R/"DIRECTION_RESEARCH_20261109"/"q102_avax_uni_survivor_exactrows_20261113.json"
 _qj=json.load(open(_qp,encoding="utf-8"))
 for _qn in _qsel:
  for _qi,_z in enumerate(_qj["candidates"][_qn]["rows"],1):
   _t=int(_z["entryTs"]);_e=int(_z["exitTs"])
   if not START<=_t<END:continue
   _ep=float(_z["entryPrice"]);_xp=float(_z["exitPrice"]);_side=str(_z["side"]);_sym=str(_z["symbol"])
   _route="Q102_REDESIGN_"+_qn
   _v={"route":_route,"requestedGross":0.75,"redesign":True}
   raw.append(dict(id="Q102R_"+_qn+"_"+str(_qi).zfill(5),s="Q102",t=_t,symbol=_sym,side=_side,
    route=_route,gross=0.75,v=_v,
    model=dict(entryTs=_t,entryPrice=_ep,exitTs=_e,exitPrice=_xp,exitReason="Q102_REDESIGN_TIME"),
    funding=funding(_sym,_t,_e,_ep,_side),src=str(_qp)))

# IDLE vNext remains 1.0x and one runner slot; portfolio simulator enforces formal-priority/cooldown/gross.
if "IDLEV3" in _DESIGN:
 _ip=R/"DIRECTION_RESEARCH_20261109"/"idle_vnext_core_tia_side_specific_v3_exactrows_20261113.json"
 _ij=json.load(open(_ip,encoding="utf-8"))
 for _ii,_z in enumerate(_ij["accepted"],1):
  _t=int(_z["entryTs"]);_e=int(_z["exitTs"])
  if not START<=_t<END:continue
  _ep=float(_z["entryPrice"]);_xp=float(_z["exitPrice"]);_side=str(_z["side"]);_sym=str(_z["symbol"])
  _route="IDLE_VNEXT_"+_sym.replace("USDT","")
  _v={"route":_route,"requestedGross":1.0,"redesign":True}
  raw.append(dict(id="IDLER_"+str(_ii).zfill(5),s="IDLE",t=_t,symbol=_sym,side=_side,
   route=_route,gross=1.0,v=_v,
   model=dict(entryTs=_t,entryPrice=_ep,exitTs=_e,exitPrice=_xp,exitReason=str(_z.get("exitReason","TIME"))),
   funding=funding(_sym,_t,_e,_ep,_side),src=str(_ip)))

# HYPE from-scratch H36 candidate at 1.0x. Old HYPE is replaced, not combined.
if "HYPEH36" in _DESIGN:
 _hp=R/"DIRECTION_RESEARCH_20261109"/"hype_causal_nextopen_fromscratch_v1_20261113.json"
 _hj=json.load(open(_hp,encoding="utf-8"))
 _hb=next(x for x in _hj["results"] if int(x["horizon"])==36)
 _hc=_hb["topPretargetSelected"][12]
 assert _hc["side"]=="LONG"
 for _hi,_z in enumerate(_hc["targetRows"],1):
  _t=int(_z["entryTs"]);_e=int(_z["exitTs"])
  if not START<=_t<END:continue
  _ep=float(_z["entryPrice"]);_xp=float(_z["exitPrice"])
  _v={"route":"HYPE_REDESIGN_CAUSAL_H36","requested_gross":1.0,"features":_z.get("features") or {}}
  raw.append(dict(id="HYPER36_"+str(_hi).zfill(5),s="HYPE",t=_t,symbol="HYPEUSDT",side="LONG",
   route="HYPE_REDESIGN_CAUSAL_H36",gross=1.0,v=_v,
   model=dict(entryTs=_t,entryPrice=_ep,exitTs=_e,exitPrice=_xp,exitReason="HYPE_REDESIGN_TIME36_NEXTOPEN"),
   funding=funding("HYPEUSDT",_t,_e,_ep,"LONG"),src=str(_hp)))

_removed=collections.Counter()
def _keep(c):
 if _DESIGN!="BASE" and c["s"]=="PENGU" and c.get("route")=="SHORT_V20":
  _v=c["v"]
  if "pengu72h" not in _v or "btc24h" not in _v:raise RuntimeError("PENGU_V20_REGIME_FEATURE_MISSING")
  if not (float(_v["btc24h"])<=-0.010836782776818987 and float(_v["pengu72h"])<=-0.05237466490617382):
   _removed["REDESIGN_PENGU_V20_R3"]+=1;return False
 if "IDLEV3" in _DESIGN and c["s"]=="IDLE" and not str(c.get("route","")).startswith("IDLE_VNEXT_"):
  _removed["REDESIGN_IDLE_OLD_REMOVED"]+=1;return False
 if "HYPEH36" in _DESIGN and c["s"]=="HYPE" and c.get("route")!="HYPE_REDESIGN_CAUSAL_H36":
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
 ("__RENDER_GATE__",repr(RENDER_GATE)),("__RENDER_ATR__",repr(RENDER_ATR_MAX)),("__RENDER_RET24__",repr(RENDER_RET24_MAX)),
 ("__DESIGN__",repr(design))
]: gate=gate.replace(a,b)
orig=orig.replace(anchor,gate+anchor,1)

if "HYPEH36" in design:
 _hc1='elif s=="HYPE" and used_crypto+1.5>CRYPTO_CAP+1e-8:reason="HYPE_FULL_1P5_CRYPTO_CAP_GATE"'
 _hc2='elif s=="HYPE" and used_total+1.5>TOTAL_CAP+1e-8:reason="HYPE_FULL_1P5_TOTAL_CAP_GATE"'
 assert orig.count(_hc1)==1 and orig.count(_hc2)==1
 orig=orig.replace(_hc1,'elif s=="HYPE" and used_crypto+g>CRYPTO_CAP+1e-8:reason="HYPE_REDESIGN_1P0_CRYPTO_CAP_GATE"',1)
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
 "redesignCase":design,"productionMutation":False
},indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
print("PRETARGET_STABLE_COMPLETE",case,flush=True)
