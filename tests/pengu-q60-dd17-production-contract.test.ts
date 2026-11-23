import assert from "node:assert/strict";
import test from "node:test";

import { INTEGRATED_PRODUCTION_RISK_POLICY } from "../config/integratedProductionRiskPolicy";
import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";

test("new PENGU production profile is COMBINED_FILTERED with fixed gross 1.0 and Q60/DD17/H72", () => {
    assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.penguMaximumGross, 1.0);
    assert.equal(PENGU_DUAL_LS_V2.maximumGross, 1.0);
    assert.equal(PENGU_DUAL_LS_V2.longGross, 1.0);
    assert.equal(PENGU_DUAL_LS_V2.shortGross, 1.0);
    assert.equal(PENGU_DUAL_LS_V2.logicProfile, "COMBINED_FILTERED_Q60_DD17_H72");
    assert.equal(PENGU_DUAL_LS_V2.routeHardStopQuarantineHours, 60);
    assert.equal(PENGU_DUAL_LS_V2.realizedDrawdownThresholdPct, 17);
    assert.equal(PENGU_DUAL_LS_V2.realizedDrawdownHoldHours, 72);
});
