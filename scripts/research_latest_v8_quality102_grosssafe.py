from pathlib import Path
import ast, math, os, re, runpy, subprocess, sys

from quality102_trim_cost import patch_named_numeric_assignment, resolve_quality102_gross_cap

SOURCE=Path('scripts/research_latest_v8_dca_1y.py')
GENERATED=Path('scripts/.research_latest_v8_quality102_dca_1y.generated.py')
orig_run, orig_unlink, orig_argv = subprocess.run, Path.unlink, list(sys.argv)
captured={}


def _env_nonnegative_bps(name: str, default: float = 0.0) -> float:
    raw=os.environ.get(name,str(default))
    try:
        value=float(raw)
    except (TypeError,ValueError) as exc:
        raise SystemExit(f'{name} must be a finite nonnegative number: {raw!r}') from exc
    if not math.isfinite(value) or value < 0.0:
        raise SystemExit(f'{name} must be a finite nonnegative number: {raw!r}')
    return value


def _find_cap_name(source: str, token: str, expected: float) -> str:
    tree=ast.parse(source)
    matches=[]
    for node in ast.walk(tree):
        if not isinstance(node,(ast.Assign,ast.AnnAssign)):
            continue
        value_node=node.value
        if not isinstance(value_node,ast.Constant) or not isinstance(value_node.value,(int,float)):
            continue
        if abs(float(value_node.value)-expected)>1e-12:
            continue
        targets=node.targets if isinstance(node,ast.Assign) else [node.target]
        for target in targets:
            if isinstance(target,ast.Name):
                upper=target.id.upper()
                if token in upper and 'GROSS' in upper:
                    matches.append(target.id)
    if len(matches)!=1:
        raise SystemExit(f'expected exactly one {token} gross cap at {expected}; found {matches}')
    return matches[0]


def hold_run(args,*a,**kw):
    argv=list(args) if isinstance(args,(list,tuple)) else None
    if argv and len(argv)>=2 and Path(str(argv[1]))==GENERATED:
        captured['argv']=argv
        return subprocess.CompletedProcess(argv,0)
    return orig_run(args,*a,**kw)


def hold_unlink(self,*a,**kw):
    return None if Path(self)==GENERATED else orig_unlink(self,*a,**kw)


trim_cost_bps=_env_nonnegative_bps('QUALITY102_TRIM_COST_BPS',0.0)
try:
    quality102_gross_cap=resolve_quality102_gross_cap(os.environ.get('QUALITY102_GROSS_CAP'))
except ValueError as exc:
    raise SystemExit(str(exc)) from exc
try:
    subprocess.run, Path.unlink = hold_run, hold_unlink
    sys.argv=[str(SOURCE),*orig_argv[1:]]
    runpy.run_path(str(SOURCE),run_name='__main__')
finally:
    subprocess.run, Path.unlink, sys.argv = orig_run, orig_unlink, orig_argv

if not GENERATED.exists() or 'argv' not in captured:
    raise SystemExit('failed to capture generated Quality102 engine')
s=GENERATED.read_text(encoding='utf-8')
crypto_cap_name=_find_cap_name(s,'CRYPTO',2.0)
supp_cap_name=_find_cap_name(s,'SUPP',0.15)
try:
    s=patch_named_numeric_assignment(s,supp_cap_name,expected_old=0.15,new_value=quality102_gross_cap)
except ValueError as exc:
    raise SystemExit(str(exc)) from exc
s=s.replace('"grossCap": 0.15', f'"grossCap": {format(quality102_gross_cap, ".12g")}')

helper_import='from quality102_trim_cost import solve_trim_resize\n'
if helper_import not in s:
    future_matches=list(re.finditer(r'^from __future__ import .*$',s,flags=re.M))
    if future_matches:
        pos=future_matches[-1].end()
        s=s[:pos]+'\n'+helper_import+s[pos+1:]
    else:
        s=helper_import+s

