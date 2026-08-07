import research_lab_v96_recent_event_core_v7 as v7

_raw_cache={}
_orig=v7.regime

def cached_regime(ts,market,cfg):
    raw=_raw_cache.get(ts)
    if raw is None:
        bidx=market['indexes']['BTC'].get(ts)
        if bidx is None:return None
        btc=market['bars']['BTC']
        btc7=v7.v6.mom(btc,bidx,int(7*24/v7.BAR_HOURS));btc20=v7.v6.sma(btc,bidx,int(20*24/v7.BAR_HOURS))
        if btc7 is None or btc20 is None:return None
        breadth=0;alt=[]
        for symbol in v7.ALT_SYMBOLS:
            idx=market['indexes'][symbol].get(ts)
            if idx is None:continue
            rows=market['bars'][symbol];avg=v7.v6.sma(rows,idx,int(20*24/v7.BAR_HOURS));m=v7.v6.mom(rows,idx,int(7*24/v7.BAR_HOURS))
            if avg is None or m is None:continue
            alt.append(m)
            if float(rows[idx]['close'])>avg and m>0:breadth+=1
        raw={'btcMom7':btc7,'above20':float(btc[bidx]['close'])>btc20,'breadth':breadth,'altMomMean':sum(alt)/len(alt) if alt else 0.0}
        _raw_cache[ts]=raw
    strong=bool(raw['above20'] and raw['btcMom7']>=cfg.btc_mom_min and raw['breadth']>=cfg.breadth_min)
    return {'strong':strong,'btcMom7':raw['btcMom7'],'breadth':raw['breadth'],'altMomMean':raw['altMomMean']}

v7.regime=cached_regime
if __name__=='__main__':v7.main()
