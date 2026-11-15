/** Ownership-only support for a formally root-bound HOLD_PROTECTED job.
 * This module never grants entry permission and never changes kill-switch bytes.
 */
import {createHash} from "node:crypto";
import {lstat,readFile} from "node:fs/promises";
type Row=Record<string,any>;
const hash=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex");
const sha=(v:unknown,n=40):v is string=>typeof v==="string"&&new RegExp("^[a-f0-9]{"+n+"}$").test(v);
const time=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
function fail(s:string):never{throw Error("PENDING_PROTECTED_HOLD_"+s);}
const KILL="/var/lib/disdex/shared/kill-switch.json";
const contexts=new WeakMap<object,{verify:()=>Promise<void>}>(),permits=new WeakMap<object,{receipt:Row;verify:()=>Promise<void>;files:Record<string,string>}>();
declare const contextBrand:unique symbol;declare const permitBrand:unique symbol;
export type PendingNoOrderContext={readonly [contextBrand]:true};
export type PendingProtectedHoldCapability={readonly [permitBrand]:true};
async function rootImmutable(path:string){const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||(st.mode&0o222)!==0)fail("ROOT_AUTHORITY_UNTRUSTED");const bytes=await readFile(path),after=await lstat(path);if(st.ino!==after.ino||st.dev!==after.dev||st.size!==after.size||st.mtimeMs!==after.mtimeMs||after.uid!==0||(after.mode&0o222)!==0)fail("ROOT_AUTHORITY_CHANGED");return{bytes,verify:async()=>{const next=await rootImmutable(path);if(!next.bytes.equals(bytes))fail("ROOT_AUTHORITY_CHANGED");}};}
/** The existing CLI validates v2 grant file metadata/scope before passing it here. */
export async function attestPendingNoOrderRootParent(workerSha:string,options:{grant?:Row;requestNonce?:string}):Promise<PendingNoOrderContext>{
 if(!sha(workerSha))fail("WORKER_SOURCE_INVALID");
 const marker=await rootImmutable("/home/deploy/disdex-trading/releases/"+workerSha+"/.disdex-release-sha");if(marker.bytes.toString().trim()!==workerSha)fail("WORKER_SOURCE_INVALID");
 const pid=process.ppid,path="/home/deploy/disdex-trading/releases/"+workerSha+"/scripts/ops/deploy/disdex_pending_maintenance.py";
 const verify=async()=>{
  const st=await lstat("/proc/"+pid),argv=(await readFile("/proc/"+pid+"/cmdline","utf8")).split("\0").filter(Boolean);
  if(st.uid!==0||process.ppid!==pid||argv[0]!=="/usr/bin/python3"||argv[1]!==path)fail("ROOT_PARENT_IDENTITY");
  if(options.requestNonce!==undefined){if(!sha(options.requestNonce,32)||argv.length!==4||argv[2]!=="--owned-venue-witness"||argv[3]!==options.requestNonce)fail("ROOT_PARENT_NONCE");}
  else {const g=options.grant;if(argv.length!==3||argv[2]!=="--service-cycle"||g?.schema!=="disdex-pending-refresh-root-grant/v2"||g.sourceSha!==workerSha||g.scope!=="PENDING_RECONCILE_ONLY"||g.ordersEnabled!==false||g.parentPid!==pid||g.route!=="ROOT_SERVICE"||g.authorizationMethod!=="ROOT_COMMITTED_NO_ORDER_MAINTENANCE"||!sha(g.maintenanceReceiptSha256,64)||!time(g.expiresAt)||g.expiresAt<=Date.now())fail("FORMAL_NO_ORDER_GRANT");}
  await marker.verify();
 };
 await verify();const context=Object.freeze({}) as PendingNoOrderContext;contexts.set(context,{verify});return context;
}
export function validatePendingProtectedHoldReceipt(receipt:Row,kill:Row,killSha256:string,v4Sha:string,now:number){
 const fields=["schema","planSha256","approvedSha","v4Sha","killSwitchPath","killSwitchSha256","reason","issuedAt","expiresAt","scope","authorizesOrders"];
 if(!receipt||Object.keys(receipt).sort().join("|")!==fields.sort().join("|")||receipt.schema!=="disdex-stable4-protected-hold-owner/v1"||!sha(receipt.planSha256,64)||!sha(receipt.approvedSha)||receipt.v4Sha!==v4Sha||!sha(v4Sha)||receipt.killSwitchPath!==KILL||!sha(killSha256,64)||receipt.killSwitchSha256!==killSha256||receipt.reason!=="STABLE4_RESEARCH_ROLLOUT:"+receipt.approvedSha||receipt.scope!=="HYPE_TREND_LONG"||receipt.authorizesOrders!==false||!time(now)||!time(receipt.issuedAt)||!time(receipt.expiresAt)||receipt.issuedAt>now||receipt.expiresAt<=now||receipt.expiresAt-receipt.issuedAt>3600000||kill?.active!==true||kill.action!=="HOLD_PROTECTED"||kill.scope!=="GLOBAL"||kill.reason!==receipt.reason)fail("RECEIPT_OR_KILL_BINDING_INVALID");
 return Object.freeze({...receipt});
}
export function validatePendingProtectedHoldV4Facts(receipt:Row,heartbeat:Row,ledger:Row,v4Sha:string,now:number):boolean{
 return receipt.v4Sha===v4Sha&&heartbeat?.safetyState==="BLOCKED"&&heartbeat.reason==="SHARED_KILL_SWITCH_ACTIVE:"+receipt.reason&&heartbeat.orderEnabled===false&&heartbeat.ordersAllowed===false&&heartbeat.runtimeSha===v4Sha&&heartbeat.expectedSha===v4Sha&&heartbeat.releaseSha===v4Sha&&time(heartbeat.heartbeatAt)&&heartbeat.heartbeatAt<=now&&now-heartbeat.heartbeatAt<=180000&&time(heartbeat.lastTickAt)&&heartbeat.lastTickAt<=now&&now-heartbeat.lastTickAt<=180000&&ledger?.state?.initial?.holdProtected===false&&ledger.state.executionReview==null&&ledger.releaseSha===v4Sha&&!!ledger.intents&&Object.values(ledger.intents).every((i:any)=>i?.action!=="ENTRY"||i.stage==="TERMINAL");
}
export async function loadPendingProtectedHoldCapability(v4Sha:string,context:PendingNoOrderContext):Promise<PendingProtectedHoldCapability|undefined>{
 const parent=contexts.get(context);if(!parent)fail("NO_ORDER_CAPABILITY_REQUIRED");await parent.verify();
 let bytes:Buffer;try{const st=await lstat(KILL);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o002)!==0)fail("KILL_FILE_UNTRUSTED");bytes=await readFile(KILL);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}
 const kill=JSON.parse(bytes.toString());if(kill.active!==true)return undefined;
 const matched=/^STABLE4_RESEARCH_ROLLOUT:([a-f0-9]{40})$/.exec(kill.reason??"");if(!matched)return undefined;
 const receiptPath="/etc/disdex/stable4/holds/"+matched[1]+".json",root=await rootImmutable(receiptPath),receipt=validatePendingProtectedHoldReceipt(JSON.parse(root.bytes.toString()),kill,hash(bytes),v4Sha,Date.now());
 const verify=async()=>{await parent.verify();await root.verify();const current=await readFile(KILL);if(!current.equals(bytes))fail("KILL_BYTES_CHANGED");validatePendingProtectedHoldReceipt(receipt,JSON.parse(current.toString()),hash(current),v4Sha,Date.now());};
 await verify();const capability=Object.freeze({}) as PendingProtectedHoldCapability;permits.set(capability,{receipt,verify,files:{[receiptPath]:hash(root.bytes),[KILL]:hash(bytes)}});return capability;
}
export function matchesPendingProtectedHold(capability:PendingProtectedHoldCapability|undefined,heartbeat:Row,ledger:Row,v4Sha:string,now:number){const p=capability&&permits.get(capability);return!!p&&validatePendingProtectedHoldV4Facts(p.receipt,heartbeat,ledger,v4Sha,now);}
export async function verifyPendingProtectedHold(capability:PendingProtectedHoldCapability){const p=permits.get(capability);if(!p)fail("CAPABILITY_INVALID");await p.verify();return{...p.files};}
