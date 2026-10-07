"""Research-only extension of the hash-verified ownership-corrected engine.

PENGU changes sizing only, not the frozen signal/lifecycle stream. HYPE uses
the actual H1 Trend signal and fixed ATR stop/TP observed in the source runner.
This remains a price model, never an operator/LIVE certificate.
"""
from scripts.research.formal_core_live_ownership import load_ownership_engine, prepare_overlay_batch

H=3600000

def hype_lifecycle(candles,ts,stop_distance,tp_distance,end):
    entry=candles.get(ts)
    if not entry:return {'status':'UNRESOLVED_HYPE_EXIT','reason':'ENTRY_BAR_MISSING'}
    price=float(entry['open']);stop=price-stop_distance;tp=price+tp_distance
    if not 0<stop<price<tp:raise ValueError('HYPE_PROTECTION_INVALID')
    deadline=min(ts+168*H,end)
    for t in range(ts,deadline,H):
        bar=candles.get(t)
        if not bar:return {'status':'UNRESOLVED_HYPE_EXIT','reason':'EXIT_CHAIN_GAP','unresolved_ts_ms':t}
        # Open gaps fill at the open; otherwise STOP-first H1 ambiguity.
        if float(bar['open'])<=stop:
            return {'status':'MODELED_CLOSED_TRADE','exit_ts_ms':t+H,'exit_price':float(bar['open']),'exit_reason':'HYPE_GAP_STOP'}
        if float(bar['open'])>=tp:
            return {'status':'MODELED_CLOSED_TRADE','exit_ts_ms':t+H,'exit_price':float(bar['open']),'exit_reason':'HYPE_GAP_TP'}
        if float(bar['low'])<=stop:
            return {'status':'MODELED_CLOSED_TRADE','exit_ts_ms':t+H,'exit_price':stop,'exit_reason':'HYPE_HARD_STOP'}
        if float(bar['high'])>=tp:
            return {'status':'MODELED_CLOSED_TRADE','exit_ts_ms':t+H,'exit_price':tp,'exit_reason':'HYPE_TAKE_PROFIT'}
    boundary=candles.get(deadline)
    previous=candles.get(deadline-H)
    if not boundary and not previous:return {'status':'UNRESOLVED_HYPE_EXIT','reason':'HOLD_BAR_MISSING'}
    return {'status':'MODELED_CLOSED_TRADE','exit_ts_ms':deadline,'exit_price':float(boundary['open'] if boundary else previous['close']),'exit_reason':'HYPE_MAX_HOLD' if deadline==ts+168*H else 'HYPE_PERIOD_END_MODEL_FLAT'}

PREEMPT_FUNCTION='''    def preempt_hype(ts, requested, strategy):
        nonlocal wallet
        if strategy not in {"V12","PENGU","Q102","FET","V52"}:
            return False
        equity = _equity(wallet,active,market,ts)
        crypto = sum(_gross(p,market,ts,equity) for p in active.values() if p["strategy_id"]!="V52")
        total = sum(_gross(p,market,ts,equity) for p in active.values())
        needed = max(0., crypto+(0. if strategy=="V52" else requested)-CRYPTO_CAP,
                     total+requested-TOTAL_CAP)
        victims = [(pid,p) for pid,p in active.items() if p["strategy_id"]=="HYPE_LONG"]
        capacity = sum(_gross(p,market,ts,equity)*.5 for _,p in victims)
        if needed<=1e-9 or capacity+1e-9<needed:
            return False
        for pid,p in victims:
            mark = _mark(market,p["symbol"],ts)
            qty = needed*equity/mark
            fraction = qty/p["quantity"]
            if fraction>.5+1e-9:raise ValueError("HYPE_HALF_REDUCTION_EXCEEDED")
            price_pnl = qty*(mark-p["entry_price"])
            fee = qty*mark*cost_side
            cash = price_pnl-fee
            wallet += cash;event_cashflow[ts] += cash
            p["price_pnl"] += price_pnl;p["exit_fee"] += fee;p["quantity"] -= qty
            p.setdefault("priority_reductions",[]).append({"ts":ts,"quantity":qty,"fraction":fraction,"cause":strategy})
            events.append({"event_type":"HYPE_PRIORITY_PARTIAL_EXIT","ts_ms":ts,
                "position_id":pid,"candidate_id":p["candidate_id"],"strategy_id":"HYPE_LONG",
                "symbol":p["symbol"],"quantity":qty,"fraction":fraction,"modeled_price_usd":mark,
                "price_pnl_settlement":price_pnl,"fee_settlement":fee,"net_cashflow_settlement":cash,
                "reference_fx_jpy_per_usd":rate_at(ts),"wallet_after_event":wallet,"cause_strategy":strategy,
                "historical_fill_verified":False})
            record_day_pnl(ts,cash)
        return True

'''

