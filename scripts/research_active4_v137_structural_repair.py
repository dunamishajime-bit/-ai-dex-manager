from __future__ import annotations
import argparse
import research_active4_v136_lifecycle_repair as v136

# V137: materially distinct structural repairs derived only from V136 Development/Validation diagnostics.
# No Confirmation/Holdout access, no dense sweeps, no threshold/risk/trail retuning.
CANDS={
 'btc_sponsor_persistence_core_v7':('BTC','btc_sponsor_durable_core_v6',.32),
 'btc_dual_horizon_acceptance_v7':('BTC','btc_sponsor_durable_core_v6',.32),
 'eth_relative_persistence_owner_v7':('ETH','eth_relative_anchor_handoff_v6',.30),
 'bnb_consensus_transition_arm_v7':('BNB','bnb_consensus_cash_rearm_v6',.28),
 'avax_persistent_burst_initiation_v7':('AVAX','avax_burst_acceptance_rearm_v6',.18),
}
v136.CANDS.clear(); v136.CANDS.update(CANDS)

_base_signal=v136.signal

def _old(cid): return CANDS[cid][1]

def signal(cid,candles,idx,ts):
    old=_old(cid)
    z=_base_signal(old,candles,idx,ts)
    p12=_base_signal(old,candles,idx,ts-12*v136.v109.HOUR)
    p6=_base_signal(old,candles,idx,ts-6*v136.v109.HOUR)
    q=dict(z)
    if cid=='btc_sponsor_persistence_core_v7':
        # Keep early setup, but Core ownership requires sponsor/continuation persistence across 12h.
        q['continue']=z['continue'] if z['continue'] and p12['continue']==z['continue'] else 0
        # Structural reversal is recognized as soon as either current or prior sponsor-owner flips.
        if z['reverse'] or (p12['continue'] and z['bias']==-p12['continue']): q['reverse']=z['reverse'] or -p12['continue']
    elif cid=='btc_dual_horizon_acceptance_v7':
        # Acceptance needs agreement at both 6h and current horizons; avoids one-bar Core handoff.
        q['continue']=z['continue'] if z['continue'] and p6['bias']==z['continue'] else 0
        q['reentry']=z['reentry'] if z['reentry'] and p6['bias'] in (0,z['reentry']) else 0
    elif cid=='eth_relative_persistence_owner_v7':
        # Preserve selectivity; Core requires relative-anchor ownership to persist across 12h.
        q['continue']=z['continue'] if z['continue'] and p12['bias']==z['continue'] else 0
        q['reentry']=z['reentry'] if z['reentry'] and p6['bias'] in (0,z['reentry']) else 0
        if p12['continue'] and z['bias']==-p12['continue']: q['reverse']=-p12['continue']
    elif cid=='bnb_consensus_transition_arm_v7':
        # V136 was too selective: arm lifecycle on a real consensus transition, while Core remains strict.
        if not z['prewave'] and z['onset'] and p6['bias'] in (0,z['onset']): q['prewave']=z['onset']
        q['continue']=z['continue']
        q['reentry']=z['reentry']
    else:
        # AVAX: faster initiation/re-entry from persistent burst evidence; no numeric threshold loosening.
        if not z['onset'] and z['prewave'] and p6['prewave']==z['prewave']: q['onset']=z['prewave']
        if not z['reentry'] and z['continue'] and p6['bias'] in (0,z['continue']): q['reentry']=z['continue']
        q['continue']=z['continue']
    return q

v136.signal=signal

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--candidate',choices=sorted(CANDS),required=True)
    args=ap.parse_args(); v136.run(args.candidate)
