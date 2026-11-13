import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../lib/server/password-hash";

test("new password hashes use scrypt and are not reversible base64", async()=>{
  const password="test-password-123!";
  const hash=await hashPassword(password);
  assert.match(hash,/^scrypt\$v1\$/);
  assert.notEqual(hash,Buffer.from(password).toString("base64"));
  assert.equal((await verifyPassword(password,hash)).ok,true);
  assert.equal((await verifyPassword("wrong",hash)).ok,false);
});

test("legacy base64 can authenticate once but requests rehash", async()=>{
  const password="legacy-password";
  const legacy=Buffer.from(password).toString("base64");
  const good=await verifyPassword(password,legacy);
  assert.equal(good.ok,true);
  assert.equal(good.needsRehash,true);
  assert.equal((await verifyPassword("wrong",legacy)).ok,false);
});
