import assert from "node:assert/strict";
import test from "node:test";

import { marketDashboardInternalRefreshUrl } from "../lib/server/market-dashboard-internal-url";

test("standalone production uses the actual bound listener on 3001", () => {
  assert.equal(
    marketDashboardInternalRefreshUrl("3001"),
    "http://127.0.0.1:3001/api/agents/refresh-universe",
  );
});

test("local development uses port 3000 by default", () => {
  assert.equal(
    marketDashboardInternalRefreshUrl(undefined),
    "http://127.0.0.1:3000/api/agents/refresh-universe",
  );
});

test("invalid ports are rejected instead of becoming an arbitrary origin", () => {
  for (const value of ["0", "65536", "-1", "abc", "80/path", "80@evil.test", ""]) {
    assert.throws(() => marketDashboardInternalRefreshUrl(value), /MARKET_DASHBOARD_INVALID_LISTEN_PORT/);
  }
});
