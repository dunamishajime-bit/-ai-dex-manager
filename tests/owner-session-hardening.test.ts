import test from "node:test";
import assert from "node:assert/strict";
import {
  issueOwnerSession,
  verifyOwnerSession,
  OWNER_SESSION_COOKIE,
} from "../lib/server/owner-session";

const key=Buffer.alloc(32,7).toString("base64url");

test("signed owner session binds purpose audience nonce and expiry",()=>{
  const now=1_800_000_000_000;
  const token=issueOwnerSession({
    key,subject:"user-1",purpose:"ADMIN",audience:"professional-dismanager.net",
    now,ttlMs:60_000,
  });
  const value=verifyOwnerSession(token,{key,purpose:"ADMIN",audience:"professional-dismanager.net",now:now+1});
  assert.equal(value.subject,"user-1");
  assert.match(value.nonce,/^[A-Za-z0-9_-]{20,}$/);
  assert.throws(()=>verifyOwnerSession(token,{key,purpose:"USER",audience:"professional-dismanager.net",now:now+1}));
  assert.throws(()=>verifyOwnerSession(token,{key,purpose:"ADMIN",audience:"wrong.example",now:now+1}));
  assert.throws(()=>verifyOwnerSession(token,{key,purpose:"ADMIN",audience:"professional-dismanager.net",now:now+60_001}));
  assert.equal(OWNER_SESSION_COOKIE,"disdex_owner_session");
});

test("legacy fixed cookies are not valid session tokens",()=>{
  for(const token of ["1","active","disdex_auth=1","disdex_admin_session=active",""]){
    assert.throws(()=>verifyOwnerSession(token,{key,purpose:"ADMIN",audience:"professional-dismanager.net",now:1_800_000_000_000}));
  }
});
