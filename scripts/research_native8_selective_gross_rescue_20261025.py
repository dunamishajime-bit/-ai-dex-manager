"""Research-only in-memory diagnostic / rerunner for source-backed eight-owner gross allocation.

Use adopted 2026-10-23 native source and archive, not a replacement
Python allocator. Strict LIVE services and production untouched.
"""
from __future__ import annotations
import argparse, importlib.util, json, hashlib
from pathlib import Path

ARCHIVE=Path(r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/2026-10-22_hype_entry_plus_exit_full8")
SOURCE=ARCHIVE/"repo/scripts/dd-reduction/run-v52-amzn-entry-full8-after-fet-20261022.py"
STOCK=ARCHIVE/"v52_amzn_entry_studies_20261022/AMZN_SHORT_PRIOR_CLOSE_PLUS1P0"
# Evaluated by the frozen native source with only current-known inputs.
OTHER_HELD_PREEXISTING_EXPR='any(p["strategy_id"] != strategy and int(p["entry_ts_ms"]) < ts for p in active.values())'
PAST_CLOSED_STRATEGY_TRADES_EXPR='[p for p in completed if p["strategy_id"] == strategy and int(p["exit_ts_ms"]) < ts]'
RESEARCH_MIN_RESIDUAL_GROSS=0.05

def load_native():
    spec=importlib.util.spec_from_file_location("native8_adopted_20261023",SOURCE)
    assert spec and spec.loader
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.native,mod

def replay(cost:int, output:Path, mode:str):
    native,amzn=load_native()
    native.m.acquire_verified_h1()
    output.mkdir(parents=True,exist_ok=True)
    core=native.m.m.core
    core.OUTPUT=output
    core.BOOTSTRAP_REDIRECT=output/"_bootstrap_cache"
    core._transform_rows=native.m.m.entry_filter
    core._apply_initial_stop=native.m.p.apply
    core._matches=native.m.m.idle.matches
    core.Path.write_text=core._redirect_legacy_write_text
    try:
        source,helper=core.task8.legacy.bootstrap()
    finally:
        core.Path.write_text=core._path_write_text
    native.m.m.base.install_legacy_capture(helper)
    core.task8.legacy.ensure_baseline(helper)
    previous=helper.experiment_filter
    original=helper.gross.base.BASE_ADMISSION_PATCH
    once=[False]
    def wrapper(text,strict):
        transformed=original(text,strict)
        if not once[0]:
            once[0]=True
            snippets={}
            for key in ('requested = 1.0','elif room + 1e-9 <','FULL_1X_UNAVAILABLE','PENGU:NO_LOT_SHRINK','accepted_gross = min(requested, room)','FULL_1X_QUANTITY_BLOCK','_idle_quantity_ok'):
                i=transformed.find(key)
                snippets[key]=transformed[max(0,i-900):i+1850] if i>=0 else None
            diagnostic=output/"source-gross-seams.json"
            diagnostic.write_text(json.dumps(snippets,indent=2)+"\n",encoding="utf8")
            print("GROSS_SOURCE_SEAMS_CAPTURED",str(diagnostic),flush=True)
        if mode=="inspect":
            raise RuntimeError("INTENTIONAL_GROSS_INSPECTION_COMPLETE")
        if mode in ("adaptive_idle", "adaptive_all") or mode.startswith("adaptive_score"):
            other=OTHER_HELD_PREEXISTING_EXPR
            if mode.startswith("adaptive_score"):
                threshold=float(mode.removeprefix("adaptive_score").split("_")[0])/100.0
                assert 0.5<=threshold<=0.9
                # Score is computed only from older CLOSED trades.
                # A missing prior is NOT a score of 100.
                prior=PAST_CLOSED_STRATEGY_TRADES_EXPR
                score=f"(len({prior}) >= 12 and (sum(float(q['total_pnl_jpy'])>0 for q in {prior})+5)/(len({prior})+10) >= {threshold})"
                other=f"({other} and {score})"
                if mode.endswith("_nojup"):
                    other=f"({other} and candidate['symbol'] != 'JUPUSDT')"
                if mode.endswith("_nojuptia"):
                    other=f"({other} and candidate['symbol'] not in ('JUPUSDT','TIAUSDT'))"
            floor=str(RESEARCH_MIN_RESIDUAL_GROSS)
            old_full="                    elif room + 1e-9 < (float(candidate['requested_gross']) if strategy=='IDLE' else 1.0):"
            replacement=old_full[:-1]+f" and not ({other} and room >= {floor}):"
            assert transformed.count(old_full)==1, "NATIVE_FULL_1X_GROSS_SOURCE_MISMATCH"
            transformed=transformed.replace(old_full,replacement,1)
            old_qty='                    if not _idle_quantity_ok(candidate["symbol"],equity,entry_price,quantity,False):'
            replacement=old_qty[:-1]+f" and not ({other} and accepted_gross >= {floor}):"
            assert transformed.count(old_qty)==1,"NATIVE_1X_QUANTITY_GATE_SOURCE_MISMATCH"
            assert transformed.count('                quantity,venue_reason=_normalize_quantity(candidate["symbol"],quantity,entry_price)')==1,"NATIVE_VENUE_QTY_PROOF_REQUIRED"
            transformed=transformed.replace(old_qty,replacement,1)
            if mode=="adaptive_all":
                old_fixed='                if strategy in {"PENGU","HYPE_LONG"} and accepted_gross + 1e-9 < requested:'
                replacement=old_fixed[:-1]+f" and not ({other} and accepted_gross >= {floor}):"
                assert transformed.count(old_fixed)==1,"NATIVE_FIXED_SIZE_SOURCE_MISMATCH"
                transformed=transformed.replace(old_fixed,replacement,1)
        return transformed
    helper.gross.base.BASE_ADMISSION_PATCH=wrapper
    if mode=="inspect":
        try:
            native.replay("ADAPTIVE_GROSS_INSPECTION",cost,source,helper,previous,STOCK)
        except RuntimeError as exc:
            if str(exc)!="INTENTIONAL_GROSS_INSPECTION_COMPLETE":raise
        assert once[0],"GROSS_PATCH_SEAM_NOT_INVOKED"
        return {"status":"SOURCE_GROSS_SEAMS_SAVED","path":str(output/"source-gross-seams.json")}
    result,passes=native.replay("GROSS_"+mode.upper(),cost,source,helper,previous,STOCK)
    return {"status":"SOURCE_NATIVE8_REPLAY", "cost_bps":cost,"result":result, "passes":passes}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--cost",type=int,choices=(10,30),default=10)
    parser.add_argument("--mode",choices=("inspect","baseline","adaptive_idle","adaptive_all","adaptive_score55","adaptive_score60","adaptive_score65","adaptive_score70","adaptive_score60_nojup","adaptive_score60_nojuptia"),default="inspect")
    parser.add_argument("--output",required=True,type=Path)
    args=parser.parse_args()
    print(json.dumps(replay(args.cost,args.output,args.mode),default=str,ensure_ascii=False),flush=True)

if __name__=="__main__":main()
