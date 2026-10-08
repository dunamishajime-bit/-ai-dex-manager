"""Research-only V4 quality prune.
Starts from V4 extended F1.75 and removes three persistently weak integrated routes:
- REC_X10_TIME_48H
- REC_Y13_REV_D2_T36
- REC_G5_SLOW_TREND
No LIVE/Production changes.
"""
import contextlib,io,json
from pathlib import Path
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_multilogic_v4_extended_f175 as v4
 import run_v12_multilogic_v3_targetsize_f175_stress as base

ROOT=base.ROOT
OUT=ROOT/'docs/research/results/v12-multilogic-v4-pruned-f175-20261009'
NAME='V4_PRUNED_F175_STRESS'
PRUNE={'REC_X10_TIME_48H','REC_Y13_REV_D2_T36','REC_G5_SLOW_TREND'}

orig_filt=base.filt
def pruned_filt(candidates,name):
 out=orig_filt(candidates,name)
 return [d for d in out if not (d.get('strategy_id')=='V12' and d.get('route') in PRUNE)]

base.OUT=OUT
base.NAME=NAME
base.filt=pruned_filt

if __name__=='__main__':
 OUT.mkdir(parents=True,exist_ok=True)
 base.main()
 protocol=json.load(open(OUT/'protocol.json',encoding='utf-8'))
 protocol.update({
  'v4_quality_prune':True,
  'pruned_routes':sorted(PRUNE),
  'prune_reason':'persistently sub-1 integrated PF across relevant cost scenarios; count buffer sufficient to test removal',
  'live_changes':False,'production_changes':False
 })
 (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
