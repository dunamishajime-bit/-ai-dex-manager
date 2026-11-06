import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (relativePath) => readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("expired owner session never reaches API JSON parsing and triggers re-authentication", () => {
  const hook = source("hooks/useLivePortfolio.ts");
  assert.match(hook, /credentials:\s*"same-origin"/);
  const authDenied = hook.indexOf("response.status === 401");
  const parseJson = hook.indexOf("await response.json()");
  assert.ok(authDenied > 0 && parseJson > authDenied);
  assert.match(hook, /setSnapshot\(null\)/);
  assert.match(hook, /window\.dispatchEvent\(new Event\("disdex-owner-session-expired"\)\)/);

  const auth = source("context/AuthContext.tsx");
  assert.match(auth, /window\.addEventListener\("disdex-owner-session-expired", onSessionExpired\)/);
  assert.match(auth, /const onSessionExpired = \(\) => triggerLogout\(\)/);
  assert.match(auth, /window\.removeEventListener\("disdex-owner-session-expired", onSessionExpired\)/);
});

test("homepage uses live portfolio balance only, no stale wallet fallback", () => {
  const home = source("app/page.tsx");
  assert.match(home, /const accountAvailable = snapshot\?\.availability\.account === true/);
  assert.match(home, /accountAvailable \? snapshot!\.account\.balanceUsd : null/);
  assert.match(home, /accountAvailable \? snapshot!\.account\.availableUsd : null/);
  assert.doesNotMatch(home, /lastAsterAccountBalanceUsd|lastAsterAvailableBalanceUsd/);
  assert.match(home, /liveError/);
});

test("wallet page reads Aster equity from the signed live portfolio, not its on-chain wallet cache", () => {
  const page = source("app/wallets/page.tsx");
  assert.match(page, /useLivePortfolio/);
  assert.match(page, /livePortfolio\?\.availability\.account === true/);
  assert.match(page, /hasAsterSnapshot \? livePortfolio!\.account\.balanceUsd : null/);
  assert.match(page, /hasAsterSnapshot \? livePortfolio!\.account\.availableUsd : null/);
  assert.match(page, /formatDate\(livePortfolio\?\.capturedAt\)/);
  assert.doesNotMatch(page, /lastAsterAccountBalanceUsd|lastAsterAvailableBalanceUsd/);
});

test("owner session lifetime and session HMAC implementation remain unchanged", () => {
  const login = source("app/api/auth/login/route.ts");
  const verify = source("app/api/auth/login/verify/route.ts");
  const owner = source("lib/server/owner-session.ts");
  assert.doesNotMatch(login, /issueOwnerSession/);
  assert.match(verify, /ttlMs:\s*10 \* 60 \* 1000/);
  assert.match(verify, /consumeOtpChallenge/);
  assert.match(owner, /crypto\.createHmac\("sha256"/);
  assert.match(owner, /timingSafeEqual/);
});
test("Aster signed portfolio reads independent sources and never treats absent position evidence as flat", () => {
  const api = source("app/api/system/live-portfolio/route.ts");
  assert.match(api, /Promise\.allSettled/);
  assert.match(api, /client\.getAccount\(\)/);
  assert.match(api, /client\.getPositionRisk\(\)/);
  assert.match(api, /client\.getOpenOrders\(\)/);
  assert.match(api, /normalizePositions\(account\.positions\)/);
  assert.match(api, /ACCOUNT_DISCREPANCY/);
  assert.match(api, /positionSource !== "UNAVAILABLE"/);
  assert.match(api, /positions: positionsAvailable/);
  assert.match(api, /account: accountAvailable/);
  assert.match(api, /orders: ordersAvailable/);
  assert.match(api, /readOnly: true/);
  assert.match(api, /private, no-store, max-age=0/);
});

test("position summary and position cards distinguish unavailable from verified flat", () => {
  const home = source("app/page.tsx");
  const dashboard = source("app/positions/page.tsx");
  const hook = source("hooks/useLivePortfolio.ts");
  assert.match(home, /positionsAvailable && positions\.length/);
  assert.match(home, /position\.markVerified/);
  assert.match(home, /position\.pnlVerified/);
  assert.match(dashboard, /positionsAvailable && snapshot!\.positions\.length/);
  assert.match(dashboard, /positionMarksVerified/);
  assert.match(dashboard, /ordersAvailable/);
  assert.match(dashboard, /accountAvailable/);
  assert.match(dashboard, /snapshot\.partial/);
  assert.match(hook, /availability: \{ account: boolean; positions: boolean; orders: boolean \}/);
  assert.doesNotMatch(dashboard, /value=\{snapshot \? String\(snapshot\.positions\.length\)/);
});

test("performance card does not treat cached operational wallet values as current Aster margin", () => {
  const performance = source("app/performance/page.tsx");
  assert.match(performance, /livePortfolio\?\.availability\.account === true/);
  assert.doesNotMatch(performance, /lastAsterAccountBalanceUsd|lastPortfolioUsd/);
});
