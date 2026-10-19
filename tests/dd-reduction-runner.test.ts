import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { canonicalDirectorySha } from "../lib/backtest/dd-reduction/source";
import {
    assertRunnerOutputRoot,
    buildRunId,
    loadFrozenStageSet,
    parseRunnerArgs,
    runBaseline,
    type RunnerArgs,
} from "../scripts/dd-reduction/run-baseline";
import { runStage } from "../scripts/dd-reduction/run-stage";
import { compareStage } from "../scripts/dd-reduction/compare-stage";

const HASH = "a".repeat(64);
const START = 1_700_000_000_000;
const END = START + 60 * 60 * 1_000;

function requiredCliArgs(outputRoot: string): readonly string[] {
    return [
        "--source-root", "source",
        "--data-root", "data",
        "--production-sha", HASH,
        "--start", String(START),
        "--end", String(END),
        "--output-root", outputRoot,
        "--stage", "V12_V4_LONG",
        "--candidate", "V12_V4_LONG:LONG:initial-stop:250",
    ];
}

function runnerArgs(root: string, outputRoot: string): RunnerArgs {
    return {
        sourceRoot: join(root, "source"),
        dataRoot: join(root, "data"),
        productionSha: HASH,
        startTs: START,
        endTs: END,
        outputRoot,
        stage: "V12_V4_LONG",
        candidate: "V12_V4_LONG:LONG:initial-stop:250",
        initialEquity: 10_000,
        deposits: [],
        feeBps: 4,
        slippageBps: 2,
        fundingSource: "fixture-funding",
    };
}

async function makeFixture(options: { readonly withBaselineLedger?: boolean } = {}): Promise<{ root: string; args: RunnerArgs }> {
    const root = await mkdtemp(join(tmpdir(), "dd-reduction-runner-"));
    await mkdir(join(root, "source"), { recursive: true });
    await mkdir(join(root, "data"), { recursive: true });
    const production = JSON.stringify({
        strategy: "V12_V4",
        config: {
            entryPolicy: "entry-v1",
            sizingPolicy: "sizing-v1",
            grossCap: 1_500,
            sharedRiskCap: 500,
            marginGuard: "margin-v1",
            leverage: 1,
            initialStopBps: 500,
            profitFloorBps: 0,
            trailingGivebackBps: 100,
            timeStopBars: null,
            supportedDirections: ["LONG", "SHORT"],
        },
    });
    await writeFile(join(root, "source", "production.json"), production, "utf8");
    if (options.withBaselineLedger === true) {
        await writeFile(join(root, "source", "baseline-ledger.json"), JSON.stringify([{
            sourceHash: HASH,
            ts: START,
            strategy: "V12_V4",
            direction: "LONG",
            symbol: "BTCUSDT",
            requestedGross: 0,
            acceptedGross: 0,
            reservation: null,
            fill: null,
            exit: null,
            reason: "fixture-baseline",
            fee: 0,
            funding: 0,
            slippage: 0,
            policyHash: HASH,
            configHash: HASH,
            resultHash: HASH,
            tradeId: "baseline-1",
            entry: null,
            finalExit: null,
        }]), "utf8");
    }
    await writeFile(join(root, "data", "BTCUSDT-1h.json"), JSON.stringify([
        { ts: START, symbol: "BTCUSDT", timeframe: "1h", open: 100, high: 101, low: 99, close: 100, volume: 1 },
        { ts: START + 60 * 60 * 1_000, symbol: "BTCUSDT", timeframe: "1h", open: 100, high: 102, low: 98, close: 101, volume: 1 },
    ]), "utf8");
    const sourceFiles = [{ path: "production.json", content: production }];
    if (options.withBaselineLedger === true) {
        sourceFiles.push({ path: "baseline-ledger.json", content: await readFile(join(root, "source", "baseline-ledger.json"), "utf8") });
    }
    const productionSha = canonicalDirectorySha(sourceFiles);
    const args = runnerArgs(root, join(root, "research-output"));
    return { root, args: { ...args, productionSha } };
}

async function cleanup(root: string): Promise<void> {
    await rm(root, { recursive: true, force: true });
}

test("requires explicit source, data, time, stage, candidate, and output flags", () => {
    assert.throws(
        () => parseRunnerArgs(["--start", String(START), "--end", String(END)]),
        /missing required flag --source-root/,
    );
    assert.throws(
        () => parseRunnerArgs(requiredCliArgs("output" ).filter((flag) => flag !== "--data-root" && flag !== "data")),
        /missing required flag --data-root/,
    );
});

test("derives a deterministic run id from source and config hashes", () => {
    const first = buildRunId({ sourceHash: HASH, configHash: "b".repeat(64), stage: "V12_V4_LONG", candidate: "candidate-a" });
    const second = buildRunId({ candidate: "candidate-a", stage: "V12_V4_LONG", configHash: "b".repeat(64), sourceHash: HASH });

    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.notEqual(first, buildRunId({ sourceHash: HASH, configHash: "c".repeat(64), stage: "V12_V4_LONG", candidate: "candidate-a" }));
});

