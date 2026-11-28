/** Research observations only; no authenticated venue or order authority. */
import {readFile,writeFile,rename,mkdir} from "node:fs/promises";
import {dirname} from "node:path";
import {randomUUID} from "node:crypto";
import type {Candidate,P91Input,R21ObservationInput} from "./stable4-research-decision-observation";
const H=3600000,M=300000;
export const OBS_SCHEMA="stable4-market-observation/v1";
export type Snapshot={schema:typeof OBS_SCHEMA;sourceSha:string;mode:"OBSERVATION_ONLY";orderEnabled:false;decisionTs:number;capturedAt:number;r21:{status:"AVAILABLE"|"UNAVAILABLE";candidates:Candidate[]};p91:{status:"AVAILABLE"|"NO_SIGNAL_OR_WINDOW"|"UNAVAILABLE";input?:P91Input}};
const sha=(x:unknown)=>typeof x==="string"&&/^[a-f0-9]{40}$/.test(x);
function validCandidate(c:Candidate,t:number){return c&&typeof c.id==="string"&&c.id.length>0&&/^[A-Z]+USDT$/.test(c.symbol)&&["R21_OLD24","R21_NEW48"].includes(c.route)&&c.ts===t&&c.side==="SHORT"&&c.gross===.3;}
export function validateObservation(s:Snapshot,expectedSha:string,asof:number){
 const t=Math.floor(asof/H)*H;
 if(!s||s.schema!==OBS_SCHEMA||!sha(expectedSha)||s.sourceSha!==expectedSha||s.mode!=="OBSERVATION_ONLY"||s.orderEnabled!==false||!Number.isSafeInteger(s.capturedAt)||s.capturedAt<t||s.capturedAt>asof||s.decisionTs!==t||asof-t>15*60000)throw Error("RESEARCH_OBSERVATION_STALE_OR_INVALID");
 if(!s.r21||!["AVAILABLE","UNAVAILABLE"].includes(s.r21.status)||!Array.isArray(s.r21.candidates)||s.r21.candidates.some(c=>!validCandidate(c,t))||new Set(s.r21.candidates.map(c=>c.id)).size!==s.r21.candidates.length||s.r21.status==="UNAVAILABLE"&&s.r21.candidates.length)throw Error("RESEARCH_R21_OBSERVATION_INVALID");
 if(!s.p91||!["AVAILABLE","NO_SIGNAL_OR_WINDOW","UNAVAILABLE"].includes(s.p91.status))throw Error("RESEARCH_P91_STATUS_INVALID");
 const p=s.p91.input;
 if(s.p91.status==="AVAILABLE"){
  if(!p||p.signalTs!==t||p.asof<t+M||p.asof>s.capturedAt||typeof p.macroBull!=="boolean"||![p.asterPoints,p.binancePoints,p.priorH1Close].every(Number.isFinite)||p.priorH1Close<=0||!Array.isArray(p.bar)||p.bar.length!==6||p.bar[0]!==t||!p.bar.every(Number.isFinite))throw Error("RESEARCH_P91_INPUT_INVALID");
 }else if(p!==undefined)throw Error("RESEARCH_P91_UNEXPECTED_INPUT");
 return s;
}
export async function readObservation(path:string,expectedSha:string,asof:number){
 try{return validateObservation(JSON.parse(await readFile(path,"utf8")),expectedSha,asof);}catch{return undefined;}
}
export async function readR21Observation(path:string,expectedSha:string,asof:number):Promise<R21ObservationInput|undefined>{
 const s=await readObservation(path,expectedSha,asof);
 // This raw observation has no verified durable slot state. Never infer flatness.
 return s?.r21.status==="AVAILABLE"?{candidates:s.r21.candidates}:undefined;
}
export async function readP91Observation(path:string,expectedSha:string,asof:number):Promise<P91Input|undefined>{
 const s=await readObservation(path,expectedSha,asof);
 return s?.p91.status==="AVAILABLE"&&s.p91.input?{...s.p91.input,asof}:undefined;
}
export async function captureObservation(input:{sourceSha:string;now:()=>number;loadR21:(asof:number)=>Promise<Candidate[]|undefined>;loadP91:(asof:number)=>Promise<P91Input|undefined>}):Promise<Snapshot>{
 if(!sha(input.sourceSha))throw Error("RESEARCH_SOURCE_SHA_INVALID");
 const at=input.now(),t=Math.floor(at/H)*H;
 if(at<t+M||at>t+15*60000)throw Error("RESEARCH_CAPTURE_WINDOW");
 const [r,p]=await Promise.allSettled([input.loadR21(at),input.loadP91(at)]);
 const end=input.now();
 const s:Snapshot={schema:OBS_SCHEMA,sourceSha:input.sourceSha,mode:"OBSERVATION_ONLY",orderEnabled:false,decisionTs:t,capturedAt:end,r21:r.status==="fulfilled"&&r.value?{status:"AVAILABLE",candidates:r.value}:{status:"UNAVAILABLE",candidates:[]},p91:p.status==="fulfilled"?(p.value?{status:"AVAILABLE",input:p.value}:{status:"NO_SIGNAL_OR_WINDOW"}):{status:"UNAVAILABLE"}};
 return validateObservation(s,input.sourceSha,end);
}
export async function writeObservation(path:string,s:Snapshot){
 validateObservation(s,s.sourceSha,s.capturedAt);
 await mkdir(dirname(path),{recursive:true});
 const tmp=path+"."+randomUUID()+".tmp";
 await writeFile(tmp,JSON.stringify(s)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});
 await rename(tmp,path);
}
