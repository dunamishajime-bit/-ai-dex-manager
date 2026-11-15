/** LIVE-only read-only native candidate wiring. This never initializes a store,
 * completes an outcome, changes owner membership or grants entry permission.
 * Source/store failures are rejected to the provider's detached diagnostics.
 */
import {createHash} from "node:crypto";
import {lstatSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import type {DisDexStable4Mode} from "../config/disdexStable4Opportunity";
import type {FetBrk48Bar} from "./fet-brk48-signal";
import type {IdleSignal} from "./idle-priority-short-signal";
import type {IdlePriorityMarketSnapshot} from "./idle-priority-short-market-data";
import {Stable4NativeShadowStore} from "./stable4-native-shadow-ledger";
import {captureStable4FetNativeCandidates,captureStable4IdleNativeCandidates,Stable4NativeShadowObserver} from "./stable4-native-shadow-observer";

type Strategy="FET"|"IDLE";
export const STABLE4_NATIVE_SHADOW_PARTITION_PATHS=Object.freeze({
 FET:"/var/lib/disdex/shared/stable4-native-shadow/FET.json",
 IDLE:"/var/lib/disdex/shared/stable4-native-shadow/IDLE.json",
});
/** Fixed reviewed native decision/exit source sets. No environment file list or
 * caller-selected policy callback can replace the source binding.
 */
export const STABLE4_NATIVE_POLICY_FILES:Readonly<Record<Strategy,readonly string[]>>=Object.freeze({
 FET:Object.freeze(["config/fetBrk48Runtime.ts","lib/fet-brk48-signal.ts","lib/fet-brk48-live-runner.ts","lib/fet-brk48-trailing-stop.ts","lib/disdex-exit-overlay-contract.ts"]),
 IDLE:Object.freeze(["config/idlePriorityShortPolicy.ts","lib/idle-priority-short-signal.ts","lib/idle-priority-short-live.ts","lib/idle-priority-short-runner.ts","lib/disdex-exit-overlay-contract.ts","lib/render-highwr-and-legacy-stop.ts","lib/render-independent-execution-contract.ts"]),
});
export function computeStable4NativePolicySourceDigest(strategy:Strategy,sources:readonly{path:string;bytes:Uint8Array}[]):string{
 const required=STABLE4_NATIVE_POLICY_FILES[strategy];
 if(!required||!Array.isArray(sources)||sources.length!==required.length||new Set(sources.map(s=>s.path)).size!==sources.length||
  sources.some(s=>!required.includes(s.path)||!(s.bytes instanceof Uint8Array)))throw Error("STABLE4_NATIVE_SHADOW_SOURCE_SET_INVALID");
 const records=sources.map(s=>({path:s.path,sha256:createHash("sha256").update(s.bytes).digest("hex")})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}
function sourceBinding(strategy:Strategy,sourceSha:string){
 try{
  if(!/^[a-f0-9]{40}$/.test(sourceSha))throw Error("SHA_INVALID");
  const root=resolve(__dirname,"..");
  const trusted=(path:string,directory=false)=>{
   const stat=lstatSync(path);
   if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile())||
    process.platform!=="win32"&&(stat.uid!==0||(stat.mode&0o222)!==0))throw Error("IMMUTABLE_METADATA_REQUIRED");
   return stat;
  };
  for(const dir of [root,resolve(root,"lib"),resolve(root,"config")])trusted(dir,true);
  const read=(path:string)=>{
   const before=trusted(path),bytes=readFileSync(path),after=trusted(path);
   if(before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error("SOURCE_CHANGED");
   return bytes;
  };
  if(read(resolve(root,".disdex-release-sha")).toString("utf8").trim()!==sourceSha)throw Error("SOURCE_MARKER_MISMATCH");
  const policySourceDigestSha256=computeStable4NativePolicySourceDigest(strategy,STABLE4_NATIVE_POLICY_FILES[strategy].map(path=>({path,bytes:read(resolve(root,path))})));
  return Object.freeze({sourceSha,policyVersion:"STABLE4_NATIVE_POLICY_SOURCE_V1",policySourceDigestSha256,sourceRef:strategy+":native-input:"+sourceSha});
 }catch(error){throw Error("STABLE4_NATIVE_SHADOW_SOURCE_UNAVAILABLE:"+(error instanceof Error?error.message:String(error)));}
}
type FetFrame={rows:readonly FetBrk48Bar[];decisionTs:number;capturedAt:number};
type IdleFrame={market:IdlePriorityMarketSnapshot;signals:IdleSignal[];capturedAt:number};
/** Source hashing is lazy and once per immutable process release. Missing
 * partitions remain errors; ordinary protection is never made to await these.
 */
export function createStable4FetNativeShadowObserver(mode:DisDexStable4Mode|undefined,sourceSha:string):((frame:FetFrame)=>Promise<unknown>)|undefined{
 if(mode!=="LIVE")return undefined;
 const observer=new Stable4NativeShadowObserver(new Stable4NativeShadowStore(STABLE4_NATIVE_SHADOW_PARTITION_PATHS.FET),"FET");
 let binding:ReturnType<typeof sourceBinding>|undefined;
 return async frame=>{
  binding??=sourceBinding("FET",sourceSha);
  return observer.capture(captureStable4FetNativeCandidates(frame,{...binding,capturedAt:frame.capturedAt}));
 };
}
export function createStable4IdleNativeShadowObserver(mode:DisDexStable4Mode|undefined,sourceSha:string):((frame:IdleFrame)=>Promise<unknown>)|undefined{
 if(mode!=="LIVE")return undefined;
 const observer=new Stable4NativeShadowObserver(new Stable4NativeShadowStore(STABLE4_NATIVE_SHADOW_PARTITION_PATHS.IDLE),"IDLE");
 let binding:ReturnType<typeof sourceBinding>|undefined;
 return async frame=>{
  binding??=sourceBinding("IDLE",sourceSha);
  return observer.capture(captureStable4IdleNativeCandidates({signals:frame.signals,sourceSnapshot:frame.market},{...binding,capturedAt:frame.capturedAt}));
 };
}
