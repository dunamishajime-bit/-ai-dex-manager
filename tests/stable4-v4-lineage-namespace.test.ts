import test from "node:test";
import assert from "node:assert/strict";
import { strategyFromClientOrderId, parseFillLineageEvidenceLine } from "../lib/server/fill-lineage-evidence";

const cid = "v12-v4-" + "a".repeat(28);
test("exact V4 order namespace is never classified as legacy V12", () => {
  assert.equal(strategyFromClientOrderId(cid), "V12_V4");
  assert.equal(parseFillLineageEvidenceLine(JSON.stringify({ orderId:"123", symbol:"BTCUSDT", clientOrderId:cid }))?.strategyId, "V12_V4");
});
test("malformed V4 namespace cannot fall through to legacy V12", () => {
  for (const invalid of ["v12-v4-", "v12-v4-short", cid + "x"]) assert.equal(strategyFromClientOrderId(invalid), undefined);
});
test("existing legacy namespaces retain their classification", () => {
  for (const [id, strategy] of [["v12-entry-abc","V12_X1.00_ALL"],["fet-entry-abc","FET_BRK48_RESIDUAL"],["q102v1-abc","QUALITY102_CAUSAL_V1"],["dualls2-abc","PENGU_DUAL_LS_V2_FINAL"],["rec-v8-abc","PENGU_DUAL_LS_V2_FINAL"]]) assert.equal(strategyFromClientOrderId(id),strategy);
});
