import itertools
import research_lab_v96_recent_event_core_v6 as v6

def fast_configs():
    out=[]
    for decl,bounce,rej,hold,rel in itertools.product((5.0,6.0,7.0),(0.5,0.75,1.0),(0.25,0.5),(60,72,84),(0.0,2.0)):
        out.append(v6.Config(f'FAST_FB_L10_D{decl:g}_B8_{bounce:g}_R{rej:g}_H{hold}_RW{rel:g}','FAILED_BOUNCE',10,decl,8,bounce,rej,hold,rel,0.0))
    for decl,bounce,hold in itertools.product((5.0,6.0,7.0),(0.5,0.75,1.0),(60,72,84)):
        out.append(v6.Config(f'FAST_SP_L10_D{decl:g}_B8_{bounce:g}_H{hold}','SHORT_PULLBACK',10,decl,8,bounce,0.0,hold))
    # One strict hybrid family only.
    for decl,bounce,rej,hold in itertools.product((5.0,6.0),(0.5,0.75),(0.25,0.5),(60,72)):
        out.append(v6.Config(f'FAST_HY_D{decl:g}_B{bounce:g}_R{rej:g}_H{hold}','HYBRID',10,decl,8,bounce,rej,hold,2.0,0.8,5,6.0,3.0,1.0))
    return out

v6.configs=fast_configs
if __name__=='__main__': v6.main()
