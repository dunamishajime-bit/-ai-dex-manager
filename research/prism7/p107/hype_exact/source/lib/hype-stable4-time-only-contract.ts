/** Selected research lifecycle; this metadata grants no order or unprotected-position authority. */
export interface HypeH48TimeOnlyContract {
 readonly schemaVersion:1;readonly kind:"H48_TIME_ONLY";readonly route:"HYPE_REDESIGN_CAUSAL_H48R4_WSIG";
 readonly positionId:string;readonly sourceSha:string;readonly logicalEntryTs:number;readonly logicalExitTs:number;
}
export interface HypeH48PolicyEvidence {
 policy:"H48_TIME_ONLY";runtimeSha:string;positionId:string;logicalEntryTs:number;logicalExitTs:number;
 quantity:number;certificateSha256:string;validatedAt:number;expiresAt:number;
}
const HOUR=3600000;
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const time=(v:unknown):v is number=>finite(v)&&Number.isSafeInteger(v)&&v>0;
const text=(v:unknown):v is string=>typeof v==="string"&&!!v&&v===v.trim();
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 return Reflect.ownKeys(value).length===keys.length&&Reflect.ownKeys(value).every(k=>typeof k==="string"&&keys.includes(k)&&"value"in Object.getOwnPropertyDescriptor(value,k)!);
}
export function createHypeH48TimeOnlyContract(identity:{positionId:string;sourceSha:string;logicalEntryTs:number}):HypeH48TimeOnlyContract {
 return validateHypeH48TimeOnlyContract({schemaVersion:1,kind:"H48_TIME_ONLY",route:"HYPE_REDESIGN_CAUSAL_H48R4_WSIG",...identity,logicalExitTs:identity.logicalEntryTs+48*HOUR},identity);
}
export function validateHypeH48TimeOnlyContract(value:unknown,expected:{positionId:string;sourceSha:string;logicalEntryTs:number}):HypeH48TimeOnlyContract {
 if(!exact(value,["schemaVersion","kind","route","positionId","sourceSha","logicalEntryTs","logicalExitTs"])||value.schemaVersion!==1||value.kind!=="H48_TIME_ONLY"||value.route!=="HYPE_REDESIGN_CAUSAL_H48R4_WSIG"||!text(value.positionId)||value.positionId!==expected.positionId||typeof value.sourceSha!=="string"||!/^[a-f0-9]{40}$/.test(value.sourceSha)||value.sourceSha!==expected.sourceSha||!time(value.logicalEntryTs)||value.logicalEntryTs%(6*HOUR)!==0||value.logicalEntryTs!==expected.logicalEntryTs||!time(value.logicalExitTs)||value.logicalExitTs!==value.logicalEntryTs+48*HOUR)throw Error("HYPE_H48_NATIVE_CONTRACT_INVALID");
 return Object.freeze({...value}) as unknown as HypeH48TimeOnlyContract;
}
export function evaluateHypeH48TimeOnlyExit(contract:HypeH48TimeOnlyContract,now:number,boundary?:{openTs:number;open:number;observedAt:number}):{due:false}|{due:true;reason:"HYPE_REDESIGN_TIME48_NEXTOPEN";logicalExitTs:number;referenceOpen:number}{
 const c=validateHypeH48TimeOnlyContract(contract,contract);
 if(!time(now)||now<c.logicalEntryTs)throw Error("HYPE_H48_EXIT_CLOCK_INVALID");
 if(now<c.logicalExitTs)return{due:false};
 if(!boundary||boundary.openTs!==c.logicalExitTs||!finite(boundary.open)||boundary.open<=0||!time(boundary.observedAt)||boundary.observedAt<c.logicalExitTs||boundary.observedAt>now||now-boundary.observedAt>120000)throw Error("HYPE_H48_BOUNDARY_OPEN_UNVERIFIED");
 return{due:true,reason:"HYPE_REDESIGN_TIME48_NEXTOPEN",logicalExitTs:c.logicalExitTs,referenceOpen:boundary.open};
}
export function validateHypeH48PolicyEvidence(value:unknown,input:{contract:HypeH48TimeOnlyContract;quantity:number;now:number}):HypeH48PolicyEvidence {
 const c=validateHypeH48TimeOnlyContract(input.contract,input.contract),now=input.now;
 if(!exact(value,["policy","runtimeSha","positionId","logicalEntryTs","logicalExitTs","quantity","certificateSha256","validatedAt","expiresAt"])||value.policy!=="H48_TIME_ONLY"||value.runtimeSha!==c.sourceSha||value.positionId!==c.positionId||value.logicalEntryTs!==c.logicalEntryTs||value.logicalExitTs!==c.logicalExitTs||!finite(input.quantity)||input.quantity<=0||value.quantity!==input.quantity||typeof value.certificateSha256!=="string"||!/^[a-f0-9]{64}$/.test(value.certificateSha256)||!time(now)||now<c.logicalEntryTs||!time(value.validatedAt)||value.validatedAt>now||now-value.validatedAt>120000||!time(value.expiresAt)||value.expiresAt<=now||value.expiresAt>value.validatedAt+120000)throw Error("HYPE_H48_ROOT_POLICY_EVIDENCE_INVALID");
 return Object.freeze({...value}) as unknown as HypeH48PolicyEvidence;
}
