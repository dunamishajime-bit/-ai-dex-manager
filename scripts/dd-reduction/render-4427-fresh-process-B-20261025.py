#!/usr/bin/env python3
"""RESEARCH ONLY: native H1 modeled8 scoped RENDER independent priority test.
The frozen venue and production source files are NEVER modified. The change
is a guarded in-memory transformation of an isolated research replay source.
Existing routes, same-symbol exclusivity, cooldown, native gross/positions,
underlying portfolio accounting and global stop remain enforced.
"""
from __future__ import annotations
import importlib.util,sys,json
from pathlib import Path
HERE=Path('C:/tmp/render-mtf-study-20261024')
ORIG=HERE/'run_render_4427_independent_profit_sell55_native8_20261024.py'
SPEC=importlib.util.spec_from_file_location('render_4427_coexistence_native_injection',ORIG)
runner=importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name]=runner
SPEC.loader.exec_module(runner)
core=runner.native.study.previous.native.m.m.core
original_bootstrap=core.task8.legacy.bootstrap
ROUTE='IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT'
INSERT=r'''
            # RESEARCH ONLY, pre-admission scoped priority sensitivity.
            # The other seven strategies, incumbent IDLE, margin and other
            # native risk gates are never unblocked here.
            for _rr in rows:
                if _rr.get("route") != "IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT":
                    continue
                if _rr.get("_overlay_block") != "CORE_SIGNAL_OR_POSITION":
                    continue
                assert _rr.get("strategy_id")=="IDLE" and _rr.get("side")=="SHORT" and _rr.get("symbol")=="RENDERUSDT"
                _sym="RENDERUSDT"
                if not all(_rr.get(x) is True for x in ("generic_accepted","route_selected","overlay_source_current")):
                    continue
                if ts < int(overlay_lifecycle.get(_sym,0)):
                    continue
                if any(p.get("symbol")==_sym for p in active.values()):
                    continue
                # No replacement of a simultaneous core or incumbent IDLE
                # candidate for the same symbol.
                if any(other is not _rr and other.get("symbol")==_sym for other in rows):
                    continue
                _research_equity=float(_equity(wallet,active,market,ts))
                if _research_equity<=0:
                    continue
                _research_crypto=sum(_gross(p,market,ts,_research_equity) for p in active.values() if p["strategy_id"]!="V52")
                _research_total=sum(_gross(p,market,ts,_research_equity) for p in active.values())
                # Stricter than historical 3.5/4.75x study caps, not looser.
                _research_room=min(3.-_research_crypto,4.25-_research_total)
                if _research_room+1e-9 < float(_rr["requested_gross"]):
                    continue
                _rr["_overlay_block"]=None
                _rr["_research_scoped_priority_only"]=True
                print("RESEARCH_RENDER_SCOPED_OWNER_PROMOTED",ts,_sym,_research_room,flush=True)
'''
assert 'RENDER_SCOPED_OWNER_PROMOTED' in INSERT
def scoped_bootstrap():
    source,helper=original_bootstrap()
    base=helper.base
    original_patch=base.BASE_ADMISSION_PATCH
    def patched_native_source(src,strict):
        out=original_patch(src,strict)
        marker='            for candidate in rows:\n'
        assert out.count(marker)==1,('NATIVE_SCOPED_ADMISSION_MARKER_NOT_UNIQUE',out.count(marker))
        assert '_prepare_overlay(rows, active' in out,'OWNER_GATE_REQUIRED_BEFORE_PATCH'
        out=out.replace(marker,INSERT+marker,1)
        assert out.count('RESEARCH_RENDER_SCOPED_OWNER_PROMOTED')==1
        print('RENDER_PRIORITY_RESEARCH_PATCH_SOURCE_BOUND',flush=True)
        return out
    base.BASE_ADMISSION_PATCH=patched_native_source
    return source,helper
core.task8.legacy.bootstrap=scoped_bootstrap
output=Path('C:/tmp/render4427-fresh-process-audit-20261025/B')
output.mkdir(parents=True,exist_ok=True)
sys.argv=[str(ORIG),'--output',str(output)]
try:
    runner.main()
finally:
    core.task8.legacy.bootstrap=original_bootstrap
print('SCOPED_OWNER_NATIVE8_COMPLETE',output,flush=True)
