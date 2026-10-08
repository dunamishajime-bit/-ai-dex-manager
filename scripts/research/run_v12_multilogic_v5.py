"""Research-only V12 V5: toward ~1,000 accepted trades.

Adds three production-feasible concepts to V4:
1) same-symbol same-side virtual legs (already validated in V4),
2) venue-minimum gross bump only when the minimum feasible quantity fits all current Gross rooms,
3) recovery-direction flip: an incoming stage3 reversal (REC_Y*) may preempt opposite-side
   recovery legs on the same symbol, but never the FAILED_BREAK core.

No LIVE/Production changes.
"""
import contextlib,io,json,sys,importlib
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_multilogic_v3 as v3
 import run_v12_independent_sleeves as ind
 import run_v12_multilogic_recovery as ml

s=v3.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v5-20261009'
MID=s.MID

def v5_patch(source,strict):
 q=ind.independent_patch(source,strict)

 # Allow same-side stacking, and let incoming stage3 reversals flip only recovery sleeves.
 old='''                    if any(p["symbol"] == candidate["symbol"] for p in active_same_strategy):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SAME_SYMBOL_ACTIVE", ts)
                        rejected["V12:SAME_SYMBOL_ACTIVE"] += 1
                        continue
'''
 new='''                    same_symbol_active=[p for p in active_same_strategy if p["symbol"] == candidate["symbol"]]
                    opposite_same_symbol=[p for p in same_symbol_active if str(p.get("side")) != str(candidate.get("side"))]
                    if opposite_same_symbol:
                        incoming_route=str(candidate.get("route") or "")
                        incoming_reversal=incoming_route.startswith("REC_Y")
                        lower_only=all(str(p.get("route") or "").startswith(("REC_X","REC_G")) for p in opposite_same_symbol)
                        if incoming_reversal and lower_only:
                            victims=[(vp,p) for vp,p in list(active.items())
                                     if p["strategy_id"]=="V12"
                                     and p["symbol"]==candidate["symbol"]
                                     and str(p.get("side")) != str(candidate.get("side"))
                                     and str(p.get("route") or "").startswith(("REC_X","REC_G"))]
                            for vp,p in victims:
                                mark=_mark(market,p["symbol"],ts)
                                if mark is None:
                                    raise ValueError(f"RECOVERY_DIRECTION_FLIP_MARK_MISSING:{p['symbol']}:{ts}")
                                finalize_position(vp,ts,mark,f"RECOVERY_DIRECTION_FLIP:{incoming_route}")
                            active_same_strategy=[p for p in active.values() if p["strategy_id"]==strategy]
                        else:
                            record_decision(candidate, "REJECTED_PORTFOLIO", "V12:OPPOSITE_SYMBOL_ACTIVE", ts)
                            rejected["V12:OPPOSITE_SYMBOL_ACTIVE"] += 1
                            continue
'''
 assert q.count(old)==1
 q=q.replace(old,new,1)

 # More virtual legs per route; total Recovery/V12/portfolio Gross caps still bind.
 old2='if active_same_route:'
 assert q.count(old2)==1
 q=q.replace(old2,'if len(active_same_route) >= 16:',1)

 # The VENUE patch is already present when patch_admission is called.
 old3='''                quantity,venue_reason=_normalize_quantity(candidate["symbol"],quantity,entry_price)
                if venue_reason:
                    reason=f"{strategy}:{venue_reason}"
                    record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts);rejected[reason]+=1;continue
                notional=quantity*entry_price
                accepted_gross=notional/equity
'''
 new3='''                quantity,venue_reason=_normalize_quantity(candidate["symbol"],quantity,entry_price)
                if venue_reason and strategy=="V12" and candidate_is_recovery:
                    # Find the minimum venue-feasible quantity inside the already-computed Gross room.
                    raw_lo=notional/entry_price
                    raw_hi=(room*equity)/entry_price
                    hi_q,hi_reason=_normalize_quantity(candidate["symbol"],raw_hi,entry_price)
                    if not hi_reason and hi_q>0:
                        best_q=hi_q
                        lo=raw_lo
                        hi=raw_hi
                        for _ in range(28):
                            mid=(lo+hi)/2.0
                            mid_q,mid_reason=_normalize_quantity(candidate["symbol"],mid,entry_price)
                            if mid_reason:
                                lo=mid
                            else:
                                best_q=mid_q
                                hi=mid
                        quantity=best_q
                        notional=quantity*entry_price
                        accepted_gross=notional/equity
                        venue_reason=None
                if venue_reason:
                    reason=f"{strategy}:{venue_reason}"
                    record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts);rejected[reason]+=1;continue
                notional=quantity*entry_price
                accepted_gross=notional/equity
'''
 assert q.count(old3)==1, q.count(old3)
 q=q.replace(old3,new3,1)
 return q

def detail(a):
 d=s.w.stats(a)
 d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in a)
 return d

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({
  'research_only':True,'live_changes':False,'production_changes':False,
  'base':'V3 1051-candidate multi-logic architecture',
  'same_side_virtual_legs':True,
  'opposite_policy':'incoming REC_Y reversal may preempt opposite recovery; FAILED_BREAK core protected',
  'venue_min_policy':'round up only to minimum feasible venue quantity if within current Gross room',
  'max_route_virtual_legs':16,
  'recovery_family_cap':1.0,
  'stage3_requested_gross':0.10,
  'V12_total_cap':2.0,'crypto_cap':3.0,'total_cap':4.25,
  'cost_bps':[10]
 },indent=2),encoding='utf-8')

 s.w.OUT=OUT;s.w.setup()
 # Same-side V12 overlaps are virtual sub-ledgers of one venue net position.
 engine_path=str(s.w.base.SUPPORT/'engine')
 if engine_path not in sys.path:sys.path.insert(0,engine_path)
 audit=importlib.import_module('scripts.research.formal_core_ownership_audit')
 orig_conflicts=audit.find_ownership_conflicts
 def virtual_conflicts(trades):
  out=[]
  for c in orig_conflicts(trades):
   a=c.get('earlier_owner',{});b=c.get('later_owner',{})
   allowed=(a.get('strategy_id')=='V12' and b.get('strategy_id')=='V12' and a.get('side')==b.get('side'))
   if not allowed:out.append(c)
  return out
 audit.find_ownership_conflicts=virtual_conflicts
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 name='V5_FLIP_MINBUMP_RCAP100'
 v3.CASE[name]={'family_cap':1.0,'gross':.10,'slots':16}
 s.w.base.read_table=v3.v2.read_table
 s.w.base._study_filter=v3.filt
 ind.ORIG_PATCH=s.w.base.patch_admission
 ind.ACTIVE_RECOVERY_CAP=1.0
 s.w.base.patch_admission=v5_patch
 s.w.base.source_batch=ind.custom_source_batch
 print('START',name,flush=True)
 r=s.w.base.run_study(name,'10');r['research_only']=True
 for sc in r['scenarios']:
  ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
  vv=[x for x in ts if x['strategy_id']=='V12']
  sc['v12_details']={'all':detail(vv),'first':detail([x for x in vv if x['exit_ts_ms']<MID]),'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
 (OUT/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
 print('DONE',name,flush=True)

if __name__=='__main__':main()
