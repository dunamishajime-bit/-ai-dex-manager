"""New ownership-corrected research baseline; NEVER edits the historical engine.

Pinned source is compiled under a distinct module identity. Only explicitly
audited admission hooks may differ. No deployment, credentials or venue APIs.
"""
from pathlib import Path
import hashlib
import sys
import types
import zipfile

ROOT = Path(__file__).resolve().parents[2]
FROZEN = ROOT / 'docs/research/results/formal-core-ownership-audit-20261003'
ENGINE_SHA = '761d88a34ddda536bcf0a88547b1f438ff58b17086b1a89388dc805df6aeba06'
CORE={'V12','PENGU','Q102','FET','V52'}


def prepare_overlay_batch(rows, active, completed, ts, market, equity, gross, finalize, lifecycle):
    """Only current candidate eligibility and actual portfolio state are read.

    This model has atomic H1 fills, not reconstructed asynchronous LIVE pending
    or snapshot freshness. Consequently this is a diagnostic, not a LIVE cert.
    """
    core_signal=any(r['strategy_id'] in CORE for r in rows)
    idle_signal=any(r['strategy_id']=='IDLE' and r.get('route_selected')
                    and ts>=lifecycle.get(r['symbol'],0) for r in rows)
    for pid,p in list(active.items()):
        if p['strategy_id']=='RESIDUAL' and (core_signal or idle_signal):
            price=market(p['symbol'],ts)
            if price is None:raise ValueError('RESIDUAL_PREEMPT_MARK_MISSING')
            finalize(pid,ts,price,'FORMAL_PRIORITY' if core_signal else 'IDLE_SHORT_PRIORITY')
    core_busy=core_signal or any(p['strategy_id'] in CORE for p in active.values())
    for r in rows:
        if r['strategy_id'] not in {'IDLE','RESIDUAL'}:continue
        reason=None
        if not r.get('overlay_source_current'):reason='SOURCE_INCOMPLETE'
        elif core_busy:reason='CORE_SIGNAL_OR_POSITION'
        elif r['strategy_id']=='IDLE':
            if ts<lifecycle.get(r['symbol'],0):reason='GENERIC_LIFECYCLE_ACTIVE'
            else:
                if r.get('generic_accepted'):lifecycle[r['symbol']]=ts+12*3600000
                if not r.get('route_selected'):reason='GENERIC_ROUTE_NOT_SELECTED'
        elif idle_signal or any(p['strategy_id']=='IDLE' for p in active.values()):reason='IDLE_PRIORITY'
        elif any(p['strategy_id']=='RESIDUAL' for p in active.values()):reason='RESIDUAL_SLOT_OCCUPIED'
        r['_overlay_block']=reason
    idle=[r for r in rows if r['strategy_id']=='IDLE' and not r['_overlay_block']]
    if idle:
        e=equity()
        crypto=sum(gross(p,e) for p in active.values() if p['strategy_id']!='V52')
        total=sum(gross(p,e) for p in active.values())
        if min(3.-crypto,4.25-total)+1e-9<len(idle):
            for r in idle:r['_overlay_block']='MULTI_SIGNAL_CAPACITY_AMBIGUOUS'


def load_ownership_engine(source_bytes=None, source_transform=None):
    archive=FROZEN/'engine-source.zip'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != 'ba39690a3b125f274571132c2992211bee6a30259e7b832cbf27208544ab4a78':
        raise ValueError('ENGINE_ARCHIVE_SHA_MISMATCH')
    with zipfile.ZipFile(archive) as z:
        payload=z.read('portfolio_price_model.py') if source_bytes is None else source_bytes
    if hashlib.sha256(payload).hexdigest()!=ENGINE_SHA:
        raise ValueError('SOURCE_SHA_MISMATCH')
    # Python imports the pinned sibling modules directly from the ZIP; it does
    # not import a writable Desktop module or overwrite historical source.
    package='frozen_formal_replay'
    if package not in sys.modules:
        p=types.ModuleType(package); p.__path__=[str(archive)]; sys.modules[package]=p
    module=types.ModuleType(package+'.live_ownership')
    module.__package__=package
    source=payload.decode('utf-8').replace('\r\n','\n')
    source=source.replace('    v12_cooldown_by_symbol: dict[str, int] = defaultdict(int)',
                          '    overlay_lifecycle = {}\n    v12_cooldown_by_symbol: dict[str, int] = defaultdict(int)')
    batch='            for candidate in rows:\n'
    assert source.count(batch)==1
    source=source.replace(batch,'''            _prepare_overlay(rows, active, completed, ts,
                             lambda symbol,t: _mark(market,symbol,t),
                             lambda: _equity(wallet,active,market,ts),
                             lambda p,e: _gross(p,market,ts,e),finalize_position,overlay_lifecycle)
'''+batch)
    research='                research_cap = _research_risk_cap(candidate, risk_caps)\n'
    source=source.replace(research,'''                if candidate.get("_overlay_block"):
                    reason = f"{strategy}:{candidate['_overlay_block']}"
                    record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts)
                    rejected[reason] += 1
                    continue
'''+research)
    source=source.replace('other is not candidate\n', 'other is not candidate\n                        and other["strategy_id"] in {"V12","PENGU","Q102","FET","V52"}\n')
    source=source.replace('if not (strategy == "V12" and int(candidate.get("rank") or 0) == 3):',
                          'if strategy in {"V12","PENGU","Q102","FET","V52"} and not (strategy == "V12" and int(candidate.get("rank") or 0) == 3):')
    hook='\n                active_same_strategy = [p for p in active.values() if p["strategy_id"] == strategy]\n'
    if source.count(hook)!=1:
        raise ValueError('OWNERSHIP_HOOK_IDENTITY_MISMATCH')
    source=source.replace(hook, '''
                owners = [p for p in active.values() if p["symbol"] == candidate["symbol"]
                          and (p["strategy_id"] != strategy or strategy in {"IDLE","RESIDUAL"})]
                if owners:
                    reason = f"{strategy}:SYMBOL_OWNED_BY_{owners[0]['strategy_id']}"
                    record_decision(candidate, "REJECTED_PORTFOLIO", reason, ts,
                                    owner_candidate_id=owners[0]["candidate_id"],
                                    owner_side=owners[0]["side"])
                    rejected[reason] += 1
                    continue
'''+hook)
    full='                accepted_gross = min(requested, room)\n'
    source=source.replace(full,'''                if strategy in {"IDLE","RESIDUAL"}:
                    if strategy == "RESIDUAL" and any(p["strategy_id"] == "RESIDUAL" for p in active.values()):
                        reason = "RESIDUAL:SLOT_OCCUPIED"
                    elif room + 1e-9 < 1.0:
                        reason = f"{strategy}:FULL_1X_UNAVAILABLE"
                    else:
                        reason = None
                    if reason:
                        record_decision(candidate,"REJECTED_PORTFOLIO",reason,ts)
                        rejected[reason] += 1
                        continue
                    requested = 1.0
'''+full)
    module._prepare_overlay=prepare_overlay_batch
    if source_transform is not None:
        source=source_transform(source)
    exec(compile(source,str(archive)+'!ownership', 'exec'),module.__dict__)
    module.PRIORITY.update(IDLE=5,RESIDUAL=6)
    old_cap=module._strategy_cap
    module._strategy_cap=lambda c: 1. if c['strategy_id'] in {'IDLE','RESIDUAL'} else old_cap(c)
    module.set_priority_policy('PB_REV_HIGHVOL_R2R1')
    module.set_v12_cooldown_hours(2)
    module.set_v12_cooldown_policy('BASE_2H')
    return module
