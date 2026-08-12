from __future__ import annotations
import argparse
import research_active4_v142_lifecycle_memory as v142

# V143: materially distinct temporal-handoff systems derived ONLY from V142 Development/Validation diagnostics.
# Confirmation/Holdout untouched. No dense sweep and no numeric threshold/risk/trail retuning.
ORIG_CANDS=dict(v142.CANDS)
ORIG_SIGNAL=v142.signal
H=v142.H

CANDS={
 'btc_prewave_sponsor_relay_v13':('BTC','btc_breadth_decay_owner',.32),
 'btc_expansion_relay_owner_v13':('BTC','btc_breadth_decay_owner',.32),
 'eth_relative_impulse_release_v13':('ETH','eth_transition_owner',.30),
 'bnb_cash_dwell_reactivation_v13':('BNB','bnb_neutral_compression_release',.28),
 'avax_event_energy_relay_v13':('AVAX','avax_burst_scout_handoff',.18),
}
BASE={
 'btc_prewave_sponsor_relay_v13':'btc_wave_memory_handoff_v12',
 'btc_expansion_relay_owner_v13':'btc_pullback_reclaim_cycle_v12',
 'eth_relative_impulse_release_v13':'eth_leadership_retest_reclaim_v12',
 'bnb_cash_dwell_reactivation_v13':'bnb_consensus_impulse_extension_v12',
 'avax_event_energy_relay_v13':'avax_shock_reset_rearm_v12',
}

v142.v141.v140.CANDS.clear();v142.v141.v140.CANDS.update(CANDS)
v142.v141.v140.v136.CANDS.clear();v142.v141.v140.v136.CANDS.update(CANDS)
v142.v141.v140.v133.CANDS.clear();v142.v141.v140.v133.CANDS.update(CANDS)

def _base(old,candles,idx,ts):
 saved=dict(v142.CANDS)
 try:
  v142.CANDS.clear();v142.CANDS.update(ORIG_CANDS)
  return ORIG_SIGNAL(old,candles,idx,ts)
 finally:
  v142.CANDS.clear();v142.CANDS.update(saved)

def signal(cid,candles,idx,ts):
 old=BASE[cid]
 z=_base(old,candles,idx,ts)
 p1=_base(old,candles,idx,ts-H)
 p3=_base(old,candles,idx,ts-3*H)
 p6=_base(old,candles,idx,ts-6*H)
 p12=_base(old,candles,idx,ts-12*H)
 q=dict(z)
 if cid=='btc_prewave_sponsor_relay_v13':
  # Preserve PRE-WAVE memory, but relay into initiation on fresh directional recovery before late Core confirmation.
  relay=p6['prewave'] or p3['prewave'] or p1['prewave']
  q['prewave']=relay if relay and z['bias'] in (0,relay) else z['prewave']
  q['onset']=z['onset'] if z['onset'] and relay==z['onset'] and p1['bias'] in (0,z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and (p1['onset']==z['continue'] or p3['onset']==z['continue'] or p3['continue']==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and p3['continue']==z['reentry'] else 0
  if relay and z['bias']==-relay: q['reverse']=-relay
  elif p3['onset'] and not q['continue'] and z['bias']==0: q['exhaust']=p3['onset']
 elif cid=='btc_expansion_relay_owner_v13':
  # Compression/initiated wave must hand off into expansion quickly; later pullback may re-enter only while expansion memory survives.
  initiated=p3['onset'] or p6['onset']
  expanded=p1['continue'] or p3['continue'] or p6['continue']
  q['prewave']=z['prewave']
  q['onset']=z['onset'] if z['onset'] and (p1['prewave']==z['onset'] or p3['prewave']==z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and (initiated==z['continue'] or expanded==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and expanded==z['reentry'] and p1['bias'] in (0,z['reentry']) else 0
  if expanded and z['bias']==-expanded: q['reverse']=-expanded
  elif expanded and not q['continue'] and not q['reentry'] and z['bias']==0: q['exhaust']=expanded
 elif cid=='eth_relative_impulse_release_v13':
  # ETH owns only a fresh relative-leadership impulse: handoff -> immediate release -> selective expansion; no late persistence chase.
  handoff=p6['prewave'] or p3['prewave'] or p3['onset']
  q['prewave']=z['prewave'] or (handoff if handoff and p1['bias'] in (0,handoff) else 0)
  q['onset']=z['onset'] if z['onset'] and handoff==z['onset'] and p1['bias'] in (0,z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and (p1['onset']==z['continue'] or p3['onset']==z['continue']) and p1['bias']==z['continue'] else 0
  q['reentry']=z['reentry'] if z['reentry'] and p3['continue']==z['reentry'] and p1['bias']==z['reentry'] else 0
  if p3['continue'] and z['bias']==-p3['continue']: q['reverse']=-p3['continue']
  elif (p3['onset'] or p6['onset']) and not q['continue'] and z['bias']==0: q['exhaust']=p3['onset'] or p6['onset']
 elif cid=='bnb_cash_dwell_reactivation_v13':
  # BNB default cash. A trade is armed only when consensus reactivates after a genuine neutral/cash dwell, then must extend immediately.
  neutral_dwell=(p12['bias']==0 and p6['bias']==0) or (p6['bias']==0 and p3['bias']==0)
  q['prewave']=z['prewave'] if neutral_dwell else 0
  q['onset']=z['onset'] if neutral_dwell and z['onset'] and p1['bias'] in (0,z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and (p1['onset']==z['continue'] or p3['onset']==z['continue']) else 0
  q['reentry']=0
  if p1['onset'] and not q['continue'] and z['bias']!=p1['onset']: q['exhaust']=p1['onset']
  if p1['continue'] and z['bias']==-p1['continue']: q['reverse']=-p1['continue']
 elif cid=='avax_event_energy_relay_v13':
  # High-beta event: shock/scout memory may relay into fast re-acceleration, but Core exists only while event energy is renewed bar-to-bar.
  scout=p12['prewave'] or p6['prewave'] or p3['prewave']
  q['prewave']=z['prewave'] or (scout if scout and p1['bias'] in (0,scout) else 0)
  q['onset']=z['onset'] if z['onset'] and scout==z['onset'] and p1['bias'] in (0,z['onset']) else 0
  q['continue']=z['continue'] if z['continue'] and (p1['onset']==z['continue'] or p1['continue']==z['continue']) else 0
  q['reentry']=z['reentry'] if z['reentry'] and p1['continue']==z['reentry'] and p1['bias']==z['reentry'] else 0
  if p1['continue'] and not q['continue'] and not q['reentry']: q['exhaust']=p1['continue']
  if p1['continue'] and z['bias']==-p1['continue']: q['reverse']=-p1['continue']
 return q

v142.v141.v140.v136.signal=signal
v142.v141.v140.v133.sig=signal

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--candidate',choices=sorted(CANDS),required=True)
 args=ap.parse_args();v142.v141.v140.run(args.candidate)
