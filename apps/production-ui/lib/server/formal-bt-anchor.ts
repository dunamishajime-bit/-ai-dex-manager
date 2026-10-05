import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
/** Research anchor only; this does not claim venue/tick-level execution parity. */
export async function loadFormalBtAnchor(root='/home/deploy/disdex-trading/current') {
 const [target,summary,ledger] = await Promise.all([
  readFile(join(root,'docs/implementation/FINAL_PRODUCTION_TARGET_DD1296_20261005.json'),'utf8').then(JSON.parse),
  readFile(join(root,'docs/research/results/dd1296-final-20261005/final-summary.json'),'utf8').then(JSON.parse),
  readFile(join(root,'docs/research/results/dd1296-final-20261005/portfolio-trades.jsonl'),'utf8'),
 ]);
 const rows=ledger.trim().split(/\r?\n/).map(line=>JSON.parse(line));
 const b=target.backtest;
 if(rows.length!==b.closedTrades||summary.closed_trades!==b.closedTrades||summary.final_equity_jpy!==b.finalEquityJpy||summary.profit_factor!==b.profitFactor||Math.abs(summary.maximum_mtm_drawdown*100-b.maximumMtmDrawdownPct)>1e-9||summary.accounting!=='PASS')throw Error('FORMAL_BT_ANCHOR_RECONCILIATION_FAILED');
 return {model:'DD1296_RESEARCH_H1_CAUSAL_NOT_LIVE_TICK_PARITY',roundtripBps:b.costModelRoundTripBps,finalEquityJpy:b.finalEquityJpy,profitFactor:b.profitFactor,maxDrawdownPct:b.maximumMtmDrawdownPct,winRatePct:100*rows.filter(r=>r.total_pnl_jpy>0).length/rows.length,trades:b.closedTrades,accounting:b.accounting,v12Trades:summary.v12_trades,v12Wins:summary.v12_wins,v12WinRatePct:100*summary.v12_wins/summary.v12_trades,period: b.periodUtc,ownershipConflicts:b.ownershipConflicts};
}
