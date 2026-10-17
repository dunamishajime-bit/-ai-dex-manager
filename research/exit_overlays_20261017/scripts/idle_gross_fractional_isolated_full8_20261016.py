"""Research-only exact-Gross sizing sensitivity; injected on frozen source in memory, never modifies original worktree or LIVE."""
import os,sys,json,argparse
import idle_profit_trailing_full8_20261016 as base
originalPatch=base.BASE_ADMISSION_PATCH
originalExit=base.causal_exit
PLANS={
 "render_half":{"RENDERUSDT":.5},
 "render_quarter":{"RENDERUSDT":.25},
 "dot_render_half":{"DOTUSDT":.5,"RENDERUSDT":.5},
 "idle_half":{"ALL_IDLE":.5},
 "render_half_plus3":{"RENDERUSDT":.5,"plus3":True},
 "render_quarter_plus3":{"RENDERUSDT":.25,"plus3":True}
}
def researched_source_patch(source,strict):
 s=originalPatch(source,strict)
 old="                    requested = 1.0\n"
 new="                    requested = (float(candidate['requested_gross']) if strategy=='IDLE' else 1.0)\n"
 assert s.count(old)==1,("FULL_GROSS_HOOK_NOT_UNIQUE",s.count(old))
 s=s.replace(old,new,1)
 oldroom="                    elif room + 1e-9 < 1.0:\n"
 newroom="                    elif room + 1e-9 < (float(candidate['requested_gross']) if strategy=='IDLE' else 1.0):\n"
 assert s.count(oldroom)==1,("ROOM_HOOK_NOT_UNIQUE",s.count(oldroom))
 s=s.replace(oldroom,newroom,1)
 return s
base.BASE_ADMISSION_PATCH=researched_source_patch
def candidate_factory(base_filter,policy,obs):
 spec=PLANS[policy]
 def fn(candidates,case):
  raw=base_filter(candidates,case)
  result=[]
  for c in raw:
   if c.get("strategy_id")=="IDLE":
    factor=spec.get("ALL_IDLE",spec.get(c.get("symbol"),1))
    if factor!=1:
     c=dict(c);c["requested_gross"]=float(c["requested_gross"])*factor
     obs["sizingCandidates"]=obs.get("sizingCandidates",0)+1
   result.append(originalExit(c,"combined_no_residual",obs) if spec.get("plus3") else c)
  return result
 return fn
PLANS["baseline_parity"]={}
base.wrapped_filter=candidate_factory

_allowed_fractional_symbols=set()
_orig_quantity_ok=base.s.w.base.quantity_ok
def research_fractional_quantity_ok(symbol,equity,price,quantity,strict):
    # Keep existing full-1x proof for original path and strict tests.
    target=equity/price
    if symbol not in _allowed_fractional_symbols or strict or quantity >= target*.90: return _orig_quantity_ok(symbol,equity,price,quantity,strict)
    # Research-only fractional lot proof: forbid oversize, fractional steps,
    # below-minimum size/notional and nonpositive quantities.
    import math
    from venue_constraints import FILTER_ROWS
    rows=FILTER_ROWS[symbol]['filters']
    filters={f['filterType']:f for f in rows}
    lot=filters.get('MARKET_LOT_SIZE') or filters['LOT_SIZE']
    step=float(lot['stepSize']); minqty=float(lot.get('minQty',0) or 0)
    vmin=filters.get('MIN_NOTIONAL') or filters.get('NOTIONAL') or {}
    minnotional=float(vmin.get('notional',vmin.get('minNotional',0)) or 0)
    x=quantity/step
    return (math.isfinite(quantity) and quantity>0 and price>0 and equity>0
            and quantity+1e-10>=minqty and quantity*price+1e-10>=minnotional
            and abs(x-round(x))<1e-5 and quantity*price<=equity+1e-8)
base.s.w.base.quantity_ok=research_fractional_quantity_ok

if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--policies",default="render_half");p.add_argument("--costs",default="10");args=p.parse_args()
 for policy in args.policies.split(","):
  _allowed_fractional_symbols.clear()
  _allowed_fractional_symbols.update(symbol for symbol in PLANS[policy] if symbol.endswith("USDT"))
  for cost in map(int,args.costs.split(",")):
   result=base.run_one(policy,cost)
   p=base.OUTROOT/policy/f"{cost}bps"/"cases"/base.CASE_NAME/"runs"
   paths=list(p.glob("*/portfolio-trades.jsonl"))
   if len(paths)!=1:raise RuntimeError("TRADE_RECORD_NOT_FOUND")
   rows=[json.loads(r) for r in paths[0].read_text(encoding="utf-8").splitlines() if r]
   bysym={}
   for sym in sorted({r["symbol"] for r in rows if r["strategy_id"]=="IDLE"}):
    symrows=[r for r in rows if r["strategy_id"]=="IDLE" and r["symbol"]==sym]
    bysym[sym]={"n":len(symrows),"avgGross":round(sum(float(r["accepted_gross"]) for r in symrows)/len(symrows),4),"maxGross":round(max(float(r["accepted_gross"]) for r in symrows),4)}
   for symbol,factor in PLANS[policy].items():
    if symbol=="plus3": continue
    chosen = [r for r in rows if r["strategy_id"]=="IDLE" and (r["symbol"]==symbol or symbol=="ALL_IDLE")]
    assert all(r["accepted_gross"] <= factor+0.000001 for r in chosen),(policy,symbol,"SIZING_NOT_APPLIED",[(r["symbol"],r["accepted_gross"]) for r in chosen[:3]])
   print("REAL_GROSS_VERDICT",json.dumps({
     "policy":policy,"cost":cost,
     "finalJPY":result["output"]["final_equity_jpy"],
     "PF":result["output"]["profit_factor"],
     "DDPct":result["output"]["maximum_mtm_drawdown"]*100,
     "winPct":result["output"]["win_rate"]*100,
     "trades":result["output"]["closed_trades"],
     "accounting":result["output"]["accounting"],
     "idleBySymbol":bysym,
     "obs":result["observations"]}),flush=True)
