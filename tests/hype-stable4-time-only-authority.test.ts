import test from "node:test";
import assert from "node:assert/strict";
import {validateH48TimeOnlyCertificate,validateH48SignedInventory} from "../lib/hype-stable4-time-only-authority";
const SHA="a".repeat(40),T=1800000000000;
const certificate=()=>({schema:"disdex-stable4-h48-time-only-policy/v1",approvedSha:SHA,researchSha:"9e1142f5ec6d4bc285deef023572623bb1c37a34",planSha256:"b".repeat(64),deploymentTarget:"professional-dismanager.net",policy:"H48_TIME_ONLY",route:"HYPE_REDESIGN_CAUSAL_H48R4_WSIG",symbol:"HYPEUSDT",side:"LONG",holdHours:48,entryGridHours:6,residentStopRequired:false,residentTakeProfitRequired:false,approvedGross:{crypto:3,stock:4,total:4.25,hype:1},issuedAt:T-1000,expiresAt:T+10000,operatorAcknowledgement:"H48_TIME_ONLY",authorizesOtherPolicies:false});
test("root H48 certificate binds exact source/research/exit and approved gross scope",()=>{
 assert.equal(validateH48TimeOnlyCertificate(certificate(),SHA,T).approvedSha,SHA);
 for(const change of [{approvedSha:"c".repeat(40)},{researchSha:"c".repeat(40)},{planSha256:""},{policy:"TREND"},{residentStopRequired:true},{residentTakeProfitRequired:true},{approvedGross:{crypto:3,stock:1.5,total:3.5,hype:1}},{expiresAt:T},{issuedAt:T+1},{authorizesOtherPolicies:true},{operatorAcknowledgement:"YES"},{extra:true}])assert.throws(()=>validateH48TimeOnlyCertificate({...certificate(),...change},SHA,T),/CERTIFICATE/);
});
test("signed H48 inventory requires exact positive LONG ownership and no HYPE order",()=>{
 const row={symbol:"HYPEUSDT",quantity:2,positionSide:"BOTH"} as any;
 validateH48SignedInventory([],[],"ENTRY",2);
 validateH48SignedInventory([row],[],"POSITION",2);
 for(const [positions,orders,phase] of [
  [[row],[],"ENTRY"],[[],[],"POSITION"],[[row,row],[],"POSITION"],
  [[{...row,quantity:-2}],[],"POSITION"],[[{...row,quantity:1}],[],"POSITION"],
  [[{...row,positionSide:"SHORT"}],[],"POSITION"],[[row],[{symbol:"HYPEUSDT"}],"POSITION"],
  [[null],[],"POSITION"],[[{...row,quantity:NaN}],[],"POSITION"],
 ] as any[])assert.throws(()=>validateH48SignedInventory(positions,orders,phase,2),/CERTIFICATE/);
});
