from __future__ import annotations
import argparse
import research_active4_v140_pair_roles as v140

# V141: materially distinct state-ownership repairs derived ONLY from V140 Development/Validation diagnostics.
# Confirmation/Holdout remain untouched. No dense sweep and no numeric threshold/risk/trail retuning.
ORIG_CANDS=dict(v140.CANDS)
ORIG_SIGNAL=v140.signal
H=v140.H

CANDS={
 'btc_probe_core_handoff_v11':('BTC','btc_breadth_decay_owner',.32),
 'btc_sponsor_reclaim_owner_v11':('BTC','btc_breadth_decay_owner',.32),
 'eth_leadership_persistence_handoff_v11':('ETH','eth_transition_owner',.30),
 'bnb_consensus_pulse_expiry_v11':('BNB','bnb_neutral_compression_release',.28),
 'avax_burst_scout_handoff_v11':('AVAX','avax_burst_scout_handoff',.18),
}
BASE={
 'btc_probe_core_handoff_v11':'btc_wave_sponsorship_handoff_v10',
 'btc_sponsor_reclaim_owner_v11':'btc_reacceleration_owner_v10',
 'eth_leadership_persistence_handoff_v11':'eth_relative_regime_handoff_v10',
 'bnb_consensus_pulse_expiry_v11':'bnb_twoofthree_transition_cash_v10',
 'avax_burst_scout_handoff_v11':'avax_shock_reacceleration_event_v10',
}

v140.CANDS.clear();v140.CANDS.update(CANDS)
v140.v136.CANDS.clear();v140.v136.CANDS.update(CANDS)
v140.v133.CANDS.clear();v140.v133.CANDS.update(CANDS)

def _base(old,candles,idx,ts):
 saved=dict(v140.CANDS)
 try:
  v140.CANDS.clear();v140.CANDS.update(ORIG_CANDS)
  return ORIG_SIGNAL(old,candles,idx,ts)
 finally:
  v140.CANDS.clear();v140.CANDS.update(saved)

def signal(cid,candles,idx,ts):
 old=BASE[cid]
 z=_base(old,candles,idx,ts)
 p6=_base(old,candles,idx,ts-6*H)
 p12=_base(old,candles,idx,ts-12*H)
 q=dict(z)
 if cid=='btc_probe_core_handoff_v11':
  # Separate initiation probe from durable Core ownership; failed probe returns to cash quickly.
  q['prewave']=z['prewave'] or (z['onset'] if p6['prewave']==z['onset'] else 0)
  q['onset']=z['onset'] if z['onset'] and (p6['prewave']==z['onset'] or p6['bias'] in (0,z['onset'])) else 0
  q['continue']=z['continue'] if z['continue'] and (p6['onset']==z['continue'] or p6['continue']==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and p6['continue']==z['reentry'] else 0
  if p6['onset'] and not q['continue'] and z['bias']!=p6['onset']: q['exhaust']=p6['onset']
  if p6['continue'] and z['bias']==-p6['continue']: q['reverse']=-p6['continue']
 elif cid=='btc_sponsor_reclaim_owner_v11':
  # Own only a reclaimed wave after a pullback/reacceleration sequence; no blind persistence of Core.
  q['prewave']=z['prewave']
  q['onset']=z['onset'] if z['onset'] and (p6['prewave']==z['onset'] or p12['bias']==z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and p6['bias']==z['continue'] and (p6['onset']==z['continue'] or p6['continue']==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and p6['continue']==z['reentry'] else 0
  if p6['continue'] and not z['continue'] and z['bias'] in (0,-p6['continue']): q['exhaust']=p6['continue']
  if p6['continue'] and z['bias']==-p6['continue']: q['reverse']=-p6['continue']
 elif cid=='eth_leadership_persistence_handoff_v11':
  # ETH can enter from a persistent leadership handoff, while Core still requires sustained relative ownership.
  q['prewave']=z['prewave']
  if not z['onset'] and z['prewave'] and p6['prewave']==z['prewave'] and z['bias']==z['prewave']:
   q['onset']=z['prewave']
  else:
   q['onset']=z['onset'] if z['onset'] and p6['bias'] in (0,z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and p12['bias']==z['continue'] else 0
  q['reentry']=z['reentry'] if z['reentry'] and p6['bias']==z['reentry'] and p12['bias']==z['reentry'] else 0
  if p12['continue'] and z['bias']!=p12['continue']: q['exhaust']=p12['continue']
  if p6['continue'] and z['bias']==-p6['continue']: q['reverse']=-p6['continue']
 elif cid=='bnb_consensus_pulse_expiry_v11':
  # BNB is tactical: transition pulse may enter, but ownership expires unless consensus follow-through arrives promptly.
  q['prewave']=z['prewave']
  q['onset']=z['onset'] if z['onset'] and p6['bias'] in (0,z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and (p6['onset']==z['continue'] or p6['continue']==z['continue']) else 0
  q['reentry']=0
  if p6['onset'] and not q['continue']: q['exhaust']=p6['onset']
  if p6['continue'] and z['bias']!=p6['continue']: q['exhaust']=p6['continue']
  if p6['continue'] and z['bias']==-p6['continue']: q['reverse']=-p6['continue']
 else:
  # AVAX uses a scout-to-event-owner handoff: persistent shock setup can initiate early, Core only after follow-through.
  q['prewave']=z['prewave']
  if z['prewave'] and p6['prewave']==z['prewave'] and z['bias'] in (0,z['prewave']):
   q['onset']=z['prewave']
  else:
   q['onset']=z['onset'] if z['onset'] and p6['bias'] in (0,z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and (p6['onset']==z['continue'] or p6['continue']==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and p6['bias'] in (0,z['reentry']) else 0
  if p6['onset'] and not q['continue'] and z['bias']!=p6['onset']: q['exhaust']=p6['onset']
  if p6['continue'] and z['bias']==-p6['continue']: q['reverse']=-p6['continue']
 return q

v140.v136.signal=signal
v140.v133.sig=signal

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True)
 args=ap.parse_args();v140.run(args.candidate)
