import type {ResearchLibraryEntry} from "@/lib/server/bt-research-library";

/** Research-only comparison. Never imply that either case is production certified. */
export const STABLE4_BASELINE_CASES={
 research:"STABLE4_HYPE6_Q102_DUALHEALTH_VALIDATION_20261114",
 capped:"STABLE4_OPPORTUNITY_PROD_CAPS_20261114"
} as const;
export type Stable4Pair={
 costBps:10|30;
 research:ResearchLibraryEntry;
 capped:ResearchLibraryEntry;
 finalDifferenceJpy:number;
 ddDifferencePoints:number;
};
function sameCaps(x:ResearchLibraryEntry,cap:{total:number;crypto:number;stock:number}){
 return x.grossCaps.total===cap.total&&x.grossCaps.crypto===cap.crypto&&x.grossCaps.stock===cap.stock;
}
export function buildStable4BaselineComparison(items:readonly ResearchLibraryEntry[]):Stable4Pair[]|null{
 const out:Stable4Pair[]=[];
 for(const costBps of [10,30] as const){
  const high=items.filter(x=>x.sourceCase===STABLE4_BASELINE_CASES.research&&x.bps===costBps);
  const capped=items.filter(x=>x.sourceCase===STABLE4_BASELINE_CASES.capped&&x.bps===costBps);
  if(high.length!==1||capped.length!==1)return null;
  const a=high[0],b=capped[0];
  if(!sameCaps(a,{total:4.25,crypto:3,stock:4})||
     !sameCaps(b,{total:3.5,crypto:3,stock:1.5})||
     ![a,b].every(x=>x.sourceMode==="RESEARCH_MODEL_NOT_VENUE_EXECUTION"&&
       x.initialJpy===10_000&&Number.isFinite(x.finalEquityJpy)&&
       x.finalEquityJpy>=0&&Number.isFinite(x.maxDdPct)&&
       x.maxDdPct<=0&&x.maxDdPct>=-100&&
       /^[a-f0-9]{64}$/.test(x.sha256)&&x.bytes>0&&x.modeledFills>=0))
    return null;
  out.push({costBps,research:a,capped:b,
    finalDifferenceJpy:a.finalEquityJpy-b.finalEquityJpy,
    ddDifferencePoints:a.maxDdPct-b.maxDdPct});
 }
 return out;
}
