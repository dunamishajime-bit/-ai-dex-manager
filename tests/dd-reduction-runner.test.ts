import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { canonicalDirectorySha } from "../lib/backtest/dd-reduction/source";
import {
    assertRunnerOutputRoot,
    buildConfigHash,
    buildRunId,
    hashEvaluationEvidence,
    hashJson,
    loadFrozenStageSet,
    parseRunnerArgs,
    runBaseline,
    type EvaluationEvidence,
    type RunnerArgs,
} from "../scripts/dd-reduction/run-baseline";
import { buildReplayPolicySet, calculateLostPriorLogicPnl, runStage, assertFrozenStageReady } from "../scripts/dd-reduction/run-stage";
import { compareStage } from "../scripts/dd-reduction/compare-stage";
import type { CandidatePolicy, FrozenStageSet, JsonValue } from "../lib/backtest/dd-reduction/types";
import type { IntegratedReplayResult } from "../lib/backtest/dd-reduction/emulator";

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

function candidatePolicy(stageId: CandidatePolicy["stageId"], strategy: CandidatePolicy["strategy"], direction: CandidatePolicy["direction"]): CandidatePolicy {
    return {
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        strategy,
        direction,
        policyHash: `${HASH}:${stageId}`,
        reason: "frozen",
        fee: 0,
        funding: 0,
        slippage: 0,
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
        candidateId: `${stageId}:candidate`,
        stageId,
        axis: "initial-stop",
        applicability: "AVAILABLE",
        requestedGross: 1_500,
        acceptedGross: 1_500,
        reservation: null,
    };
}

function frozenSet(overrides: Partial<FrozenStageSet> = {}): FrozenStageSet {
    return {
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        policyHash: HASH,
        stageIds: [],
        policies: [],
        reason: "FROZEN_RESEARCH_POLICY_ONLY",
        completedStageIds: [],
        ...overrides,
    };
}

