/** Read-only systemd attestation of peer runner service identity.
 * The V12 V4 process is not allowed to assume stale state files imply a live
 * peer. Each active peer is tied to an exact release-SHA systemd instance.
 */
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {V4PeerKind} from "./v12-v4-peer-state-owners";
const exec=promisify(execFile);
const PREFIX:Record<Exclude<V4PeerKind,"V12">,string>={
 PENGU:"disdex-pengu-dual-ls-v2",Q102:"disdex-quality102-causal-v1",
 V52:"disdex-v52-aster-only",FET:"disdex-fet-brk48",
 HYPE_LONG:"disdex-hype-long",IDLE:"disdex-idle-priority-short",
 RESIDUAL:"disdex-idle-priority-short",
};
export type V4ServiceObservation={
 unit:string;active:boolean;retiredV12:boolean;observedAt:number;mainPid:number;
};
export function parseV4SystemdShow(text:string,expectedUnit:string,now:number):V4ServiceObservation{
 const data=Object.fromEntries(text.split(/\r?\n/).filter(x=>x.includes("="))
  .map(line=>[line.slice(0,line.indexOf("=")),line.slice(line.indexOf("=")+1)]));
 if(data.Id!==expectedUnit||data.ActiveState!=="active"||data.SubState!=="running"||
  !/^[1-9][0-9]*$/.test(data.MainPID??""))
  throw Error("V4_PEER_UNIT_NOT_RUNNING_OR_WRONG_SHA:"+expectedUnit);
 return {unit:expectedUnit,active:true,retiredV12:false,observedAt:now,mainPid:Number(data.MainPID)};
}
export async function observeV4PeerService(kind:V4PeerKind,sha:string):Promise<V4ServiceObservation>{
 if(!/^[a-f0-9]{40}$/.test(sha))throw Error("V4_PEER_SERVICE_SHA_INVALID");
 if(kind==="V12"){
  // V12 legacy and V4 may never place entries simultaneously. The old
  // service MUST be absent from the running list, irrespective of SHA.
  const {stdout}=await exec("systemctl",["list-units","--no-pager","--plain",
   "--type=service","--state=running","disdex-v12-x1-all@*.service"],{timeout:5000});
  if(/disdex-v12-x1-all@[0-9a-f]{40}\.service\s+loaded\s+active\s+running/i.test(stdout))
   throw Error("V4_LEGACY_V12_RUNNER_STILL_ACTIVE");
  if(stdout.includes("disdex-v12-x1-all@"))throw Error("V4_LEGACY_V12_SERVICE_STATUS_UNKNOWN");
  return {unit:"disdex-v12-x1-all@*.service",active:false,retiredV12:true,
   observedAt:Date.now(),mainPid:0};
 }
 const unit=PREFIX[kind]+"@"+sha+".service";
 const {stdout}=await exec("systemctl",["show",unit,"--no-pager",
  "--property=Id,ActiveState,SubState,MainPID"],{timeout:5000});
 return parseV4SystemdShow(stdout,unit,Date.now());
}
