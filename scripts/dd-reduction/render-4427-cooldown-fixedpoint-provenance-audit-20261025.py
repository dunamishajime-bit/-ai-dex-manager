#!/usr/bin/env python3
"""RENDER #4427: read-only provenance of iterative cooldown feedback in archived Native8."""
from pathlib import Path
import collections, hashlib, json

ROOT=Path(r"C:\tmp\render-mtf-study-20261024")
REPO=Path(r"C:\tmp\render-multiregime-study-20261024")
ENGINE=Path(r"C:\tmp\r4427c3\RENDER_4427_INDEPENDENT_ASOF_SELL55_NATIVE8_20261024\engine")
RUNS={10:["cmp_5bb26c207eb3","cmp_88139ccf92bb","cmp_d112f9aef1ff"],30:["cmp_2104321c587e","cmp_3a77ec7e46bd","cmp_433aa2452f5a"]}
OUT=ROOT/"RENDER_4427_COOLDOWN_FIXEDPOINT_PROVENANCE_AUDIT_20261025"
HOUR=3600000
def sha(data):
    return hashlib.sha256(data).hexdigest()
def read(path):
    assert path.is_file(),f"PRIMARY_EVIDENCE_MISSING:{path}"
    return [json.loads(line) for line in path.read_text(encoding="utf8").splitlines() if line.strip()]
def key(row):
    return tuple(row.get(k) for k in ("strategy_id","symbol","side","route","entry_ts_ms"))
def source_contract():
    runner=(REPO/"scripts/dd-reduction/run-v52-correct-stock-tape-full8-after-fet-20261022.py").read_text(encoding="utf8")
    filt=(REPO/"scripts/dd-reduction/run-q102-adopted2-plus-hvlong-h1-2h-20261022.py").read_text(encoding="utf8")
    assert "prev=None" in runner and 'if prev is not None:m.m.base.CURRENT["cooldown_events"]=prev' in runner
    assert "events=m.m.base.actual_cooldown_events(result)" in runner
    assert "if events==prev:return result,passes" in runner
    assert "prev=events" in runner
    assert 'if not CURRENT.get("cooldown_events"):return after' in filt
    assert 'blocked=any(sy==symbol and end<=ts<end+12*HOUR for sy,end,_ in CURRENT["cooldown_events"])' in filt
    assert "def actual_cooldown_events(out):" in filt
    return {"runner_source_sha256":sha(runner.encode()),"filter_source_sha256":sha(filt.encode()),
            "first_pass_has_no_prior_cooldown_events":True,"later_passes_feed_back_actual_stops":True,
            "preallocation_filters_v12_short_with_previous_stop_windows":True}
