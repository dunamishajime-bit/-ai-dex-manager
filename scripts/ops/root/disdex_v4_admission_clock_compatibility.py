"""Recognize only the audited forward V4 admission-clock classification repair.

This is source compatibility evidence, never trading permission. Source parity,
signed venue/owner proof, risk, activation, and real decision-cycle gates remain
mandatory. Any unrelated changed byte, missing check, different timeout, repeated
block, or reverse transition fails. Historical journal and economics stay intact.
"""
OLD_CLOCK = b'''  if(!Number.isFinite(observedAtMs)||observedAtMs<input.ts||observedAtMs-input.ts>15*60_000||
    observedAtMs<(state.journal.at(-1)?.ts??0))throw Error("ENTRY_LIVE_OBSERVATION_STALE_OR_REVERSED");
'''
NEW_CLOCK = b'''  if(!Number.isFinite(observedAtMs)||observedAtMs<input.ts||
    observedAtMs<(state.journal.at(-1)?.ts??0))throw Error("ENTRY_LIVE_OBSERVATION_STALE_OR_REVERSED");
  if(observedAtMs-input.ts>15*60_000)throw Error("ENTRY_LIVE_OBSERVATION_EXPIRED");
'''

def economic_source_equal(prior: bytes, candidate: bytes) -> bool:
    prior=prior.replace(b'\r\n',b'\n')
    candidate=candidate.replace(b'\r\n',b'\n')
    if prior==candidate:return True
    return (prior.count(OLD_CLOCK)==1 and candidate.count(NEW_CLOCK)==1
            and candidate.replace(NEW_CLOCK,OLD_CLOCK)==prior)
