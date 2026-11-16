/**
 * Source-pinned native Q102 state parser compatibility check, OFFLINE ONLY.
 *
 * Does not refresh outcomes, observe, send orders, access account data, activate
 * a runner or write the inspected private state. Refuses any path outside an
 * explicit private temp directory. This is not the Root bootstrap validator.
 */
import { readFileSync, realpathSync, lstatSync } from "node:fs";
import { relative, resolve, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Stable4Q102OnlineEngine } from "../lib/disdex-quality102-stable4-online";

const hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const arg=(key:string)=>{
  const i=process.argv.indexOf(key);
  if(i<0||!process.argv[i+1]||process.argv[i+1].startsWith("--"))throw Error("Q102_NATIVE_ARG_MISSING:"+key);
  return process.argv[i+1];
};
const sha40=(value:string)=>/^[a-f0-9]{40}$/.test(value);
function safeFile(path:string,root:string){
  if(!isAbsolute(path)||!isAbsolute(root))throw Error("Q102_NATIVE_ABSOLUTE_REQUIRED");
  const canonicalRoot=realpathSync(root),canonicalFile=realpathSync(path);
  const rel=relative(canonicalRoot,canonicalFile);
  if(!rel||rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel)||resolve(path)!==canonicalFile
      ||lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile())throw Error("Q102_NATIVE_PRIVATE_PATH_INVALID");
  return canonicalFile;
}
function pinnedBytes(path:string,sha:string):Buffer{
  const git=execFileSync("git",["show",sha+":"+path],{maxBuffer:8_000_000});
  const live=readFileSync(path);
  if(hash(git)!==hash(live)){
    // Windows worktrees may check out verified Git LF blobs as CRLF.
    // Permit ONLY that lossless checkout transform for this offline check.
    const normalized=Buffer.from(live.toString("utf8").replace(/\r\n/g,"\n"),"utf8");
    if(process.platform!=="win32"||hash(git)!==hash(normalized))
      throw Error("Q102_NATIVE_GIT_SOURCE_DRIFT:"+path);
  }
  return live;
}
function parserObject(raw:Buffer){
  const seen=JSON.parse(raw.toString("utf8"));
  if(!seen||typeof seen!=="object"||Array.isArray(seen))throw Error("Q102_NATIVE_SUMMARY_INVALID");
  return seen as Record<string,unknown>;
}
function main(){
  const sourceSha=arg("--source-sha"),privateRoot=arg("--private-root");
  if(!sha40(sourceSha))throw Error("Q102_NATIVE_COMMIT_INVALID");
  const gitHead=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  if(sourceSha!==gitHead)throw Error("Q102_NATIVE_COMMIT_DRIFT");
  // Local offline only: never accept a real VPS /var/lib state path.
  const root=realpathSync(privateRoot);
  const allow=process.platform==="win32"?"C:\\tmp":"/tmp";
  if(!(root===resolve(allow)||root.startsWith(resolve(allow)+sep)))throw Error("Q102_NATIVE_NONPRIVATE_ROOT");
  const state=safeFile(arg("--state"),root);
  const summary=safeFile(arg("--summary"),root);
  const rolling=safeFile(arg("--rolling-h1"),root);
  const input=readFileSync(state),before=lstatSync(state);
  const summaryDoc=parserObject(readFileSync(summary));
  if(hash(readFileSync(rolling))!==summaryDoc.sourceCacheSha256)throw Error("Q102_NATIVE_SOURCE_CACHE_CHANGED");
  for(const path of [
    "lib/disdex-quality102-stable4-online.ts",
    "config/stable4/q102-online-recovery-seed-20261114.json",
    "config/stable4/q102-avax-knn-seed-20261114.json",
  ])pinnedBytes(path,sourceSha);
  if(!Array.isArray(summaryDoc.highVolSymbols)||!summaryDoc.highVolSymbols.every(x=>typeof x==="string"))
    throw Error("Q102_NATIVE_HIGHVOL_INPUT_INVALID");
  const engine=new Stable4Q102OnlineEngine({
    mode:"OFF",statePath:state,
    recoverySeedPath:"config/stable4/q102-online-recovery-seed-20261114.json",
    avaxSeedPath:"config/stable4/q102-avax-knn-seed-20261114.json",
    highVolSymbols:summaryDoc.highVolSymbols as string[],
    requireHourlyCoverage:true,
  });
  const status=engine.learningStatus();
  if(!engine.isHealthy()||JSON.stringify(status)!==JSON.stringify(summaryDoc.model))
    throw Error("Q102_NATIVE_MODEL_SUMMARY_MISMATCH");
  if(status.observedThrough!==summaryDoc.lastObserved
      ||!Number.isSafeInteger(status.pendingContinuationRows)
      ||status.pendingContinuationRows<0)
    throw Error("Q102_NATIVE_OBSERVATION_OR_PENDING_MISMATCH");
  const after=lstatSync(state);
  if(hash(readFileSync(state))!==hash(input)||after.size!==before.size
      ||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)
    throw Error("Q102_NATIVE_STATE_MUTATED");
  console.log(JSON.stringify({
    schema:"disdex-stable4-q102-offline-native-parser-check/v1",
    status:"PASS_OFFLINE_NATIVE_STATE_PARSE_ONLY",sourceSha,
    stateSha256:hash(input),observedThrough:status.observedThrough,
    pendingContinuationRows:status.pendingContinuationRows,
    completedContinuationRows:status.completedContinuationRows,
    unresolvedContinuationRows:status.unresolvedContinuationRows,
    stateUnchanged:true,mode:"OFF",ordersSent:0,
    writerExclusionCertified:false,bootstrapInstallationAuthorized:false,
    sourceClosureCertified:false,productionReady:false,
  }));
}
try{main()}catch(err){console.error(err instanceof Error?err.message:String(err));process.exitCode=2}
