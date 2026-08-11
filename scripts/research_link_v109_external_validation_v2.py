from __future__ import annotations

import time
import urllib.parse

import research_link_v109_external_validation as base


def fetch_bybit_alt(s, start, end):
    rows=[]; cursor=end
    hosts=('https://api.bytick.com','https://api.bybit.com')
    while cursor>start:
        q=urllib.parse.urlencode({'category':'linear','symbol':base.bybit_symbol(s),'interval':'60','start':start,'end':cursor-1,'limit':1000})
        last=None
        for host in hosts:
            try:
                d=base.get_json(host+'/v5/market/kline?'+q,tries=2)
                if d.get('retCode')==0:
                    break
                last=RuntimeError(f'BYBIT:{s}:{d}')
            except Exception as e:
                last=e
        else:
            raise RuntimeError(f'BYBIT_ALL_HOSTS_FAILED:{s}:{last}')
        xs=d.get('result',{}).get('list',[])
        if not xs: break
        batch=[]
        for x in xs:
            ts=int(x[0])
            batch.append({'ts':ts,'open':x[1],'high':x[2],'low':x[3],'close':x[4],'volume':x[5] if len(x)>5 else '0'})
        rows.extend(batch)
        oldest=min(int(r['ts']) for r in batch)
        if oldest>=cursor: break
        cursor=oldest
        if oldest<=start: break
        time.sleep(.04)
    return base.normalize(rows,start,end)


base.fetch_bybit=fetch_bybit_alt

if __name__=='__main__':
    base.main()
