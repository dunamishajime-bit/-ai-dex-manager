"""Descriptive post-trade H1 bounds, never used as entry features."""
from pathlib import Path
import json
import run_wr60_new_model as w
def main():
 w.load_bars()
 trades=w.base.rows(w.PRIOR/'cases/Q_RET14_DELTA/runs/PRICE_MODEL_10BPS/portfolio-trades.jsonl.gz')
 stats={}
 for sid in sorted({t['strategy_id'] for t in trades}):
  rows=[]
  for t in [x for x in trades if x['strategy_id']==sid]:
   e=t['entry_price'];sg=1 if t['side']=='LONG' else -1
   bars=[w.bars.get(t['symbol'],{}).get(h) for h in range(t['entry_ts_ms'],t['exit_ts_ms'],w.H)]
   expected=len(bars);present=[b for b in bars if b]
   mfe=max([0]+[b['high']/e-1 if sg==1 else 1-b['low']/e for b in present]) if present else None
   mae=min([0]+[b['low']/e-1 if sg==1 else 1-b['high']/e for b in present]) if present else None
   ret=sg*(t['exit_price']/e-1)
   rows.append({'symbol':t['symbol'],'side':t['side'],'entry_ts_ms':t['entry_ts_ms'],'exit_ts_ms':t['exit_ts_ms'],'exit_reason':t['exit_reason_actual'],'mfe_h1_bound':mfe,'mae_h1_bound':mae,'final_remaining_price_return':ret,'giveback_h1_bound':mfe-ret if mfe is not None else None,'bars_expected':expected,'bars_covered':len(present),'net_usd':t['total_pnl_jpy'],'gross_positive_net_loss':t['price_pnl']>0 and t['total_pnl_jpy']<=0})
  known=[f for f in rows if f['mfe_h1_bound'] is not None]
  stats[sid]={'trades':len(rows),'coverage_trades':len(known),'gross_positive_net_loss':sum(f['gross_positive_net_loss'] for f in rows),'mfe1pct_net_loss_h1_bound':sum(f['mfe_h1_bound']>=.01 and f['net_usd']<0 for f in known),'mean_mfe_h1_bound':sum(f['mfe_h1_bound'] for f in known)/len(known) if known else None,'mean_giveback_h1_bound':sum(f['giveback_h1_bound'] for f in known)/len(known) if known else None,'rows':rows}
 out={'scope':'POST_TRADE_DESCRIPTIVE_ONLY; NOT_ENTRY_FEATURES','limitations':['H1 bar extrema include unknown intrabar ordering and can extend past actual intrabar exit; these are bounds, not tick MFE/MAE','No coverage yields null, including V52 Yahoo reference trades without matched Aster hourly bars','Price-return giveback measures final remaining exit; partial exits require full realized ledger to measure profit capture'],'strategies':stats}
 (w.OUT/'baseline-mfe-giveback.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
 print({sid:{k:v for k,v in a.items() if k!='rows'} for sid,a in stats.items()})
if __name__=='__main__':main()
