import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const read=(p)=>readFileSync(path.join(process.cwd(),p),"utf8");

test("login factor priority is passkey then authenticator then email",()=>{
 const server=read("lib/server/user-login-otp.ts");
 const page=read("components/features/LoginPage.tsx");
 assert.match(server,/LOGIN_FACTOR_PRIORITY[^=]*=\s*\["passkey", "totp", "email"\]/);
 assert.match(page,/LOGIN_FACTOR_ORDER[^=]*=\s*\["passkey", "totp", "email"\]/);
 assert.match(page,/1\. 指紋認証 \/ パスキー/);
 assert.match(page,/2\. Google Authenticator/);
 assert.match(page,/3\. メール認証コード/);
});

test("password proof returns available methods and factor switch stays server-bound",()=>{
 const login=read("app/api/auth/login/route.ts");
 const challenge=read("app/api/auth/login/challenge/route.ts");
 const method=read("app/api/auth/login/method/route.ts");
 assert.match(login,/availableMethods: challenge\.availableMethods/);
 assert.match(challenge,/availableLoginFactors\(user\)/);
 assert.doesNotMatch(challenge,/passwordHash|totpSecret|webAuthnCredentials|subject:/);
 assert.match(method,/requireSameOriginMutation\(request\)/);
 assert.match(method,/getActiveOtpChallenge\(challengeId, "USER_LOGIN"\)/);
 assert.match(method,/startUserLoginChallenge\(user, method\)/);
 assert.match(method,/setLoginChallengeCookie\(response, next\.challengeId\)/);
});

test("passkey login factor is verified from server-side credentials before owner session issuance",()=>{
 const options=read("app/api/auth/login/passkey/options/route.ts");
 const verify=read("app/api/auth/login/passkey/verify/route.ts");
 assert.match(options,/findUserById\(pending\.subject\)/);
 assert.match(options,/user\?\.webAuthnCredentials/);
 assert.match(options,/userVerification: "required"/);
 assert.doesNotMatch(options,/request\.json\(\).*credentials/);
 assert.match(verify,/findUserById\(pending\.subject\)/);
 assert.match(verify,/credentials\.find\(\(item: any\) => item\.id === authenticationResponse\.id\)/);
 assert.match(verify,/requireUserVerification: true/);
 const verified=verify.indexOf("if (!verification.verified)");
 const consumed=verify.indexOf("const consumed = await consumeOtpChallenge");
 const token=verify.indexOf("const token = issueOwnerSession");
 assert.ok(verified>=0 && consumed>verified && token>consumed);
 assert.match(verify,/response\.cookies\.set\(OWNER_SESSION_COOKIE/);
});

test("numeric factor verification obeys the selected challenge and refuses passkey codes",()=>{
 const verify=read("app/api/auth/login/verify/route.ts");
 assert.match(verify,/const method = challenge\.factor \|\| loginFactorFor\(user\)/);
 assert.match(verify,/if \(method === "passkey"\)/);
 assert.match(verify,/指紋・端末認証を実行してください/);
});

test("login UI has explicit switch button and displays only the active factor",()=>{
 const page=read("components/features/LoginPage.tsx");
 const auth=read("context/AuthContext.tsx");
 assert.match(page,/他の認証方法へ切り替える/);
 assert.match(page,/activeFactor === "passkey"/);
 assert.match(page,/activeFactor === "totp"/);
 assert.match(page,/activeFactor === "email"/);
 assert.match(page,/LOGIN_FACTOR_ORDER\.map/);
 assert.match(page,/未登録/);
 assert.match(auth,/switchSecondFactor/);
 assert.match(auth,/\/api\/auth\/login\/method/);
 assert.match(auth,/\/api\/auth\/login\/passkey\/options/);
 assert.match(auth,/\/api\/auth\/login\/passkey\/verify/);
});

test("switching factors never finalizes login client-side",()=>{
 const auth=read("context/AuthContext.tsx");
 const start=auth.indexOf("const switchSecondFactor");
 const end=auth.indexOf("const resendEmailCode",start);
 const block=auth.slice(start,end);
 assert.doesNotMatch(block,/finalizeLogin|OWNER_SESSION_COOKIE|setCurrentUser/);
});