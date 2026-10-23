import test from "node:test";
import assert from "node:assert/strict";
import { applyProductionEvent, createProductionState } from "../lib/v12-v4-production-lifecycle";

test("event application does not mutate the previous lifecycle snapshot", () => {
    const initial = createProductionState({ equityUsd: 1_000, foreign: [], holdProtected: false });
    const marked = applyProductionEvent(initial, {
        type: "ACCOUNT_MARK",
        eventId: "mark-1",
        ts: 1,
        equityUsd: 1_000,
        prices: { BTCUSDT: 100 },
    });

    assert.equal(initial.journal.length, 0);
    assert.equal(marked.journal.length, 1);
    assert.equal(marked.journal[0].eventId, "mark-1");

    const next = applyProductionEvent(marked, {
        type: "ACCOUNT_MARK",
        eventId: "mark-2",
        ts: 2,
        equityUsd: 990,
        prices: { BTCUSDT: 99 },
    });
    assert.equal(marked.journal.length, 1);
    assert.equal(next.journal.length, 2);
    assert.equal(marked.equityUsd, 1_000);
    assert.equal(next.equityUsd, 990);
});
