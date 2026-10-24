#!/usr/bin/env python3
"""Read-only cross-process Native8 fixed-point convergence audit; research only."""
from pathlib import Path
import hashlib,json
ROOT=Path("C:/tmp/render4427-fresh-process-audit-20261025")
CASE="RENDER_4427_INDEPENDENT_ASOF_SELL55_NATIVE8_20261024"
IDS={10:["cmp_5bb26c207eb3","cmp_d112f9aef1ff","cmp_88139ccf92bb"],
     30:["cmp_2104321c587e","cmp_433aa2452f5a","cmp_3a77ec7e46bd"]}
RUN_FILES=("candidate-decisions.jsonl","portfolio-events.jsonl","portfolio-trades.jsonl","task9-mtm.jsonl")
METRICS=("final_equity_jpy","profit_factor","win_rate","maximum_mtm_drawdown_pct","closed_trades")
def digest(p):
    assert p.is_file(),f"MISSING:{p}"
    h=hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()
def path(proc,c,run):
    return ROOT/proc/CASE/"engine"/run/run/(str(c)+"bps")
def report_for(proc,c,run):
    base=path(proc,c,run)
    case=base/"cases"/"V2_M150_D05_CORE_NATIVE"
    model=case/"runs"/("PRICE_MODEL_"+str(c)+"BPS")
    files={"preallocation_candidates":case/"candidates"/"crypto-price-model-candidates.jsonl",
           "core_reference_inputs":base/"inputs"/"core-reference-candidates.jsonl.gz",
           "quantity_vectors":base/"quantity-production-vectors.json"}
    files.update({k:model/k for k in RUN_FILES})
    j=json.loads((base/"result.json").read_text(encoding="utf-8"))
    assert all(k in j for k in METRICS)
    return {"sha256":{k:digest(v) for k,v in files.items()},
            "metrics":{k:j[k] for k in METRICS},
            "decision_count":sum(1 for _ in (model/"candidate-decisions.jsonl").open(encoding="utf-8"))}
def main():
    evidence={"status":"UNDETERMINED","scope":"Research-only, two fresh independent Python processes A/B, identical pinned scripts except output path",
              "costs":{},"limitations":["Research in-memory overlay adjustment is not a registered Owner/Route; do not deploy.",
              "Shared Risk, Margin Guard, Kill Switch, Pending, account lock and dedup parity not fully certified.",
              "2025 Aster RENDER H1 mark missing; actual Aster M5 fills/funding not verified.",
              "Historical periods are previously explored, not untouched OOS.","No VPS/LIVE/Production/HP/orders changed."]}
    sa=(ROOT/"render_4427_fresh_process_A.py").read_text(encoding="utf-8")
    sb=(ROOT/"render_4427_fresh_process_B.py").read_text(encoding="utf-8")
    normalized_a=sa.replace("render4427-fresh-process-audit-20261025/A", "render4427-fresh-process-audit-20261025/OUTPUT")
    normalized_b=sb.replace("render4427-fresh-process-audit-20261025/B", "render4427-fresh-process-audit-20261025/OUTPUT")
    assert normalized_a==normalized_b,"SOURCE_SCRIPT_DRIFT"
    evidence["normalized_runner_sha256"]=hashlib.sha256(normalized_a.encode()).hexdigest()
    original=Path("C:/tmp/render-mtf-study-20261024/render_4427_priority_native8_source_patch_v3_20261024.py")
    evidence["source_patch_sha256"]=digest(original)
    overall=True
    for c,ids in IDS.items():
        data={p:[report_for(p,c,run) for run in ids] for p in ("A","B")}
        same_passes=[data["A"][i]["sha256"]==data["B"][i]["sha256"] and
                     data["A"][i]["metrics"]==data["B"][i]["metrics"] for i in range(3)]
        final_sha={p:data[p][2]["sha256"] for p in ("A","B")}
        final_equal=final_sha["A"]==final_sha["B"]
        within={p:(data[p][1]["sha256"]==data[p][2]["sha256"] and
                    data[p][1]["metrics"]==data[p][2]["metrics"]) for p in ("A","B")}
        all_metrics={p:[x["metrics"] for x in data[p]] for p in ("A","B")}
        expected_n=1293 if c==10 else 1292
        expected_equity=290070131.97157055 if c==10 else 175324355.2534185
        economic=all(abs(x["final_equity_jpy"]-expected_equity)<1e-6 and x["closed_trades"]==expected_n
                     for p in all_metrics for x in all_metrics[p])
        ok=all(same_passes) and final_equal and all(within.values()) and economic
        overall=overall and ok
        evidence["costs"][str(c)]={"pass_ids":ids,"cross_process_identical_passes":same_passes,
          "within_process_converged_I1_I2_byte_identical":within,
          "final_pass_byte_identical_including_candidate_ids":final_equal,
          "raw_sha256_final":final_sha["A"],"decision_counts_A":[x["decision_count"] for x in data["A"]],
          "decision_counts_B":[x["decision_count"] for x in data["B"]],
          "final_metrics":all_metrics["A"][-1],"economic_match_archived":economic,"pass":ok}
    evidence["status"]="RESEARCH_ONLY_FRESH_PROCESS_RAW_DETERMINISM_PASS" if overall else "RESEARCH_ONLY_FRESH_PROCESS_RAW_DETERMINISM_FAIL"
    out=ROOT/"RENDER_4427_FRESH_PROCESS_FINAL_ITERATION_RAW_AUDIT_20261025"
    assert not out.with_suffix(".json").exists()
    out.with_suffix(".json").write_text(json.dumps(evidence,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    lines=["# RENDER #4427 — fresh-process final-iteration Native8 raw audit (2026-10-25)","",
           "STATUS: "+evidence["status"],"",
           "Two independent Python processes A/B each ran the full research Native8 engine for 10/30bps.",
           "I0/I1/I2 within a process are cooldown feedback iterations, NOT independent repeated inputs.",
           "A/B compared identical iteration index at frozen inputs, including raw candidate IDs.",
           ""]
    for c,d in evidence["costs"].items():
        m=d["final_metrics"]
        lines += [f"## {c}bps",
          f"- Cross-process I0/I1/I2 exact raw SHA pass: {d['cross_process_identical_passes']}.",
          f"- Converged I1/I2 byte-identical within each process: {d['within_process_converged_I1_I2_byte_identical']}.",
          f"- Final raw candidate/decision/trade/event/MTM SHA including IDs equal: {d['final_pass_byte_identical_including_candidate_ids']}.",
          f"- Decision counts A/B: {d['decision_counts_A']} / {d['decision_counts_B']}.",
          f"- Final modeled equity JPY {m['final_equity_jpy']:.3f}, PF {m['profit_factor']:.6f}, WR {100*m['win_rate']:.4f}%, MTM DD {m['maximum_mtm_drawdown_pct']:.6f}%, trades {m['closed_trades']}.",""]
    lines+=["## Fail-closed limits",""]+["- "+x for x in evidence["limitations"]]
    out.with_suffix(".md").write_text("\n".join(lines)+"\n",encoding="utf-8")
    print(evidence["status"],json.dumps({k:v["pass"] for k,v in evidence["costs"].items()}),flush=True)
    return evidence
if __name__=="__main__":main()