def audit():
    report={"status":"RESEARCH_ONLY_ITERATIVE_COOLDOWN_FEEDBACK_CAUSAL_EVIDENCE",
            "model_only":True,"source_contract":source_contract(),"costs":{},
            "not_independent_replays":True,"production_changes":0,"live_changes":0}
    for cost,ids in RUNS.items():
        manifests=[];decisions=[];events=[];trades=[];results=[]
        for id in ids:
            p=ENGINE/id/id/f"{cost}bps"/"cases"/"V2_M150_D05_CORE_NATIVE"
            q=p/"runs"/f"PRICE_MODEL_{cost}BPS"
            manifests.append(read(p/"candidates"/"crypto-price-model-candidates.jsonl"))
            decisions.append(read(q/"candidate-decisions.jsonl"))
            events.append(read(q/"portfolio-events.jsonl"))
            trades.append(read(q/"portfolio-trades.jsonl"))
            results.append(json.loads((ENGINE/id/id/f"{cost}bps"/"result.json").read_text(encoding="utf8")))
        assert [len(x) for x in manifests]==[2444,2424,2424]
        assert [len(x) for x in decisions]==[2543,2523,2523]
        assert manifests[1]==manifests[2] and decisions[1]==decisions[2]
        warm=collections.Counter(map(key,manifests[1]))
        first=collections.Counter(map(key,manifests[0]))
        extra=first-warm
        assert sum(extra.values())==20 and not (warm-first)
        added=[row for row in manifests[0] if key(row) in extra]
        assert len(added)==20 and all(row["strategy_id"]=="V12" and row["side"]=="SHORT" for row in added)
        assert [row for row in manifests[0] if key(row) not in extra]==manifests[1]
        stops=[row for row in events[0] if row.get("event_type")=="TASK9_MODELED_STOP_COOLDOWN" and row.get("side")=="SHORT"]
        assert len(stops)>=20
        witnesses=[]
        for row in added:
            t=int(row["entry_ts_ms"])
            hits=[ev for ev in stops if ev.get("symbol")==row["symbol"] and int(ev["ts_ms"])<=t<int(ev["until_ts_ms"])]
            assert hits,("EXTRA_V12_NOT_EXPLAINED_BY_PRIOR_COOLDOWN",key(row))
            witnesses.append({"key":list(key(row)),"matching_stop_event_count":len(hits),
                             "first_matching_stop_ts_ms":int(hits[0]["ts_ms"])})
        rejected=[x for x in decisions[0] if x.get("reason")=="V12:TASK9_ADVERSE_SIDE_COOLDOWN"]
        assert collections.Counter(map(key,rejected))==extra
        assert not any(x.get("reason")=="V12:TASK9_ADVERSE_SIDE_COOLDOWN" for d in decisions[1:] for x in d)
        economic=("final_equity_jpy","profit_factor","maximum_mtm_drawdown_pct","win_rate","closed_trades")
        assert all(all(r[k]==results[0][k] for k in economic) for r in results[1:])
        report["costs"][str(cost)]={"first_pass_candidate_rows":2444,"feedback_pass_candidate_rows":[2424,2424],
            "first_pass_only_v12_short_rows":20,"all_20_match_actual_first_pass_12h_stop_windows":True,
            "stop_event_count_in_first_pass":len(stops),"first_pass_only_rejections_match_source":True,
            "later_pass_source_and_decisions_identical":True,"economic_fields_identical_across_passes":True,
            "extra_witness_sha256":sha(json.dumps(witnesses,sort_keys=True,separators=(",",":")).encode()),
            "run_ids":ids}
    assert report["costs"]["10"]["extra_witness_sha256"]==report["costs"]["30"]["extra_witness_sha256"]
    report["conclusion"]=("The archived I0/I1/I2 files are dynamic cooldown fixed-point iterations, not three "
       "identical-input independent replays. I0 starts without previous accepted V12 SHORT stop windows. "
       "I1/I2 use accepted prior-pass stops to prefilter V12 SHORT proposals. Every one of the 20 "
       "I0-only V12 candidates falls inside a first-pass accepted STOP 12h cooldown window. "
       "Therefore the 20-row difference is explained by explicit iteration feedback, not evidence "
       "of nondeterministic Python cache pollution. Exact raw SHA should be tested across independent "
       "fresh processes at the same converged iteration and frozen inputs.")
    report["limits"]=["Archived replay evidence plus source-level control-flow proof; no fresh clean-process full8 repeat.",
        "The prior claim of raw three-pass nondeterminism is not supported because the passes have different cooldown inputs.",
        "Formal independent Owner/Route and safety gate parity not certified.",
        "2025 Aster RENDER H1 mark missing, Aster signed fills/funding unverified, explored periods not untouched OOS.",
        "No VPS/LIVE/Production/HP/orders changed."]
    return report
if __name__=="__main__":
    result=audit()
    OUT.with_suffix(".json").write_text(json.dumps(result,indent=2,ensure_ascii=False,sort_keys=True)+"\n",encoding="utf8")
    md=["# RENDER #4427 — Native8 cooldown fixed-point provenance audit (2026-10-25)","",
        "STATUS: RESEARCH ONLY. Previously labeled raw three-replay drift is a comparison of different feedback iterations.","",
        "## New causal finding",
        "The source explicitly begins I0 without cooldown events, feeds back accepted STOP events into I1, and iterates until the cooldown event set converges. The V12 preallocation filter removes SHORT candidates within those 12-hour windows.","",
        "| Cost | I0 candidates | I1 / I2 candidates | I0-only V12 | Matched prior-pass accepted STOP windows |",
        "|---|---:|---:|---:|---:|"]
    for c in (10,30):
        x=result["costs"][str(c)]
        md.append(f"| {c}bps | 2,444 | 2,424 / 2,424 | 20 | 20 / 20 |")
    md+=["","All 20 extra candidates are inside accepted first-pass V12 SHORT STOP cooldown windows. They are absent from both feedback passes; all other candidate rows remain exactly identical. The 10bps/30bps witness SHA matches.","",
        "## Interpretation",
        "The 3 files are fixed-point iterations with **different inputs**, not three independent identical-input replays. Comparing their raw SHA is not a valid nondeterminism test. Reproducibility requires **fresh separate-process full-run** tests at identical frozen inputs and comparison of the converged final pass, including candidate IDs and raw decisions. No row was deleted or ID normalized to force equality.","",
        "## Still blocked",
        *["- "+x for x in result["limits"]],"",
        "Evidence: accompanying JSON, pinned source hashes, archived candidate manifests, first-pass accepted STOP event ledger. No LIVE or production changes."]
    OUT.with_suffix(".md").write_text("\n".join(md)+"\n",encoding="utf8")
    print(json.dumps({"status":result["status"],"costs":{c:{"matched":20,"stop_events":x["stop_event_count_in_first_pass"]} for c,x in result["costs"].items()},
        "report_sha256":sha(OUT.with_suffix(".json").read_bytes())},ensure_ascii=False))
