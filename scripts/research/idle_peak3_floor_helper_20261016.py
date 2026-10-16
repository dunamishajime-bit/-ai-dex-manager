"""No-venue, causal H1 modeled Idle SHORT giveback protection; research use only."""
from __future__ import annotations
H=3_600_000

def model_idle_peak_floor(x, bars, *, threshold=.03, floor=-.01, activation="close", extra_stop_slip_bps=0, observation=None):
    """After historic profit >= threshold, activate a fixed STOP floor on next complete H1.
    A SHORT position return at stop = floor. floor=-.01 means original entry -1% PnL.
    Price crosses in next H1: fill at adverse max(open, stop). Original exit still takes priority
    in last bar. Candles are observational, not venue-certified or intra-bar sequencing.
    """
    if x.get("strategy_id")!="IDLE" or x.get("side")!="SHORT":
        return x
    obs=observation if observation is not None else {}
    symbol=x["symbol"];entry=float(x["entry_price"])
    t0=int(x["entry_ts_ms"]);t1=int(x["exit_ts_ms"])
    stop_px=entry*(1-floor)
    series=bars.get(symbol,{})
    armed=False
    for t in range(t0,t1,H):
        c=series.get(t)
        if not c:
            obs["gaps"]=obs.get("gaps",0)+1
            return x
        op,hi,lo,cl=(float(c[k]) for k in ("open","high","low","close"))
        # Stop can only have been armed from the previously completed bar;
        # at final booked exit timestamp original exit convention wins.
        if armed and t+H<t1 and (op>=stop_px or hi>=stop_px):
            px=max(op,stop_px)*(1+extra_stop_slip_bps/10_000)
            obs["stopped"]=obs.get("stopped",0)+1
            obs["stopped_by_symbol"]=obs.get("stopped_by_symbol",{})
            obs["stopped_by_symbol"][symbol]=obs["stopped_by_symbol"].get(symbol,0)+1
            return dict(x,exit_ts_ms=t+H,exit_price=px,
                        exit_reason="IDLE_PEAK3_RETURN_TO_FLOOR_SHADOW",
                        exit_reason_actual="IDLE_PEAK3_RETURN_TO_FLOOR_SHADOW",
                        unit_price_return=(entry-px)/entry)
        best=(entry-(cl if activation=="close" else lo))/entry
        if best>=threshold and not armed:
            armed=True
            obs["armed"]=obs.get("armed",0)+1
            obs["armed_by_symbol"]=obs.get("armed_by_symbol",{})
            obs["armed_by_symbol"][symbol]=obs["armed_by_symbol"].get(symbol,0)+1
    return x
