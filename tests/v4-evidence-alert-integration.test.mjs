import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/ops/root/disdex-runner-health-alert.ts", import.meta.url), "utf8");

test("V4 expiry monitoring is wired to the existing provider-backed notification path", () => {
  assert.match(source, /inspectRootEvidenceFiles/);
  assert.match(source, /observeV4EvidenceExpiry/);
  assert.match(source, /formatV4EvidenceExpiryEmail/);
  assert.match(source, /markV4EvidenceExpiryAttempt/);
  assert.match(source, /markV4EvidenceExpiryDelivered/);
  assert.match(source, /await sendAlert\(mail\.subject, mail\.text\)/);
  assert.match(source, /DISDEX_V4_EVIDENCE_EXPIRY_ALERT status=/);
});

test("expiry alert integration remains observational and cannot mutate trading state", () => {
  for (const forbidden of ["placeMarketOrder(", "placeConditionalOrder(", "placeStopMarketOrder(", "cancelOrder(", "setLeverage(", "setMarginType(", "Kill Switch解除"]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), forbidden);
  }
});
