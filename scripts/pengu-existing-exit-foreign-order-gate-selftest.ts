import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { penguForeignOrderConflictsWithAction } from "../lib/pengu-dual-ls-v2-portfolio-runner";

// No exchange client or executor is created. Model only the admission condition.
const otherOrder = [{ symbol: "BTCUSDT" }];
const sameSymbolOrder = [{ symbol: "PENGUUSDT" }];
assert.equal(penguForeignOrderConflictsWithAction([], "PENGUUSDT", false), false);
assert.equal(penguForeignOrderConflictsWithAction(otherOrder, "PENGUUSDT", false), true,
    "Unmanaged cross-sleeve order must block new exposure");
assert.equal(penguForeignOrderConflictsWithAction(otherOrder, "PENGUUSDT", true), false,
    "A foreign BTC order must not suppress existing PENGU reduce-only exit");
assert.equal(penguForeignOrderConflictsWithAction(sameSymbolOrder, "PENGUUSDT", true), true,
    "Unmanaged same-symbol order must still fail closed");
assert.equal(penguForeignOrderConflictsWithAction([{ symbol: "penguusdt" }], "PENGUUSDT", true), true,
    "Same-symbol checking must not depend on symbol casing");

const code = readFileSync(resolve("lib/pengu-dual-ls-v2-portfolio-runner.ts"), "utf8");
assert.match(code, /quality102Ownership\?\.pending && !state\.position/,
    "Q102 pending ownership must block new PENGU entries, not existing position exit evaluation");
assert.match(code, /if \(!state\.position && quality102OpenOrder\)/,
    "Foreign Q102 orders must not prevent existing PENGU exit evaluation");
assert.match(code, /if \(!state\.position && nonQuality102OpenOrders\.length > 0\)/,
    "Global foreign open order hold must affect entries only");
assert.match(code, /if \(state\.position && conflictingSameSymbolOrder\)/,
    "Unknown PENGUUSDT orders must remain a hard conflict");
assert.match(code, /penguForeignOrderConflictsWithAction\(unmanagedOrders, SYMBOL, pending\.reduceOnly\)/,
    "Pre-submit must independently distinguish entry from reduce-only exit");
assert.match(code, /if \(!pending\.reduceOnly\) return openOrders\.length > 0/,
    "No global open-order bypass is permitted for entries");
assert.match(code, /const protectionBlocked = await this\.protectOrdinaryPosition\(state\)/,
    "Venue-resident stop protection must remain present before exit evaluation");
assert.match(code, /if \(state\.pending\) return await this\.reconcilePending\(state\)/,
    "Existing submitted orders must still reconcile first");
assert.match(code, /advancePenguShortV20TimedStops\(/,
    "SHORT_V20 timing must remain reachable after foreign entry gating");

console.log("PENGU_REDUCE_ONLY_FOREIGN_ORDER_GATE_SELFTEST_PASS");
console.log("newOrdersSent=0 cancelsSent=0 positionChangesSent=0");
