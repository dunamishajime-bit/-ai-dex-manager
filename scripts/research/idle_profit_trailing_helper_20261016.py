"""Research-only Idle SHORT peak-profit trailing STOP simulation."""
H=3600000

def trailing_exit(row,bars,arm=.03,gap=.01,symbols=None,peak_mode="close",slip_bps=0,obs=None):
    if row.get("strategy_id")!="IDLE" or row.get("side")!="SHORT":return row
    symbol=row["symbol"]
    if symbols is not None and symbol not in symbols:return row
    if not 0<gap<arm<1:raise ValueError("bad parameters")
    if peak_mode not in ("close","wick"):raise ValueError("bad mode")
    obs=obs if obs is not None else {}
    entry=float(row["entry_price"]);start=int(row["entry_ts_ms"]);end=int(row["exit_ts_ms"])
    highwater=0.;stop=None;armed=False;series=bars.get(symbol,{})
    for t in range(start,end,H):
        c=series.get(t)
        if c is None:
            obs["missing"]=obs.get("missing",0)+1
            return row
        op,hi,lo,cl=(float(c[k]) for k in ("open","high","low","close"))
        if stop is not None and t+H<end and (op>=stop or hi>=stop):
            px=max(op,stop)*(1.+slip_bps/10000.)
            obs["stopped"]=obs.get("stopped",0)+1
            by=obs.setdefault("by_symbol",{})
            by[symbol]=by.get(symbol,0)+1
            return dict(row,exit_price=px,exit_ts_ms=t+H,
                        exit_reason="IDLE_TRAIL_PROFIT_SHADOW",
                        exit_reason_actual="IDLE_TRAIL_PROFIT_SHADOW",
                        unit_price_return=1-px/entry)
        gain=(entry-(cl if peak_mode=="close" else lo))/entry
        highwater=max(highwater,gain)
        if highwater>=arm:
            if not armed:
                obs["armed"]=obs.get("armed",0)+1
                by=obs.setdefault("armed_by_symbol",{})
                by[symbol]=by.get(symbol,0)+1
                armed=True
            proposal=entry*(1-highwater+gap)
            stop=min(stop,proposal) if stop is not None else proposal
    return row
