import assert from "node:assert/strict";
import test from "node:test";
import { chmod, lstat, mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVIDENCE_FILE_NAMES, inspectV4EvidenceExpiry, validateEvidenceBundle } from "../scripts/ops/root/disdex-v12-v4-evidence-preflight.mjs";
import { inspectRootEvidenceFiles } from "../scripts/ops/root/disdex-v4-evidence-expiry-watch.mjs";
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
