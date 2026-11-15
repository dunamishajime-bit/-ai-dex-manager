import assert from "node:assert/strict";
import test from "node:test";

import {
    planStrictPortfolio,
    resolveCryptoGrossEntryControl,
    type StrictPortfolioPosition,
} from "../lib/disdex-strict-portfolio-planner";

const BOUNDARIES = [2.99, 3.00, 3.01, 3.25, 3.50, 3.51];

test("Crypto Gross boundaries separate existing exposure from new risk", () => {
    for (const currentCryptoGross of BOUNDARIES) {
        const control = resolveCryptoGrossEntryControl({
            currentCryptoGross,
            requestedEntryCap: 3.0,
        });
        const expectedIncrement = Math.max(0, Math.min(0.25, 3.0 - currentCryptoGross));
        assert.equal(control.existingExposureManaged, true, "existing exposure must remain manageable at " + currentCryptoGross);
        assert.equal(control.protectedExitAllowed, true, "protected exits must remain available at " + currentCryptoGross);
        assert.equal(control.newRiskAllowed, expectedIncrement > 1e-9, "new-risk decision at " + currentCryptoGross);
        assert.equal(control.entryCapForNewRisk, Math.max(currentCryptoGross, 3.0));
        if (currentCryptoGross >= 3.0) {
            assert.equal(control.reason, "CRYPTO_GROSS_EXISTING_EXCESS_NO_NEW_RISK");
        }
    }
});

test("Existing Crypto Gross over 3.5 is a new-risk block, not an exit block", () => {
    const control = resolveCryptoGrossEntryControl({
        currentCryptoGross: 3.51,
        requestedEntryCap: 5.0,
    });
    assert.equal(control.existingExposureManaged, true);
    assert.equal(control.protectedExitAllowed, true);
    assert.equal(control.newRiskAllowed, false);
    assert.equal(control.entryCapForNewRisk, 3.51);
    assert.equal(control.reason, "CRYPTO_GROSS_EXISTING_EXCESS_NO_NEW_RISK");
});


const NOW = 1_800_000_000_000;

function activeAt(currentCryptoGross: number): StrictPortfolioPosition[] {
    const q102Gross = currentCryptoGross - 2;
    return [
        {
            id: "v12-eth",
            strategy: "V12",
            symbol: "ETHUSDT",
            side: "LONG",
            quantity: 100,
            entryPrice: 10,
            markPrice: 10,
            entryTs: NOW - 3_600_000,
            updatedAt: NOW,
        },
        {
            id: "v12-btc",
            strategy: "V12",
            symbol: "BTCUSDT",
            side: "LONG",
            quantity: 100,
            entryPrice: 10,
            markPrice: 10,
            entryTs: NOW - 3_600_000,
            updatedAt: NOW,
        },
        {
            id: "q102-causal",
            strategy: "QUALITY102_CAUSAL_V1",
            symbol: "SOLUSDT",
            side: "LONG",
            quantity: q102Gross * 100,
            entryPrice: 10,
            markPrice: 10,
            entryTs: NOW - 3_600_000,
            updatedAt: NOW,
            markSource: "LIVE_MARKET_QUOTE",
            markSourceEvidence: {
                source: "LIVE_MARKET_QUOTE",
                timestamp: NOW,
                price: 10,
                crossChecked: true,
            },
        },
    ];
}

test("Strict planner keeps all existing Gross boundaries manageable without an entry", () => {
    for (const currentCryptoGross of BOUNDARIES) {
        const plan = planStrictPortfolio({
            equity: 1_000,
            now: NOW,
            active: activeAt(currentCryptoGross),
            intents: [],
        });
        assert.equal(plan.status, "planned", "existing boundary " + currentCryptoGross);
        assert.equal(plan.accepted.length, 0);
        assert.equal(plan.reductions.length, 0);
        assert.ok(Math.abs(plan.totals.cryptoGross - currentCryptoGross) < 1e-9);
    }
});
