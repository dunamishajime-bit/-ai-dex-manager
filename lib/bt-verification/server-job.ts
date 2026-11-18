import {createMultiassetH48Replay} from "./multiasset-h48-replay";
import {validateReplay} from "./replay";

export type AllowedSyntheticJob={
 mode:"H48_23SYM_CANDIDATE_RESEARCH_ONLY";
 seed:number;
 scenario:"trend"|"range"|"down"|"volatile";
 costBps:10|30;
};
export function parseAllowedSyntheticJob(value:unknown):AllowedSyntheticJob{
 if(value===null||typeof value!=="object"||Array.isArray(value))
   throw Error("BT_JOB_INVALID_PAYLOAD");
 const payload=value as Record<string,unknown>;
 const keys=Object.keys(payload);
 const allowed=["mode","seed","scenario","costBps"];
 if(keys.length!==allowed.length||keys.some(k=>!allowed.includes(k)))
   throw Error("BT_JOB_FIELDS_INVALID");
 if(payload.mode!=="H48_23SYM_CANDIDATE_RESEARCH_ONLY")
   throw Error("BT_NATIVE_ENGINE_NOT_CONNECTED");
 if(typeof payload.seed!=="number"||!Number.isSafeInteger(payload.seed)||
   payload.seed<0||payload.seed>0xffffffff)throw Error("BT_JOB_SEED_INVALID");
 if(!(["trend","range","down","volatile"] as unknown[]).includes(payload.scenario))
   throw Error("BT_JOB_SCENARIO_INVALID");
 if(payload.costBps!==10&&payload.costBps!==30)
   throw Error("BT_JOB_COST_INVALID");
 return payload as AllowedSyntheticJob;
}
export function computeAllowedSyntheticJob(value:AllowedSyntheticJob){
 const replay=createMultiassetH48Replay(value.seed,value.scenario,value.costBps);
 if(!validateReplay(replay)||replay.mode!=="DEMO"||
   replay.source?.kind!=="SYNTHETIC_MULTI_ASSET_H48_CANDIDATE")
   throw Error("BT_JOB_OUTPUT_FAILED_CLOSED");
 return replay;
}
