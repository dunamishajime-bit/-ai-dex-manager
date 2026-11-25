import {strict as assert} from "node:assert";
import {test} from "node:test";
import {generateKeyPairSync,sign} from "node:crypto";
import {
  attestH48Stop8RootBundle,H48_STOP8_ROOT_BUNDLE_SCHEMA,
  type H48Stop8RootBundle,
} from "../lib/hype-h48-stop8-root-authority";

const SOURCE="4786f600ae7bf86ffca948f1412956a9113cb20d";
const PLAN="b".repeat(64);
const NOW=Date.UTC(2026,10,26,4,30,0);
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const publicPem=publicKey.export({format:"pem",type:"spki"}) as string;
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):
  v&&typeof v==="object"
    ?Object.fromEntries(Object.entries(v as Record<string,unknown>)
      .sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,canonical(value)]))
    :v;
const encode=(v:unknown)=>JSON.stringify(canonical(v));
function token(changes:Record<string,unknown>={}){
  const payload={
    schema:"disdex-owner-deployment-approval/v2",repository:"dunamishajime-bit/-ai-dex-manager",
    deploymentTarget:"professional-dismanager.net",
    operatorTarget:"DD1296_FINAL_ALLIN_10BPS",route:"GITHUB_ACTIONS",
    sourceSha:SOURCE,scope:"HYPE_TREND_LONG",operator:"dunamishajime-bit",
    nonce:"a".repeat(32),issuedAt:Math.floor(NOW/1000)-10,
    expiresAt:Math.floor(NOW/1000)+100,
    planSha256:PLAN,ordersEnabled:true,...changes,
  };
  const signature=sign(null,Buffer.from(encode(payload)),privateKey).toString("base64");
  return Buffer.from(encode({payload,signature})).toString("base64");
}
function bundle(changes:Partial<H48Stop8RootBundle>={}):H48Stop8RootBundle{
  return {
    schema:H48_STOP8_ROOT_BUNDLE_SCHEMA,approvedSha:SOURCE,planSha256:PLAN,
    deploymentTarget:"professional-dismanager.net",
    scope:"HYPE_TREND_LONG",operation:"HYPE_STABLE4_H48_STOP8_LIVE",
    policy:"H48_R4_RESIDENT_STOP8",residentStopRequired:true,
    residentTakeProfitRequired:false,stopTriggerPct:8,
    stopOrderType:"STOP_MARKET",stopReduceOnly:true,
    gross:{crypto:3,stock:4,total:4.25,hype:1.5},
    approvalId:"11111111-1111-4111-8111-111111111111",
    ownerSignedToken:token(),issuedAt:NOW,expiresAt:NOW+30*86_400_000,
    maxEntryNotionalUsd:250,maxSlippageBps:30,...changes,
  };
}
function attest(b:unknown,options:{
  bytes?:string;source?:string;plan?:string;
  key?:string;now?:number;
}={}){
  return attestH48Stop8RootBundle({
    bundle:b,rootCertificateBytes:Buffer.from(options.bytes??encode(b)+"\n"),
    trustedOwnerEd25519PublicPem:Buffer.from(options.key??publicPem),
    sourceSha:options.source??SOURCE,planSha256:options.plan??PLAN,
    now:options.now??NOW+1000,
  });
}
test("an independent Ed25519 Owner token, exact STOP8 Root bundle and SHA/plan is accepted READ ONLY",()=>{
  const b=bundle(),result=attest(b);
  assert.equal(result.bundle.policy,"H48_R4_RESIDENT_STOP8");
  assert.equal(result.bundle.stopTriggerPct,8);
  assert.equal(result.bundle.gross.total,4.25);
  assert.match(result.certificateSha256,/^[0-9a-f]{64}$/);
});
test("legacy H48_TIME_ONLY, no STOP and different Gross never produce a valid Root grant",()=>{
  for(const edited of [
    {policy:"H48_TIME_ONLY" as never},
    {residentStopRequired:false as never},
    {residentTakeProfitRequired:true as never},
    {stopTriggerPct:5 as never},
    {gross:{crypto:3,stock:1.5,total:3.5,hype:1} as never},
    {operation:"HYPE_STABLE4_H48_TIME_ONLY_LIVE" as never},
  ]){
    assert.throws(()=>attest(bundle(edited)),/H48_STOP8_ROOT_GRANT_INVALID/);
  }
});
test("Owner signature rejects wrong SHA/plan, forged public key and altered source",()=>{
  assert.throws(()=>attest(bundle({ownerSignedToken:token({sourceSha:"f".repeat(40)})})),/OWNER_SIGNED_PLAN_POLICY_SCOPE_MISMATCH/);
  assert.throws(()=>attest(bundle({ownerSignedToken:token({planSha256:"f".repeat(64)})})),/OWNER_SIGNED_PLAN_POLICY_SCOPE_MISMATCH/);
  assert.throws(()=>attest(bundle(),{source:"f".repeat(40)}),/EXACT_ROOT_CERTIFICATE_FIELDS/);
  const other=generateKeyPairSync("ed25519").publicKey.export({format:"pem",type:"spki"}) as string;
  assert.throws(()=>attest(bundle(),{key:other}),/OWNER_ED25519_SIGNATURE_INVALID/);
});
test("certificate tampering, expired cert and wrong binding are rejected before any order",()=>{
  const b=bundle();
  assert.throws(()=>attest(b,{bytes:encode({...b,policy:"H48_TIME_ONLY"})+"\n"}),/ROOT_CERTIFICATE_CANONICAL_BYTES/);
  assert.throws(()=>attest(b,{now:NOW+31*86_400_000}),/EXACT_ROOT_CERTIFICATE_FIELDS/);
  assert.throws(()=>attest(b,{plan:"f".repeat(64)}),/EXACT_ROOT_CERTIFICATE_FIELDS/);
  assert.throws(()=>attest({...b,extraField:"NOT_PERMITTED"}),/EXACT_ROOT_CERTIFICATE_FIELDS/);
});
test("Owner token JSON duplicate fields, noncanonical base64, unsigned or forged envelope are rejected",()=>{
  const b=bundle();
  const raw=Buffer.from(b.ownerSignedToken,"base64").toString("utf8");
  assert.throws(()=>attest(bundle({ownerSignedToken:Buffer.from(raw.slice(0,-1)+',"payload":{}}').toString("base64")})),/OWNER_TOKEN_FIELDS/);
  assert.throws(()=>attest(bundle({ownerSignedToken:"***"})),/OWNER_TOKEN_ENCODED_INVALID/);
  const o=JSON.parse(raw);
  o.signature=Buffer.alloc(64,42).toString("base64");
  assert.throws(()=>attest(bundle({ownerSignedToken:Buffer.from(encode(o)).toString("base64")})),/OWNER_ED25519_SIGNATURE_INVALID/);
});
