import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=(p)=>fs.readFileSync(p,"utf8");

test("server auth routes do not trust fixed auth cookies",()=>{
  for(const p of [
    "app/api/admin/route.ts",
    "app/api/admin/deploy-approval/route.ts",
    "app/api/production-approval/route.ts",
    "app/api/auth/profile/route.ts",
    "app/api/auth/users/route.ts",
    "app/api/auth/delete/route.ts",
    "app/api/auth/approve/route.ts",
  ]){
    const src=read(p);
    assert.match(src,/owner-session|requireOwnerSession|verifyRequestSession/);
    assert.doesNotMatch(src,/\.value\s*===\s*["'](?:1|active)["']/);
  }
});

test("admin OTP does not store code hash or expiry in client cookies",()=>{
  const src=read("app/api/admin/route.ts");
  assert.doesNotMatch(src,/disdex_admin_2fa_hash/);
  assert.doesNotMatch(src,/disdex_admin_2fa_expires/);
  assert.match(src,/createOtpChallenge/);
  assert.match(src,/consumeOtpChallenge/);
  assert.match(src,/sent\.simulated/);
});

test("profile and user administration require strict mutation origin checks",()=>{
  for(const p of [
    "app/api/auth/profile/route.ts",
    "app/api/auth/delete/route.ts",
    "app/api/auth/approve/route.ts",
    "app/api/admin/route.ts",
    "app/api/admin/deploy-approval/route.ts",
    "app/api/production-approval/route.ts",
  ]){
    assert.match(read(p),/requireSameOriginMutation/);
  }
});
