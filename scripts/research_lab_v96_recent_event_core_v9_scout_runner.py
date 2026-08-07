import itertools
import research_lab_v96_recent_event_core_v9 as v9


def make(name, decline=5.0, bmax=99.0, cmax=99.0, rel=99.0, volume=0.0, dist=-99.0, btc=99.0, breadth=5, rank='DEEP', cooldown=0):
    return v9.FilterConfig(name, decline, 1.0, bmax, cmax, rel, volume, dist, btc, breadth, rank, cooldown)


def scout_configs():
    out=[make('SCOUT_BASE')]
    for bmax in (1.5,2.0,3.0): out.append(make(f'S_BM{bmax:g}',bmax=bmax))
    for cmax in (0.0,0.5,1.0): out.append(make(f'S_C{cmax:g}',cmax=cmax))
    for rel in (0.0,-2.0,-4.0): out.append(make(f'S_R{rel:g}',rel=rel))
    for dist in (-15.0,-10.0,-7.0): out.append(make(f'S_DIST{dist:g}',dist=dist))
    for btc in (0.0,4.0,8.0): out.append(make(f'S_BTC{btc:g}',btc=btc))
    for breadth in (2,3,4): out.append(make(f'S_BR{breadth}',breadth=breadth))
    for volume in (0.8,1.0): out.append(make(f'S_V{volume:g}',volume=volume))
    for cooldown in (12,24): out.append(make(f'S_CD{cooldown}',cooldown=cooldown))
    for rel,bmax,cmax in itertools.product((0.0,-2.0,-4.0),(1.5,2.0,3.0),(0.0,0.5,1.0,99.0)):
        out.append(make(f'S_RBC_{rel:g}_{bmax:g}_{cmax:g}',rel=rel,bmax=bmax,cmax=cmax,rank='BALANCED'))
    for rel,dist,btc in itertools.product((0.0,-2.0,-4.0),(-99.0,-15.0,-10.0),(4.0,8.0,99.0)):
        out.append(make(f'S_RDB_{rel:g}_{dist:g}_{btc:g}',rel=rel,dist=dist,btc=btc,rank='RELATIVE'))
    for bmax,btc,breadth in itertools.product((1.5,2.0,3.0,99.0),(4.0,8.0,99.0),(3,5)):
        out.append(make(f'S_BBB_{bmax:g}_{btc:g}_{breadth}',bmax=bmax,btc=btc,breadth=breadth,rank='BALANCED'))
    for rel,volume,cmax in itertools.product((0.0,-2.0,-4.0),(0.8,1.0),(0.0,0.5,1.0)):
        out.append(make(f'S_RVC_{rel:g}_{volume:g}_{cmax:g}',rel=rel,volume=volume,cmax=cmax,dist=-15.0,rank='BALANCED'))
    for decline in (5.5,6.0):
        for rel in (99.0,-2.0,-4.0):
            for bmax in (2.0,3.0,99.0):
                out.append(make(f'S_D{decline:g}_R{rel:g}_BM{bmax:g}',decline=decline,rel=rel,bmax=bmax))
    return list({cfg.config_id:cfg for cfg in out}.values())

v9.configs=scout_configs

if __name__=='__main__':
    v9.main()
