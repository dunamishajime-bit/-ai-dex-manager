import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const load=(file)=>readFileSync(path.join(process.cwd(),file),"utf8");

test("pending 2FA recovery exposes only a method, never authentication cookies or secrets",()=>{
 const s=load("app/api/auth/login/challenge/route.ts");
 assert.match(s,/getActiveOtpChallenge\(challengeId, "USER_LOGIN"\)/);
 assert.match(s,/request\.cookies\.get\(USER_LOGIN_OTP_COOKIE\)/);
 assert.match(s,/if \(!user \|\| !user\.isApproved\)/);
 assert.match(s,/pending: true, method: loginFactorFor\(user\)/);
 assert.doesNotMatch(s,/issueOwnerSession|OWNER_SESSION_COOKIE|passwordHash|totpSecret|codeHash|email:/);
});
test("client restores only a pending factor on unauthenticated initialization, never a USER session",()=>{
 const s=load("context/AuthContext.tsx");
 const rejected=s.indexOf("if (response.status !== 204)");
 const fetch=s.indexOf('fetch("/api/auth/login/challenge"');
 const factor=s.indexOf("setPendingSecondFactors([challenge.method])");
 const returns=s.indexOf("          return;",rejected);
 assert.ok(rejected>0 && fetch>rejected && factor>fetch && returns>factor);
 assert.match(s,/setCurrentUser\(null\)/);
 assert.match(s,/setUser\(null\)/);
 assert.match(s,/challenge\?\.pending === true/);
 assert.doesNotMatch(s.slice(rejected,returns),/finalizeLogin|issueOwnerSession/);
});
test("login screen returns to 2FA step and clears stale wrong-password error",()=>{
 const s=load("components/features/LoginPage.tsx");
 assert.match(s,/if \(pendingSecondFactors\.length > 0\) \{\s*setStep\("second-factor"\);\s*setError\(null\);/);
 assert.match(s,/remainingFactors\.includes\("totp"\)/);
 assert.match(s,/remainingFactors\.includes\("email"\)/);
});