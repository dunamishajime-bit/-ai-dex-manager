#!/usr/bin/env python3
import json, itertools, random, hashlib
from pathlib import Path

SEED=20261110
N_RANDOM=20000

RULES = {
    "V4_REC_X05_TIME_36H": {
        "status":"candidate",
        "conditions":[("vol72","<=",0.00658)],
        "ranges":{"vol72":(0.0,0.03)},
        "native":"SHORT","action":"LONG",
        "source":"README.md high-precision candidate"
    },
    "V4_REC_X07_TIME_6H": {
        "status":"candidate",
        "conditions":[("sym_ret3",">",-0.01401),("btc_ret3",">",-0.00588)],
        "ranges":{"sym_ret3":(-0.08,0.08),"btc_ret3":(-0.05,0.05)},
        "native":"SHORT","action":"LONG",
        "source":"README.md high-precision candidate"
    },
    "V4_REC_X11_TIME_48H": {
        "status":"candidate",
        "conditions":[("rel72",">",0.0)],
        "ranges":{"rel72":(-0.20,0.20)},
        "native":"SHORT","action":"LONG",
        "source":"README.md high-precision candidate"
    },
    "PENGU_RECOVERY_V8_2H_RESCUE": {
        "status":"research-candidate",
        "conditions":[("pre12",">",0.0254491018),("post2","<=",-0.0039952058)],
        "ranges":{"pre12":(-0.20,0.30),"post2":(-0.15,0.15)},
        "native":"KEEP_ENTRY","action":"EARLY_RESCUE_REEVALUATE",
        "source":"README.md PENGU reclassification addendum"
    },
    "Q102_FET_PB168": {
        "status":"candidate-small-sample",
        "conditions":[("ret14",">",0.098337)],
        "ranges":{"ret14":(-0.30,0.50)},
        "native":"LONG","action":"SHORT",
        "source":"README.md high-priority finding"
    },
    "PENGU_SHORT_V20_EXHAUSTION": {
        "status":"exploratory",
        "conditions":[("btc24",">=",-0.01),("rel12","<=",-0.035)],
        "ranges":{"btc24":(-0.12,0.12),"rel12":(-0.20,0.20)},
        "native":"SHORT","action":"REVIEW_DIRECTION",
        "source":"README.md exploratory only"
    },
    "PENGU_LONG_V64_OVERHEAT": {
        "status":"exploratory",
        "conditions":[("pre12",">=",0.12)],
        "ranges":{"pre12":(-0.20,0.40)},
        "native":"LONG","action":"REVIEW_DIRECTION",
        "source":"README.md exploratory only"
    }
}

def cmp(v,op,t):
    return {
        ">": v>t, ">=": v>=t, "<": v<t, "<=": v<=t
    }[op]

def fire(rule, x):
    return all(cmp(x[k],op,t) for k,op,t in rule["conditions"])

def eps_for(t):
    return max(1e-8, abs(t)*1e-6, 1e-7)

def boundary_values(op,t):
    e=eps_for(t)
    return [("below",t-e),("equal",t),("above",t+e)]

def expected_at(op, pos):
    if op==">": return pos=="above"
    if op==">=": return pos in ("equal","above")
    if op=="<": return pos=="below"
    if op=="<=": return pos in ("below","equal")
    raise ValueError(op)

def boundary_test(name, rule):
    conds=rule["conditions"]
    per=[]
    labels=[boundary_values(op,t) for _,op,t in conds]
    for combo in itertools.product(*labels):
        x={}
        expected=True
        desc=[]
        for ((k,op,t),(pos,v)) in zip(conds,combo):
            x[k]=v
            expected = expected and expected_at(op,pos)
            desc.append(f"{k}:{pos}")
        actual=fire(rule,x)
        per.append({"case":"|".join(desc),"features":x,"expected":expected,"actual":actual,"pass":actual==expected})
    return per

def metamorphic_test(name, rule):
    failures=[]
    for k,op,t in rule["conditions"]:
        base={}
        for kk,oop,tt in rule["conditions"]:
            e=eps_for(tt)
            if oop in (">",">="): base[kk]=tt+10*e
            else: base[kk]=tt-10*e
        if not fire(rule,base):
            failures.append({"condition":k,"reason":"constructed trigger base did not fire","base":base})
            continue
        e=eps_for(t)
        stronger=dict(base); weaker=dict(base)
        if op in (">",">="):
            stronger[k]=base[k]+100*e
            weaker[k]=t-100*e
        else:
            stronger[k]=base[k]-100*e
            weaker[k]=t+100*e
        if not fire(rule,stronger):
            failures.append({"condition":k,"reason":"stronger evidence stopped firing","features":stronger})
        if fire(rule,weaker):
            failures.append({"condition":k,"reason":"violating one condition still fired","features":weaker})
    return failures

