export type RiskCapDelta={
  runner:"V4"|"HYPE";
  category:string;
  historicalModel:number;
  pinnedSource:number;
  difference:number;
};

type CaseCaps={historical_model:number;pinned_v4_lifecycle:number;delta_x:number};
type HypeCaps={historical_research:number;pinned_hype_stable4:number;delta_x:number};

export type RiskEvidenceV4={
 schema:string;vps_static_lifecycle_source_verified:boolean;
 actual_exchange_gross_excess_verified:boolean;production_bt_parity_certified:boolean;
 caps:Record<string,CaseCaps>;
};
export type RiskEvidenceHYPE={
 schema:string;live_static_source_bytes_verified_from_vps:boolean;
 actual_exchange_gross_limit_breach_verified:boolean;production_bt_parity_certified:boolean;
 comparison:{crypto_stock_total:Record<string,HypeCaps>};
};

function plausible(value:number):boolean{
 return Number.isFinite(value)&&value>0&&value<=10;
}

export function auditedRiskSourceDifferences(hype:RiskEvidenceHYPE,v4:RiskEvidenceV4):RiskCapDelta[]{
 if(hype.schema!=="disdex-bt-hype-source-defined-gross-policy-drift/v1"||
    v4.schema!=="disdex-bt-v4-source-gross-cap-drift/v1"||
    !hype.live_static_source_bytes_verified_from_vps||
    !v4.vps_static_lifecycle_source_verified||
    hype.actual_exchange_gross_limit_breach_verified!==false||
    v4.actual_exchange_gross_excess_verified!==false||
    hype.production_bt_parity_certified!==false||
    v4.production_bt_parity_certified!==false)return [];
 const inputs=[
  {runner:"HYPE" as const,category:"Stock Gross",row:hype.comparison.crypto_stock_total.stockGrossCap},
  {runner:"HYPE" as const,category:"総Gross",row:hype.comparison.crypto_stock_total.totalGrossCap},
 ];
 const output:RiskCapDelta[]=[];
 for(const item of inputs){
  const row=item.row;
  if(!row||!plausible(row.historical_research)||!plausible(row.pinned_hype_stable4)||
     !Number.isFinite(row.delta_x)||Math.abs(row.pinned_hype_stable4-row.historical_research-row.delta_x)>1e-8)return [];
  output.push({runner:item.runner,category:item.category,historicalModel:row.historical_research,
    pinnedSource:row.pinned_hype_stable4,difference:row.delta_x});
 }
 for(const [key,category] of [["v4AggregateGrossCap","V4系合計Gross"],["totalGrossCap","口座総Gross"]] as const){
  const row=v4.caps[key];
  if(!row||!plausible(row.historical_model)||!plausible(row.pinned_v4_lifecycle)||
     !Number.isFinite(row.delta_x)||Math.abs(row.pinned_v4_lifecycle-row.historical_model-row.delta_x)>1e-8)return [];
  output.push({runner:"V4",category,historicalModel:row.historical_model,
   pinnedSource:row.pinned_v4_lifecycle,difference:row.delta_x});
 }
 return output;
}
