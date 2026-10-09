/** Research-only draft. NOT an authorized production STOP or order gateway. */
import {productionExitSpec} from "./v12-v4-production-lifecycle";
export const V12_V4_TIME_EMERGENCY_RESEARCH_ID =
  "V12_V4_TIME37_FIXED_8PCT_H1_RESEARCH_20261010" as const;
export type V4EmergencyPreview={
 route:string;symbol:string;side:"LONG"|"SHORT";entryFillPrice:number;
 tentativeStopPrice:number;policyId:typeof V12_V4_TIME_EMERGENCY_RESEARCH_ID;
 orderEnabled:false;protectiveOrderPermitted:false;
};
/** No venue normalization, no live execution permission and no user approval. */
export function previewV4TimeEmergencyStop(input:{
 route:string;symbol:string;side:"LONG"|"SHORT";entryFillPrice:number;
 policyId:typeof V12_V4_TIME_EMERGENCY_RESEARCH_ID;
}):V4EmergencyPreview{
 if(input.policyId!==V12_V4_TIME_EMERGENCY_RESEARCH_ID)
  throw Error("V4_TIME_EMERGENCY_POLICY_NOT_RESEARCH_V1");
 if(productionExitSpec(input.route).kind!=="TIME")
  throw Error("V4_TIME_EMERGENCY_NOT_TIME_ROUTE");
 if(!input.symbol||!["LONG","SHORT"].includes(input.side)||
  !(input.entryFillPrice>0)||!Number.isFinite(input.entryFillPrice))
  throw Error("V4_TIME_EMERGENCY_SIGNED_FILL_REQUIRED");
 const tentativeStopPrice=input.entryFillPrice*(input.side==="LONG"?.92:1.08);
 if(!(tentativeStopPrice>0)||!Number.isFinite(tentativeStopPrice))
  throw Error("V4_TIME_EMERGENCY_STOP_INVALID");
 return {...input,tentativeStopPrice,orderEnabled:false,protectiveOrderPermitted:false};
}
