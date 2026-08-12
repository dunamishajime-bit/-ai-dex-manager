from __future__ import annotations
import argparse
import research_active4_v136_lifecycle_repair as v136

# V137: materially distinct structural repairs derived only from V136 Development/Validation diagnostics.
# No Confirmation/Holdout access, no dense sweeps, no threshold/risk/trail retuning.
ORIG_CANDS=dict(v136.CANDS)
ORIG_SIGNAL=v136.signal
CANDS={
 'btc_sponsor_persistence_core_v7':('BTC','btc_sponsor_durable_core_v6',.32),
 'btc_dual_horizon_acceptance_v7':('BTC','btc_sponsor_durable_core_v6',.32),
 'eth_relative_persistence_owner_v7':('ETH','eth_relative_anchor_handoff_v6',.30),
 'bnb_consensus_transition_arm_v7':('BNB','bnb_consensus_cash_rearm_v6',.28),
 'avax_persistent_burst_initiation_v7':('AVAX','avax_burst_acceptance_rearm_v6',.18),
}
v136.CANDS.clear(); v136.CANDS.update(CANDS)

def _base(old,candles,idx,ts):
    # Original V136 signal needs its own catalog. Swap only for the duration of this pure signal call.
    saved=dict(v136.CANDS)
    try:
        v136.CANDS.clear(); v136.CANDS.update(ORIG_CANDS)
        return ORIG_SIGNAL(old,candles,idx,ts)
    finally:
        v136.CANDS.clear(); v136.CANDS.update(saved)

def _old(cid): return CANDS[cid][1]

def signal(cid,candles,idx,ts):
    old=_old(cid)
    z=_base(old,candles,idx,ts)
    p12=_base(old,candles,idx,ts-12*v136.v109.HOUR)
    p6=_base(old,candles,idx,ts-6*v136.v109.HOUR)
    q=dict(z)
    if cid=='btc_sponsor_persistence_core_v7':
        q['continue']=z['continue'] if z['continue'] and p12['continue']==z['continue'] else 0
        if z['reverse'] or (p12['continue'] and z['bias']==-p12['continue']): q['reverse']=z['reverse'] or -p12['continue']
    elif cid=='btc_dual_horizon_acceptance_v7':
        q['continue']=z['continue'] if z['continue'] and p6['bias']==z['continue'] else 0
        q['reentry']=z['reentry'] if z['reentry'] and p6['bias'] in (0,z['reentry']) else 0
    elif cid=='eth_relative_persistence_owner_v7':
        q['continue']=z['continue'] if z['continue'] and p12['bias']==z['continue'] else 0
        q['reentry']=z['reentry'] if z['reentry'] and p6['bias'] in (0,z['reentry']) else 0
        if p12['continue'] and z['bias']==-p12['continue']: q['reverse']=-p12['continue']
    elif cid=='bnb_consensus_transition_arm_v7':
        if not z['prewave'] and z['onset'] and p6['bias'] in (0,z['onset']): q['prewave']=z['onset']
        q['continue']=z['continue']; q['reentry']=z['reentry']
    else:
        if not z['onset'] and z['prewave'] and p6['prewave']==z['prewave']: q['onset']=z['prewave']
        if not z['reentry'] and z['continue'] and p6['bias'] in (0,z['continue']): q['reentry']=z['continue']
        q['continue']=z['continue']
    return q

v136.signal=signal

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--candidate',choices=sorted(CANDS),required=True)
    args=ap.parse_args(); v136.run(args.candidate)
