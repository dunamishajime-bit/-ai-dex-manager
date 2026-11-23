const H=3_600_000;
export interface BoundaryBar {timestampMs:number;open:number;close:number}
/** Hourly OPENs are known at their boundary. Never inspect the entry bar close. */
export function causalReturn(rows:readonly BoundaryBar[], entry:{timestampMs:number;open:number}, hours:number):number {
  const then=rows.find(r=>r.timestampMs===entry.timestampMs-hours*H);
  if(!then || !(then.open>0) || !(entry.open>0) || !Number.isFinite(entry.open)) throw new Error('DD1296_CAUSAL_BOUNDARY_MISSING');
  return entry.open/then.open-1;
}
export function q102ExhaustionReason(symbol:string,family:string,side:number,ret72:number|undefined):string|undefined {
  if(symbol==='FETUSDT'&&family==='BRK'&&side===-1) {
    if(ret72===undefined||!Number.isFinite(ret72)) return 'Q102_BRK_FET_SHORT_CAUSAL_DATA_MISSING';
    if(ret72<=-.12+1e-12) return 'Q102_BRK_FET_SHORT_EXHAUSTION';
  }
}
export function v12EntryReason(symbol:string,side:'LONG'|'SHORT',rank:number,asset3:number,btc3:number,asset24:number):string|undefined {
  const sign=side==='LONG'?1:-1,relative=sign*(asset3-btc3);
  if(symbol==='ATOMUSDT'&&relative>=.00603-1e-12) return 'V12_ATOM_EXHAUSTION_CAUSAL';
  if(symbol==='AVAXUSDT'&&rank===1&&side==='SHORT'&&btc3<0&&relative<=-.0075+1e-12) return 'V12_AVAX_R1_SHORT_REBOUND';
  if(symbol==='AVAXUSDT'&&rank===1&&side==='LONG'&&sign*asset24<=.0165+1e-12) return 'V12_AVAX_LONG_WEAK24_CAUSAL';
}
export interface SideLossLedger {LONG?:{losses:number;until:number};SHORT?:{losses:number;until:number};completed?:string[];initializedAt?:number}
/** All finalized exits, including preemption/forced, count once by net realized PNL. */
export function recordSideExit(ledger:SideLossLedger,exit:{id:string;side:'LONG'|'SHORT';netPnl:number;exitTs:number}):void {
  if(!exit.id||!Number.isFinite(exit.netPnl)||!(exit.exitTs>0)) throw new Error('V12_REALIZED_EXIT_EVIDENCE_INVALID');
  if(ledger.completed?.includes(exit.id)) return;
  const row=ledger[exit.side] ||= {losses:0,until:0};
  if(exit.netPnl<0) {row.losses++; if(row.losses>=6) row.until=Math.max(row.until,exit.exitTs+6*H);}
  else if(exit.netPnl>0) row.losses=0;
  ledger.completed=[...(ledger.completed||[]),exit.id];
}