marker='    gross_conflicts: List[dict] = []\n'
replacement=(
    '    gross_conflicts: List[dict] = []\n'
    '    gross_resizes: List[dict] = []\n'
    f'    quality102_trim_cost_bps = {trim_cost_bps!r}\n'
    f'    quality102_configured_gross_cap = {quality102_gross_cap!r}\n'
    '    trim_execution_cost_total_jpy = 0.0\n'
)
if s.count(marker)!=1:
    raise SystemExit(f'gross conflict marker count unexpected: {s.count(marker)}')
s=s.replace(marker,replacement,1)

new_observe='''    def observe_entry(entered_kind: str, ts: int) -> None:
        nonlocal max_v12_positions, max_entry_v12_gross, max_entry_pengu_gross, max_entry_stock_gross, max_entry_crypto_gross, max_entry_total_gross, max_entry_supp_gross, equity, trim_execution_cost_total_jpy
        # Gross caps are sized on the equity snapshot before charging execution
        # friction for the trim caused by this same baseline entry. The cost is
        # then deducted exactly once and compounds into later events.
        sizing_equity = equity
        vg, pg, sg = v12_gross(), pengu_gross(), stock_gross()
        trim_cost_this = 0.0
        if entered_kind != "SUPP_ENTRY" and active_supp is not None:
            old_notional = finite(active_supp.get("entryNotional"))
            ug_before = old_notional / sizing_equity if sizing_equity > 0.0 else 0.0
            resize = solve_trim_resize(
                old_notional_jpy=old_notional,
                equity_jpy=sizing_equity,
                base_total_gross=vg + pg + sg,
                base_crypto_gross=vg + pg,
                total_gross_cap=TOTAL_GROSS_CAP,
                crypto_gross_cap=__CRYPTO_GROSS_CAP__,
                quality_gross_cap=__SUPP_GROSS_CAP__,
                trim_cost_bps=quality102_trim_cost_bps,
            )
            new_notional = finite(resize["notionalAfterJpy"])
            if new_notional < old_notional - 1e-9:
                active_supp["entryNotional"] = max(0.0, new_notional)
                trim_cost_this = finite(resize["trimExecutionCostJpy"])
                gross_resizes.append({
                    "ts": ts,
                    "supplementSymbol": active_supp.get("symbol"),
                    "supplementEntryTs": active_supp.get("entryTs"),
                    "supplementExitTs": active_supp.get("exitTs"),
                    "enteredKind": entered_kind,
                    "baseGross": vg + pg + sg,
                    "baseCryptoGross": vg + pg,
                    "supplementGrossBefore": ug_before,
                    "supplementGrossAfter": finite(resize["sizingQualityGrossAfter"]),
                    "grossHeadroomTotal": finite(resize["totalHeadroomGross"]),
                    "grossHeadroomCrypto": finite(resize["cryptoHeadroomGross"]),
                    "bindingCap": resize["bindingCap"],
                    "notionalBeforeJpy": old_notional,
                    "notionalAfterJpy": new_notional,
                    "trimmedNotionalJpy": finite(resize["trimmedNotionalJpy"]),
                    "trimCostBps": quality102_trim_cost_bps,
                    "trimExecutionCostJpy": trim_cost_this,
                    "sizingEquityJpy": sizing_equity,
                    "equityAfterCostJpy": finite(resize["equityAfterCostJpy"]),
                    "sizingTotalGrossAfter": finite(resize["sizingTotalGrossAfter"]),
                    "sizingCryptoGrossAfter": finite(resize["sizingCryptoGrossAfter"]),
                    "sizingQualityGrossAfter": finite(resize["sizingQualityGrossAfter"]),
                    "economicTotalGrossAfterCost": finite(resize["economicTotalGrossAfterCost"]),
                    "economicCryptoGrossAfterCost": finite(resize["economicCryptoGrossAfterCost"]),
                    "economicQualityGrossAfterCost": finite(resize["economicQualityGrossAfterCost"]),
                })
                stats["SUPPLEMENT_GROSS_RESIZED"] += 1
        ug = finite(active_supp.get("entryNotional")) / sizing_equity if active_supp is not None and sizing_equity > 0.0 else 0.0
        max_v12_positions = max(max_v12_positions, len(active_v12))
        if entered_kind == "V12_ENTRY": max_entry_v12_gross = max(max_entry_v12_gross, vg)
        elif entered_kind == "PENGU_ENTRY": max_entry_pengu_gross = max(max_entry_pengu_gross, pg)
        elif entered_kind == "STOCK_ENTRY": max_entry_stock_gross = max(max_entry_stock_gross, sg)
        if active_supp is not None: max_entry_supp_gross = max(max_entry_supp_gross, ug)
        # Quality102 is a crypto sleeve, so it must consume shared crypto gross.
        crypto_total = vg + pg + ug
        max_entry_crypto_gross = max(max_entry_crypto_gross, crypto_total)
        total = vg + pg + sg + ug
        max_entry_total_gross = max(max_entry_total_gross, total)
        if (total > TOTAL_GROSS_CAP + 1e-9 or crypto_total > __CRYPTO_GROSS_CAP__ + 1e-9 or ug > __SUPP_GROSS_CAP__ + 1e-9) and active_supp is not None:
            gross_conflicts.append({
                "ts": ts,
                "supplementSymbol": active_supp.get("symbol"),
                "supplementEntryTs": active_supp.get("entryTs"),
                "supplementExitTs": active_supp.get("exitTs"),
                "enteredKind": entered_kind,
                "totalGross": total,
                "cryptoGross": crypto_total,
                "supplementGross": ug,
            })
        if trim_cost_this > 0.0:
            equity -= trim_cost_this
            trim_execution_cost_total_jpy += trim_cost_this

'''
new_observe=new_observe.replace('__CRYPTO_GROSS_CAP__',crypto_cap_name).replace('__SUPP_GROSS_CAP__',supp_cap_name)
s,n=re.subn(r'    def observe_entry\(entered_kind: str, ts: int\) -> None:\n.*?(?=    def reset_day\(ts: int\) -> None:)',new_observe,s,count=1,flags=re.S)
if n!=1:
    raise SystemExit('observe patch failed')

