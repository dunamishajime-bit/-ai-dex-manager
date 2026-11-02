import assert from "node:assert/strict";
import test from "node:test";
import { chmod, lstat, mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVIDENCE_FILE_NAMES, inspectV4EvidenceExpiry, validateEvidenceBundle } from "../scripts/ops/root/disdex-v12-v4-evidence-preflight.mjs";
import { inspectRootEvidenceFiles, inspectRootRefreshLease, combineV4EvidenceAndLease } from "../scripts/ops/root/disdex-v4-evidence-expiry-watch.mjs";
const SHA = "a".repeat(40);
const NOW = Date.parse("2026-10-30T00:00:00Z");
function bundle(overrides = {}) {
  const capturedAt = new Date(NOW - 3600000).toISOString();
  return {
    routeSourceParity: {status:"PASS",candidateSha:SHA,capturedAt,routeCount:41,sourceParity:true},
    establishedAsterOrders: {status:"PASS",candidateSha:SHA,capturedAt,readOnly:true,mutationCalls:0},
    signedAsterAccount: {status:"PASS",candidateSha:SHA,capturedAt,readOnly:true,signedGet:true,mutationCalls:0},
    v4ExecutionTests: {status:"PASS",candidateSha:SHA,capturedAt,testPasses:200,failCount:0,typecheck:true},
    sharedRiskAndPeers: {status:"PASS",candidateSha:SHA,capturedAt,sharedRiskHealthy:true,marginGuardHealthy:true,killSwitch:false,pendingCount:0},
    ...overrides,
  };
}
test("fresh bundle is non-authorizing", () => {
  const r=inspectV4EvidenceExpiry({sha:SHA,payloads:bundle(),now:NOW});
  assert.equal(r.status,"FRESH");
  assert.equal(r.readOnly,true);
  assert.equal(r.authorizesTrading,false);
});
test("warn 12 hours before oldest proof expires", () => {
  const old=new Date(NOW-18*3600000).toISOString();
  const b=bundle({signedAsterAccount:{...bundle().signedAsterAccount,capturedAt:old}});
  const r=inspectV4EvidenceExpiry({sha:SHA,payloads:b,now:NOW});
  assert.equal(r.status,"EXPIRING_SOON");
  assert.equal(r.earliestExpiryAt,new Date(NOW+6*3600000).toISOString());
  assert.equal(r.evidence.filter(e=>e.remainingMs!==null && e.remainingMs<=r.warningWindowMs).length,1);
});
test("old static release proof is reusable and does not create a dynamic expiry warning", () => {
  const old=new Date(NOW-30*3600000).toISOString();
  const b=bundle({routeSourceParity:{...bundle().routeSourceParity,capturedAt:old},v4ExecutionTests:{...bundle().v4ExecutionTests,capturedAt:old}});
  const r=inspectV4EvidenceExpiry({sha:SHA,payloads:b,now:NOW});
  assert.equal(r.status,"FRESH");
  assert.equal(r.evidence.find(e=>e.key==="routeSourceParity").expiresAt,null);
  assert.equal(r.evidence.find(e=>e.key==="v4ExecutionTests").refreshRequired,false);
});
test("expired signed account remains blocked by real gate", () => {
  const old=new Date(NOW-25*3600000).toISOString();
  const b=bundle({signedAsterAccount:{...bundle().signedAsterAccount,capturedAt:old}});
  assert.equal(inspectV4EvidenceExpiry({sha:SHA,payloads:b,now:NOW}).status,"EXPIRED");
  assert.throws(()=>validateEvidenceBundle({sha:SHA,releaseMarker:SHA,payloads:b,now:NOW}),/STALE/);
});
test("authoritative gate earliest capture time is conservative", () => {
  const old=new Date(NOW-20*3600000).toISOString();
  const b=bundle({signedAsterAccount:{...bundle().signedAsterAccount,capturedAt:old}});
  const v=validateEvidenceBundle({sha:SHA,releaseMarker:SHA,payloads:b,now:NOW});
  assert.equal(v.evidenceCapturedAt,Date.parse(old));
  assert.equal(v.evidenceEarliestExpiryAt,new Date(NOW+4*3600000).toISOString());
});
test("invalid SHA and future evidence reject", () => {
  assert.throws(()=>inspectV4EvidenceExpiry({sha:"x",payloads:bundle(),now:NOW}),/SHA/);
  assert.throws(()=>inspectV4EvidenceExpiry({sha:SHA,payloads:bundle({routeSourceParity:{...bundle().routeSourceParity,candidateSha:"b".repeat(40)}}),now:NOW}),/SHA_MISMATCH/);
  assert.throws(()=>inspectV4EvidenceExpiry({sha:SHA,payloads:bundle({routeSourceParity:{...bundle().routeSourceParity,capturedAt:new Date(NOW+600000).toISOString()}}),now:NOW}),/TIMESTAMP_INVALID/);
});
test("cannot alter expiry monitoring threshold beyond 24 hours",()=>{
  assert.throws(()=>inspectV4EvidenceExpiry({sha:SHA,payloads:bundle(),now:NOW,warningWindowMs:26*3600000}),/MONITOR_INPUT/);
});
test("scanner rejects mutable and symlink files", async()=>{
  if(process.platform === "win32") return;
  const dir=await mkdtemp(join(tmpdir(),"disdex-v4-expiry-"));
  try {
    const b=bundle();
    for(const [key,name] of Object.entries(EVIDENCE_FILE_NAMES)) {
      await writeFile(join(dir,name),JSON.stringify(b[key]),{mode:0o600});
      await chmod(join(dir,name),0o600);
    }
    const uid=(await lstat(join(dir,EVIDENCE_FILE_NAMES.routeSourceParity))).uid;
    assert.equal((await inspectRootEvidenceFiles({sha:SHA,directory:dir,now:NOW,requiredUid:uid})).status,"FRESH");
    const p=join(dir,EVIDENCE_FILE_NAMES.routeSourceParity);
    await chmod(p,0o666);
    await assert.rejects(inspectRootEvidenceFiles({sha:SHA,directory:dir,now:NOW,requiredUid:uid}),/UNTRUSTED/);
    await rm(p);
    await symlink(join(dir,EVIDENCE_FILE_NAMES.establishedAsterOrders),p);
    await assert.rejects(inspectRootEvidenceFiles({sha:SHA,directory:dir,now:NOW,requiredUid:uid}),/UNTRUSTED/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("fresh proof warns when owner-signed refresh lease nears expiry", () => {
  const evidence=inspectV4EvidenceExpiry({sha:SHA,payloads:bundle(),now:NOW});
  const lease={status:"EXPIRING_SOON",earliestExpiryAt:new Date(NOW+3*3600000).toISOString(),
    remainingMs:3*3600000,expiringKeys:["refreshLease"]};
  const merged=combineV4EvidenceAndLease(evidence,lease);
  assert.equal(evidence.status,"FRESH");
  assert.equal(merged.status,"EXPIRING_SOON");
  assert.equal(merged.remainingMs,3*3600000);
  assert.deepEqual(merged.lease.expiringKeys,["refreshLease"]);
});
test("lease expiry blocks even when dynamic account proofs are fresh", () => {
  const evidence=inspectV4EvidenceExpiry({sha:SHA,payloads:bundle(),now:NOW});
  const lease={status:"EXPIRED",earliestExpiryAt:new Date(NOW-1000).toISOString(),
    remainingMs:-1000,expiringKeys:["refreshLease"]};
  const merged=combineV4EvidenceAndLease(evidence,lease);
  assert.equal(merged.status,"EXPIRED");
  assert.equal(merged.remainingMs,-1000);
});
test("missing lease directory is not mistaken for installed lease",async()=>{
  const missing=join(tmpdir(),"v4-lease-absent-"+process.pid+"-"+Date.now());
  assert.equal(await inspectRootRefreshLease({sha:SHA,directory:missing,now:NOW}),null);
});
test("installed lease is read-only and validates SHA, scope, mode, ownership and expiry",async()=>{
  if(process.platform==="win32")return;
  const dir=await mkdtemp(join(tmpdir(),"v4-lease-"));
  const file=join(dir,SHA+".json");
  const base={
    schema:"disdex-v4-evidence-refresh-lease/v1",
    scope:"V4_EVIDENCE_REFRESH_ONLY", approvedSha:SHA, approvedRunner:"V12_V4",
    approvedRunners:["V12_V4"], approvedShaByRunner:{V12_V4:SHA},
    deploymentTarget:"professional-dismanager.net", operatorTarget:"DD1296_FINAL_ALLIN_10BPS",
    ordersEnabled:false, signatureVerified:true, planSha256:"d".repeat(64),
    approvalNonceDigest:"f".repeat(64),
    approvedAt:Math.floor(NOW/1000)-3600,
    expiresAt:Math.floor(NOW/1000)+20*3600,
  };
  const write=async(value)=>{await writeFile(file,JSON.stringify(value),{mode:0o600});await chmod(file,0o600);};
  try{
    await chmod(dir,0o700);
    const uid=(await lstat(dir)).uid;
    await assert.rejects(inspectRootRefreshLease({sha:SHA,directory:dir,now:NOW,requiredUid:uid}),/MISSING/);
    await write(base);
    const fresh=await inspectRootRefreshLease({sha:SHA,directory:dir,now:NOW,requiredUid:uid});
    assert.equal(fresh.status,"FRESH");
    assert.equal(fresh.authorizesTrading,false);
    const soon=await inspectRootRefreshLease({sha:SHA,directory:dir,now:NOW+12*3600000,requiredUid:uid});
    assert.equal(soon.status,"EXPIRING_SOON");
    const expired=await inspectRootRefreshLease({sha:SHA,directory:dir,now:NOW+21*3600000,requiredUid:uid});
    assert.equal(expired.status,"EXPIRED");
    await write({...base,ordersEnabled:true});
    await assert.rejects(inspectRootRefreshLease({sha:SHA,directory:dir,now:NOW,requiredUid:uid}),/METADATA_INVALID/);
    await write({...base,approvedSha:"b".repeat(40)});
    await assert.rejects(inspectRootRefreshLease({sha:SHA,directory:dir,now:NOW,requiredUid:uid}),/METADATA_INVALID/);
    await write({...base,expiresAt:base.approvedAt+86401});
    await assert.rejects(inspectRootRefreshLease({sha:SHA,directory:dir,now:NOW,requiredUid:uid}),/METADATA_INVALID/);
    await write(base);
    await chmod(file,0o666);
    await assert.rejects(inspectRootRefreshLease({sha:SHA,directory:dir,now:NOW,requiredUid:uid}),/UNTRUSTED/);
    await rm(file);
    await symlink(join(dir,"other.json"),file);
    await assert.rejects(inspectRootRefreshLease({sha:SHA,directory:dir,now:NOW,requiredUid:uid}),/UNTRUSTED/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
