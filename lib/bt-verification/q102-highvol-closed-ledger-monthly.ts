/**
 * Q102 S1/S2: causal closed-trade research ledger -> original 180d
 * monthly rule selector. No invented monthly rules, stage membership,
 * trade authority, portfolio slots, PnL, or production certification.
 *
 * This function only demonstrates what an evidence-complete CLOSED
 * trade source would supply to the frozen native selector. Current BT
 * page does not yet possess such a complete S1/S2 ledger.
 */
import {
 QUALITY102_DAY_MS,QUALITY102_HOUR_MS,
 quality102HighVolRuleKey,selectQuality102HighVolMonthlyRule,
 type Quality102HighVolRule,type Quality102HighVolMonthlyRuleStats
} from "./pinned-native-q102/disdex-quality102-causal-pipeline";

export type Q102HvClosedResearchTrade={
 id:string;rule:Quality102HighVolRule;openedAtMs:number;
 closedAtMs:number|null;netReturn:number;
};
export type Q102HvClosedResearchLedger={
 kind:"ISOLATED_RESEARCH_COMPLETED_TRADES";
 windowStartMs:number;windowEndMs:number;
 rows:readonly Q102HvClosedResearchTrade[];
};
export type Q102HvMonthlyResearchResult={
 schema:"disdex-bt-q102-180d-closed-research-v1";
 monthStartMs:number;windowStartMs:number;windowEndMs:number;
 sourcePin:"7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f";
 closedTradesEvaluated:number;rulesEvaluated:number;
 sourceOutcome:"MISSING_COMPLETED_LEDGER"|"MISSING_MINIMUM_SAMPLE"|"SELECTED_RESEARCH_ONLY";
 selectedRuleKey:string|null;
 nativeMonthlyRuleSelectedForResearch:boolean;
 verifiedStageMembership:false;liveEntryEnabled:false;
 fills:0;note:string;
};
export function inspectQ102HvClosedTradeMonth(
 monthStartMs:number,ledger:Q102HvClosedResearchLedger|null
):Q102HvMonthlyResearchResult{
 const raw=selectQuality102HighVolMonthlyRule({monthStartTs:monthStartMs,evaluations:[]});
 if(raw.eligible.length!==0||raw.selected!==undefined)
   throw Error("Q102_HV_EMPTY_SOURCE_SELECTOR_CHANGED");
 const start=monthStartMs-180*QUALITY102_DAY_MS;
 const end=monthStartMs-QUALITY102_HOUR_MS;
 const basic:Q102HvMonthlyResearchResult={
  schema:"disdex-bt-q102-180d-closed-research-v1",monthStartMs,
  windowStartMs:start,windowEndMs:end,
  sourcePin:"7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f",
  closedTradesEvaluated:0,rulesEvaluated:0,
  sourceOutcome:"MISSING_COMPLETED_LEDGER",
  selectedRuleKey:null,nativeMonthlyRuleSelectedForResearch:false,
  verifiedStageMembership:false,liveEntryEnabled:false,fills:0,
  note:"No complete causal 180d closed-trade source for S1/S2. The 22d raw HIGH_VOL grid does not produce monthly rules, entries or orders."
 };
 if(!ledger)return basic;
 if(ledger.kind!=="ISOLATED_RESEARCH_COMPLETED_TRADES"||
     ledger.windowStartMs!==start||ledger.windowEndMs!==end)
   throw Error("Q102_HV_EXACT_180D_SOURCE_COVERAGE_REQUIRED");
 if(ledger.rows.length>1_000_000)
   throw Error("Q102_HV_TRAINING_SOURCE_TOO_LARGE");
 const used=new Set<string>();
 const byRule=new Map<string,{rule:Quality102HighVolRule;
   rows:Q102HvClosedResearchTrade[]}>();
 for(const row of ledger.rows){
  if(typeof row.id!=="string"||row.id.length===0||used.has(row.id))
   throw Error("Q102_HV_TRAINING_DUPLICATE_OR_MISSING_TRADE_ID");
  used.add(row.id);
  if(!Number.isSafeInteger(row.openedAtMs)||row.openedAtMs<start||
     row.openedAtMs>end||row.closedAtMs===null||!Number.isSafeInteger(row.closedAtMs)||
     row.closedAtMs<=row.openedAtMs||row.closedAtMs>end)
   throw Error("Q102_HV_TRAINING_FUTURE_OR_OPEN_TRADE");
  if(!Number.isFinite(row.netReturn)||row.netReturn<=-1)
   throw Error("Q102_HV_TRAINING_INVALID_REALIZED_RETURN");
  const key=quality102HighVolRuleKey(row.rule);
  const existing=byRule.get(key)??{rule:row.rule,rows:[]};
  existing.rows.push(row);byRule.set(key,existing);
 }
 const evaluations:Quality102HighVolMonthlyRuleStats[]=[];
 for(const [key,group] of byRule){
   const sorted=group.rows.toSorted((a,b)=>a.closedAtMs!-b.closedAtMs!||
     a.id.localeCompare(b.id));
   let totalReturn=0,wins=0,profit=0,loss=0,
       equity=1,peak=1,worstDD=0,lastExit=start;
   for(const row of sorted){
     const net=row.netReturn;
     totalReturn+=net;
     if(net>0){wins++;profit+=net;}
     else{loss-=net;}
     equity*=1+net;
     peak=Math.max(peak,equity);
     worstDD=Math.min(worstDD,equity/peak-1);
     lastExit=row.closedAtMs!;
   }
   evaluations.push({
     rule:group.rule,trades:sorted.length,wins,
     totalReturn,profitFactor:loss===0?Infinity:profit/loss,
     expectancy:totalReturn/sorted.length,maxDrawdown:worstDD,
     trainingStartTs:start,trainingEndTs:end,
     availableAtTs:lastExit
   });
 }
 const selected=selectQuality102HighVolMonthlyRule({
  monthStartTs:monthStartMs,evaluations
 });
 const ok=selected.selected!==undefined;
 return {...basic,
  closedTradesEvaluated:ledger.rows.length,rulesEvaluated:evaluations.length,
  sourceOutcome:ok?"SELECTED_RESEARCH_ONLY":"MISSING_MINIMUM_SAMPLE",
  selectedRuleKey:ok?selected.selected!.ruleKey:null,
  nativeMonthlyRuleSelectedForResearch:ok,
  note:ok
   ?"Original 180d monthly selector accepted an engineered research ledger. Its rule is NOT promoted to an executable S1/S2 entry: no proven upstream stage IDs, verified historical venue trades, standalone exit parity or admission."
   :"The native 180d selector did not accept any supplied closed-trade rule; fail closed, no entries or fills."
 };
}
