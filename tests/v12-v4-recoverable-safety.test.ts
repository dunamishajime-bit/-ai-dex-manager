import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildV4HealthPayload, classifyV4RecoverableSafetyFailure, waitForV4Daemon } from "../scripts/v12-v4-production-runner";

test("V4 shutdown interrupts an idle wait and handles shutdown before the wait", {timeout: 1000}, async () => {
  const shutdown = new AbortController();
  const sleeping = waitForV4Daemon(60_000, shutdown.signal);
  shutdown.abort();
  await sleeping;
  await waitForV4Daemon(60_000, shutdown.signal);
});

test("stale dynamic evidence and an unavailable peer block orders and can retry", () => {
  for (const reason of ["V4_EVIDENCE_STALE:signedAsterAccount", "V4_EVIDENCE_STALE:sharedRiskAndPeers",
    'V4_REFRESH_LEASE_EXPIRED','V4_REFRESH_COMMIT_STALE',
    'FRESH_SHARED_ACCOUNT_LEDGER_REQUIRED','V4_SIGNED_ACCOUNT_READ_WINDOW_STALE',
    "V4_PEER_UNIT_NOT_RUNNING_OR_WRONG_SHA:peer.service"]) {
    const result=classifyV4RecoverableSafetyFailure(new Error(reason),1000);
    assert.equal(result?.status,"blocked"); assert.equal(result?.orderEnabled,false);
  }
});

test("tampering, static evidence drift and ambiguous order timeouts remain fatal", () => {
  for (const reason of ["V4_EVIDENCE_STALE:routeSourceParity", "V4_EVIDENCE_DIGEST_MISMATCH:signedAsterAccount",
    'V4_REFRESH_COMMIT_INVALID','V4_REFRESH_COMMIT_UNTRUSTED','V4_REFRESH_GENERATION_MISMATCH',
    "V4_EVIDENCE_CANDIDATE_SHA_MISMATCH:signedAsterAccount", "Aster request timeout after 10000ms", "ECONNRESET", "UNKNOWN_FATAL"]) {
    assert.equal(classifyV4RecoverableSafetyFailure(new Error(reason),1000),undefined);
  }
});

test("heartbeat liveness and last completed tick are distinct while orders remain blocked", () => {
  const blocked=classifyV4RecoverableSafetyFailure(new Error("V4_EVIDENCE_STALE:signedAsterAccount"),1000)!;
  const before=buildV4HealthPayload("a".repeat(40),"CERTIFIED",blocked,null,1500);
  assert.equal(before.heartbeatAt,1500); assert.equal(before.lastTickAt,null);
  assert.equal(before.safetyState,"BLOCKED"); assert.equal(before.ordersAllowed,false);
  assert.equal(before.processAlive,true); assert.equal(before.orderPermission,"BLOCKED");
  const after=buildV4HealthPayload("a".repeat(40),"CERTIFIED",blocked,900,1600);
  assert.equal(after.heartbeatAt,1600); assert.equal(after.lastTickAt,900);
  const locked=buildV4HealthPayload("a".repeat(40),"CERTIFIED",{...blocked,status:"locked",orderEnabled:true},900,1700);
  assert.equal(locked.safetyState,"BLOCKED"); assert.equal(locked.ordersAllowed,false);
});

test("production runner publishes tick markers only after a completed processing result", () => {
  const path="scripts/v12-v4-production-runner.ts";
  const source=readFileSync(path,"utf8");
  assert.match(source,/if\s*\(tickCompleted\)\s*\{[\s\S]*?await writeRunnerTickHeartbeat\(/);
  assert.match(source,/lastCompletedTickAt\s*=\s*tickCompletedAt/);
});
