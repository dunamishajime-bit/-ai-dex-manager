import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PENGU_RECOVERY_V8, RECOVERY_V8_FREEZE_SHA, RECOVERY_V8_SOURCE_PRODUCTION_SHA } from "@/config/penguRecoveryV8";

type Metric = { trades: number; returnPct: number; profitFactor: number; maxDrawdownPct: number };

function close(actual: number, expected: number, label: string) {
    assert.ok(Number.isFinite(actual), `${label} is not finite`);
    assert.ok(Math.abs(actual - expected) <= 1e-9, `${label} mismatch: expected=${expected} actual=${actual}`);
}

async function main() {
    const freezePath = resolve(process.argv[2] || "research/pengu-recovery-v8-final-20260828.json");
    const replayPath = resolve(process.argv[3] || "research-results/pengu-recovery-v8-replay.json");
    const freeze = JSON.parse(await readFile(freezePath, "utf8")) as any;
    const replay = JSON.parse(await readFile(replayPath, "utf8")) as any;
    assert.equal(replay.researchFreezeSha, RECOVERY_V8_FREEZE_SHA);
    assert.equal(replay.researchSourceSha, RECOVERY_V8_SOURCE_PRODUCTION_SHA);
    assert.equal(replay.selected.rule, PENGU_RECOVERY_V8.rule);
    assert.equal(replay.selected.priority, PENGU_RECOVERY_V8.priority);
    assert.equal(replay.selected.gross, PENGU_RECOVERY_V8.initialGross);
    assert.equal(replay.selected.yieldMode, PENGU_RECOVERY_V8.yieldMode);
    assert.equal(replay.selected.exit.hardStopPct, PENGU_RECOVERY_V8.exit.hardStopPct);
    assert.equal(replay.selected.exit.trailActivationPct, PENGU_RECOVERY_V8.exit.trailActivationPct);
    assert.equal(replay.selected.exit.trailRetracePct, PENGU_RECOVERY_V8.exit.trailRetracePct);
    assert.equal(replay.selected.exit.maxHoldHours, PENGU_RECOVERY_V8.exit.maxHoldHours);
    assert.equal(replay.selected.delayedPartialDefense.partialAfterHours, PENGU_RECOVERY_V8.partial.afterHours);
    assert.equal(replay.selected.delayedPartialDefense.partialStopPct, PENGU_RECOVERY_V8.partial.stopPct);
    assert.equal(replay.selected.delayedPartialDefense.partialGross, PENGU_RECOVERY_V8.partial.gross);
    assert.equal(replay.selected.delayedPartialDefense.remainingGross, PENGU_RECOVERY_V8.partial.remainingGross);
    assert.equal(replay.selected.v7BreakevenProtectorRemoved, true);

    const normal = replay.historical.normal as Metric;
    const severe = replay.historical.severe as Metric;
    for (const mode of ["normal", "severe"] as const) {
        const actual = mode === "normal" ? replay.historical.normal : replay.historical.severe;
        const expected = freeze.historical[mode];
        assert.equal(actual.trades, expected.trades, `${mode}.trades`);
        close(actual.returnPct, expected.returnPct, `${mode}.returnPct`);
        close(actual.profitFactor, expected.profitFactor, `${mode}.profitFactor`);
        close(actual.maxDrawdownPct, expected.maxDrawdownPct, `${mode}.maxDrawdownPct`);
    }
    for (const venue of ["OKX", "BITGET", "GATE"] as const) {
        const actual = replay.externalDiagnostics[venue];
        const expected = freeze.crossVenueDiagnostics[venue];
        close(actual.normalReturnPct, expected.normalReturnPct, `${venue}.normalReturnPct`);
        close(actual.normalPf, expected.normalPf, `${venue}.normalPf`);
        close(actual.normalDdPct, expected.normalDdPct, `${venue}.normalDdPct`);
    }
    assert.equal(replay.observedForward.alreadyObserved, true);
    assert.equal(replay.observedForward.notFreshHoldout, true);
    assert.equal(replay.safety.ordersSent, false);
    assert.equal(replay.safety.liveChanged, false);
    assert.equal(replay.safety.vpsChanged, false);
    assert.equal(replay.safety.productionChanged, false);
    console.log("PENGU_RECOVERY_V8_PARITY_PASS");
    console.log(JSON.stringify({ normal, severe, externalDiagnostics: replay.externalDiagnostics, safety: replay.safety }));
}

void main().catch((error) => {
    console.error(`PENGU_RECOVERY_V8_PARITY_FAIL_CLOSED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
