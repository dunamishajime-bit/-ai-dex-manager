import assert from "node:assert/strict";
import test from "node:test";
import { assertWatchdogSafetyBoundary, inspectWatchdogSource } from "../scripts/disdex-runner-watchdog-safety-boundary";

test("the production watchdog satisfies its static safety boundary", () => {
    assert.doesNotThrow(() => assertWatchdogSafetyBoundary());
});

test("the boundary rejects exchange imports in static, require, and dynamic forms", () => {
    for (const source of [
        'import client from "exchange-sdk";',
        'const client = require("aster-client");',
        'const client = await import(\n  "hyperliquid-client"\n);',
    ]) {
        assert.match(inspectWatchdogSource(source).violations.join("\n"), /exchange client import/);
    }
});

test("the boundary rejects systemctl start and unallowlisted unit expressions", () => {
    for (const source of [
        'execFile(SYSTEMCTL, ["start", unit]);',
        'execFile(SYSTEMCTL, ["restart", configuredUnit]);',
    ]) {
        assert.match(inspectWatchdogSource(source).violations.join("\n"), /systemctl/);
    }
});

test("the boundary rejects order lifecycle calls across multiline and computed forms", () => {
    for (const source of [
        'runner.submitOrder(\n  order\n);',
        'runner["cancelOrder"](order);',
        'const fn = runner.closePosition; fn(position);',
    ]) {
        assert.match(inspectWatchdogSource(source).violations.join("\n"), /forbidden order\/lifecycle operation/);
    }
});
