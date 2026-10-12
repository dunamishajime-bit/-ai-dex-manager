import test from "node:test";
import assert from "node:assert/strict";
import { createProductionState } from "../lib/v12-v4-production-lifecycle";
import { v4OrderIdentity, type V4ExecutionDocument } from "../lib/v12-v4-execution-store";
import { migrateFlatV4State, type V4FlatLineageEvidence } from "../lib/v12-v4-flat-lineage-migration";

const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);
const LEG_ID = "LTCUSDT:FAILED_BREAK_REV_SHORT_6H:SHORT:1791799200000";
const CID = v4OrderIdentity(OLD_SHA, LEG_ID, "ENTRY", 0);

function flatObserved(): V4ExecutionDocument {
    const foreign = [{ owner: "FET", symbol: "FETUSDT", side: "LONG" as const, qty: 298, gross: 0, pendingGross: 0, crypto: true }];
    const state = createProductionState({ equityUsd: 72, foreign, holdProtected: false });
    return {
        schema: 2,
        releaseSha: OLD_SHA,
        revision: 0,
        state,
        intents: {},
        protections: {},
    };
}

function evidence(overrides: Partial<V4FlatLineageEvidence> = {}): V4FlatLineageEvidence {
    return {
        observedAt: 1_000,
        accountEquityUsd: 71.5,
        availableBalanceUsd: 70,
        prices: { FETUSDT: 0.234 },
        positions: [{ symbol: "FETUSDT", positionAmt: "298" }],
        openOrders: [
            { symbol: "FETUSDT", origQty: "298", executedQty: "0", reduceOnly: true, status: "NEW" },
            { symbol: "FETUSDT", origQty: "298", executedQty: "0", reduceOnly: true, status: "NEW" },
        ],
        pendingEntries: [],
        ...overrides,
    };
}

test("flat lineage migration preserves foreign ownership and creates a new-SHA empty V4 ledger", () => {
    const migrated = migrateFlatV4State({ observed: flatObserved(), expectedOldSha: OLD_SHA, newSha: NEW_SHA, evidence: evidence() });
    assert.equal(migrated.releaseSha, NEW_SHA);
    assert.equal(migrated.revision, 0);
    assert.deepEqual(migrated.intents, {});
    assert.deepEqual(migrated.protections, {});
    assert.deepEqual(migrated.state.legs, {});
    assert.equal(migrated.state.foreign[0]?.owner, "FET");
    assert.equal(migrated.state.equityUsd, 71.5);
    assert.equal(migrated.state.journal.length, 1);
    assert.equal(migrated.state.journal[0]?.type, "ACCOUNT_MARK");
});

test("flat lineage migration fails closed on active owned lifecycle", () => {
    const observed = flatObserved();
    observed.state.legs[LEG_ID] = {
        id: LEG_ID,
        candidate: {} as any,
        qty: 0,
        entryNotional: 0,
        requestedQty: 1,
        reservationUsd: 1,
        entryTs: 900,
        status: "PENDING_ENTRY",
        exitRemainingQty: 0,
        realizedUsd: 0,
        feesUsd: 0,
        fundingUsd: 0,
    };
    assert.throws(
        () => migrateFlatV4State({ observed, expectedOldSha: OLD_SHA, newSha: NEW_SHA, evidence: evidence() }),
        /V4_FLAT_LINEAGE_ACTIVE_LIFECYCLE/,
    );
});

test("flat lineage migration fails closed on unknown pending exposure, unmanaged order, or mismatch", () => {
    assert.throws(
        () => migrateFlatV4State({
            observed: flatObserved(),
            expectedOldSha: OLD_SHA,
            newSha: NEW_SHA,
            evidence: evidence({ pendingEntries: [{ strategyId: "V12_V4", status: "UNKNOWN" } as any] }),
        }),
        /V4_FLAT_LINEAGE_PENDING_EXPOSURE/,
    );
    assert.throws(
        () => migrateFlatV4State({
            observed: flatObserved(),
            expectedOldSha: OLD_SHA,
            newSha: NEW_SHA,
            evidence: evidence({ openOrders: [{ symbol: "FETUSDT", origQty: "298", reduceOnly: false, status: "NEW" }] }),
        }),
        /V4_FLAT_LINEAGE_UNMANAGED_ORDER/,
    );
    assert.throws(
        () => migrateFlatV4State({
            observed: flatObserved(),
            expectedOldSha: OLD_SHA,
            newSha: NEW_SHA,
            evidence: evidence({ positions: [{ symbol: "FETUSDT", positionAmt: "297" }] }),
        }),
        /V4_FLAT_LINEAGE_POSITION_MISMATCH/,
    );
});
