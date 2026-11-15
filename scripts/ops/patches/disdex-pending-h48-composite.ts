/** Copied into the immutable no-order worker release as lib/disdex-pending-h48-composite.ts.
 * Facts are not authority. Only this module can mint a capability after loading
 * the exact root-pinned HYPE validators and checking their real certificate.
 */
import {createHash} from "node:crypto";
import {lstat,readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
type Row=Record<string,any>;
type Lease={document():Promise<Row>};
type ReadOnlyClient={getPositions():Promise<Row[]>;getOpenOrders():Promise<Row[]>};
export type PendingH48FactsInput={positions:Row[];orders:Row[];hypeState:Row;hypeSha:string;now:number};
declare const capabilityBrand:unique symbol;
export type PendingH48Capability={readonly [capabilityBrand]:true};
const capabilities=new WeakMap<object,{fingerprint:string;verifyUnchanged:()=>Promise<void>;certificateSha256:string;files:Record<string,string>}>();
function fail(s:string):never{throw Error("PENDING_H48_"+s);}
/** tsx may expose CommonJS modules under default; preserve native named exports too. */
export function pendingModuleExports(value:Row):Row{
 if(!value||typeof value!=="object")fail("MODULE_NAMESPACE_INVALID");
 const fallback=value.default;
 return {...(fallback&&typeof fallback==="object"?fallback:{}),...value};
}
const sha=(v:unknown,n=64):v is string=>typeof v==="string"&&new RegExp("^[a-f0-9]{"+n+"}$").test(v);
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const time=(v:unknown):v is number=>finite(v)&&Number.isSafeInteger(v)&&v>0;
export function pendingWitnessNumber(v:unknown):number{
 if(typeof v!=="number"&&(typeof v!=="string"||!v.trim()||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(v.trim())))fail("NUMBER_INVALID");
 const n=Number(v);if(!Number.isFinite(n))fail("NUMBER_INVALID");return n;
}
const digest=(v:string|Uint8Array)=>createHash("sha256").update(v).digest("hex");
function canonical(v:any):string{if(Array.isArray(v))return"["+v.map(canonical).join(",")+"]";if(v&&typeof v==="object")return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";return JSON.stringify(v);}
function fingerprint(i:PendingH48FactsInput){return digest(canonical({positions:i.positions,orders:i.orders,hypeState:i.hypeState,hypeSha:i.hypeSha}));}
export function validatePendingH48ManifestBinding(manifest:Row,hypeSha:string){
 const r=manifest?.runners?.HYPE_TREND_LONG,b=r?.h48TimeOnly;
 if(!sha(hypeSha,40)||r?.sha!==hypeSha||!b||Object.keys(b).sort().join("|")!==["schema","sourceSha","authoritySha256","contractSha256","certificateSha256"].sort().join("|")||b.schema!=="disdex-pending-h48-authority-binding/v1"||b.sourceSha!==hypeSha||![b.authoritySha256,b.contractSha256,b.certificateSha256].every(v=>sha(v)))fail("MANIFEST_BINDING_INVALID");
 return Object.freeze({...b}) as Readonly<{schema:string;sourceSha:string;authoritySha256:string;contractSha256:string;certificateSha256:string}>;
}
export function inspectPendingH48CompositeFacts(input:PendingH48FactsInput){
 if(!Array.isArray(input.positions)||!Array.isArray(input.orders)||!time(input.now)||!sha(input.hypeSha,40))fail("FACTS_INVALID");
 const active=input.positions.filter(p=>{if(!p||typeof p!=="object")fail("POSITION_INVALID");const n=pendingWitnessNumber(p.positionAmt);if(n!==0&&Math.abs(n)<=1e-12)fail("DUST_NOT_DEFINITELY_FLAT");return n!==0;});
 const rows=active.filter(p=>p.symbol==="HYPEUSDT"),h=input.hypeState;
 if(rows.length!==1||rows[0].positionSide!=="BOTH"||pendingWitnessNumber(rows[0].positionAmt)<=0||input.orders.some(o=>o?.symbol==="HYPEUSDT"))fail("SIGNED_HYPE_IDENTITY_OR_ORDER");
 if(h?.schema!=="disdex-hype-zec-long/v1"||h.runtimeCommitSha!==input.hypeSha||h.mode!=="LIVE"||!time(h.updatedAt)||h.updatedAt>input.now||input.now-h.updatedAt>300000||h.pending!=null||h.manualReview!=null||!Array.isArray(h.positions)||h.positions.length!==1)fail("STATE_UNVERIFIED");
 const p=h.positions[0],c=p?.nativeExitContract;
 if(p?.strategy!=="HYPE_LONG"||p.symbol!=="HYPEUSDT"||p.side!=="LONG"||typeof p.positionId!=="string"||!p.positionId||!finite(p.quantity)||p.quantity!==pendingWitnessNumber(rows[0].positionAmt)||p.stopClientOrderId!=null||p.takeProfitClientOrderId!=null||!c||Object.keys(c).sort().join("|")!==["schemaVersion","kind","route","positionId","sourceSha","logicalEntryTs","logicalExitTs"].sort().join("|")||c.schemaVersion!==1||c.kind!=="H48_TIME_ONLY"||c.route!=="HYPE_REDESIGN_CAUSAL_H48R4_WSIG"||c.positionId!==p.positionId||c.sourceSha!==input.hypeSha||!time(c.logicalEntryTs)||c.logicalEntryTs%21600000!==0||c.logicalEntryTs!==p.signalTs||c.logicalEntryTs>input.now||!time(c.logicalExitTs)||c.logicalExitTs!==c.logicalEntryTs+48*3600000)fail("NATIVE_CONTRACT_MISMATCH");
 return {positions:input.positions,residualPositions:input.positions.filter(p=>p.symbol!=="HYPEUSDT"),orders:[...input.orders],positionCount:active.length,openOrderCount:input.orders.length,h48PositionCount:1,contract:Object.freeze({...c}),quantity:p.quantity};
}
async function immutableFile(path:string,expectedHash?:string){
 const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.uid!==0||(before.mode&0o222)!==0)fail("ROOT_FILE_UNTRUSTED");
 const raw=await readFile(path),after=await lstat(path),hash=digest(raw);
 if(!after.isFile()||after.isSymbolicLink()||before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||after.uid!==0||(after.mode&0o222)!==0||(expectedHash!==undefined&&hash!==expectedHash))fail("ROOT_FILE_CHANGED");
 return{raw,hash,verify:async()=>{const current=await immutableFile(path,hash);if(!current.raw.equals(raw))fail("ROOT_FILE_CHANGED");}};
}
/** Preserve the signed venue side required by the H48 authority. */
export function pendingH48AuthorityPositionRows(raw:Row[]){
 if(!Array.isArray(raw))fail("SIGNED_POSITION_INVALID");
 return raw.map(p=>{
  if(!p||typeof p.symbol!=="string")fail("SIGNED_POSITION_INVALID");
  const positionSide=p.positionSide??"BOTH";
  if(!["BOTH","LONG","SHORT"].includes(positionSide))fail("SIGNED_POSITION_SIDE_INVALID");
  return {symbol:p.symbol,quantity:pendingWitnessNumber(p.positionAmt),positionSide};
 });
}
/** Real lease + GET-only client. There is deliberately no permission boolean/test mint API. */
export async function authorizePendingH48Ownership(input:PendingH48FactsInput,options:{manifest:Row;lease:Lease;client:ReadOnlyClient}):Promise<PendingH48Capability>{
 const captured=fingerprint(input),facts=inspectPendingH48CompositeFacts(input),binding=validatePendingH48ManifestBinding(options.manifest,input.hypeSha),release="/home/deploy/disdex-trading/releases/"+input.hypeSha;
 const paths={authority:release+"/lib/hype-stable4-time-only-authority.ts",contract:release+"/lib/hype-stable4-time-only-contract.ts",marker:release+"/.disdex-release-sha",certificate:"/etc/disdex/stable4/h48-time-only/"+input.hypeSha+".json"};
 const files=await Promise.all([immutableFile(paths.authority,binding.authoritySha256),immutableFile(paths.contract,binding.contractSha256),immutableFile(paths.marker),immutableFile(paths.certificate,binding.certificateSha256)]);
 if(files[2].raw.toString("utf8").trim()!==input.hypeSha)fail("RELEASE_MARKER_INVALID");
 const initial=await options.lease.document();
 if(initial.accountScope!=="ASTER_FUTURES"||!time(initial.expiresAt)||initial.expiresAt<=Date.now())fail("ACCOUNT_LEASE_INVALID");
 const [authorityModule,contractModule]=(await Promise.all([import(pathToFileURL(paths.authority).href),import(pathToFileURL(paths.contract).href)])).map(pendingModuleExports);
 if(typeof authorityModule.createH48TimeOnlyPolicyAuthority!=="function"||typeof contractModule.validateHypeH48TimeOnlyContract!=="function"||typeof contractModule.validateHypeH48PolicyEvidence!=="function")fail("PINNED_MODULE_EXPORT_INVALID");
 const contract=contractModule.validateHypeH48TimeOnlyContract(facts.contract,facts.contract);
 const readonlyExecutor={getPositions:async()=>pendingH48AuthorityPositionRows(await options.client.getPositions()),getOpenOrders:async()=>options.client.getOpenOrders()};
 const authority=authorityModule.createH48TimeOnlyPolicyAuthority(input.hypeSha,readonlyExecutor);
 const evidence=await authority.authorize({phase:"POSITION",runtimeSha:input.hypeSha,contract,quantity:facts.quantity,lease:options.lease});
 contractModule.validateHypeH48PolicyEvidence(evidence,{contract,quantity:facts.quantity,now:Date.now()});
 if(evidence.certificateSha256!==binding.certificateSha256)fail("ROOT_CERTIFICATE_HASH_MISMATCH");
 const verifyUnchanged=async()=>{
  const current=await options.lease.document();if(current.ownerId!==initial.ownerId||current.leaseId!==initial.leaseId||current.acquiredAt!==initial.acquiredAt||current.accountScope!==initial.accountScope||current.expiresAt<=Date.now()||fingerprint(input)!==captured)fail("LEASE_OR_FACTS_CHANGED");
  for(const f of files)await f.verify();
 };
 await verifyUnchanged();
 const capability=Object.freeze({}) as PendingH48Capability;
 capabilities.set(capability,{fingerprint:captured,verifyUnchanged,certificateSha256:binding.certificateSha256,files:Object.fromEntries(Object.values(paths).map((path,i)=>[path,files[i].hash]))});
 return capability;
}
export function partitionPendingH48Ownership(input:PendingH48FactsInput,capability:PendingH48Capability|undefined){
 if(capability===undefined)return{positions:input.positions,orders:input.orders,h48PositionCount:0,positionCount:input.positions.filter(p=>pendingWitnessNumber(p.positionAmt)!==0).length,openOrderCount:input.orders.length};
 const proof=capabilities.get(capability);if(!proof||proof.fingerprint!==fingerprint(input))fail("CAPABILITY_INVALID");
 const facts=inspectPendingH48CompositeFacts(input);
 return{positions:facts.residualPositions,orders:facts.orders,h48PositionCount:facts.h48PositionCount,positionCount:facts.positionCount,openOrderCount:facts.openOrderCount};
}
export async function verifyPendingH48Capability(capability:PendingH48Capability){const p=capabilities.get(capability);if(!p)fail("CAPABILITY_INVALID");await p.verifyUnchanged();return{certificateSha256:p.certificateSha256,files:{...p.files}};}
