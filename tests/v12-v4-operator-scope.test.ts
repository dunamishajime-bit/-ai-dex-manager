import test from "node:test";
import assert from "node:assert/strict";
import {TRADING_RUNNERS,VALID_TRADING_RUNNERS,validateOperatorActivationArtifact} from
 "../scripts/ops/root/disdex-live-operator-activation-gate.mjs";
test("V4 is a separate operator scope without changing legacy seven-runner --all gate",()=>{
 assert.equal(TRADING_RUNNERS.length,7);
 assert.equal(TRADING_RUNNERS.includes("V12_V4"),false);
 assert.equal(VALID_TRADING_RUNNERS.includes("V12_V4"),true);
 const sha="a".repeat(40),now=new Date().toISOString();
 const artifact={schema:"disdex-live-operator-activation/v1",approvedSha:sha,
  target:"disdex-trading",ordersEnabled:true,
  operatorAcknowledgement:"I_ACK_REAL_MONEY_LIVE_ACTIVATION",
  approvedAt:now,approvedRunners:["V12_X1_ALL"]};
 assert.equal(validateOperatorActivationArtifact(artifact,{sha,target:"disdex-trading",runner:"V12_V4"}).allowed,false);
 assert.equal(validateOperatorActivationArtifact({...artifact,approvedRunners:["V12_V4"]},
  {sha,target:"disdex-trading",runner:"V12_V4"}).allowed,true);
 assert.equal(validateOperatorActivationArtifact({...artifact,approvedRunners:["V12_V4"]},
  {sha:"b".repeat(40),target:"disdex-trading",runner:"V12_V4"}).allowed,false);
});
