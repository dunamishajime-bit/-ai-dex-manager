from __future__ import annotations
import argparse
import research_active4_v137_structural_repair as v137

# V138: state-transition repairs derived only from V137 Development/Validation evidence.
# No Confirmation/Holdout access. No threshold/risk/trail retuning and no dense sweep.
OLDSIG=v137.signal
CANDS={
 'btc_shadow_sponsor_acceptance_v8':('BTC','btc_breadth_decay_owner',.32),
 'btc_core_reversal_guard_v8':('BTC','btc_breadth_decay_owner',.32),
 'eth_transition_participation_v8':('ETH','eth_transition_owner',.30),
 'bnb_consensus_retest_cash_v8':('BNB','bnb_neutral_compression_release',.28),
 'avax_burst_reset_reaccel_v8':('AVAX','avax_burst_scout_handoff',.18),
}
BASE={
 'btc_shadow_sponsor_acceptance_v8':'btc_sponsor_persistence_core_v7',
 'btc_core_reversal_guard_v8':'btc_sponsor_persistence_core_v7',
 'eth_transition_participation_v8':'eth_relative_persistence_owner_v7',
 'bnb_consensus_retest_cash_v8':'bnb_consensus_transition_arm_v7',
 'avax_burst_reset_reaccel_v8':'avax_persistent_burst_initiation_v7',
}
H=v137.v136.v109.HOUR
v137.v136.CANDS.clear(); v137.v136.CANDS.update(CANDS)
v137.v136.v133.CANDS.clear(); v137.v136.v133.CANDS.update(CANDS)

def oldsig(old,candles,idx,ts):
    return OLDSIG(old,candles,idx,ts)

def signal(cid,candles,idx,ts):
    old=BASE[cid]
    z=oldsig(old,candles,idx,ts)
    p6=oldsig(old,candles,idx,ts-6*H)
    p12=oldsig(old,candles,idx,ts-12*H)
    q=dict(z)
    if cid=='btc_shadow_sponsor_acceptance_v8':
        # Economic probe waits for a causal sponsor/onset persistence handshake.
        q['onset']=z['onset'] if z['onset'] and p6['bias']==z['onset'] else 0
        q['continue']=z['continue'] if z['continue'] and p12['bias']==z['continue'] else 0
        q['reentry']=z['reentry'] if z['reentry'] and p6['bias']==z['reentry'] else 0
        if p6['onset'] and z['bias']==-p6['onset']: q['reverse']=-p6['onset']
    elif cid=='btc_core_reversal_guard_v8':
        # Preserve valid sponsor capture but shed ownership when medium support disappears.
        q['continue']=z['continue']
        q['reentry']=z['reentry'] if z['reentry'] and p6['bias'] in (0,z['reentry']) else 0
        if p12['continue'] and not z['continue'] and z['bias'] in (0,-p12['continue']):
            q['exhaust']=p12['continue']
        if p6['continue'] and z['bias']==-p6['continue']:
            q['reverse']=-p6['continue']
    elif cid=='eth_transition_participation_v8':
        # Arm lifecycle on a relative-leadership transition, but keep Core ownership selective.
        if not z['prewave'] and z['onset'] and p6['bias'] in (0,z['onset']): q['prewave']=z['onset']
        q['onset']=z['onset'] if z['onset'] and p6['bias'] in (0,z['onset']) else 0
        q['continue']=z['continue'] if z['continue'] and p6['bias']==z['continue'] else 0
        q['reentry']=z['reentry'] if z['reentry'] and p6['bias']==z['reentry'] else 0
        if p12['continue'] and z['bias']==-p12['continue']: q['reverse']=-p12['continue']
    elif cid=='bnb_consensus_retest_cash_v8':
        # Consensus must appear, pause/retest, then re-confirm before ownership; otherwise remain cash.
        q['prewave']=z['prewave'] or (z['onset'] if z['onset'] and p12['bias'] in (0,z['onset']) else 0)
        q['onset']=z['onset'] if z['onset'] and p6['bias']==z['onset'] else 0
        q['continue']=z['continue'] if z['continue'] and p6['bias']==z['continue'] else 0
        q['reentry']=z['reentry'] if z['reentry'] and p6['bias']==z['reentry'] else 0
        if p6['continue'] and z['bias']!=p6['continue']: q['exhaust']=p6['continue']
    else:
        # High-beta burst must reset before causal re-acceleration; no threshold loosening.
        q['onset']=z['onset'] if z['onset'] and (p6['prewave']==z['onset'] or p6['bias'] in (0,-z['onset'])) else 0
        q['continue']=z['continue'] if z['continue'] and p6['bias'] in (0,z['continue']) else 0
        q['reentry']=z['reentry'] if z['reentry'] and p6['bias'] in (0,z['reentry']) else 0
        if p12['continue'] and not z['continue'] and z['bias'] in (0,-p12['continue']): q['exhaust']=p12['continue']
    return q

v137.v136.signal=signal
v137.v136.v133.sig=signal

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--candidate',choices=sorted(CANDS),required=True)
    args=ap.parse_args(); v137.v136.run(args.candidate)