test("reports divergence, direct and lost PnL, cost deltas, conflicts, and DD decomposition", () => {
    const baseline = {
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        stageId: "V12_V4_LONG",
        strategy: "V12_V4" as const,
        direction: "LONG" as const,
        accepted: true,
        reason: "baseline",
        fee: 10,
        funding: 2,
        slippage: 1,
        policyHash: HASH,
        metrics: { maxDrawdown: 500, firstDivergenceTs: -1, netPnl: 100 },
    };
    const candidate = {
        ...baseline,
        resultHash: "b".repeat(64),
        accepted: false,
        reason: "REJECTED_GATES:severeDrawdown",
        fee: 12,
        funding: 3,
        slippage: 4,
        policyHash: "c".repeat(64),
        metrics: {
            maxDrawdown: 300,
            firstDivergenceTs: START,
            directPnl: 120,
            lostPriorLogicPnl: 20,
            grossConflicts: 2,
            normalDdImprovementBps: 200,
            severeDdImprovementBps: 150,
        },
    };

    const report = compareStage(baseline, candidate);

    assert.equal(report.firstDivergenceTs, START);
    assert.equal(report.directPnl, 120);
    assert.equal(report.lostPriorLogicPnl, 20);
    assert.deepEqual({ fee: report.feeDelta, funding: report.fundingDelta, slippage: report.slippageDelta }, { fee: 2, funding: 1, slippage: 3 });
    assert.equal(report.grossConflicts, 2);
    assert.equal(report.ddDecomposition.candidateMaxDrawdown, 300);
    assert.equal(report.ddDecomposition.severeDdImprovementBps, 150);
});

test("loads the cumulative frozen stage set without selecting or rewriting candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "dd-reduction-frozen-"));
    try {
        const path = join(root, "frozen-stage.json");
        await writeFile(path, JSON.stringify({
            sourceHash: HASH,
            configHash: HASH,
            resultHash: HASH,
            policyHash: HASH,
            stageIds: ["V12_V4_LONG", "V12_V4_SHORT"],
            policies: [],
            reason: "FROZEN_RESEARCH_POLICY_ONLY",
            completedStageIds: ["V12_V4_LONG", "V12_V4_SHORT"],
        }), "utf8");

        const frozen = await loadFrozenStageSet(path);

        assert.deepEqual(frozen.stageIds, ["V12_V4_LONG", "V12_V4_SHORT"]);
        assert.equal(frozen.reason, "FROZEN_RESEARCH_POLICY_ONLY");
        assert.equal(await readFile(path, "utf8"), await readFile(path, "utf8"));
    } finally {
        await cleanup(root);
    }
});

test("rejects repository and Desktop-root output paths", () => {
    const repository = resolve(fileURLToPath(import.meta.url), "..", "..");
    assert.throws(() => assertRunnerOutputRoot(join(repository, ".tmp", "research")), /RESEARCH_OUTPUT_MUST_NOT_BE_INSIDE_REPOSITORY/);
    assert.throws(() => assertRunnerOutputRoot("C:/Users/dis/Desktop"), /RESEARCH_OUTPUT_MUST_NOT_BE_DESKTOP_ROOT|RESEARCH_OUTPUT_ROOT_MUST_BE_APPROVED_RESEARCH_HIERARCHY/);
});

test("fails closed when baseline parity evidence is absent", async () => {
    const fixture = await makeFixture();
    const previousOutputRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = fixture.args.outputRoot;
    try {
        await assert.rejects(
            () => runStage(fixture.args),
            /BASELINE_PARITY_BLOCKED|baseline parity/i,
        );
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});

test("baseline runner does not silently accept missing parity evidence", async () => {
    const fixture = await makeFixture();
    const previousOutputRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = fixture.args.outputRoot;
    try {
        const result = await runBaseline(fixture.args);
        assert.equal(result.accepted, false);
        assert.match(result.reason, /BASELINE_PARITY_BLOCKED/);
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});

test("runs a parity-backed baseline and a fixed candidate against the cumulative frozen set", async () => {
    const fixture = await makeFixture({ withBaselineLedger: true });
    const previousOutputRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = fixture.args.outputRoot;
    try {
        const baseline = await runBaseline(fixture.args);
        assert.equal(baseline.status, "ACCEPTED");
        assert.match(baseline.reason, /BASELINE_PARITY_PASS/);

        const frozenPath = join(fixture.root, "prior-frozen-stage.json");
        await writeFile(frozenPath, JSON.stringify({
            sourceHash: baseline.sourceHash,
            configHash: baseline.configHash,
            resultHash: baseline.resultHash,
            policyHash: baseline.policyHash,
            stageIds: [],
            policies: [],
            reason: "FROZEN_RESEARCH_POLICY_ONLY",
            completedStageIds: [],
        }), "utf8");
        const stage = await runStage({ ...fixture.args, frozenStagePath: frozenPath });
        assert.equal(stage.stageId, "V12_V4_LONG");
        assert.equal(stage.status, "REJECTED");
        assert.equal(stage.accepted, false);
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});
