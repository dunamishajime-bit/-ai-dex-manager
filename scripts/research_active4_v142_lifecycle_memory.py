from __future__ import annotations
import argparse
import research_active4_v141_state_ownership as v141

# V142: materially distinct lifecycle-memory systems derived ONLY from V141 Development/Validation diagnostics.
# Confirmation/Holdout remain untouched. No dense sweep; no numeric threshold/risk/trail retuning.
ORIG_CANDS=dict(v141.CANDS)
ORIG_SIGNAL=v141.signal
H=v141.H

CANDS={
 'btc_wave_memory_handoff_v12':('BTC','btc_breadth_decay_owner',.32),
 'btc_pullback_reclaim_cycle_v12':('BTC','btc_breadth_decay_owner',.32),
 'eth_leadership_retest_reclaim_v12':('ETH','eth_transition_owner',.30),
 'bnb_consensus_impulse_extension_v12':('BNB','bnb_neutral_compression_release',.28),
 'avax_shock_reset_rearm_v12':('AVAX','avax_burst_scout_handoff',.18),
}
BASE={
 'btc_wave_memory_handoff_v12':'btc_probe_core_handoff_v11',
 'btc_pullback_reclaim_cycle_v12':'btc_sponsor_reclaim_owner_v11',
 'eth_leadership_retest_reclaim_v12':'eth_leadership_persistence_handoff_v11',
 'bnb_consensus_impulse_extension_v12':'bnb_consensus_pulse_expiry_v11',
 'avax_shock_reset_rearm_v12':'avax_burst_scout_handoff_v11',
}

v141.v140.CANDS.clear();v141.v140.CANDS.update(CANDS)
v141.v140.v136.CANDS.clear();v141.v140.v136.CANDS.update(CANDS)
v141.v140.v133.CANDS.clear();v141.v140.v133.CANDS.update(CANDS)

def _base(old,candles,idx,ts):
 saved=dict(v141.CANDS)
 try:
  v141.CANDS.clear();v141.CANDS.update(ORIG_CANDS)
  return ORIG_SIGNAL(old,candles,idx,ts)
 finally:
  v141.CANDS.clear();v141.CANDS.update(saved)

def signal(cid,candles,idx,ts):
 old=BASE[cid]
 z=_base(old,candles,idx,ts)
 p3=_base(old,candles,idx,ts-3*H)
 p6=_base(old,candles,idx,ts-6*H)
 p12=_base(old,candles,idx,ts-12*H)
 q=dict(z)
 if cid=='btc_wave_memory_handoff_v12':
  # PRE-WAVE memory -> probe -> Core handoff; a single transient loss does not erase a valid wave memory.
  remembered = z['prewave'] or p3['prewave'] or p6['prewave']
  q['prewave']=remembered if remembered and z['bias'] in (0,remembered) else z['prewave']
  q['onset']=z['onset'] if z['onset'] and remembered==z['onset'] else 0
  q['continue']=z['continue'] if z['continue'] and (p3['onset']==z['continue'] or p6['continue']==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and (p3['continue']==z['reentry'] or p6['continue']==z['reentry']) else 0
  if p3['onset'] and not q['continue'] and z['bias']==-p3['onset']: q['reverse']=-p3['onset']
  elif p6['onset'] and not q['continue'] and z['bias']==0: q['exhaust']=p6['onset']
 elif cid=='btc_pullback_reclaim_cycle_v12':
  # Own only full wave cycles: established Core -> pullback -> sponsor reclaim -> re-entry/continuation.
  owner=p6['continue'] or p12['continue']
  q['prewave']=z['prewave']
  q['onset']=z['onset'] if z['onset'] and p6['prewave']==z['onset'] else 0
  q['continue']=z['continue'] if z['continue'] and (p3['onset']==z['continue'] or owner==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and owner==z['reentry'] and p3['bias'] in (0,z['reentry']) else 0
  if owner and z['bias']==-owner: q['reverse']=-owner
  elif owner and z['continue']==0 and z['reentry']==0 and p3['bias'] not in (owner,): q['exhaust']=owner
 elif cid=='eth_leadership_retest_reclaim_v12':
  # ETH leadership must hand off, retest without reversal, then reclaim before Core ownership.
  handoff=p12['prewave'] or p12['onset'] or p6['prewave']
  reclaim=z['onset'] or z['continue']
  q['prewave']=z['prewave'] or (handoff if handoff and p6['bias'] in (0,handoff) else 0)
  q['onset']=z['onset'] if z['onset'] and handoff==z['onset'] and p3['bias'] in (0,z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and reclaim==z['continue'] and p6['bias']==z['continue'] else 0
  q['reentry']=z['reentry'] if z['reentry'] and p6['continue']==z['reentry'] and p3['bias'] in (0,z['reentry']) else 0
  if p6['continue'] and z['bias']==-p6['continue']: q['reverse']=-p6['continue']
  elif p12['continue'] and z['bias']==0 and z['continue']==0: q['exhaust']=p12['continue']
 elif cid=='bnb_consensus_impulse_extension_v12':
  # Tactical BNB: ignore one-bar pulse; own only a consensus impulse that extends from onset into follow-through, then expire to cash.
  q['prewave']=z['prewave']
  q['onset']=z['onset'] if z['onset'] and p3['bias'] in (0,z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and (p3['onset']==z['continue'] or p3['continue']==z['continue']) else 0
  q['reentry']=0
  if p3['onset'] and z['continue']==0 and z['bias']!=p3['onset']: q['exhaust']=p3['onset']
  if p3['continue'] and z['bias']==-p3['continue']: q['reverse']=-p3['continue']
 elif cid=='avax_shock_reset_rearm_v12':
  # High-beta event memory: shock scout -> reset/cash -> causal re-arm -> short event Core; late persistence is not owned.
  scout=p6['prewave'] or p12['prewave']
  q['prewave']=z['prewave']
  q['onset']=z['onset'] if z['onset'] and scout==z['onset'] and p3['bias'] in (0,z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and (p3['onset']==z['continue'] or p3['continue']==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and p3['continue']==z['reentry'] else 0
  if p3['continue'] and z['continue']==0 and z['reentry']==0: q['exhaust']=p3['continue']
  if p3['continue'] and z['bias']==-p3['continue']: q['reverse']=-p3['continue']
 return q

v141.v140.v136.signal=signal
v141.v140.v133.sig=signal

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True)
 args=ap.parse_args();v141.v140.run(args.candidate)
