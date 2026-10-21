/** Approved V4 LONG design; pure logic only. Not connected to order sending. */
import {productionExitSpec,PRODUCTION_EXIT_CATALOG} from "./v12-v4-production-lifecycle";
export const V4_LONG_TIME37_MFE2_ARM=0.02;
export const V4_LONG_TIME37_STOP_INITIAL=-0.08;
export const V4_LONG_TIME37_STOP_ARMED=-0.05;
export const V4_LONG_PROFIT3_FLOOR1_ROUTES=[
 "REC_X09_TIME_48H","REC_X10_TIME_48H","REC_X14_TIME_48H"
] as const;
export type V4LongStage={armed:boolean;peakHigh:number;lastM5OpenTs?:number;armedAt?:number};
export type V4ClosedM5={openTs:number;open:number;high:number;low:number;close:number;observedAt:number};
export function v4LongTimeScope(route:string,side:"LONG"|"SHORT"):boolean{
 return side==="LONG"&&productionExitSpec(route).kind==="TIME";
}
export function v4InitialLongStage():V4LongStage{return {armed:false,peakHigh:0};}
export function v4ObserveLongClosedM5(route:string,side:"LONG"|"SHORT",entryTs:number,
 fill:number,state:V4LongStage,bar:V4ClosedM5):V4LongStage{
 if(!v4LongTimeScope(route,side)||!(fill>0)||!Number.isFinite(fill))
   throw Error("V4_LONG_STOP_SCOPE_OR_FILL_INVALID");
 const duration=300000;
 if(entryTs%duration!==0||bar.openTs%duration!==0||
   bar.openTs+duration>bar.observedAt||bar.openTs<entryTs)
   throw Error("V4_LONG_M5_UNCLOSED");
 if(![bar.open,bar.high,bar.low,bar.close].every(x=>Number.isFinite(x)&&x>0)||
   bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close))
   throw Error("V4_LONG_M5_OHLC_INVALID");
 if(state.armed){
   if(state.armedAt===undefined||state.peakHigh<fill*1.02)
     throw Error("V4_LONG_ARMED_STATE_UNPROVEN");
   return state;
 }
 if(bar.openTs!==(state.lastM5OpenTs===undefined?entryTs:state.lastM5OpenTs+duration))
   throw Error("V4_LONG_M5_GAP");
 const peakHigh=Math.max(state.peakHigh,bar.high);
 return {armed:peakHigh>=fill*1.02,peakHigh,lastM5OpenTs:bar.openTs,
   ...(peakHigh>=fill*1.02?{armedAt:bar.openTs+duration}:{})};
}
export function v4LongDesiredStop(route:string,side:"LONG"|"SHORT",fill:number,state:V4LongStage):number{
 if(!v4LongTimeScope(route,side)||!(fill>0))throw Error("V4_LONG_STOP_SCOPE");
 if(state.armed&&(state.armedAt===undefined||state.peakHigh<fill*1.02))
   throw Error("V4_LONG_STOP_ARM_PROOF_MISSING");
 return fill*(state.armed?0.95:0.92);
}
export function v4AssertNoStopLoosening(oldPrice:number,nextPrice:number):void{
 if(!(oldPrice>0)||!(nextPrice>0)||nextPrice<oldPrice-Math.max(1e-8,oldPrice*1e-8))
   throw Error("V4_LONG_STOP_MUST_NOT_LOOSEN");
}
export function v4LongProfitGuardScope(route:string,side:"LONG"|"SHORT"):boolean{
 return side==="LONG"&&(V4_LONG_PROFIT3_FLOOR1_ROUTES as readonly string[]).includes(route);
}
export function v4LongProfit3Floor1Trigger(route:string,side:"LONG"|"SHORT",fill:number,
 peakHigh:number,priorH1Close:number,penultimateH1Close:number,lastH1Close:number):boolean{
 if(!v4LongProfitGuardScope(route,side))return false;
 if(![fill,peakHigh,priorH1Close,penultimateH1Close,lastH1Close].every(x=>Number.isFinite(x)&&x>0))
   throw Error("V4_LONG_PROFIT_INPUT_INVALID");
 return peakHigh>=fill*1.03 && lastH1Close<=fill*1.01 &&
   lastH1Close<penultimateH1Close&&penultimateH1Close<priorH1Close;
}
if(PRODUCTION_EXIT_CATALOG.filter(x=>x.spec.kind==="TIME").length!==37)
 throw Error("V4_LONG_TIME37_ROUTE_COUNT_DRIFT");
