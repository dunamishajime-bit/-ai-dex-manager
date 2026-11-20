import type {StrategyCatalogEntry} from "./replay";

export type ObservedPinSnapshot = {
  schema: string;
  observed_utc: string;
  all_entrypoints_verified: boolean;
  rows: Array<{runner:string;git_commit:string;verified:boolean}>;
};

export type SourcePinResult = {
  logic:string;
  modeledExits:number;
  researchShas:string[];
  observedSha:string|null;
  status:"RESEARCH_SOURCE_DIFFERS"|"SHA_MATCH_NOT_PARITY"|"NO_TRUSTED_OBSERVATION";
};

const SHA=/^[0-9a-f]{40}$/;

export function compareStudyPinsWithObservedVps(
  catalog:readonly StrategyCatalogEntry[],
  evidence:ObservedPinSnapshot,
):SourcePinResult[] {
  const reliable=evidence.schema==="disdex-bt-vps-entrypoint-parity/v1"
    && evidence.all_entrypoints_verified===true
    && Number.isFinite(Date.parse(evidence.observed_utc))
    && evidence.rows.length===8;
  const pins=new Map<string,string>();
  if(reliable){
    for(const row of evidence.rows){
      if(row.verified!==true||!SHA.test(row.git_commit)||pins.has(row.runner)){
        pins.clear();break;
      }
      pins.set(row.runner,row.git_commit);
    }
    if(pins.size!==8)pins.clear();
  }
  return catalog.map(item=>{
    const observedSha=pins.get(item.logic)??null;
    const researchShas=item.sourceRuntimeShas;
    const valid=researchShas.length>0&&researchShas.every(x=>SHA.test(x));
    const status=observedSha&&valid
      ? researchShas.every(x=>x===observedSha)
        ? "SHA_MATCH_NOT_PARITY" as const
        : "RESEARCH_SOURCE_DIFFERS" as const
      : "NO_TRUSTED_OBSERVATION" as const;
    return {logic:item.logic,modeledExits:item.trades,researchShas:[...researchShas],observedSha,status};
  });
}
