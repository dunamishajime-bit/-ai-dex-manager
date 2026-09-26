import assert from "node:assert/strict";
import test from "node:test";
import {safeV12MultiGateChecks, diagnoseSignalGate} from "../lib/server/v12-decision-observability";

const valid={
  volume:{actual:0.3,minimum:0.9845,pass:false},
  momentum:{actual:0.08,minimumAbsolute:0.0227,pass:true},
  edgeToCost:{actual:0.08,minimumAbsolute:0.0060879,pass:true},
  btcDirection:{regime:"LONG",side:"LONG",pass:true},
  scoreQuality:{actual:0.85,normalMinimum:1.4649,strongMinimum:0.15,strongMaximum:0.7,
    atrRatio:0.02,minimumAtrRatio:0.014,normalPass:false,strongBandPass:false,
    relaxedMomentumPass:false,pass:false,strongScoreGap:true},
  selection:{evaluated:false,selected:false},winRate:{evaluated:false},
  failedGates:["VOLUME_RATIO","SCORE_OR_QUALITY"],qualityRoute:"BLOCKED",
};
test("runner simultaneous volume and score gap verdicts survive UI sanitization",()=>{
  const s=safeV12MultiGateChecks(valid);
  assert.equal(s?.volume.pass,false);
  assert.equal(s?.momentum.pass,true);
  assert.equal(s?.scoreQuality.strongScoreGap,true);
  assert.deepEqual(s?.failedGates,["VOLUME_RATIO","SCORE_OR_QUALITY"]);
});
test("old snapshot does not manufacture pass/fail for missing multi-gates",()=>{
  assert.equal(safeV12MultiGateChecks(undefined),undefined);
  assert.equal(safeV12MultiGateChecks({volume:valid.volume}),undefined);
  assert.equal(diagnoseSignalGate({symbol:"LTC",signalEligible:false,signalReason:"VOLUME_RATIO_BELOW_MINIMUM"}).status,"blocked");
});
test("malformed multi-gate payload does not override authoritative runner reason",()=>{
  assert.equal(safeV12MultiGateChecks({...valid,scoreQuality:{...valid.scoreQuality,pass:"yes"}}),undefined);
  assert.equal(diagnoseSignalGate({symbol:"LTC",signalEligible:false,signalReason:"VOLUME_RATIO_BELOW_MINIMUM"}).code,"VOLUME_RATIO_BELOW_MINIMUM");
});
