import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertPendingApplyCertified, assertPendingReconcileUser, buildPendingReconciledRegistry, parsePendingReconcileArgs, validatePendingReadonlyReconcile, validatePendingRegistryMetadata } from "../scripts/ops/root/disdex-pending-exposure-readonly-reconcile";

const REGISTRY = {
  schema: "disdex-pending-exposure/v1",
  accountScope: "ASTER_FUTURES",
  updatedAt: 1_000,
  entries: [{reservationId:"r",strategyId:"V12_V4",sleeve:"CRYPTO",symbol:"DOGEUSDT",
    side:"SHORT",gross:0.1,notionalUsd:10,status:"RELEASED",createdAt:900,updatedAt:950}],
};

test("pending read-only reconcile accepts only flat venue plus released registry", () => {
  const result=validatePendingReadonlyReconcile({registry:REGISTRY,positions:[],openOrders:[]});
  assert.equal(result.positionCount,0);
  assert.equal(result.openOrderCount,0);
});

test("pending read-only reconcile blocks active registry or venue exposure", () => {
  assert.throws(()=>validatePendingReadonlyReconcile({
    registry:{...REGISTRY,entries:[{...REGISTRY.entries[0],status:"PENDING"}]},
    positions:[],openOrders:[],
  }),/ACTIVE_REGISTRY_ENTRIES/);
  assert.throws(()=>validatePendingReadonlyReconcile({
    registry:REGISTRY,positions:[{positionAmt:"1"}],openOrders:[],
  }),/NONFLAT_REQUIRES_OWNERSHIP_PROOF/);
  assert.throws(()=>validatePendingReadonlyReconcile({
    registry:REGISTRY,positions:[],openOrders:[{orderId:1}],
  }),/NONFLAT_REQUIRES_OWNERSHIP_PROOF/);
});

test("pending reconciliation rejects missing numbers and a different account scope", () => {
  assert.throws(()=>validatePendingReadonlyReconcile({
    registry:{...REGISTRY,accountScope:"OTHER"},positions:[],openOrders:[],
  }),/ACCOUNT_SCOPE/);
  for (const amount of [null, undefined, "", "  "]) {
    assert.throws(()=>validatePendingReadonlyReconcile({
      registry:REGISTRY,positions:[{positionAmt:amount}],openOrders:[],
    }),/POSITION_AMOUNT_INVALID/);
  }
  for (const field of ["gross", "notionalUsd"]) {
    assert.throws(()=>validatePendingReadonlyReconcile({
      registry:{...REGISTRY,entries:[{...REGISTRY.entries[0],[field]:null}]},
      positions:[],openOrders:[],
    }),/REGISTRY_AMOUNT_INVALID/);
  }
});

test("a verified pending refresh preserves every existing registry and entry field", () => {
  const original={...REGISTRY, extraRoot:{source:"keep"}, entries:[{...REGISTRY.entries[0], extraEntry:"keep"}]};
  const updated=buildPendingReconciledRegistry(original, 2_000);
  assert.deepEqual(updated,{...original,updatedAt:2_000});
  assert.equal(original.updatedAt,1_000);
  assert.throws(()=>buildPendingReconciledRegistry(original,0),/VERIFIED_AT_INVALID/);
});

test("pending reconciliation accepts only explicit mutually exclusive CLI modes", () => {
  assert.deepEqual(parsePendingReconcileArgs(["--verify-only"]), {apply:false});
  assert.deepEqual(parsePendingReconcileArgs(["--apply-refresh"]), {apply:true});
  for (const args of [[],["--verify-only","--apply-refresh"],["--verify-only","--other"],["--apply-refresh","--apply-refresh"]]) {
    assert.throws(()=>parsePendingReconcileArgs(args),/PENDING_RECONCILE_MODE/);
  }
});

test("pending state mutation remains blocked until a scoped executor is certified", () => {
  assert.doesNotThrow(()=>assertPendingApplyCertified(false));
  assert.throws(()=>assertPendingApplyCertified(true),/APPLY_NOT_CERTIFIED/);
});

test("pending registry requires a trusted owner, parent, and restrictive modes", () => {
  const valid={fileIsRegular:true,fileIsSymlink:false,fileUid:1000,fileGid:1000,fileMode:0o600,
    parentIsDirectory:true,parentIsSymlink:false,parentUid:1000,parentGid:1000,parentMode:0o2770,
    deployUid:1000,deployGid:1000};
  assert.doesNotThrow(()=>validatePendingRegistryMetadata(valid));
  for (const bad of [{fileIsSymlink:true},{fileUid:0},{fileGid:0},{fileMode:0o666},
    {parentIsSymlink:true},{parentUid:0},{parentMode:0o777}]) {
    assert.throws(()=>validatePendingRegistryMetadata({...valid,...bad}),/REGISTRY_UNTRUSTED/);
  }
});

test("pending reconciliation runs as deploy, preventing root-owned account locks", () => {
  assert.doesNotThrow(()=>assertPendingReconcileUser(1000,1000,1000,1000));
  for (const [uid,gid] of [[0,0],[0,1000],[1000,0],[1001,1000]]) {
    assert.throws(()=>assertPendingReconcileUser(uid,gid,1000,1000),/EXECUTION_USER_INVALID/);
  }
});

test("pending reconcile source cannot place, cancel, or close orders", () => {
  const source=readFileSync("scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts","utf8");
  assert.doesNotMatch(source,/placeOrder|cancelOrder|closePosition|submitOrder/);
  assert.match(source,/ordersSent: 0/);
  assert.match(source,/positionChangesSent: 0/);
  assert.match(source,/assertV4SharedRateBudget\(process\.env\.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH\)/);
  assert.match(source,/fetchImpl:\s*createV4EvidenceFetch\(fetch\)/);
  assert.match(source,/await handle\.renew\(\)/);
});
