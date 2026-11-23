from pathlib import Path
import re, runpy, subprocess, sys

SOURCE=Path('scripts/research_latest_v8_dca_1y.py')
GENERATED=Path('scripts/.research_latest_v8_quality102_dca_1y.generated.py')
orig_run, orig_unlink, orig_argv = subprocess.run, Path.unlink, list(sys.argv)
captured={}

def hold_run(args,*a,**kw):
    argv=list(args) if isinstance(args,(list,tuple)) else None
    if argv and len(argv)>=2 and Path(str(argv[1]))==GENERATED:
        captured['argv']=argv
        return subprocess.CompletedProcess(argv,0)
    return orig_run(args,*a,**kw)

def hold_unlink(self,*a,**kw):
    return None if Path(self)==GENERATED else orig_unlink(self,*a,**kw)

try:
    subprocess.run, Path.unlink = hold_run, hold_unlink
    sys.argv=[str(SOURCE),*orig_argv[1:]]
    runpy.run_path(str(SOURCE),run_name='__main__')
finally:
    subprocess.run, Path.unlink, sys.argv = orig_run, orig_unlink, orig_argv

if not GENERATED.exists() or 'argv' not in captured:
    raise SystemExit('failed to capture generated Quality102 engine')
s=GENERATED.read_text(encoding='utf-8')
s=s.replace('    gross_conflicts: List[dict] = []\n','    gross_conflicts: List[dict] = []\n    gross_resizes: List[dict] = []\n',1)

new_observe='''    def observe_entry(entered_kind: str, ts: int) -> None:
        nonlocal max_v12_positions, max_entry_v12_gross, max_entry_pengu_gross, max_entry_stock_gross, max_entry_crypto_gross, max_entry_total_gross, max_entry_supp_gross
        vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
        if entered_kind != "SUPP_ENTRY" and active_supp is not None:
            ug_before = supp_gross()
            headroom = max(0.0, TOTAL_GROSS_CAP - vg - pg - sg)
            if ug_before > headroom + 1e-9:
                old_notional = finite(active_supp.get("entryNotional"))
                new_notional = min(old_notional, equity * headroom)
                active_supp["entryNotional"] = max(0.0, new_notional)
                gross_resizes.append({"ts": ts, "supplementSymbol": active_supp.get("symbol"), "supplementEntryTs": active_supp.get("entryTs"), "supplementExitTs": active_supp.get("exitTs"), "enteredKind": entered_kind, "baseGross": vg + pg + sg, "supplementGrossBefore": ug_before, "supplementGrossAfter": supp_gross(), "grossHeadroom": headroom, "notionalBeforeJpy": old_notional, "notionalAfterJpy": max(0.0, new_notional)})
                stats["SUPPLEMENT_GROSS_RESIZED"] += 1
        ug = supp_gross()
        max_v12_positions = max(max_v12_positions, len(active_v12))
        if entered_kind == "V12_ENTRY": max_entry_v12_gross = max(max_entry_v12_gross, vg)
        elif entered_kind == "PENGU_ENTRY": max_entry_pengu_gross = max(max_entry_pengu_gross, pg)
        elif entered_kind == "STOCK_ENTRY": max_entry_stock_gross = max(max_entry_stock_gross, sg)
        elif entered_kind == "SUPP_ENTRY": max_entry_supp_gross = max(max_entry_supp_gross, ug)
        max_entry_crypto_gross = max(max_entry_crypto_gross, vg + pg)
        total = vg + pg + sg + ug
        max_entry_total_gross = max(max_entry_total_gross, total)
        if total > TOTAL_GROSS_CAP + 1e-9 and active_supp is not None:
            gross_conflicts.append({"ts": ts, "supplementSymbol": active_supp.get("symbol"), "supplementEntryTs": active_supp.get("entryTs"), "supplementExitTs": active_supp.get("exitTs"), "enteredKind": entered_kind, "totalGross": total})

'''
s,n=re.subn(r'    def observe_entry\(entered_kind: str, ts: int\) -> None:\n.*?(?=    def reset_day\(ts: int\) -> None:)',new_observe,s,count=1,flags=re.S)
if n!=1: raise SystemExit('observe patch failed')
s=s.replace('"supplementGrossConflicts": gross_conflicts, "limits":','"supplementGrossConflicts": gross_conflicts, "supplementGrossResizes": gross_resizes, "limits":',1)
s=s.replace('"entryPolicy": "BASE_IDLE_ONLY_ONE_SLOT_NO_PREEMPT"','"entryPolicy": "BASE_IDLE_ONE_SLOT_BASE_PRIORITY_RESIDUAL_GROSS_SHRINK", "resizePnlAccounting": "ZERO_PNL_ON_TRIMMED_NOTIONAL"',1)
if 'SUPPLEMENT_GROSS_RESIZED' not in s or 'BASE_IDLE_ONLY_ONE_SLOT_NO_PREEMPT' in s:
    raise SystemExit('gross-safe regression guard failed')
GENERATED.write_text(s,encoding='utf-8')
try:
    argv=captured['argv']
    orig_run([sys.executable,str(GENERATED),*argv[2:]],check=True)
finally:
    GENERATED.unlink(missing_ok=True)
