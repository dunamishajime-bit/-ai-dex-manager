"""Research-only V12 V6: recovery-only opposite-side virtual net legs.

Extends V5:
- same-side virtual legs stay enabled
- opposite-side overlap is allowed only when BOTH active and incoming V12 legs are
  recovery/complement sleeves, never FAILED_BREAK core
- aggregate Recovery gross remains capped at 1.25x; V12 total 2.0x,
  crypto 3.0x, total 4.25x
- venue minimum bump retained only when executable within remaining gross room

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
OUT=ROOT/'docs/research/results/v12-multilogic-v6-20261009'
MID=s.MID

def v6_patch(source,strict):
 q=ind.independent_patch(source,strict)
 indep='(str(candidate.get("route") or "").startswith("REC_") or str(candidate.get("route") or "")=="CONT_SHORT_MID_AGE24_48")'
 posrec='(str(p.get("route") or "").startswith("REC_") or str(p.get("route") or "")=="CONT_SHORT_MID_AGE24_48")'

 old='''                    if any(p["symbol"] == candidate["symbol"] for p in active_same_strategy):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SAME_SYMBOL_ACTIVE", ts)
                        rejected["V12:SAME_SYMBOL_ACTIVE"] += 1
                        continue
'''
 new=f'''                    same_symbol_active=[p for p in active_same_strategy if p["symbol"] == candidate["symbol"]]
                    if same_symbol_active:
                        candidate_recovery={indep}
                        all_active_recovery=all({posrec} for p in same_symbol_active)
                        if not (candidate_recovery and all_active_recovery):
                            record_decision(candidate,"REJECTED_PORTFOLIO","V12:CORE_SYMBOL_ACTIVE",ts)
                            rejected["V12:CORE_SYMBOL_ACTIVE"] += 1
                            continue
'''
 assert q.count(old)==1,q.count(old)
 q=q.replace(old,new,1)

 old2='if active_same_route:'
 assert q.count(old2)==1
 q=q.replace(old2,'if len(active_same_route) >= 16:',1)

 old3='''                quantity,venue_reason=_normalize_quantity(candidate["symbol"],quantity,entry_price)
                if venue_reason:
                    reason=f"{strategy}:{venue_reason}"
                    record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts);rejected[reason]+=1;continue
                notional=quantity*entry_price
                accepted_gross=notional/equity
'''
 new3=f'''                quantity,venue_reason=_normalize_quantity(candidate["symbol"],quantity,entry_price)
                if venue_reason and strategy=="V12" and {indep}:
                    raw_lo=notional/entry_price
                    raw_hi=(room*equity)/entry_price
                    hi_q,hi_reason=_normalize_quantity(candidate["symbol"],raw_hi,entry_price)
                    if not hi_reason and hi_q>0:
                        best_q=hi_q;lo=raw_lo;hi=raw_hi
                        for _ in range(28):
                            mid=(lo+hi)/2.0
                            mid_q,mid_reason=_normalize_quantity(candidate["symbol"],mid,entry_price)
                            if mid_reason:lo=mid
                            else:best_q=mid_q;hi=mid
                        quantity=best_q;notional=quantity*entry_price
                        accepted_gross=notional/equity;venue_reason=None
                if venue_reason:
                    reason=f"{{strategy}}:{{venue_reason}}"
                    record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts);rejected[reason]+=1;continue
                notional=quantity*entry_price
                accepted_gross=notional/equity
'''
 assert q.count(old3)==1,q.count(old3)
 q=q.replace(old3,new3,1)
 return q

def patch_audit():
 engine_path=str(s.w.base.SUPPORT/'engine')
 if engine_path not in sys.path:sys.path.insert(0,engine_path)
 audit=importlib.import_module('scripts.research.formal_core_ownership_audit')
 orig=audit.find_ownership_conflicts
 def virtual_conflicts(trades):
  route_by_id={t.get('candidate_id'):t.get('route') for t in trades}
  out=[]
  for c in orig(trades):
   a=c.get('earlier_owner',{});b=c.get('later_owner',{})
   if a.get('strategy_id')=='V12' and b.get('strategy_id')=='V12':
    ar=str(route_by_id.get(a.get('candidate_id')) or '')
    br=str(route_by_id.get(b.get('candidate_id')) or '')
    arec=ar.startswith('REC_') or ar=='CONT_SHORT_MID_AGE24_48'
    brec=br.startswith('REC_') or br=='CONT_SHORT_MID_AGE24_48'
    if arec and brec:
     continue
   out.append(c)
  return out
 audit.find_ownership_conflicts=virtual_conflicts

def detail(a):
 d=s.w.stats(a)
 d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in a)
 return d

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/'protocol.json').write_text(json.dumps({
  'research_only':True,'live_changes':False,'production_changes':False,
  'base':'V5 / V3 1051-candidate architecture',
  'opposite_virtual_net':'allowed only among V12 recovery/complement sleeves',
  'failed_break_core_overlap':'forbidden',
  'max_route_virtual_legs':16,
  'recovery_family_cap':1.25,
  'stage3_requested_gross':0.10,
  'V12_total_cap':2.0,'crypto_cap':3.0,'total_cap':4.25,
  'venue_min_policy':'minimum feasible upsize only inside remaining gross room',
  'cost_bps':[10,20,30]
 },indent=2),encoding='utf-8')

 s.w.OUT=OUT;s.w.setup();patch_audit()
 v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
 name='V6_VNET_RCAP125'
 v3.CASE[name]={'family_cap':1.25,'gross':.10,'slots':16}
 s.w.base.read_table=v3.v2.read_table
 s.w.base._study_filter=v3.filt
 ind.ORIG_PATCH=s.w.base.patch_admission
 ind.ACTIVE_RECOVERY_CAP=1.25
 s.w.base.patch_admission=v6_patch
 s.w.base.source_batch=ind.custom_source_batch
 print('START',name,flush=True)
 r=s.w.base.run_study(name,'10,20,30');r['research_only']=True
 for sc in r['scenarios']:
  ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
  vv=[x for x in ts if x['strategy_id']=='V12']
  sc['v12_details']={'all':detail(vv),'first':detail([x for x in vv if x['exit_ts_ms']<MID]),'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})}}
 (OUT/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
 print('DONE',name,flush=True)
if __name__=='__main__':main()