async function makeFixture(options: { readonly withBaselineLedger?: boolean; readonly corruptParity?: boolean } = {}): Promise<{ root: string; args: RunnerArgs }> {
    const root = await mkdtemp(join(tmpdir(), "dd-reduction-runner-"));
    await mkdir(join(root, "source"), { recursive: true });
    await mkdir(join(root, "data"), { recursive: true });
    const baselineRows = [{
        sourceHash: HASH,
        ts: START,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 100,
        acceptedGross: 100,
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
        entry: { sourceHash: HASH, ts: START, price: 100, quantity: 1, gross: 100, fee: 0, funding: 0, slippage: 0, reason: "fixture" },
        finalExit: null,
    }];
    const baselineContent = JSON.stringify(baselineRows);
    const baselineParity = options.withBaselineLedger === true ? {
        ledgerHash: options.corruptParity === true ? "b".repeat(64) : hashJson(baselineRows as unknown as JsonValue),
        tradeCount: 1,
        openTradeCount: 1,
        openAcceptedGross: 100,
    } : undefined;
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
            ...(baselineParity === undefined ? {} : { baselineParity }),
        },
    });
    await writeFile(join(root, "source", "production.json"), production, "utf8");
    if (options.withBaselineLedger === true) {
        await writeFile(join(root, "source", "baseline-ledger.json"), baselineContent, "utf8");
    }
    await writeFile(join(root, "data", "BTCUSDT-1h.json"), JSON.stringify([
        { ts: START, symbol: "BTCUSDT", timeframe: "1h", open: 100, high: 101, low: 99, close: 100, volume: 1 },
        { ts: START + 60 * 60 * 1_000, symbol: "BTCUSDT", timeframe: "1h", open: 100, high: 102, low: 98, close: 101, volume: 1 },
    ]), "utf8");
    const sourceFiles = [{ path: "production.json", content: production }];
    if (options.withBaselineLedger === true) {
        sourceFiles.push({ path: "baseline-ledger.json", content: baselineContent });
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

test("changes config identity when frozen lineage changes", () => {
    const args = runnerArgs("C:/fixture", "C:/output");
    const first = buildConfigHash({ ...args, frozenStageHash: HASH }, HASH);
    const second = buildConfigHash({ ...args, frozenStageHash: "b".repeat(64) }, HASH);

    assert.notEqual(first, second);
});

test("rejects skipped, duplicate, and inconsistent frozen stage transitions", () => {
    assert.throws(() => assertFrozenStageReady(frozenSet(), "Q102_LONG"), /FROZEN_STAGE_ORDER/);
    assert.throws(() => assertFrozenStageReady(frozenSet({ stageIds: ["V12_V4_LONG"], completedStageIds: ["V12_V4_LONG"] }), "V12_V4_LONG"), /FROZEN_STAGE_ORDER|FROZEN_STAGE_METADATA/);
    assert.throws(() => assertFrozenStageReady(frozenSet({ stageIds: ["V12_V4_LONG"], completedStageIds: [] }), "V12_V4_SHORT"), /FROZEN_STAGE_METADATA/);
});

test("preserves two frozen policies sharing a direction by strategy identity", () => {
    const longV12 = candidatePolicy("V12_V4_LONG", "V12_V4", "LONG");
    const longQ102 = candidatePolicy("Q102_LONG", "Q102", "LONG");
    const frozen = frozenSet({
        stageIds: ["V12_V4_LONG", "Q102_LONG"],
        completedStageIds: ["V12_V4_LONG", "Q102_LONG"],
        policies: [longV12, longQ102],
    });
    const keys = buildReplayPolicySet(frozen, longQ102).map((policy) => `${policy.strategy}:${policy.direction}`);

    assert.deepEqual(keys, ["V12_V4:LONG", "Q102:LONG"]);
});

test("fails closed when required evaluation evidence is absent", async () => {
    const fixture = await makeFixture({ withBaselineLedger: true });
    const previousOutputRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = fixture.args.outputRoot;
    try {
        const baseline = await runBaseline(fixture.args);
        const frozenPath = join(fixture.root, "prior-frozen-stage.json");
        await writeFile(frozenPath, JSON.stringify({ ...frozenSet(), sourceHash: baseline.sourceHash, configHash: baseline.configHash, resultHash: baseline.resultHash, policyHash: baseline.policyHash }), "utf8");
        await assert.rejects(() => runStage({ ...fixture.args, frozenStagePath: frozenPath }), /METRIC_EVIDENCE_UNAVAILABLE/);
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});

test("calculates non-zero PnL lost by prior frozen logic from replay evidence", () => {
    const prior = candidatePolicy("V12_V4_LONG", "V12_V4", "LONG");
    const frozen = frozenSet({ stageIds: ["V12_V4_LONG"], completedStageIds: ["V12_V4_LONG"], policies: [prior] });
    const makeReplay = (pnl: number): IntegratedReplayResult => ({
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        policyHash: HASH,
        reason: "fixture",
        fee: 0,
        funding: 0,
        slippage: 0,
        events: [],
        positions: [],
        portfolio: [],
        tradeLedger: [{
            sourceHash: HASH,
            positionId: `position-${pnl}`,
            strategy: "V12_V4",
            direction: "LONG",
            symbol: "BTCUSDT",
            requestedGross: 100,
            acceptedGross: 100,
            reservation: null,
            entryFill: null,
            exit: null,
            reason: "fixture",
            fee: 0,
            funding: 0,
            slippage: 0,
            policyHash: HASH,
            configHash: HASH,
            resultHash: HASH,
            events: [{
                eventId: `exit-${pnl}`,
                eventType: "EXIT",
                positionId: `position-${pnl}`,
                sourceHash: HASH,
                ts: START,
                strategy: "V12_V4",
                direction: "LONG",
                symbol: "BTCUSDT",
                requestedGross: 100,
                acceptedGross: 100,
                reservation: null,
                fill: null,
                exit: { sourceHash: HASH, ts: START, price: 101, quantity: 1, gross: 100, fee: 0, funding: 0, slippage: 0, realizedPnl: pnl, reason: "fixture" },
                reason: "fixture",
                fee: 0,
                funding: 0,
                slippage: 0,
                policyHash: HASH,
                configHash: HASH,
                resultHash: HASH,
            }],
        }],
        accountingReconciliation: { cash: 0, equity: 0, realizedPnl: pnl, unrealizedPnl: 0, fee: 0, funding: 0, slippage: 0, difference: 0, balanced: true },
    } as unknown as IntegratedReplayResult);

    assert.equal(calculateLostPriorLogicPnl(makeReplay(100), makeReplay(40), frozen), 60);
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
            policies: [candidatePolicy("V12_V4_LONG", "V12_V4", "LONG"), candidatePolicy("V12_V4_SHORT", "V12_V4", "SHORT")],
            reason: "FROZEN_RESEARCH_POLICY_ONLY",
            completedStageIds: ["V12_V4_LONG", "V12_V4_SHORT"],
            stageDecisions: [
                { stageId: "V12_V4_LONG", status: "ACCEPTED", accepted: true, candidateId: "V12_V4_LONG:candidate", policyHash: `${HASH}:V12_V4_LONG`, sourceHash: HASH, configHash: HASH, resultHash: HASH, candidatePolicy: candidatePolicy("V12_V4_LONG", "V12_V4", "LONG") },
                { stageId: "V12_V4_SHORT", status: "ACCEPTED", accepted: true, candidateId: "V12_V4_SHORT:candidate", policyHash: `${HASH}:V12_V4_SHORT`, sourceHash: HASH, configHash: HASH, resultHash: HASH, candidatePolicy: candidatePolicy("V12_V4_SHORT", "V12_V4", "SHORT") },
            ],
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

test("rejects a non-empty but mismatched canonical baseline ledger", async () => {
    const fixture = await makeFixture({ withBaselineLedger: true, corruptParity: true });
    const previousOutputRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = fixture.args.outputRoot;
    try {
        const result = await runBaseline(fixture.args);
        assert.equal(result.status, "BASELINE_PARITY_BLOCKED");
        assert.match(result.reason, /ledgerHash/);
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});

test("refuses to overwrite an immutable deterministic baseline artifact directory", async () => {
    const fixture = await makeFixture({ withBaselineLedger: true });
    const previousOutputRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = fixture.args.outputRoot;
    try {
        await runBaseline(fixture.args);
        await assert.rejects(() => runBaseline(fixture.args), /RESEARCH_ARTIFACT_EXISTS/);
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
        const metrics = {
            normalDdImprovementBps: 100,
            severeDdImprovementBps: 100,
            oosDdImprovementBps: 0,
            walkForwardImprovementBps: 0,
            profitFactorDeclinePct: 0,
            finalEquityDeclinePct: 0,
            tradeCountRatio: 1,
            capacityRegression: 0,
            safetyRegression: 0,
            costStressPass: 1,
            candidateSelectionUsesFuturePnl: 0,
        };
        const evaluationEvidence: EvaluationEvidence = {
            sourceHash: baseline.sourceHash,
            candidateId: fixture.args.candidate,
            lineageHash: hashEvaluationEvidence({ sourceHash: baseline.sourceHash, candidateId: fixture.args.candidate, lineageHash: "", metrics }),
            metrics,
        };
        const stage = await runStage({ ...fixture.args, frozenStagePath: frozenPath, evaluationEvidence });
        assert.equal(stage.stageId, "V12_V4_LONG");
        assert.equal(stage.status, "ACCEPTED");
        assert.equal(stage.accepted, true);
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});
