import research_lab_v96_recent_event_core_v8 as v8

_cache={}
_orig=v8.v6.short_signal

def cached_short_signal(cfg,ts,mkt,require_rejection):
    key=(ts,require_rejection)
    if key not in _cache:
        _cache[key]=_orig(cfg,ts,mkt,require_rejection)
    return _cache[key]

v8.v6.short_signal=cached_short_signal

if __name__=='__main__':v8.main()
