import research_lab_v96_recent_event_core_v10 as v10

_cache={}
_orig=v10.trailing_stats

def cached_trailing_stats(rows,ts,lookback_days):
    key=(id(rows),ts,lookback_days)
    if key not in _cache:
        _cache[key]=_orig(rows,ts,lookback_days)
    return _cache[key]

v10.trailing_stats=cached_trailing_stats

if __name__=='__main__':
    v10.main()
