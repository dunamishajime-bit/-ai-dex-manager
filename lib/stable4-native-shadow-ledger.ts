/** Independent hypothetical native outcomes. Never an account-owner book or order authority.
 * Completion is a normalized result from a trusted native replay implementation;
 * hashes bind its inputs but do not independently prove an external price source.
 */
import {createHash,randomUUID} from "node:crypto";
import {lstat,readFile,open,rename,unlink} from "node:fs/promises";
import {dirname} from "node:path";
import {isStable4StrategyEntryFeature,type Stable4OpportunityLabel} from "./stable4-opportunity-model";
const schema="disdex-stable4-native-shadow/v1";
const strategies=new Set(["V4","PENGU","FET","Q102","IDLE","V52","HYPE"]);
type Row=Record<string,any>;
export interface Stable4NativeShadowLedger{schema:typeof schema;strategy:string;revision:number;entries:Row[]}
const fail=(reason:string):never=>{throw Error("STABLE4_NATIVE_SHADOW_"+reason);};
const plain=(v:any):v is Row=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const num=(v:any)=>typeof v==="number"&&Number.isFinite(v);
const stamp=(v:any)=>num(v)&&Number.isSafeInteger(v)&&v>0;
const text=(v:any)=>typeof v==="string"&&v.length>0&&v===v.trim();
function exact(v:any,keys:string[]){if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||Reflect.ownKeys(v).some(k=>typeof k!=="string"||!keys.includes(k)||!("value" in Object.getOwnPropertyDescriptor(v,k)!)))fail("SCHEMA_INVALID");}
function array(v:any){if(!Array.isArray(v)||Array.from({length:v.length},(_,i)=>i).some(i=>!Object.hasOwn(v,i)))fail("ARRAY_INVALID");}
const same=(a:any,b:any):boolean=>{if(a===b)return true;if(!a||!b||typeof a!=="object"||typeof b!=="object")return false;const ak=Object.keys(a),bk=Object.keys(b);return ak.length===bk.length&&ak.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));};
function freeze<T>(v:T):T{if(v&&typeof v==="object"){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
function refs(v:any,required:string[]){array(v);const seen=new Set<string>();for(const r of v){exact(r,["kind","ref","sha256"]);if(!text(r.kind)||!text(r.ref)||!text(r.sha256)||!/^[a-f0-9]{64}$/.test(r.sha256)||seen.has(r.kind+":"+r.ref))fail("EVIDENCE_REF_INVALID");seen.add(r.kind+":"+r.ref);}for(const k of required)if(!v.some((r:Row)=>r.kind===k))fail("EVIDENCE_REF_MISSING");}
function coverage(v:any,required:string[]){exact(v,["from","through","observedAt","refs"]);if(!stamp(v.from)||!stamp(v.through)||v.through<v.from||!stamp(v.observedAt)||v.observedAt<v.through)fail("EVIDENCE_COVERAGE_INVALID");refs(v.refs,required);}
function validateCandidate(c:any,strategy:string){
 exact(c,["nativeKey","sourceSha","strategy","symbol","side","route","logicalEntryTs","gross","modelExpectedHoldHours","capturedAt","entryFeatures","nativePolicy","evidenceCoverage"]);
 if(c.strategy!==strategy||!strategies.has(strategy)||!text(c.nativeKey)||!text(c.sourceSha)||!text(c.symbol)||!/^[a-f0-9]{40}$/.test(c.sourceSha)||!/^[A-Z0-9]+USDT$/.test(c.symbol)||!["LONG","SHORT"].includes(c.side)||!text(c.route)||!stamp(c.logicalEntryTs)||!stamp(c.capturedAt)||c.capturedAt<c.logicalEntryTs||!num(c.gross)||c.gross<=0||!num(c.modelExpectedHoldHours)||c.modelExpectedHoldHours<=0||!plain(c.entryFeatures))fail("CANDIDATE_INVALID");
 for(const [k,v]of Object.entries(c.entryFeatures))if(!isStable4StrategyEntryFeature(strategy,k)||!num(v))fail("FEATURE_INVALID");
 exact(c.nativePolicy,["id","version","sourceSha","sourceDigestSha256","shortReturnConvention","roundTripCost"]);
 const p=c.nativePolicy;if(!text(p.id)||!text(p.version)||p.sourceSha!==c.sourceSha||!text(p.sourceDigestSha256)||!/^[a-f0-9]{64}$/.test(p.sourceDigestSha256)||!["linear","reciprocal"].includes(p.shortReturnConvention)||p.roundTripCost!==.003)fail("POLICY_INVALID");
 coverage(c.evidenceCoverage,["ENTRY","POLICY"]);if(c.evidenceCoverage.refs.some((r:Row)=>r.kind==="POLICY"&&r.sha256!==p.sourceDigestSha256))fail("POLICY_REF_INVALID");if(c.evidenceCoverage.through<c.logicalEntryTs||c.evidenceCoverage.observedAt>c.capturedAt)fail("CANDIDATE_COVERAGE_INVALID");
}
function label(c:Row,r:Row,at:number):Stable4OpportunityLabel{
 exact(r,["nativeKey","policyDigestSha256","entryTs","entryPrice","exitTs","exitPrice","exitReason","knownAt","evidenceCoverage","funding"]);
 if(!stamp(at)||r.nativeKey!==c.nativeKey||r.policyDigestSha256!==c.nativePolicy.sourceDigestSha256||r.entryTs!==c.logicalEntryTs||!num(r.entryPrice)||r.entryPrice<=0||!num(r.exitPrice)||r.exitPrice<=0||!stamp(r.exitTs)||r.exitTs<=r.entryTs||!text(r.exitReason)||!stamp(r.knownAt)||r.knownAt<=r.exitTs||r.knownAt>at)fail("COMPLETION_INVALID");
 coverage(r.evidenceCoverage,["PRICE","POLICY"]);if(r.evidenceCoverage.refs.some((ref:Row)=>ref.kind==="POLICY"&&ref.sha256!==c.nativePolicy.sourceDigestSha256))fail("POLICY_REF_INVALID");if(r.evidenceCoverage.from>r.entryTs||r.evidenceCoverage.through<r.exitTs||r.evidenceCoverage.observedAt>r.knownAt)fail("PRICE_COVERAGE_INVALID");
 exact(r.funding,["from","through","observedAt","refs","rows"]);coverage({from:r.funding.from,through:r.funding.through,observedAt:r.funding.observedAt,refs:r.funding.refs},["FUNDING"]);
 if(r.funding.from>r.entryTs||r.funding.through<r.exitTs||r.funding.observedAt>r.knownAt)fail("FUNDING_COVERAGE_INVALID");
 array(r.funding.rows);let funding=0,last=0;for(const f of r.funding.rows){exact(f,["fundingTime","fundingRate","markPrice"]);if(!stamp(f.fundingTime)||f.fundingTime<=last||f.fundingTime<r.funding.from||f.fundingTime>r.funding.through||!num(f.fundingRate)||!num(f.markPrice)||f.markPrice<=0)fail("FUNDING_ROW_INVALID");last=f.fundingTime;if(f.fundingTime>r.entryTs&&f.fundingTime<r.exitTs)funding+=(c.side==="LONG"?-1:1)*f.fundingRate*f.markPrice/r.entryPrice;}
 const price=c.side==="LONG"?r.exitPrice/r.entryPrice-1:c.nativePolicy.shortReturnConvention==="reciprocal"?r.entryPrice/r.exitPrice-1:1-r.exitPrice/r.entryPrice;
 const net30=price+funding-.003;if(!num(net30))fail("RETURN_INVALID");
 return{id:c.nativeKey,strategy:c.strategy,symbol:c.symbol,side:c.side,route:c.route,entryTs:c.logicalEntryTs,exitTs:r.exitTs,net30,features:structuredClone(c.entryFeatures)};
}
export function validateStable4NativeShadowLedger(raw:any):Stable4NativeShadowLedger{
 exact(raw,["schema","strategy","revision","entries"]);if(raw.schema!==schema||!strategies.has(raw.strategy)||!Number.isSafeInteger(raw.revision)||raw.revision<0)fail("LEDGER_INVALID");array(raw.entries);const seen=new Set<string>();
 for(const e of raw.entries){exact(e,["candidate","status",...(e.completion===undefined?[]:["completion"]),...(e.unresolved===undefined?[]:["unresolved"])]);validateCandidate(e.candidate,raw.strategy);if(seen.has(e.candidate.nativeKey))fail("DUPLICATE_NATIVE_KEY");seen.add(e.candidate.nativeKey);
  if(e.status==="PENDING"){if(e.completion!==undefined||e.unresolved!==undefined)fail("STATUS_INVALID");}
  else if(e.status==="COMPLETED"){exact(e.completion,["result","recordedAt","label"]);if(!same(label(e.candidate,e.completion.result,e.completion.recordedAt),e.completion.label))fail("COMPLETED_LABEL_INVALID");if(e.unresolved!==undefined){array(e.unresolved);for(const u of e.unresolved)validateUnresolved(u);}}
  else if(e.status==="UNRESOLVED"){array(e.unresolved);if(!e.unresolved.length)fail("UNRESOLVED_INVALID");for(const u of e.unresolved)validateUnresolved(u);if(e.completion!==undefined)fail("STATUS_INVALID");}else fail("STATUS_INVALID");
 }
 return freeze(structuredClone(raw));
}
function validateUnresolved(u:any){exact(u,["reason","observedAt","evidenceCoverage"]);if(!text(u.reason)||!stamp(u.observedAt))fail("UNRESOLVED_INVALID");coverage(u.evidenceCoverage,[]);if(u.evidenceCoverage.observedAt>u.observedAt)fail("UNRESOLVED_INVALID");}
export function createStable4NativeShadowLedger(strategy:string){return validateStable4NativeShadowLedger({schema,strategy,revision:0,entries:[]});}
export function appendStable4NativeShadowCandidate(raw:Stable4NativeShadowLedger,candidate:Row){const l=validateStable4NativeShadowLedger(raw);const old=l.entries.find(e=>e.candidate.nativeKey===candidate.nativeKey);if(old){if(!same(old.candidate,candidate))fail("CANDIDATE_CONFLICT");return l;}validateCandidate(candidate,l.strategy);return validateStable4NativeShadowLedger({...l,entries:[...l.entries,{candidate,status:"PENDING"}]});}
export function completeStable4NativeShadowCandidate(raw:Stable4NativeShadowLedger,key:string,result:Row,now:number){const l=validateStable4NativeShadowLedger(raw),e=l.entries.find(x=>x.candidate.nativeKey===key);if(!e)fail("NATIVE_KEY_MISSING");const output=label(e!.candidate,result,now);if(e!.status==="COMPLETED"){if(!same(e!.completion.result,result))fail("COMPLETION_CONFLICT");return l;}return validateStable4NativeShadowLedger({...l,entries:l.entries.map(x=>x===e?{candidate:e!.candidate,status:"COMPLETED",completion:{result,recordedAt:now,label:output},...(e!.unresolved?{unresolved:e!.unresolved}:{})}:x)});}
export function markStable4NativeShadowUnresolved(raw:Stable4NativeShadowLedger,key:string,unresolved:Row,now:number){const l=validateStable4NativeShadowLedger(raw);validateUnresolved(unresolved);if(!stamp(now)||unresolved.observedAt>now)fail("UNRESOLVED_INVALID");const e=l.entries.find(x=>x.candidate.nativeKey===key);if(!e||e.status==="COMPLETED")fail("UNRESOLVED_CONFLICT");return validateStable4NativeShadowLedger({...l,entries:l.entries.map(x=>x===e?{candidate:e.candidate,status:"UNRESOLVED",unresolved:[...(e.unresolved??[]),unresolved]}:x)});}
export function completedStable4NativeShadowLabels(raw:Stable4NativeShadowLedger,knownBefore:number){if(!stamp(knownBefore))fail("CLOCK_INVALID");return validateStable4NativeShadowLedger(raw).entries.filter(e=>e.status==="COMPLETED"&&e.completion.result.knownAt<knownBefore&&e.completion.label.exitTs<knownBefore).map(e=>e.completion.label as Stable4OpportunityLabel);}
const digest=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
export class Stable4NativeShadowStore{
 constructor(readonly path:string){}
 async snapshot(){let s;try{s=await lstat(this.path);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")fail("STORE_MISSING");throw e;}if(!s!.isFile()||s!.isSymbolicLink())fail("STORE_UNSAFE");const b=await readFile(this.path),after=await lstat(this.path);if(s!.ino!==after.ino||s!.mtimeMs!==after.mtimeMs||s!.size!==after.size)fail("STORE_CAS_CHANGED");return{ledger:validateStable4NativeShadowLedger(JSON.parse(b.toString("utf8"))),byteSha256:digest(b)};}
 async read(){return(await this.snapshot()).ledger;}
 async initialize(raw:Stable4NativeShadowLedger){const l=validateStable4NativeShadowLedger(raw),fd=await open(this.path,"wx",0o600);try{await fd.writeFile(JSON.stringify(l)+"\n");await fd.sync();}finally{await fd.close();}}
 async commit(expected:Awaited<ReturnType<Stable4NativeShadowStore["snapshot"]>>,proposed:Stable4NativeShadowLedger){
  const captured=validateStable4NativeShadowLedger(proposed),baseline=validateStable4NativeShadowLedger(expected.ledger),hash=expected.byteSha256;let guard;
  try{guard=await open(this.path+".writer","wx",0o600);}catch{fail("STORE_WRITER_BUSY");}
  const token=randomUUID();await guard!.writeFile(token);const guardStat=await guard!.stat();const ownsGuard=async()=>{try{const s=await lstat(this.path+".writer");return s.isFile()&&!s.isSymbolicLink()&&s.ino===guardStat.ino&&s.dev===guardStat.dev&&(await readFile(this.path+".writer","utf8"))===token;}catch{return false;}};const assertGuard=async()=>{if(!await ownsGuard())fail("STORE_WRITER_CHANGED");};
  const temp=this.path+"."+randomUUID()+".tmp";let exists=false;
  try{
   const current=await this.snapshot();if(current.byteSha256!==hash||!same(current.ledger,baseline)||captured.revision!==baseline.revision||captured.strategy!==baseline.strategy)fail("STORE_CAS_CHANGED");
   for(const old of baseline.entries){const next=captured.entries.find(e=>e.candidate.nativeKey===old.candidate.nativeKey);if(!next||!same(old.candidate,next.candidate)||old.status==="COMPLETED"&&!same(old,next)||old.status==="UNRESOLVED"&&next.status==="PENDING")fail("STORE_HISTORY_CONFLICT");}
   for(const old of baseline.entries){if(old.unresolved){const next=captured.entries.find(e=>e.candidate.nativeKey===old.candidate.nativeKey);if(!Array.isArray(next?.unresolved)||!same(old.unresolved,next!.unresolved.slice(0,old.unresolved.length)))fail("STORE_HISTORY_CONFLICT");}}
   await assertGuard();for(const next of captured.entries)if(!baseline.entries.some(e=>e.candidate.nativeKey===next.candidate.nativeKey)&&next.status!=="PENDING")fail("STORE_CAPTURE_REQUIRED");
   const out={...captured,revision:baseline.revision+1},fd=await open(temp,"wx",0o600);exists=true;try{await fd.writeFile(JSON.stringify(out)+"\n");await fd.sync();}finally{await fd.close();}
   if((await this.snapshot()).byteSha256!==hash)fail("STORE_CAS_CHANGED");await assertGuard();await rename(temp,this.path);exists=false;
   if(process.platform!=="win32"){const dir=await open(dirname(this.path),"r");try{await dir.sync();}finally{await dir.close();}}
   return validateStable4NativeShadowLedger(out);
  }finally{if(exists)await unlink(temp).catch(()=>undefined);const ours=await ownsGuard();await guard!.close();if(ours)await unlink(this.path+".writer");}
 }
}