old_report='"supplementGrossConflicts": gross_conflicts, "limits":'
new_report='"supplementGrossConflicts": gross_conflicts, "supplementGrossResizes": gross_resizes, "configuredQuality102GrossCap": quality102_configured_gross_cap, "trimExecutionCostBps": quality102_trim_cost_bps, "trimExecutionCostJpy": trim_execution_cost_total_jpy, "grossBasis": "PRE_TRIM_EXECUTION_COST_EQUITY", "quality102CountsTowardCryptoGross": True, "limits":'
if s.count(old_report)!=1:
    raise SystemExit(f'gross report marker count unexpected: {s.count(old_report)}')
s=s.replace(old_report,new_report,1)

old_policy='"entryPolicy": "BASE_IDLE_ONLY_ONE_SLOT_NO_PREEMPT"'
new_policy='"entryPolicy": "BASE_IDLE_ONE_SLOT_BASE_PRIORITY_TOTAL_AND_CRYPTO_RESIDUAL_SHRINK", "resizePnlAccounting": "TRIMMED_NOTIONAL_X_BPS_CHARGED_ONCE", "grossSizingBasis": "PRE_TRIM_EXECUTION_COST_EQUITY", "quality102CountsTowardCryptoGross": True, "configuredQuality102GrossCap": quality102_configured_gross_cap'
if s.count(old_policy)!=1:
    raise SystemExit(f'entry policy marker count unexpected: {s.count(old_policy)}')
s=s.replace(old_policy,new_policy,1)

if 'SUPPLEMENT_GROSS_RESIZED' not in s or 'BASE_IDLE_ONLY_ONE_SLOT_NO_PREEMPT' in s or 'quality102CountsTowardCryptoGross' not in s or 'configuredQuality102GrossCap' not in s:
    raise SystemExit('gross-safe regression guard failed')
GENERATED.write_text(s,encoding='utf-8')
try:
    argv=captured['argv']
    orig_run([sys.executable,str(GENERATED),*argv[2:]],check=True)
finally:
    GENERATED.unlink(missing_ok=True)
