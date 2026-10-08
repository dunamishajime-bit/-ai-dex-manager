"""Research-only final V4 candidate.
Base: V4 pruned F1.75.
Additional change: REC_G2_EARLY_BTC_OPPOSE_VOL uses a 6h time exit.
No LIVE/Production changes.
"""
import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
 import run_v12_multilogic_v4_pruned_f175 as pruned

base=pruned.base
s=base.s
ROOT=base.ROOT
H=3600000
OUT=ROOT/'docs/research/results/v12-multilogic-v4-final-f175-20261009'
NAME='V4_FINAL_F175_STRESS'
orig_filt=base.filt

def final_filt(candidates,name):
 out=orig_filt(candidates,name)
 for d in out:
  if d.get('strategy_id')=='V12' and d.get('route')=='REC_G2_EARLY_BTC_OPPOSE_VOL':
   exit_ts=int(d['entry_ts_ms'])+6*H
   b=s.w.bars.get(d['symbol'],{}).get(exit_ts)
   if b is None: continue
   px=float(b['open']);e=float(d['entry_price']);sg=1 if d['side']=='LONG' else -1
   d['exit_ts_ms']=exit_ts
   d['exit_price']=px
   d['exit_reason']='REC_G2_TIME_EXIT_6H'
   d['unit_price_return']=sg*(px/e-1)
 return out

base.OUT=OUT
base.NAME=NAME
base.filt=final_filt

if __name__=='__main__':
 OUT.mkdir(parents=True,exist_ok=True)
 base.main()
 p=json.load(open(OUT/'protocol.json',encoding='utf-8'))
 p.update({
  'final_v4_candidate':True,
  'g2_exit':'6h time exit',
  'g2_reason':'legacy/long exit was sub-1 at 30bps; 6h exit screened positive overall and in both temporal halves at 30bps',
  'live_changes':False,'production_changes':False
 })
 (OUT/'protocol.json').write_text(json.dumps(p,indent=2),encoding='utf-8')