def transform_source(source,pengu_fixed=True):
    def replace(old,new):
        nonlocal source
        if source.count(old)!=1:raise ValueError('ENGINE_EXTENSION_HOOK_MISMATCH:'+old[:65])
        source=source.replace(old,new)
    replace('if strategy in {"PENGU", "Q102", "FET", "V52"} and active_same_strategy:',
            'if strategy in {"PENGU", "Q102", "FET", "V52", "HYPE_LONG"} and active_same_strategy:')
    replace('if strategy == "PENGU" and accepted_gross + 1e-9 < requested:',
            'if strategy in {"PENGU","HYPE_LONG"} and accepted_gross + 1e-9 < requested:')
    replace('"PENGU:NO_LOT_SHRINK", ts)', 'f"{strategy}:NO_LOT_SHRINK", ts)')
    replace('rejected["PENGU:NO_LOT_SHRINK"] += 1','rejected[f"{strategy}:NO_LOT_SHRINK"] += 1')
    if pengu_fixed:
        replace('                requested = min(float(candidate["requested_gross"]), research_cap)\n',
                '                requested = min(float(candidate["requested_gross"]), research_cap)\n                if strategy=="PENGU": requested=1.0\n')
    replace('    while True:\n',PREEMPT_FUNCTION+'    while True:\n')
    marker='                # FET is the residual sleeve and is preemptible by core crypto.\n'
    recompute='''                if room + 1e-12 < requested and strategy_room + 1e-9 >= requested:
                    if preempt_hype(ts,requested,strategy):
                        equity = _equity(wallet,active,market,ts)
                        strategy_gross = sum(_gross(p,market,ts,equity) for p in active_same_strategy)
                        total_gross = sum(_gross(p,market,ts,equity) for p in active.values())
                        crypto_gross = sum(_gross(p,market,ts,equity) for p in active.values() if p["strategy_id"]!="V52")
                        stock_gross = sum(_gross(p,market,ts,equity) for p in active.values() if p["strategy_id"]=="V52")
                        strategy_room = max(0.,research_cap-strategy_gross)
                        sleeve_room = max(0.,(STOCK_CAP-stock_gross) if strategy=="V52" else (CRYPTO_CAP-crypto_gross))
                        total_room = max(0.,TOTAL_CAP-total_gross)
                        room = min(strategy_room,sleeve_room,total_room)

'''
    replace(marker,recompute+marker)
    return source

def load_extended_engine(pengu_fixed=True):
    m=load_ownership_engine(source_transform=lambda s:transform_source(s,pengu_fixed))
    old=m._strategy_cap
    m._strategy_cap=lambda c:1.5 if c['strategy_id']=='HYPE_LONG' else old(c)
    m.PRIORITY['HYPE_LONG']=7
    def batch(rows,active,completed,ts,market,equity,gross,finalize,lifecycle):
        prepare_overlay_batch(rows,active,completed,ts,market,equity,gross,finalize,lifecycle)
        if any(p['strategy_id']=='HYPE_LONG' for p in active.values()):
            for row in rows:
                if row['strategy_id'] in {'IDLE','RESIDUAL'} and not row.get('_overlay_block'):
                    row['_overlay_block']='HYPE_SIDECAR_ACTIVE'
    m._prepare_overlay=batch
    return m
