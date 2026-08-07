import itertools
import research_lab_v96_recent_event_core_v6 as v6


def bounded_configs():
    out=[]
    for lb,decl,bounce,rej,hold,rel,vol in itertools.product((10,12),(5.0,6.0,7.0),(0.5,0.75,1.0),(0.25,0.5),(60,72,84),(0.0,2.0),(0.0,0.8)):
        out.append(v6.Config(f'FB_L{lb}_D{decl:g}_B8_{bounce:g}_R{rej:g}_H{hold}_RW{rel:g}_V{vol:g}','FAILED_BOUNCE',lb,decl,8,bounce,rej,hold,rel,vol))
    for lb,decl,bounce,hold in itertools.product((10,12),(5.0,6.0,7.0),(0.5,0.75,1.0),(60,72,84)):
        out.append(v6.Config(f'SP4_L{lb}_D{decl:g}_B8_{bounce:g}_H{hold}','SHORT_PULLBACK',lb,decl,8,bounce,0.0,hold))
    for decl,bounce,rej,hold,bd,lmom,bm,lr in itertools.product((5.0,6.0,7.0),(0.5,0.75,1.0),(0.25,0.5),(60,72),(5,10),(6.0,8.0),(3.0,5.0),(1.0,3.0)):
        out.append(v6.Config(f'HY_D{decl:g}_B{bounce:g}_R{rej:g}_H{hold}_BD{bd}_LM{lmom:g}_BM{bm:g}_LR{lr:g}','HYBRID',10,decl,8,bounce,rej,hold,2.0,0.8,bd,lmom,bm,lr))
    return out

v6.configs=bounded_configs

if __name__=='__main__':
    v6.main()
