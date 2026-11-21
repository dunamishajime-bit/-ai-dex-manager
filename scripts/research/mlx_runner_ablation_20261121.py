#!/usr/bin/env python3
"""Research-only runner ablations of the predeclared MLX multi-layer exit policy.
No production writes. Reuses identical engine and tests individual runner effects.
"""
from pathlib import Path
import ast,os,hashlib,time
F=Path(__file__).with_name("mlx_replay_v1.py")
m=ast.parse(F.read_text(encoding="utf-8"))
v={}
for x in m.body:
 if isinstance(x,ast.Assign) and len(x.targets)==1 and isinstance(x.targets[0],ast.Name):
  name=x.targets[0].id
  if name in ("ENGINE","EXIT_PATCH"):
   v[name]=ast.literal_eval(x.value)
assert "ENGINE" in v and "EXIT_PATCH" in v
BASE=Path(r"C:\tmp\disdex-bt-20251001-20261001\DIRECTION_RESEARCH_20261109\STABLE3_REPRO_RECOVERED_20261113")
W=BASE/"portfolio_stable4_gross425_v4_475_l3_q102_h48_20261116.py"
src=W.read_text(encoding="utf-8-sig")
assert hashlib.sha256(W.read_bytes()).hexdigest()=="595fcf25a164392d70f156738c595f2af2697817166255bed2a6aa85b2cbd7f7"
O='out_name="STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1"'
A='exec(compile(orig,str(SRC)+"::PRETARGET_STABLE_"+case,"exec"),{"__name__":"__main__"})'
assert src.count(O)==1 and src.count(A)==1
os.environ["DISDEX_Q102_ADOPTED_MODE"]="ON"
os.environ["DISDEX_PRETARGET_STABLE_CASE"]="STABLE3"
for key,eligible in (("Q102_ONLY",{"Q102"}),("V4_ONLY",{"V4"}),("IDLE_ONLY",{"IDLE"}),("PENGU_ONLY",{"PENGU"}),("FET_ONLY",{"FET"}),("NO_V4",{"Q102","IDLE","FET","PENGU","RESIDUAL"})):
 name="DD_MLX_ABLATION_"+key+"_20261121"
 folder=BASE.parent.parent/name
 if (folder/"RUN_MANIFEST.json").exists():print("SKIP_EXISTING",name,flush=True);continue
 layer=v["ENGINE"].replace("__MODE__","FULL_LAYER")
 mask='_LX_ELIGIBLE={"Q102","V4","IDLE","FET","PENGU","RESIDUAL"}'
 assert layer.count(mask)==1
 layer=layer.replace(mask,"_LX_ELIGIBLE="+repr(eligible),1)
 s=src.replace(O,f'out_name="{name}"',1)
 inj=v["EXIT_PATCH"]+"\n"+'_LX_INJECT='+repr(layer)+'\n'+r'''
_a="def simulate(name,bps,priority,include_v4):"
assert orig.count(_a)==1
orig=orig.replace(_a,_LX_INJECT+"\n"+_a,1)
print("ABLAT_GENERATED_SHA",hashlib.sha256(orig.encode()).hexdigest(),flush=True)
'''
 s=s.replace(A,inj+A,1)
 print("ABLAT_START",name,time.time(),flush=True)
 exec(compile(s,str(W)+"::ABLAT_"+key,"exec"),{"__name__":"__main__","__file__":str(W)})
 print("ABLAT_COMPLETE",name,time.time(),flush=True)
