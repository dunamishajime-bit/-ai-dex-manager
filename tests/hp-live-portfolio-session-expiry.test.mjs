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
  assert.match(home, /const balance = snapshot\?\.account\.balanceUsd \?\? null/);
  assert.match(home, /const available = snapshot\?\.account\.availableUsd \?\? null/);
  assert.doesNotMatch(home, /lastAsterAccountBalanceUsd|lastAsterAvailableBalanceUsd/);
  assert.match(home, /liveError/);
});

test("wallet page reads Aster equity from the signed live portfolio, not its on-chain wallet cache", () => {
  const page = source("app/wallets/page.tsx");
  assert.match(page, /useLivePortfolio/);
  assert.match(page, /livePortfolio\?\.account\.balanceUsd \?\? null/);
  assert.match(page, /livePortfolio\?\.account\.availableUsd \?\? null/);
  assert.match(page, /formatDate\(livePortfolio\?\.capturedAt\)/);
  assert.doesNotMatch(page, /lastAsterAccountBalanceUsd|lastAsterAvailableBalanceUsd/);
});

test("owner session lifetime and session HMAC implementation remain unchanged", () => {
  const login = source("app/api/auth/login/route.ts");
  const owner = source("lib/server/owner-session.ts");
  assert.match(login, /ttlMs:\s*10 \* 60 \* 1000/);
  assert.match(owner, /crypto\.createHmac\("sha256"/);
  assert.match(owner, /timingSafeEqual/);
});