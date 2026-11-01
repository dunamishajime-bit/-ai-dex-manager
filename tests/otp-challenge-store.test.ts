import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("OTP challenge is server-side, single-use, attempt-bounded and race-safe", async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"disdex-otp-"));
  process.env.DISDEX_OTP_CHALLENGE_STORE_PATH=path.join(dir,"otp.json");
  const store=await import("../lib/server/otp-challenge-store");
  try{
    const c=await store.createOtpChallenge({
      purpose:"ADMIN_LOGIN",subject:"owner",codeHash:"a".repeat(64),
      now:1000,expiresAt:5000,maxAttempts:3,
    });
    assert.ok(c.id);
    const wrong=await store.consumeOtpChallenge({id:c.id,codeHash:"b".repeat(64),now:2000});
    assert.equal(wrong.ok,false);
    assert.equal(wrong.remainingAttempts,2);

    const attempts=await Promise.allSettled([
      store.consumeOtpChallenge({id:c.id,codeHash:"a".repeat(64),now:2500}),
      store.consumeOtpChallenge({id:c.id,codeHash:"a".repeat(64),now:2500}),
    ]);
    const ok=attempts.filter(x=>x.status==="fulfilled"&&x.value.ok);
    assert.equal(ok.length,1);
    const after=await store.consumeOtpChallenge({id:c.id,codeHash:"a".repeat(64),now:2600});
    assert.equal(after.ok,false);
    assert.match(after.reason,/CONSUMED|REPLAY/);

    const expired=await store.createOtpChallenge({
      purpose:"ADMIN_LOGIN",subject:"owner",codeHash:"c".repeat(64),
      now:1000,expiresAt:1500,maxAttempts:1,
    });
    assert.equal((await store.consumeOtpChallenge({id:expired.id,codeHash:"c".repeat(64),now:1501})).ok,false);
  } finally {
    await fs.rm(dir,{recursive:true,force:true});
  }
});
