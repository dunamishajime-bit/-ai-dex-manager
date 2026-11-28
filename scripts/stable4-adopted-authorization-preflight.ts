/** Read-only exact-release authorization preflight. No issuance or order API. */
import {readFile} from "node:fs/promises";
import {assertRootOwnedIdleR26EntryCertificate} from "../lib/idle-r26-entry-certificate";
import {checkH48Stop8RootAuthorizationEvidence} from "../lib/hype-h48-stop8-root-authority";

const R26_CERT="/var/lib/disdex/shared/operator-activation/idle-r26-entry-certificate.json";
const reason=(e:unknown)=>{
 const message=e instanceof Error?e.message:"UNKNOWN";
 return /^[A-Z0-9_:-]{1,180}$/.test(message)?message:
  ((e as NodeJS.ErrnoException)?.code==="ENOENT"?"REQUIRED_ROOT_FILE_MISSING":"EVIDENCE_READ_OR_VALIDATION_FAILED");
};
async function main(){
 const [sha,plan,...extra]=process.argv.slice(2);
 if(!/^[a-f0-9]{40}$/.test(sha??"")||!/^[a-f0-9]{64}$/.test(plan??"")||extra.length)
  throw Error("EXACT_SOURCE_AND_OWNER_PLAN_SHA_REQUIRED");
 if((await readFile(".disdex-release-sha","utf8")).trim()!==sha)throw Error("IMMUTABLE_RELEASE_SHA_MISMATCH");
 if(process.platform!=="linux")throw Error("ROOT_EVIDENCE_LINUX_ONLY");
 const inspect=async (fn:()=>Promise<unknown>)=>{
  try{await fn();return {status:"VERIFIED_READ_ONLY",orderAuthority:false}}
  catch(e){return {status:"BLOCKED",reason:reason(e),orderAuthority:false}}
 };
 const [r26,h48]=await Promise.all([
  inspect(()=>assertRootOwnedIdleR26EntryCertificate(R26_CERT,sha)),
  inspect(()=>checkH48Stop8RootAuthorizationEvidence(sha,plan)),
 ]);
 console.log(JSON.stringify({sourceSha:sha,planSha256:plan,orderAuthority:false,certificateIssued:false,
  V4_R21:{status:"BLOCKED",reason:"R21_EXACT_NEW_ROUTE_CERT_REQUIRED"},
  PENGU_P91:{status:"BLOCKED",reason:"P91_EXACT_SOURCE_EXIT_CERT_REQUIRED"},
  IDLE_R26:r26,HYPE_H48_STOP8:h48},null,2));
 // Both R21/P91 still require a reviewed source-specific execution gate.
 process.exitCode=2;
}
main().catch(e=>{console.error(reason(e));process.exitCode=1});
