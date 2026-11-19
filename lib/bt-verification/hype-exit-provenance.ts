export type HypeH48ExitSummary={
 bps:10|30;
 candidateCount:number;
 researchStopCount:number;
 historicalWinPct:number;
 timeOnlyWinPct:number;
 historicalWorstPct:number;
 timeOnlyWorstPct:number;
 worstDeltaPctPoints:number;
};

type Report={
 schema:string;actual_execution_count_verified:boolean;
 historical_research_selected_hype_count_exhaustive_of_pinned_pure_signal:boolean;
 preemption_and_competing_runner_priority_replayed:boolean;
 cross_runner_portfolio_shared_risk_gross_replayed:boolean;
 funding_real_slippage_and_order_lifecycle_replayed:boolean;
 max_drawdown_computed:boolean;
 production_bt_parity_certified:boolean;
 scenarios:Record<string,{
   research_model_candidates:number;old_model_stop_count:number;
   old_standalone_win_rate_pct:number;hypothetical_time_only_win_rate_pct:number;
   old_standalone_worst_trade_return_net_pct:number;
   hypothetical_time_only_worst_trade_return_net_pct:number;
   rows:Array<{old_model_exit_reason:string;modeled_entry_utc:string}>;
 }>;
};

function finitePct(x:number):boolean{return Number.isFinite(x)&&Math.abs(x)<=10000;}

export function safeStandaloneH48ExitComparison(input:Report):HypeH48ExitSummary[]|null{
 if(input.schema!=="disdex-bt-hype-h48-exit-standalone-counterfactual/v1"||
    input.actual_execution_count_verified!==false||
    input.historical_research_selected_hype_count_exhaustive_of_pinned_pure_signal!==false||
    input.preemption_and_competing_runner_priority_replayed!==false||
    input.cross_runner_portfolio_shared_risk_gross_replayed!==false||
    input.funding_real_slippage_and_order_lifecycle_replayed!==false||
    input.max_drawdown_computed!==false||
    input.production_bt_parity_certified!==false)return null;
 const output:HypeH48ExitSummary[]=[];
 for(const bps of [10,30] as const){
  const row=input.scenarios[String(bps)];
  if(!row||row.research_model_candidates!==27||row.old_model_stop_count!==6||
     !Array.isArray(row.rows)||row.rows.length!==27||
     new Set(row.rows.map(x=>x.modeled_entry_utc)).size!==27||
     row.rows.filter(x=>x.old_model_exit_reason==="STOP").length!==6||
     row.rows.some(x=>x.old_model_exit_reason!=="STOP"&&x.old_model_exit_reason!=="TIME")||
     !finitePct(row.old_standalone_win_rate_pct)||
     !finitePct(row.hypothetical_time_only_win_rate_pct)||
     row.old_standalone_win_rate_pct<0||row.old_standalone_win_rate_pct>100||
     row.hypothetical_time_only_win_rate_pct<0||row.hypothetical_time_only_win_rate_pct>100||
     !finitePct(row.old_standalone_worst_trade_return_net_pct)||
     !finitePct(row.hypothetical_time_only_worst_trade_return_net_pct))return null;
  output.push({
   bps,candidateCount:27,researchStopCount:6,
   historicalWinPct:row.old_standalone_win_rate_pct,
   timeOnlyWinPct:row.hypothetical_time_only_win_rate_pct,
   historicalWorstPct:row.old_standalone_worst_trade_return_net_pct,
   timeOnlyWorstPct:row.hypothetical_time_only_worst_trade_return_net_pct,
   worstDeltaPctPoints:Number((row.hypothetical_time_only_worst_trade_return_net_pct-row.old_standalone_worst_trade_return_net_pct).toFixed(4)),
  });
 }
 return output;
}