def random_test(name, rule, rng):
    fired=0
    minmax={}
    for _ in range(N_RANDOM):
        x={k:rng.uniform(*rule["ranges"][k]) for k,_,_ in rule["conditions"]}
        a=fire(rule,x)
        if a: fired+=1
    return {"n":N_RANDOM,"fired":fired,"activation_rate":fired/N_RANDOM}

def main():
    rng=random.Random(SEED)
    out={"seed":SEED,"random_cases_per_rule":N_RANDOM,"purpose":"synthetic feature-space signal stress; not profitability evidence","rules":{}}
    total_boundary=0; total_boundary_fail=0; total_meta_fail=0
    for name,rule in RULES.items():
        b=boundary_test(name,rule)
        m=metamorphic_test(name,rule)
        rr=random_test(name,rule,rng)
        total_boundary += len(b)
        total_boundary_fail += sum(not z["pass"] for z in b)
        total_meta_fail += len(m)
        out["rules"][name]={
            "status":rule["status"],
            "source":rule["source"],
            "conditions":[{"feature":k,"op":op,"threshold":t} for k,op,t in rule["conditions"]],
            "boundary":{"cases":len(b),"failures":sum(not z["pass"] for z in b),"details":b},
            "metamorphic":{"failures":len(m),"details":m},
            "random":rr
        }
    out["summary"]={
        "rules":len(RULES),
        "boundary_cases":total_boundary,
        "boundary_failures":total_boundary_fail,
        "metamorphic_failures":total_meta_fail,
        "logic_shape_pass": total_boundary_fail==0 and total_meta_fail==0
    }
    here=Path(__file__).resolve().parent
    result=here.parent/"results"/"synthetic_signal_stress_20261110.json"
    result.write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    md=here.parent/"SYNTHETIC_SIGNAL_STRESS_20261110.md"
    lines=[
        "# Synthetic signal stress — 2026-11-10",
        "",
        "Purpose: verify candidate gate semantics, boundary behavior, AND-condition behavior, and monotonicity using synthetic feature-space scenarios.",
        "",
        "**This is not profitability or out-of-sample evidence.** It cannot replace real historical/forward validation; it only verifies that a candidate fires exactly where its mathematical rule says it should.",
        "",
        f"- Rules tested: {len(RULES)}",
        f"- Boundary cases: {total_boundary}",
        f"- Boundary failures: {total_boundary_fail}",
        f"- Metamorphic failures: {total_meta_fail}",
        f"- Random synthetic cases per rule: {N_RANDOM}",
        f"- Logic-shape result: {'PASS' if out['summary']['logic_shape_pass'] else 'FAIL'}",
        "",
        "## Per-rule random activation surface",
        ""
    ]
    for name,v in out["rules"].items():
        lines.append(f"- {name} [{v['status']}]: {v['random']['fired']}/{v['random']['n']} = {v['random']['activation_rate']:.4%}; boundary failures={v['boundary']['failures']}; metamorphic failures={v['metamorphic']['failures']}")
    lines += [
        "",
        "## Interpretation",
        "",
        "- PASS means the coded mathematical gate has no boundary/inclusion or simple monotonicity defect under these synthetic scenarios.",
        "- It does **not** mean the gate predicts the market correctly.",
        "- Candidate promotion still requires historical walk-forward/OOS, threshold-jitter stability, regime splits, false-positive accounting, and integrated 10bps/30bps portfolio BT.",
        "- FET BRK24 is intentionally not included as a candidate gate here because the saved snapshot proves its portfolio importance but does not yet contain a single final causal threshold rule to freeze.",
        ""
    ]
    md.write_text("\n".join(lines),encoding="utf-8")
    print(json.dumps(out["summary"],ensure_ascii=False))
    for name,v in out["rules"].items():
        print(name, f"activation={v['random']['activation_rate']:.4%}", "boundary_fail",v["boundary"]["failures"],"meta_fail",v["metamorphic"]["failures"])

if __name__=="__main__":
    main()
