from __future__ import annotations
import argparse
import research_active4_v143_temporal_handoff as v143

# V144: materially distinct state-routing systems derived ONLY from V143 Development/Validation diagnostics.
# Confirmation/Holdout untouched. No dense sweep and no numeric threshold/risk/trail retuning.
ORIG_SIGNAL = v143.signal
H = v143.H

CANDS = {
 'btc_dual_route_wave_owner_v14': ('BTC','btc_breadth_decay_owner',.32),
 'btc_expansion_checkpoint_cycle_v14': ('BTC','btc_breadth_decay_owner',.32),
 'eth_relative_rotation_state_v14': ('ETH','eth_transition_owner',.30),
 'bnb_consensus_scout_reactivation_v14': ('BNB','bnb_neutral_compression_release',.28),
 'avax_shock_cluster_handoff_v14': ('AVAX','avax_burst_scout_handoff',.18),
}
BASE = {
 'btc_dual_route_wave_owner_v14': 'btc_prewave_sponsor_relay_v13',
 'btc_expansion_checkpoint_cycle_v14': 'btc_expansion_relay_owner_v13',
 'eth_relative_rotation_state_v14': 'eth_relative_impulse_release_v13',
 'bnb_consensus_scout_reactivation_v14': 'bnb_cash_dwell_reactivation_v13',
 'avax_shock_cluster_handoff_v14': 'avax_event_energy_relay_v13',
}

# Engine-facing candidate registry only; production/live registries are never touched.
v143.v142.v141.v140.CANDS.clear(); v143.v142.v141.v140.CANDS.update(CANDS)
v143.v142.v141.v140.v136.CANDS.clear(); v143.v142.v141.v140.v136.CANDS.update(CANDS)
v143.v142.v141.v140.v133.CANDS.clear(); v143.v142.v141.v140.v133.CANDS.update(CANDS)

def _old(cid,candles,idx,ts):
 return ORIG_SIGNAL(BASE[cid],candles,idx,ts)

def signal(cid,candles,idx,ts):
 z=_old(cid,candles,idx,ts)
 p1=_old(cid,candles,idx,ts-H)
 p3=_old(cid,candles,idx,ts-3*H)
 p6=_old(cid,candles,idx,ts-6*H)
 p12=_old(cid,candles,idx,ts-12*H)
 q=dict(z)

 if cid=='btc_dual_route_wave_owner_v14':
  # Two causal routes: PRE-WAVE sponsor relay for early participation OR already-live expansion relay for missed-wave recovery.
  setup=p6['prewave'] or p3['prewave'] or p1['prewave']
  expansion=p6['continue'] or p3['continue'] or p1['continue']
  side=setup or expansion
  q['prewave']=z['prewave'] or (side if side and z['bias'] in (0,side) else 0)
  q['onset']=z['onset'] if z['onset'] and ((setup==z['onset']) or (expansion==z['onset'])) else 0
  q['continue']=z['continue'] if z['continue'] and (p1['onset']==z['continue'] or p1['continue']==z['continue'] or p3['continue']==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and expansion==z['reentry'] and p1['bias'] in (0,z['reentry']) else 0
  if side and z['bias']==-side: q['reverse']=-side
  elif expansion and z['bias']==0 and not q['continue'] and not q['reentry']: q['exhaust']=expansion

 elif cid=='btc_expansion_checkpoint_cycle_v14':
  # Entry may scout an initiated wave, but ownership must pass an expansion checkpoint; one pullback/reclaim cycle can re-arm.
  onset_mem=p6['onset'] or p3['onset'] or p1['onset']
  core_mem=p6['continue'] or p3['continue'] or p1['continue']
  q['prewave']=z['prewave']
  q['onset']=z['onset'] if z['onset'] and (p1['prewave']==z['onset'] or p3['prewave']==z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and onset_mem==z['continue'] and (p1['bias']==z['continue'] or p3['bias']==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and core_mem==z['reentry'] and p1['bias'] in (0,z['reentry']) and p3['bias']==z['reentry'] else 0
  if core_mem and z['bias']==-core_mem: q['reverse']=-core_mem
  elif onset_mem and not q['continue'] and z['bias']==0: q['exhaust']=onset_mem

 elif cid=='eth_relative_rotation_state_v14':
  # ETH is a rotation asset: arm on a fresh relative-leadership state change, own only release+follow-through, then return to Cash.
  prior_side=p12['bias'] or p6['bias']
  fresh=z['onset'] or z['prewave']
  rotation=fresh if fresh and prior_side in (0,-fresh) else 0
  q['prewave']=rotation
  q['onset']=z['onset'] if rotation and z['onset']==rotation and p1['bias'] in (0,rotation) else 0
  q['continue']=z['continue'] if z['continue'] and (p1['onset']==z['continue'] or p3['onset']==z['continue']) and p1['bias']==z['continue'] else 0
  q['reentry']=z['reentry'] if z['reentry'] and p1['continue']==z['reentry'] and p3['bias']==z['reentry'] else 0
  oldcore=p1['continue'] or p3['continue']
  if oldcore and z['bias']==-oldcore: q['reverse']=-oldcore
  elif oldcore and not q['continue'] and not q['reentry']: q['exhaust']=oldcore

 elif cid=='bnb_consensus_scout_reactivation_v14':
  # Cash-default BNB: replace long neutral-dwell requirement with a one-step consensus scout, then demand immediate extension.
  recent_cash=(p3['bias']==0 or p1['bias']==0)
  scout=z['prewave'] or z['onset']
  q['prewave']=scout if recent_cash and scout else 0
  q['onset']=z['onset'] if recent_cash and z['onset'] and p1['bias'] in (0,z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and (p1['onset']==z['continue'] or (p3['onset']==z['continue'] and p1['bias']==z['continue'])) else 0
  q['reentry']=0
  if p1['onset'] and not q['continue'] and z['bias']!=p1['onset']: q['exhaust']=p1['onset']
  if p1['continue'] and z['bias']==-p1['continue']: q['reverse']=-p1['continue']

 else:
  # AVAX event cluster: repeated shock/scout evidence forms a cluster; first re-acceleration enters, renewed energy owns Core, one brief reset may re-enter.
  scouts=[p12['prewave'],p6['prewave'],p3['prewave'],p1['prewave'],z['prewave']]
  side=next((s for s in reversed(scouts) if s),0)
  votes=sum(1 for s in scouts if s==side) if side else 0
  cluster=side if votes>=2 else 0
  q['prewave']=cluster or z['prewave']
  q['onset']=z['onset'] if cluster and z['onset']==cluster and p1['bias'] in (0,cluster) else 0
  q['continue']=z['continue'] if z['continue'] and (p1['onset']==z['continue'] or p1['continue']==z['continue'] or p3['continue']==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and cluster==z['reentry'] and (p1['continue']==z['reentry'] or p3['continue']==z['reentry']) else 0
  event=p1['continue'] or p3['continue']
  if event and z['bias']==-event: q['reverse']=-event
  elif event and not q['continue'] and not q['reentry'] and z['bias']==0: q['exhaust']=event
 return q

v143.v142.v141.v140.v136.signal=signal
v143.v142.v141.v140.v133.sig=signal

if __name__=='__main__':
 ap=argparse.ArgumentParser(); ap.add_argument('--candidate',choices=sorted(CANDS),required=True)
 args=ap.parse_args(); v143.v142.v141.v140.run(args.candidate)
