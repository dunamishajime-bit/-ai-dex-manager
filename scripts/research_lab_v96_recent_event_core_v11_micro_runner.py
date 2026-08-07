import research_lab_v96_recent_event_core_v11 as v11

_cache={}
_orig=v11.recent_completed

def cached(ledger,ts,n):
    key=(id(ledger),ts,n)
    if key not in _cache:
        _cache[key]=_orig(ledger,ts,n)
    return _cache[key]


def micro_configs():
    return [
        v11.MetaConfig('MICRO_N3_EWMA_A',3,'EWMA',0.0,1.0,0.25,0.25,'A4H'),
        v11.MetaConfig('MICRO_N3_EWMA_CASH',3,'EWMA',0.0,1.0,0.25,0.25,'CASH'),
        v11.MetaConfig('MICRO_N3_PF_A',3,'PF_MEAN',0.0,1.0,0.25,0.25,'A4H'),
        v11.MetaConfig('MICRO_N5_EWMA_A',5,'EWMA',0.0,1.0,0.25,0.25,'A4H'),
        v11.MetaConfig('MICRO_N5_EWMA_CASH',5,'EWMA',0.5,1.0,0.50,0.50,'CASH'),
        v11.MetaConfig('MICRO_N5_PF_B',5,'PF_MEAN',0.0,2.0,0.50,0.25,'B12H'),
    ]

v11.recent_completed=cached
v11.configs=micro_configs
if __name__=='__main__':v11.main()
