import {strict as assert} from "node:assert";
import {test} from "node:test";
import {readFileSync} from "node:fs";

const risk=JSON.parse(readFileSync(
  new URL("../docs/production/stable4-dd30-h48-stop8-risk-owner-candidate-20261126.json",import.meta.url),"utf8"));
const plan=JSON.parse(readFileSync(
  new URL("../docs/production/stable4-dd30-live-plan-candidate-20261125.json",import.meta.url),"utf8"));

test("owner Gross decision is exact 3/4/4.25/HYPE1.5 without forging Root or HP signature",()=>{
  const approved={cryptoGross:3,stockGross:4,totalGross:4.25,hypeGross:1.5};
  assert.equal(risk.grossDecision,"OWNER_CHAT_INSTRUCTION_APPROVED_PENDING_SIGNED_HP_APPROVAL");
  assert.equal(risk.ownerGrossInstruction.source,"EXPLICIT_OWNER_INSTRUCTION_IN_CURRENT_CHAT");
  assert.equal(risk.ownerGrossInstruction.recordedDateJst,"2026-11-26");
  assert.deepEqual(risk.ownerGrossInstruction.approvedCaps,approved);
  assert.equal(risk.ownerGrossInstruction.scope,"GROSS_CAPS_ONLY");
  assert.equal(risk.ownerGrossInstruction.isSignedHpApproval,false);
  assert.equal(risk.ownerGrossInstruction.isRootCertificate,false);
  assert.equal(risk.ownerGrossInstruction.isOrderPermit,false);
  assert.equal(risk.ownerGrossInstruction.isLiveDeploymentAuthorization,false);
  assert.deepEqual(plan.economics.grossCaps,
    {crypto:3,stock:4,total:4.25,hype:1.5});
  assert.deepEqual(plan.ownerChatApproval.approved,
    {crypto:3,stock:4,total:4.25,hype:1.5});
});
test("neither Gross approval artifact is a LIVE Root plan, permit or global HOLD release",()=>{
  assert.equal(risk.status,"DRAFT_NOT_AUTHORIZED");
  assert.equal(risk.ordersEnabled,false);
  assert.equal(plan.reviewStatus,"DRAFT_NOT_AUTHORIZED");
  assert.equal(plan.ownerChatApproval.signedHpApprovalId,null);
  assert.equal(plan.ownerChatApproval.signedRootCertificate,null);
  assert.equal(plan.globalHold.clearGlobalHold,false);
  assert.equal(plan.safety.noManualKillSwitchClear,true);
  assert.equal(plan.safety.noTestOrders,true);
});
test("new H48 STOP8 is NOT the old TIME_ONLY policy or old signed Root authority",()=>{
  assert.equal(risk.hype.policy,"H48_R4_RESIDENT_STOP8");
  assert.equal(risk.hype.oldH48TimeOnlyCertificateValidForThisPolicy,false);
  assert.equal(risk.hype.residentStopMarketRequired,true);
  assert.equal(risk.hype.emergencyStopTriggerPct,8);
  assert.equal(plan.runnerOrderAuthorities.hype.policy,"H48_R4_RESIDENT_STOP8");
  assert.equal(plan.runnerOrderAuthorities.hype.residentStopRequired,true);
  assert.equal(plan.runnerOrderAuthorities.hype.previousH48TimeOnlyCertificateMayAuthorize,false);
  assert.equal(plan.runnerOrderAuthorities.hype.authenticatedStopReadbackRequired,true);
});
