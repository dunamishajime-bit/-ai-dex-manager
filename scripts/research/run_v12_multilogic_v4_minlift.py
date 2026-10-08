"""Research-only V4 Min-Lift test.

Base: V4 same-direction virtual-leg stacking, 0.10x recovery gross, 0.75x recovery family cap.
Change: when a V12 recovery order fails venue minQty/minNotional, lift only that order to
minimum valid venue quantity if post-lift gross <= 0.20x and <= available room.
No opposite-direction behavior change. No LIVE/Production changes.
"""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_multilogic_v4_stacking as v4
    import run_v12_multilogic_v3 as v3
    import run_v12_independent_sleeves as ind
    import run_v12_multilogic_recovery as ml

s=v4.s
ROOT=s.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v4-minlift-20261009'
MID=s.MID
MAX_LIFT_GROSS=.20

def minlift_patch(source,strict):
    q=v4.stacking_patch(source,strict)

    marker='def run_portfolio_model('
    assert marker in q
    helper=r'''
from venue_constraints import FILTER_ROWS as _V4_FILTER_ROWS
import math as _v4_math
from decimal import Decimal as _V4_Decimal

def _v4_minlift_quantity(symbol, price):
    row=_V4_FILTER_ROWS.get(symbol)
    if not row:
        return 0.0,"VENUE_FILTER_MISSING"
    filters={f["filterType"]:f for f in row.get("filters",[])}
    lot=filters.get("MARKET_LOT_SIZE") or filters.get("LOT_SIZE")
    if not lot:
        return 0.0,"VENUE_QUANTITY_FILTER_MISSING"
    step=float(lot["stepSize"]); minimum=float(lot["minQty"]); maximum=float(lot["maxQty"])
    minimum_notional=max(5.0,float(filters.get("MIN_NOTIONAL",{}).get("notional",0)))
    required=max(minimum,minimum_notional/price)
    scale=10**min(12,max(0,-_V4_Decimal(str(step)).as_tuple().exponent))
    integer_step=max(1,_v4_math.floor(step*scale+.5))
    required_i=_v4_math.ceil(required*scale-1e-9)
    quantity=_v4_math.ceil(required_i/integer_step)*integer_step/scale
    if quantity>maximum:
        return 0.0,"VENUE_MAX_QTY"
    return quantity,None

'''
    q=q.replace(marker,helper+marker,1)

    old='''                quantity,venue_reason=_normalize_quantity(candidate["symbol"],quantity,entry_price)
                if venue_reason:
                    reason=f"{strategy}:{venue_reason}"
                    record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts);rejected[reason]+=1;continue
                notional=quantity*entry_price
                accepted_gross=notional/equity
'''
    new=f'''                quantity,venue_reason=_normalize_quantity(candidate["symbol"],quantity,entry_price)
                minlift_used=False
                if venue_reason in {{"VENUE_MIN_QTY","VENUE_MIN_NOTIONAL"}} and strategy=="V12" and (str(candidate.get("route") or "").startswith("REC_") or str(candidate.get("route") or "")=="CONT_SHORT_MID_AGE24_48"):
                    lifted_quantity,lift_reason=_v4_minlift_quantity(candidate["symbol"],entry_price)
                    if lift_reason is None:
                        lifted_gross=lifted_quantity*entry_price/equity
                        if lifted_gross <= room + 1e-9 and lifted_gross <= {MAX_LIFT_GROSS!r} + 1e-9:
                            quantity=lifted_quantity
                            venue_reason=None
                            minlift_used=True
                if venue_reason:
                    reason=f"{{strategy}}:{{venue_reason}}"
                    record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts);rejected[reason]+=1;continue
                notional=quantity*entry_price
                accepted_gross=notional/equity
                if accepted_gross > room + 1e-9:
                    reason=f"{{strategy}}:MINLIFT_NO_GROSS_ROOM" if minlift_used else f"{{strategy}}:NO_GROSS_ROOM"
                    record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts);rejected[reason]+=1;continue
'''
    assert q.count(old)==1,q.count(old)
    return q.replace(old,new,1)

def detail(rows):
    d=s.w.stats(rows)
    d['gross_hours']=sum(t.get('accepted_gross',0)*(t['exit_ts_ms']-t['entry_ts_ms'])/3600000 for t in rows)
    return d

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'protocol.json').write_text(json.dumps({
        'research_only':True,'live_changes':False,'production_changes':False,
        'base':'V4 stacking 0.10x',
        'minlift_max_gross':MAX_LIFT_GROSS,
        'recovery_family_cap':.75,'V12_cap':2.0,'crypto_cap':3.0,'total_cap':4.25,
        'opposite_direction':'unchanged reject','costs_bps':[10]
    },indent=2),encoding='utf-8')

    s.w.OUT=OUT
    s.w.setup()
    v4.install_virtual_leg_study_adapter()

    v3.FAILED=ml.failed_candidates();v3.v2.FAILED=v3.FAILED
    name='V4_MINLIFT_G0100_RCAP075'
    v3.CASE[name]={'family_cap':.75,'gross':.10,'slots':8}
    s.w.base.read_table=v3.v2.read_table
    s.w.base._study_filter=v3.filt
    ind.ORIG_PATCH=s.w.base.patch_admission
    ind.ACTIVE_RECOVERY_CAP=.75
    s.w.base.patch_admission=minlift_patch
    s.w.base.source_batch=ind.custom_source_batch

    print('START',name,flush=True)
    r=s.w.base.run_study(name,'10');r['research_only']=True
    for sc in r['scenarios']:
        ts=s.rows(OUT/'cases'/name/'runs'/sc['scenario_id']/'portfolio-trades.jsonl')
        vv=[x for x in ts if x['strategy_id']=='V12']
        sc['v12_details']={
            'all':detail(vv),
            'first':detail([x for x in vv if x['exit_ts_ms']<MID]),
            'second':detail([x for x in vv if x['entry_ts_ms']>=MID]),
            'routes':{rt:detail([x for x in vv if x.get('route')==rt]) for rt in sorted({x.get('route') for x in vv if x.get('route')})},
        }
    (OUT/'result.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
    print('DONE',name,flush=True)

if __name__=='__main__':
    main()
