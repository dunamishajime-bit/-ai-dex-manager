import { strict as assert } from "node:assert";
import test from "node:test";
import { buildPenguQuality102IntegrationEvent } from "../lib/pengu-quality102-integration-status";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("PENGU reports causal Q102 ownership wiring instead of the retired selector manifest", () => {
  const event = buildPenguQuality102IntegrationEvent({ expectedRuntimeSha: SHA });

  assert.equal(event.event, "quality102-causal-v1-integration");
  assert.equal(event.ownershipCheck, "PER_TICK");
  assert.equal(event.expectedRuntimeSha, SHA);
  assert.equal(event.legacySelectorManifestRequired, false);
  assert.equal("quality102LiveBlockedFailClosed" in event, false);
  assert.equal("reason" in event, false);
});
