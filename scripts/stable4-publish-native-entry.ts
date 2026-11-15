/** Evidence-only bridge for the existing Python V52 account-lease holder.
 * Input is passed through stdin; this program has no order or cancel API.
 */
import {lstat,readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createStable4EntryOpportunityRuntime} from "../lib/stable4-entry-opportunity-runtime";
import {ACCOUNT_LOCK_SCHEMA,type AccountLockDocument} from "../lib/disdex-account-order-lock";
import type {Stable4EntryOpportunityCaptureInput} from "../lib/stable4-entry-opportunity-publisher";

export async function publishStable4PythonNativeEntry(value:{input:Stable4EntryOpportunityCaptureInput;lockPath:string;ownerId:string;leaseId:string}){
 if(value.input.strategy!=="V52"||value.input.sourceGitSha!==String(process.env.DISDEX_RUNTIME_COMMIT_SHA||process.env.DISDEX_RELEASE_SHA||"").toLowerCase()||!value.ownerId||!value.leaseId||typeof value.lockPath!=="string"||resolve(value.lockPath)!==value.lockPath)throw Error("STABLE4_NATIVE_PUBLISH_IDENTITY_INVALID");
 const lease={document:async()=>{
  const st=await lstat(value.lockPath);if(!st.isFile()||st.isSymbolicLink())throw Error("STABLE4_NATIVE_PUBLISH_UNSAFE_LEASE");
  const d=JSON.parse(await readFile(value.lockPath,"utf8")) as AccountLockDocument;
  if(d.schema!==ACCOUNT_LOCK_SCHEMA||d.accountScope!=="ASTER_FUTURES"||d.ownerId!==value.ownerId||d.leaseId!==value.leaseId||d.expiresAt<=Date.now())throw Error("STABLE4_NATIVE_PUBLISH_LEASE_CHANGED");
  return d;
 }};
 return createStable4EntryOpportunityRuntime().prepareAndPublish(value.input,lease);
}
if(process.argv[1]?.replace(/\\/g,"/").endsWith("/stable4-publish-native-entry.ts")){
 (async()=>{
  let raw="";for await(const chunk of process.stdin){raw+=chunk;if(raw.length>100000)throw Error("STABLE4_NATIVE_PUBLISH_INPUT_TOO_LARGE");}
  const record=await publishStable4PythonNativeEntry(JSON.parse(raw));
  process.stdout.write(JSON.stringify(record)+"\n");
 })().catch(()=>{process.stderr.write("STABLE4_NATIVE_ENTRY_EVIDENCE_UNAVAILABLE\n");process.exitCode=1;});
}
