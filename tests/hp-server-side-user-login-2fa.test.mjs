import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const read=(p)=>readFileSync(path.join(process.cwd(),p),"utf8");

test("password authentication only creates a pending challenge",()=>{
 const s=read("app/api/auth/login/route.ts");
 assert.match(s,/verifyPassword/);
 assert.match(s,/startUserLoginChallenge\(user\)/);
 assert.match(s,/requiresSecondFactor:\s*true/);
 assert.doesNotMatch(s,/issueOwnerSession|OWNER_SESSION_COOKIE|ownerSessionCookieOptions|finalizeLogin/);
});
test("server verifies a factor and consumes its OTP before minting signed session",()=>{
 const s=read("app/api/auth/login/verify/route.ts");
 assert.match(s,/getActiveOtpChallenge/);
 assert.match(s,/verifyTOTPToken/);
 assert.match(s,/consumeOtpChallenge/);
 assert.match(s,/req\.cookies\.get\(USER_LOGIN_OTP_COOKIE\)/);
 assert.match(s,/purpose:\s*"USER_LOGIN"/);
 assert.match(s,/timingSafeEqual|consumeOtpChallenge/);
 const consumed=s.indexOf("const consumed = await consumeOtpChallenge");
 const signed=s.indexOf("const token = issueOwnerSession");
 const cookie=s.indexOf("response.cookies.set(OWNER_SESSION_COOKIE");
 assert.ok(consumed>=0 && signed>consumed && cookie>signed);
 assert.match(s,/if \(!consumed\.ok \|\| !valid\)/);
 assert.doesNotMatch(s,/totpSecret\}\s*=/);
});
test("OTP is created and kept on server with short expiration, max attempts and one-use",()=>{
 const s=read("lib/server/user-login-otp.ts");
 assert.match(s,/crypto\.randomInt\(100000,\s*1000000\)/);
 assert.match(s,/createOtpChallenge/);
 assert.match(s,/ttl|TTL_MS/);
 assert.match(s,/maxAttempts:\s*5/);
 assert.match(s,/httpOnly:\s*true/);
 assert.match(s,/sameSite:\s*"strict"/);
 assert.match(s,/secure:\s*true/);
 assert.match(s,/!result\.success \|\| result\.simulated/);
 const store=read("lib/server/otp-challenge-store.ts");
 assert.match(store,/row\.consumedAt/);
 assert.match(store,/row\.attemptsRemaining < 1/);
 assert.match(store,/row\.expiresAt <= now/);
 assert.match(store,/CONSUMED_REPLAY/);
});
test("browser login never validates OTP client side or authenticates local cache alone",()=>{
 const s=read("context/AuthContext.tsx");
 assert.match(s,/\/api\/auth\/login\/verify/);
 assert.match(s,/\/api\/system\/owner-session-probe/);
 assert.match(s,/response\.status !== 204/);
 assert.match(s,/if \(json\.requiresSecondFactor !== true/);
 assert.doesNotMatch(s,/code\.trim\(\) !== pending2FACode/);
 const factor=s.indexOf('const response = await fetch("/api/auth/login/verify"');
 const final=s.indexOf("finalizeLogin(json.user)");
 assert.ok(factor>0 && final>factor);
 assert.match(s,/パスキー単独ログインはサーバー認証の整備中/);
});
test("generic email endpoint rejects browser-supplied login codes",()=>{
 const s=read("app/api/auth/2fa/route.ts");
 assert.match(s,/if \(type !== "register"\)/);
 assert.match(s,/status:\s*403/);
});
test("administrator login keeps its separate server-side OTP authentication",()=>{
 const s=read("app/api/admin/route.ts");
 assert.match(s,/createOtpChallenge/);
 assert.match(s,/consumeOtpChallenge/);
 assert.match(s,/ADMIN_LOGIN/);
});