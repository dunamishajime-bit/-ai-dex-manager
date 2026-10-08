"""Research-only V12 V4: same-direction virtual-leg stacking.

Extends V3 by allowing multiple V12 recovery legs on the same symbol only when all
active V12 legs for that symbol have the same side as the new candidate.
Opposite-direction overlap remains rejected. Shared risk caps remain unchanged.
No LIVE/Production changes.
"""
import contextlib
import inspect
import io
import json

with contextlib.redirect_stdout(io.StringIO()):
    import run_v12_multilogic_v3 as v3
    import run_v12_independent_sleeves as ind
    import run_v12_multilogic_recovery as ml

s = v3.s
ROOT = s.ROOT
OUT = ROOT / "docs/research/results/v12-multilogic-v4-stacking-20261009"
MID = s.MID


def stacking_patch(source, strict):
    q = ind.independent_patch(source, strict)

    # Independent patch rejects every same-symbol V12 overlap. V4 only rejects
    # opposite-side overlap; same-side overlap is represented as virtual legs.
    old = """                    if any(p["symbol"] == candidate["symbol"] for p in active_same_strategy):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:SAME_SYMBOL_ACTIVE", ts)
                        rejected["V12:SAME_SYMBOL_ACTIVE"] += 1
                        continue
"""
    new = """                    same_symbol_active=[p for p in active_same_strategy if p["symbol"] == candidate["symbol"]]
                    if any(str(p.get("side")) != str(candidate.get("side")) for p in same_symbol_active):
                        record_decision(candidate, "REJECTED_PORTFOLIO", "V12:OPPOSITE_SYMBOL_ACTIVE", ts)
                        rejected["V12:OPPOSITE_SYMBOL_ACTIVE"] += 1
                        continue
"""
    assert q.count(old) == 1, q.count(old)
    q = q.replace(old, new, 1)

    # Route-local slot sensitivity. Family/portfolio gross caps remain binding.
    old2 = "if active_same_route:"
    assert q.count(old2) == 1
    q = q.replace(old2, "if len(active_same_route) >= 8:", 1)
    return q


def install_virtual_leg_study_adapter():
    """Rebuild run_study with a V4-only final audit exception.

    The canonical audit still treats any overlapping symbol ownership as a conflict.
    For this research case only, same-symbol/same-side V12 legs are virtual sub-ledgers
    of one venue net position, so they are removed from the *final audit report*.
    Opposite-side and cross-strategy overlaps remain conflicts.
    """
    study = inspect.getsource(s.w.base.run).replace(
        "def run(name,costs):", "def run_study(name,costs):"
    )
    study = study.replace(
        "if name in {'Q_REV20_DELTA','Q_RET14_DELTA'}:", "if True:"
    )
    study = study.replace(
        " # Stable source symbol priority for simultaneous residual candidates.",
        " candidates=_study_filter(candidates,name)\n"
        " # Stable source symbol priority for simultaneous residual candidates.",
    )
    assert "_study_filter(candidates,name)" in study

    needle = "source=(SUPPORT/'run-current-vps-no-dca.py').read_text(encoding='utf-8')"
    assert needle in study

    audit_import = (
        "from scripts.research.formal_core_ownership_audit "
        "import rows,find_ownership_conflicts"
    )
    audit_code = """from scripts.research.formal_core_ownership_audit import rows,find_ownership_conflicts as _formal_find_ownership_conflicts
def find_ownership_conflicts(trades):
    conflicts=_formal_find_ownership_conflicts(trades)
    kept=[]
    for c in conflicts:
        a=c.get("earlier_owner",{})
        b=c.get("later_owner",{})
        virtual=(a.get("strategy_id")=="V12" and b.get("strategy_id")=="V12" and a.get("side")==b.get("side"))
        if not virtual:
            kept.append(c)
    return kept
"""
    pos = study.index(needle)
    line_start = study.rfind("\n", 0, pos) + 1
    indent = study[line_start:pos]
    inject = needle + "\n" + indent + "source=source.replace(" + repr(audit_import) + "," + repr(audit_code) + ")"
    study = study.replace(needle, inject, 1)

    exec(
        compile(study, "<v4-virtual-leg-study-adapter>", "exec"),
        s.w.base.__dict__,
    )


def detail(rows):
    d = s.w.stats(rows)
    d["gross_hours"] = sum(
        t.get("accepted_gross", 0)
        * (t["exit_ts_ms"] - t["entry_ts_ms"])
        / 3600000
        for t in rows
    )
    return d


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "protocol.json").write_text(
        json.dumps(
            {
                "research_only": True,
                "live_changes": False,
                "production_changes": False,
                "base": "V3 1051-candidate architecture",
                "change": (
                    "allow same-symbol same-direction V12 virtual legs; "
                    "opposite side still rejected"
                ),
                "max_recovery_route_virtual_legs": 8,
                "recovery_family_gross_cap": 0.75,
                "V12_total_gross_cap": 2.0,
                "crypto_gross_cap": 3.0,
                "total_gross_cap": 4.25,
                "same_symbol_opposite_direction": "REJECT",
                "final_audit_exception": (
                    "V12/V12 same-symbol same-side overlap only"
                ),
                "costs_bps": [10],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    s.w.OUT = OUT
    s.w.setup()
    install_virtual_leg_study_adapter()

    v3.FAILED = ml.failed_candidates()
    v3.v2.FAILED = v3.FAILED
    v3.CASE["V4_STACK_G0075_RCAP075"] = {
        "family_cap": 0.75,
        "gross": 0.075,
        "slots": 8,
    }

    s.w.base.read_table = v3.v2.read_table
    s.w.base._study_filter = v3.filt
    ind.ORIG_PATCH = s.w.base.patch_admission
    ind.ACTIVE_RECOVERY_CAP = 0.75
    s.w.base.patch_admission = stacking_patch
    s.w.base.source_batch = ind.custom_source_batch

    name = "V4_STACK_G0075_RCAP075"
    print("START", name, flush=True)
    result = s.w.base.run_study(name, "10")
    result["research_only"] = True

    for scenario in result["scenarios"]:
        trades = s.rows(
            OUT
            / "cases"
            / name
            / "runs"
            / scenario["scenario_id"]
            / "portfolio-trades.jsonl"
        )
        v12 = [x for x in trades if x["strategy_id"] == "V12"]
        scenario["v12_details"] = {
            "all": detail(v12),
            "first": detail([x for x in v12 if x["exit_ts_ms"] < MID]),
            "second": detail([x for x in v12 if x["entry_ts_ms"] >= MID]),
            "routes": {
                route: detail([x for x in v12 if x.get("route") == route])
                for route in sorted(
                    {x.get("route") for x in v12 if x.get("route")}
                )
            },
        }

    (OUT / "result.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    print("DONE", name, flush=True)


if __name__ == "__main__":
    main()
