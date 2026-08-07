import research_lab_v96_recent_event_core_v10_corrected_runner as corrected

v10=corrected.v10
_cache={}
_orig=v10.trailing_stats

def cached(rows,ts,lookback_days):
    key=(id(rows),ts,lookback_days)
    if key not in _cache:
        _cache[key]=_orig(rows,ts,lookback_days)
    return _cache[key]

v10.trailing_stats=cached

if __name__=='__main__':
    v10.main()
