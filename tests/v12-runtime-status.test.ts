import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateV12RuntimeBadge, loadV12RuntimeBadge, type V12RuntimeBadgeInput } from "../apps/production-ui/lib/server/v12-runtime-status";
const sha = "a".repeat(40), other = "b".repeat(40), now = Date.UTC(2026,9,9,8);
function good(): V12RuntimeBadgeInput {
 return { now, configured: true, expectedReleaseSha: sha, currentReleaseSha: sha,
  state: { strategyId: "V12_X1.00_ALL", mode: "LIVE", runtimeCommitSha: sha, updatedAt: now - 1000 },
  heartbeat: { schema: "disdex-runner-heartbeat/v1", runnerId: "V12_X1_ALL", runtimeSha: sha, expectedSha: sha, serviceUnit: "disdex-v12-x1-all@" + sha + ".service", mode: "LIVE", liveEnabled: true, safetyState: "HEALTHY", mainPid: 123, heartbeatAt: now - 1000, lastTickAt: now - 1000 },
  sharedKill: { active: false } };
}
test("LIVE requires coherent fresh state, service heartbeat and explicit inactive shared protection", () => {
 assert.equal(evaluateV12RuntimeBadge(good()).status, "LIVE");
});
for(const [name, key, patch] of [
 ["future state", "state", { updatedAt: now + 1 }],
 ["stale state", "state", { updatedAt: now - 10800001 }],
 ["missing state lineage", "state", { runtimeCommitSha: undefined }],
 ["mismatched state lineage", "state", { runtimeCommitSha: other }],
 ["PAPER state", "state", { mode: "PAPER" }],
 ["manual review", "state", { manualReview: "RECONCILE" }],
 ["embedded hold", "state", { killSwitch: { active: true } }],
 ["future heartbeat", "heartbeat", { heartbeatAt: now + 1 }],
 ["future tick", "heartbeat", { lastTickAt: now + 1 }],
 ["stale heartbeat", "heartbeat", { heartbeatAt: now - 180001 }],
 ["two-hour-old healthy positive PID", "heartbeat", { heartbeatAt: now - 7200000 }],
 ["stale tick", "heartbeat", { lastTickAt: now - 10800001 }],
 ["blocked service", "heartbeat", { safetyState: "BLOCKED", healthReason: "service failed" }],
 ["disabled service", "heartbeat", { liveEnabled: false }],
 ["dead service", "heartbeat", { mainPid: 0 }],
 ["wrong heartbeat SHA", "heartbeat", { runtimeSha: other }],
 ["wrong expected SHA", "heartbeat", { expectedSha: other }],
 ["wrong service unit", "heartbeat", { serviceUnit: "disdex-v12-x1-all@" + other + ".service" }],
 ["unrelated heartbeat", "heartbeat", { runnerId: "PENGU_V8" }],
 ["protected hold", "sharedKill", { active: true, action: "HOLD_PROTECTED" }],
 ["unknown shared protection", "sharedKill", { active: undefined }],
 ["coerced shared protection", "sharedKill", { active: "false" }],
 ] as const) {
 test(name + " cannot display LIVE", () => {
  const input = good(); input[key] = { ...(input[key] as object), ...patch };
  assert.notEqual(evaluateV12RuntimeBadge(input).status, "LIVE");
 });
}
test("missing current marker, heartbeat or shared protection cannot pass", () => {
 for (const patch of [{ currentReleaseSha: undefined }, { currentReleaseSha: other }, { heartbeat: null }, { sharedKill: null }, { configured: false }]) assert.notEqual(evaluateV12RuntimeBadge({ ...good(), ...patch }).status, "LIVE");
});
test("file reader uses current marker and fails closed on missing/malformed kill JSON", async () => {
 const root = await mkdtemp(join(tmpdir(), "v12-badge-"));
 try {
  const markerPath=join(root,"marker"),heartbeatPath=join(root,"heartbeat.json"),killSwitchPath=join(root,"kill.json");
  await writeFile(markerPath,sha); await writeFile(heartbeatPath,JSON.stringify(good().heartbeat));
  const options={ configured:true,state:good().state,expectedReleaseSha:sha,now,markerPath,heartbeatPath,killSwitchPath };
  assert.equal((await loadV12RuntimeBadge(options)).status,"UNCONFIRMED");
  await writeFile(killSwitchPath,"not json");
  assert.equal((await loadV12RuntimeBadge(options)).status,"UNCONFIRMED");
  await writeFile(killSwitchPath,JSON.stringify({active:false}));
  assert.equal((await loadV12RuntimeBadge(options)).status,"LIVE");
  await writeFile(markerPath,other);
  assert.notEqual((await loadV12RuntimeBadge(options)).status,"LIVE");
 } finally { await rm(root,{recursive:true,force:true}); }
});
