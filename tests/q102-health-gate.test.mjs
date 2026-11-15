import assert from "node:assert/strict";
import test from "node:test";

import { resolveQuality102OperatorGateReason } from "../lib/disdex-q102-health-gate.mjs";

const validEnvironment = [
  "QUALITY102_CAUSAL_V1_MODE=LIVE",
  "QUALITY102_CAUSAL_V1_ENABLED=true",
  "QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED=true",
  "QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=true",
  "QUALITY102_CAUSAL_V1_OPERATOR_ARMED=true",
  "QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4",
  "QUALITY102_LIVE_ENABLED=false",
  "QUALITY102_LIVE_SELECTOR_PARITY=false",
].join(" ");

test("causal V1 LIVE gates allow health while historical parity remains false", () => {
  assert.equal(resolveQuality102OperatorGateReason(validEnvironment), "");
});

test("missing causal V1 operator arm fails closed", () => {
  const environment = validEnvironment.replace(
    "QUALITY102_CAUSAL_V1_OPERATOR_ARMED=true",
    "QUALITY102_CAUSAL_V1_OPERATOR_ARMED=false",
  );
  assert.equal(
    resolveQuality102OperatorGateReason(environment),
    "QUALITY102_CAUSAL_V1_LIVE_GATE_INCOMPLETE:QUALITY102_CAUSAL_V1_OPERATOR_ARMED",
  );
});

test("wrong selector mode fails closed", () => {
  const environment = validEnvironment.replace(
    "QUALITY102_CAUSAL_V1_SELECTOR_MODE=CAUSAL_V4",
    "QUALITY102_CAUSAL_V1_SELECTOR_MODE=DERIVED_HIGH_VOL_ONLY",
  );
  assert.equal(
    resolveQuality102OperatorGateReason(environment),
    "QUALITY102_CAUSAL_V1_SELECTOR_MODE_ACK_REQUIRED",
  );
});

test("historical selector parity cannot be enabled through the causal gate", () => {
  const environment = validEnvironment.replace(
    "QUALITY102_LIVE_SELECTOR_PARITY=false",
    "QUALITY102_LIVE_SELECTOR_PARITY=true",
  );
  assert.equal(
    resolveQuality102OperatorGateReason(environment),
    "QUALITY102_HISTORICAL_SELECTOR_FLAG_MUST_REMAIN_FAIL_CLOSED",
  );
});

test("missing environment fails closed without exposing environment values", () => {
  assert.equal(
    resolveQuality102OperatorGateReason(""),
    "QUALITY102_CAUSAL_V1_LIVE_GATE_INCOMPLETE:QUALITY102_CAUSAL_V1_MODE",
  );
});
