import itertools
import research_lab_v96_recent_event_core_v9 as v9


def fixed_configs():
    result=[]
    for decline,bmax,cmax,rel,dist,btcmax,breadth,rank,cooldown in itertools.product(
        (5.0,5.5,6.0),
        (1.5,2.0,3.0,99.0),
        (0.0,0.5,1.0,99.0),
        (0.0,-2.0,-4.0),
        (-99.0,-15.0,-10.0),
        (0.0,4.0,8.0,99.0),
        (2,3,5),
        ('DEEP','RELATIVE','BALANCED'),
        (0,12),
    ):
        signature=(
            int(decline*10)*3+int(bmax*10)*5+int(cmax*10)*7+int(abs(rel)*10)*11
            +int(abs(dist))*13+int(btcmax if btcmax<90 else 17)*17+breadth*19
            +(0 if rank=='DEEP' else 1 if rank=='RELATIVE' else 2)*23+cooldown
        )
        if signature%4!=0:
            continue
        result.append(v9.FilterConfig(
            f'V9_D{decline:g}_BM{bmax:g}_C{cmax:g}_R{rel:g}_DIST{dist:g}_BTC{btcmax:g}_BR{breadth}_{rank}_CD{cooldown}',
            decline,1.0,bmax,cmax,rel,0.0,dist,btcmax,breadth,rank,cooldown,
        ))
    for rel,bmax,cmax,volume,rank in itertools.product(
        (0.0,-2.0,-4.0),(1.5,2.0,3.0),(0.0,0.5,1.0),(0.8,1.0),('DEEP','BALANCED')
    ):
        result.append(v9.FilterConfig(
            f'V9_VOL_R{rel:g}_BM{bmax:g}_C{cmax:g}_V{volume:g}_{rank}',
            5.0,1.0,bmax,cmax,rel,volume,-15.0,99.0,5,rank,0,
        ))
    result.append(v9.FilterConfig('V9_BASELINE',5.0,1.0,99.0,99.0,99.0,0.0,-99.0,99.0,5,'DEEP',0))
    return list({cfg.config_id:cfg for cfg in result}.values())

v9.configs=fixed_configs

if __name__=='__main__':
    v9.main()
