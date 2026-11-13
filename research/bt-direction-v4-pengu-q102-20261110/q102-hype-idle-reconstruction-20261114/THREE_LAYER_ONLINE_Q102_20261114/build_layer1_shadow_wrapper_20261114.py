from pathlib import Path
src=Path(r"C:\tmp\disdex-bt-20251001-20261001\DIRECTION_RESEARCH_20261109\STABLE3_REPRO_RECOVERED_20261113\portfolio_s3_p3_hypewsig_formalfreeentry_q01365_renderwait_taorisk12_causal_20261114.py")
dst=src.with_name("portfolio_three_layer_layer1_shadow_20261114.py")
t=src.read_text(encoding="utf-8")
t=t.replace("S3_P3_HYPEWSIG_FORMALFREEENTRY_Q01365_RENDERWAIT_TAORISK12_CAUSAL_20261114",
            "THREE_LAYER_LAYER1_SHADOW_V3_20261114")
old='''_before=len(raw)
raw=[c for c in raw if _keep(c)]
print("PRETARGET_STABLE_ROUTE_CASE",__CASE__,"REMOVED",dict(_removed),"TOTAL",_before-len(raw),flush=True)
'''
new='''_shadow_all=list(raw)
_before=len(raw)
raw=[c for c in raw if _keep(c)]
_shadow_kept_ids=set(c["id"] for c in raw)
_shadow_path=R/"DIRECTION_RESEARCH_20261109"/"three_layer_layer1_all_candidates_20261114.jsonl"
with open(_shadow_path,"w",encoding="utf-8") as _sf:
 for _c in _shadow_all:
  _m=_c.get("model") or {}
  _row={"id":_c.get("id"),"strategy":_c.get("s"),"entryTs":int(_c.get("t")),
        "symbol":_c.get("symbol"),"side":_c.get("side"),"route":_c.get("route"),
        "gross":float(_c.get("gross",0.0)),"v":_c.get("v"),"model":_m,
        "funding":_c.get("funding"),"src":str(_c.get("src","")),
        "layer1Kept":_c.get("id") in _shadow_kept_ids}
  _sf.write(json.dumps(_row,ensure_ascii=False,separators=(",",":"))+"\n")
print("THREE_LAYER_LAYER1_LEDGER",str(_shadow_path),"ALL",len(_shadow_all),"KEPT",len(raw),"FILTERED",len(_shadow_all)-len(raw),flush=True)
print("PRETARGET_STABLE_ROUTE_CASE",__CASE__,"REMOVED",dict(_removed),"TOTAL",_before-len(raw),flush=True)
'''
if old not in t:
    raise SystemExit("filter anchor missing")
t=t.replace(old,new,1)
dst.write_text(t,encoding="utf-8")
compile(t,str(dst),"exec")
print("BUILT",dst)