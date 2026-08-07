import itertools
import research_lab_v96_recent_event_core_v11 as v11

_cache={}
_orig=v11.recent_completed

def cached(ledger,ts,n):
    key=(id(ledger),ts,n)
    if key not in _cache:
        _cache[key]=_orig(ledger,ts,n)
    return _cache[key]

def scout_configs():
    out=[]
    for n,metric,minimum,penalty,bonus_b,bonus_c,fallback in itertools.product(
        (3,5),('EWMA','PF_MEAN'),(0.0,0.5),(0.0,1.0,2.0),(0.0,0.5),(0.0,0.5),('A4H','B12H','CASH')
    ):
        out.append(v11.MetaConfig(f'V11S_N{n}_{metric}_MIN{minimum:g}_LP{penalty:g}_B{bonus_b:g}_C{bonus_c:g}_{fallback}',n,metric,minimum,penalty,bonus_b,bonus_c,fallback))
    return out

v11.recent_completed=cached
v11.configs=scout_configs
if __name__=='__main__':v11.main()
