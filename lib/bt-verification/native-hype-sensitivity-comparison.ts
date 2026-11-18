import type {ResearchLibraryEntry} from "../server/bt-research-library";

export const NATIVE_HYPE_SENSITIVITY_SOURCE_CASES={
  native:"STABLE4_OPPORTUNITY_PROD_CAPS_20261114_NATIVE_HYPE_TREND_SOURCE_GROSS_20261115_V1",
  noHype:"STABLE4_OPPORTUNITY_PROD_CAPS_20261114_NO_HYPE_SIDECAR_SOURCE_GROSS_20261115_V1",
} as const;

type SensitivityRow={
 bps:10|30;
 native:ResearchLibraryEntry;
 noHype:ResearchLibraryEntry;
 ddDifferencePctPoints:number;
};
export type NativeHypeSensitivityComparison={
 status:"INDEX_ONLY_SENSITIVITY_NOT_VENUE_OR_CAUSAL_PARITY";
 rows:[SensitivityRow,SensitivityRow];
 bothPathsMaxDdOver20:boolean;
 currentV4SourceReplayed:false;
};
const finite=(n:number)=>typeof n==="number"&&Number.isFinite(n);
function valid(item:ResearchLibraryEntry):boolean {
 return (item.bps===10||item.bps===30)&&
  item.sourceMode==="RESEARCH_MODEL_NOT_VENUE_EXECUTION"&&
  item.sourceStatus.includes("NOT_FULL_PRODUCTION_PARITY")&&
  item.initialJpy===10000&&
  finite(item.maxDdPct)&&item.maxDdPct<0&&item.maxDdPct>=-100&&
  finite(item.winRatePct)&&item.winRatePct>=0&&item.winRatePct<=100&&
  finite(item.finalEquityJpy)&&item.finalEquityJpy>0&&
  item.modeledFills>=1&&item.frames>=1000&&
  item.btcCandles===8928&&item.sha256.length===64&&
  item.grossCaps.total===3.5&&
  item.grossCaps.crypto===3.0&&
  item.grossCaps.stock===1.5;
}
function one(items:readonly ResearchLibraryEntry[],caseName:string,bps:10|30) {
 const found=items.filter(x=>x.sourceCase===caseName&&x.bps===bps);
 return found.length===1&&valid(found[0])?found[0]:null;
}
export function buildNativeHypeSensitivityComparison(
 items:readonly ResearchLibraryEntry[]
):NativeHypeSensitivityComparison|null {
 const result:SensitivityRow[]=[];
 for(const bps of [10,30] as const){
  const native=one(items,NATIVE_HYPE_SENSITIVITY_SOURCE_CASES.native,bps);
  const noHype=one(items,NATIVE_HYPE_SENSITIVITY_SOURCE_CASES.noHype,bps);
  if(!native||!noHype)return null;
  if(native.sha256===noHype.sha256||native.id===noHype.id)return null;
  result.push({bps,native,noHype,
    ddDifferencePctPoints:Math.abs(native.maxDdPct)-Math.abs(noHype.maxDdPct)});
 }
 if(result.length!==2)return null;
 return {status:"INDEX_ONLY_SENSITIVITY_NOT_VENUE_OR_CAUSAL_PARITY",
   rows:result as [SensitivityRow,SensitivityRow],
   bothPathsMaxDdOver20:result.every(x=>
      Math.abs(x.native.maxDdPct)>20&&Math.abs(x.noHype.maxDdPct)>20),
   currentV4SourceReplayed:false};
}
