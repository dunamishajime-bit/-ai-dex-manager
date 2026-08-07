import itertools
import research_lab_v96_recent_event_core_v11 as v11

_cache={}
_orig_recent=v11.recent_completed

def cached_recent(ledger,ts,n):
    key=(id(ledger),ts,n)
    if key not in _cache:
        _cache[key]=_orig_recent(ledger,ts,n)
    return _cache[key]


def fast_configs():
    out=[]
    for n,metric,minimum,penalty,bonus_b,bonus_c,fallback in itertools.product(
        (3,5,8),
        ('MEAN','EWMA','PF_MEAN'),
        (0.0,0.5,1.0),
        (0.0,1.0,2.0),
        (0.0,0.5),
        (0.0,0.5),
        ('A4H','B12H','BEST_SIGNAL','CASH'),
    ):
        # Full short windows; deterministically halve N8 surface.
        signature=n*7+len(metric)*11+int(minimum*10)*13+int(penalty*10)*17+int(bonus_b*10)*19+int(bonus_c*10)*23+len(fallback)
        if n==8 and signature%2:
            continue
        out.append(v11.MetaConfig(
            f'V11F_N{n}_{metric}_MIN{minimum:g}_LP{penalty:g}_B{bonus_b:g}_C{bonus_c:g}_{fallback}',
            n,metric,minimum,penalty,bonus_b,bonus_c,fallback,
        ))
    return out

v11.recent_completed=cached_recent
v11.configs=fast_configs

if __name__=='__main__':
    v11.main()
