import assert from "node:assert/strict";
import test from "node:test";

import { assertFreshStrictPortfolioAccountSnapshot } from "../lib/v12-strict-live-adapter";

test("accepts an account snapshot observed after the venue timestamp", () => {
    assert.doesNotThrow(() => assertFreshStrictPortfolioAccountSnapshot(
        { walletBalance: 100, updatedAt: 1_000 },
        1_050,
        5_000,
    ));
});

test("rejects future and stale account snapshots", () => {
    assert.throws(
        () => assertFreshStrictPortfolioAccountSnapshot({ walletBalance: 100, updatedAt: 1_051 }, 1_050, 5_000),
        /STRICT_PORTFOLIO_ACCOUNT_SNAPSHOT_STALE_OR_INVALID/,
    );
    assert.throws(
        () => assertFreshStrictPortfolioAccountSnapshot({ walletBalance: 100, updatedAt: 1_000 }, 6_001, 5_000),
        /STRICT_PORTFOLIO_ACCOUNT_SNAPSHOT_STALE_OR_INVALID/,
    );
});
