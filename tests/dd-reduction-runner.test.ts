import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { canonicalDirectorySha, loadCanonicalSource } from "../lib/backtest/dd-reduction/source";
import {
    assertRunnerOutputRoot,
    buildConfigHash,
    buildRunId,
    hashEvaluationEvidence,
    hashFrozenStageSet,
    hashProtectionReadbackEvidence,
    hashJson,
    loadFrozenStageSet,
    parseRunnerArgs,
    runBaseline,
    evaluateBaselineParity,
    policyFromSource,
    type EvaluationEvidence,
    type RunnerArgs,
} from "../scripts/dd-reduction/run-baseline";
import { buildEvaluationConfigHash, buildEvaluationGateHash, buildReplayConfig, buildReplayPolicySet, calculateLostPriorLogicPnl, runStage, assertFrozenStageReady, validateReplayBoundary } from "../scripts/dd-reduction/run-stage";
import { compareStage } from "../scripts/dd-reduction/compare-stage";
import type { CandidatePolicy, FrozenStageSet, JsonValue, ProtectionReadbackEvidence, StageResult } from "../lib/backtest/dd-reduction/types";
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

async function makeFixture(options: { readonly withBaselineLedger?: boolean; readonly corruptParity?: boolean; readonly shortOnly?: boolean; readonly withCandidateFill?: boolean } = {}): Promise<{ root: string; args: RunnerArgs }> {
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
        entries: baselineRows,
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
            supportedDirections: options.shortOnly === true ? ["SHORT"] : ["LONG", "SHORT"],
            ...(baselineParity === undefined ? {} : { baselineParity }),
        },
    });
    await writeFile(join(root, "source", "production.json"), production, "utf8");
    if (options.withBaselineLedger === true) {
        await writeFile(join(root, "source", "baseline-ledger.json"), baselineContent, "utf8");
    }
    const candidateContent = JSON.stringify([{
        sourceHash: HASH,
        ts: START,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 100,
        acceptedGross: 100,
        reservation: null,
        fill: { sourceHash: HASH, ts: START, price: 100, quantity: 1, gross: 100, fee: 0, funding: 0, slippage: 0, reason: "fixture-candidate" },
        exit: null,
        reason: "fixture-candidate",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        candidateId: "V12_V4_LONG:LONG:initial-stop:250",
        accepted: true,
        rejectionReason: null,
    }]);
    if (options.withCandidateFill === true) await writeFile(join(root, "source", "candidate-events.json"), candidateContent, "utf8");
    await writeFile(join(root, "data", "BTCUSDT-1h.json"), JSON.stringify([
        { ts: START, symbol: "BTCUSDT", timeframe: "1h", open: 100, high: 100, low: 100, close: 100, volume: 1 },
        { ts: START + 60 * 60 * 1_000, symbol: "BTCUSDT", timeframe: "1h", open: 100, high: 100, low: 100, close: 100, volume: 1 },
    ]), "utf8");
    const sourceFiles = [{ path: "production.json", content: production }];
    if (options.withBaselineLedger === true) {
        sourceFiles.push({ path: "baseline-ledger.json", content: baselineContent });
    }
    if (options.withCandidateFill === true) sourceFiles.push({ path: "candidate-events.json", content: candidateContent });
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
    assert.throws(() => assertFrozenStageReady(frozenSet({ stageIds: ["V12_V4_LONG"], completedStageIds: ["V12_V4_LONG"] }), "V12_V4_LONG"), /FROZEN_STAGE_ORDER|FROZEN_STAGE_METADATA|FROZEN_STAGE_LINEAGE_REQUIRED/);
    assert.throws(() => assertFrozenStageReady(frozenSet({ stageIds: ["V12_V4_LONG"], completedStageIds: [] }), "V12_V4_SHORT"), /FROZEN_STAGE_METADATA|FROZEN_STAGE_LINEAGE_REQUIRED/);
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

test("attributes lost prior-logic PnL across multiple frozen strategies and symbols", () => {
    const v12 = candidatePolicy("V12_V4_LONG", "V12_V4", "LONG");
    const q102 = candidatePolicy("Q102_LONG", "Q102", "LONG");
    const frozen = frozenSet({ stageIds: ["V12_V4_LONG", "Q102_LONG"], completedStageIds: ["V12_V4_LONG", "Q102_LONG"], policies: [v12, q102] });
    const makeReplay = (values: readonly { strategy: "V12_V4" | "Q102"; symbol: string; pnl: number }[]): IntegratedReplayResult => ({
        sourceHash: HASH, configHash: HASH, resultHash: HASH, policyHash: HASH, reason: "fixture", fee: 0, funding: 0, slippage: 0,
        events: [], positions: [], portfolio: [], decisionLedger: [], reservationLedger: [], protectionLedger: [], equityMtmTimeline: [], rejectionCount: 0,
        preemption: { supported: false, count: null, reason: "PREEMPTION_UNSUPPORTED_IN_TASK_2" }, preemptionCount: null,
        tradeLedger: values.map((value, index) => ({
            sourceHash: HASH, positionId: `position-${index}`, strategy: value.strategy, direction: "LONG", symbol: value.symbol, requestedGross: 100, acceptedGross: 100,
            reservation: null, entryFill: null, exit: null, reason: "fixture", fee: 0, funding: 0, slippage: 0, policyHash: HASH, configHash: HASH, resultHash: HASH,
            events: [{ eventId: `exit-${index}`, eventType: "EXIT", positionId: `position-${index}`, sourceHash: HASH, ts: START, strategy: value.strategy, direction: "LONG", symbol: value.symbol,
                requestedGross: 100, acceptedGross: 100, reservation: null, fill: null, exit: { sourceHash: HASH, ts: START, price: 101, quantity: 1, gross: 100, fee: 0, funding: 0, slippage: 0, realizedPnl: value.pnl, reason: "fixture" },
                reason: "fixture", fee: 0, funding: 0, slippage: 0, policyHash: HASH, configHash: HASH, resultHash: HASH }],
        })),
        accountingReconciliation: { cash: 0, equity: 0, realizedPnl: values.reduce((sum, value) => sum + value.pnl, 0), unrealizedPnl: 0, fee: 0, funding: 0, slippage: 0, difference: 0, balanced: true },
        baselineTradeLedger: [],
    } as unknown as IntegratedReplayResult);
    const baseline = makeReplay([{ strategy: "V12_V4", symbol: "BTCUSDT", pnl: 100 }, { strategy: "Q102", symbol: "ETHUSDT", pnl: 50 }]);
    const candidate = makeReplay([{ strategy: "V12_V4", symbol: "BTCUSDT", pnl: 80 }, { strategy: "Q102", symbol: "ETHUSDT", pnl: 40 }]);
    assert.equal(calculateLostPriorLogicPnl(baseline, candidate, frozen), 30);
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
        const longPolicy = { ...candidatePolicy("V12_V4_LONG", "V12_V4", "LONG"), policyHash: HASH };
        const shortPolicy = { ...candidatePolicy("V12_V4_SHORT", "V12_V4", "SHORT"), policyHash: HASH };
        const lineages = [
            { stageId: "V12_V4_LONG", status: "ACCEPTED", sourceHash: HASH, configHash: HASH, resultHash: HASH, policyHash: HASH, candidateId: longPolicy.candidateId, candidatePolicy: longPolicy, decisionIndex: 0 },
            { stageId: "V12_V4_SHORT", status: "ACCEPTED", sourceHash: HASH, configHash: HASH, resultHash: HASH, policyHash: HASH, candidateId: shortPolicy.candidateId, candidatePolicy: shortPolicy, decisionIndex: 1 },
        ] as const;
        await writeFile(path, JSON.stringify({
            sourceHash: HASH,
            configHash: HASH,
            resultHash: HASH,
            policyHash: HASH,
            stageIds: ["V12_V4_LONG", "V12_V4_SHORT"],
            policies: [longPolicy, shortPolicy],
            reason: "FROZEN_RESEARCH_POLICY_ONLY",
            completedStageIds: ["V12_V4_LONG", "V12_V4_SHORT"],
            stageDecisions: [
                { stageId: "V12_V4_LONG", status: "ACCEPTED", accepted: true, candidateId: longPolicy.candidateId, policyHash: HASH, sourceHash: HASH, configHash: HASH, resultHash: HASH, candidatePolicy: longPolicy },
                { stageId: "V12_V4_SHORT", status: "ACCEPTED", accepted: true, candidateId: shortPolicy.candidateId, policyHash: HASH, sourceHash: HASH, configHash: HASH, resultHash: HASH, candidatePolicy: shortPolicy },
            ],
            stageLineages: lineages,
            aggregateHash: hashJson(lineages as unknown as JsonValue),
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

test("baseline parity fails when replay omits a canonical trade from its complete ledger", async () => {
    const fixture = await makeFixture({ withBaselineLedger: true });
    try {
        const source = await loadCanonicalSource({
            sourceRoot: fixture.args.sourceRoot, dataRoot: fixture.args.dataRoot, productionSha: fixture.args.productionSha,
            startTs: fixture.args.startTs, endTs: fixture.args.endTs, initialEquity: fixture.args.initialEquity, deposits: fixture.args.deposits,
            feeBps: fixture.args.feeBps, slippageBps: fixture.args.slippageBps, fundingSource: fixture.args.fundingSource,
        });
        const policy = policyFromSource(source, fixture.args.stage);
        const parity = evaluateBaselineParity(source, policy, {
            positions: [{ positionId: "baseline:baseline-1", acceptedGross: 100 }],
            baselineTradeLedger: [],
        });
        assert.equal(parity.passed, false);
        assert.match(parity.reason, /replay\.completeLedger/);
    } finally {
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
        const priorFrozen = {
            sourceHash: baseline.sourceHash,
            configHash: baseline.configHash,
            resultHash: baseline.resultHash,
            policyHash: baseline.policyHash,
            stageIds: [],
            policies: [],
            reason: "FROZEN_RESEARCH_POLICY_ONLY",
            completedStageIds: [],
        } as FrozenStageSet;
        await writeFile(frozenPath, JSON.stringify(priorFrozen), "utf8");
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
        const frozenStageHash = hashFrozenStageSet(priorFrozen);
        const evaluationConfigHash = buildEvaluationConfigHash(fixture.args, baseline.sourceHash, frozenStageHash);
        const evaluationEvidence: EvaluationEvidence = {
            sourceHash: baseline.sourceHash,
            configHash: evaluationConfigHash,
            frozenStageHash,
            stageId: fixture.args.stage,
            candidateId: fixture.args.candidate,
            startTs: fixture.args.startTs,
            endTs: fixture.args.endTs,
            initialEquity: fixture.args.initialEquity,
            deposits: fixture.args.deposits,
            feeBps: fixture.args.feeBps,
            slippageBps: fixture.args.slippageBps,
            fundingSource: fixture.args.fundingSource,
            gateHash: buildEvaluationGateHash(baseline.sourceHash, evaluationConfigHash, baseline.policyHash, fixture.args.startTs),
            lineageHash: "",
            metrics,
        };
        const boundEvidence = { ...evaluationEvidence, lineageHash: hashEvaluationEvidence(evaluationEvidence) };
        const stage = await runStage({ ...fixture.args, frozenStagePath: frozenPath, evaluationEvidence: boundEvidence });
        assert.equal(stage.stageId, "V12_V4_LONG");
        assert.equal(stage.status, "ACCEPTED");
        const substitutedWindowEvidence = { ...boundEvidence, endTs: END + 1 };
        await assert.rejects(
            () => runStage({ ...fixture.args, frozenStagePath: frozenPath, evaluationEvidence: { ...substitutedWindowEvidence, lineageHash: hashEvaluationEvidence(substitutedWindowEvidence) } }),
            /METRIC_EVIDENCE_INVALID_LINEAGE/,
        );
        assert.equal(stage.accepted, true);
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});

test("requires evaluation evidence to bind the complete run identity", () => {
    const evidence = {
        sourceHash: HASH,
        configHash: HASH,
        frozenStageHash: HASH,
        stageId: "V12_V4_LONG" as const,
        candidateId: "V12_V4_LONG:candidate",
        startTs: START,
        endTs: END,
        initialEquity: 10_000,
        deposits: [],
        feeBps: 4,
        slippageBps: 2,
        fundingSource: "fixture-funding",
        gateHash: HASH,
        lineageHash: "",
        metrics: { normalDdImprovementBps: 1 },
    };
    const valid = { ...evidence, lineageHash: hashEvaluationEvidence(evidence) };
    assert.equal(hashEvaluationEvidence(valid), valid.lineageHash);
    assert.notEqual(hashEvaluationEvidence({ ...valid, endTs: END + 1 }), valid.lineageHash);
    assert.notEqual(hashEvaluationEvidence({ ...valid, frozenStageHash: "b".repeat(64) }), valid.lineageHash);
});

test("accepts a cumulative frozen set with accepted and not-applicable stage records after reload", async () => {
    const root = await mkdtemp(join(tmpdir(), "dd-reduction-frozen-lineage-"));
    try {
        const path = join(root, "frozen-stage.json");
        const stageLineages = [
            { stageId: "V12_V4_LONG", status: "NOT_APPLICABLE", sourceHash: HASH, configHash: HASH, resultHash: HASH, policyHash: HASH, candidatePolicy: null, decisionIndex: 0 },
            { stageId: "V12_V4_SHORT", status: "ACCEPTED", sourceHash: HASH, configHash: HASH, resultHash: HASH, policyHash: HASH, candidatePolicy: { ...candidatePolicy("V12_V4_SHORT", "V12_V4", "SHORT"), policyHash: HASH }, decisionIndex: 1 },
        ] as const;
        const frozen = {
            ...frozenSet(),
            stageIds: ["V12_V4_SHORT"],
            policies: [{ ...candidatePolicy("V12_V4_SHORT", "V12_V4", "SHORT"), policyHash: HASH }],
            completedStageIds: ["V12_V4_LONG", "V12_V4_SHORT"],
            stageDecisions: [
                { stageId: "V12_V4_LONG", status: "NOT_APPLICABLE", accepted: false, candidateId: "V12_V4_LONG:na", policyHash: HASH, sourceHash: HASH, configHash: HASH, resultHash: HASH, candidatePolicy: null },
                { stageId: "V12_V4_SHORT", status: "ACCEPTED", accepted: true, candidateId: "V12_V4_SHORT:candidate", policyHash: HASH, sourceHash: HASH, configHash: HASH, resultHash: HASH, candidatePolicy: { ...candidatePolicy("V12_V4_SHORT", "V12_V4", "SHORT"), policyHash: HASH } },
            ],
            stageLineages,
            aggregateHash: hashJson(stageLineages as unknown as JsonValue),
        };
        await writeFile(path, JSON.stringify(frozen), "utf8");
        const loaded = await loadFrozenStageSet(path);
        assert.deepEqual(loaded.completedStageIds, ["V12_V4_LONG", "V12_V4_SHORT"]);
        assert.deepEqual(loaded.stageIds, ["V12_V4_SHORT"]);
        assertFrozenStageReady(loaded, "Q102_LONG");
    } finally {
        await cleanup(root);
    }
});

test("runner replay config preserves aggregate, strategy, and symbol cap lineage", () => {
    const current = { ...candidatePolicy("V12_V4_LONG", "V12_V4", "LONG"), grossCap: 1_500, sharedRiskCap: 500, aggregateGrossCap: 9_000, cryptoGrossCap: 7_000, strategyGrossCap: 3_000, perStrategyGrossCaps: { V12_V4: 3_000, Q102: 4_000 }, perSymbolGrossCaps: { BTCUSDT: 2_500 } };
    const prior = { ...candidatePolicy("Q102_LONG", "Q102", "LONG"), grossCap: 800, sharedRiskCap: 250, aggregateGrossCap: 9_000, cryptoGrossCap: 7_000, strategyGrossCap: 4_000, perStrategyGrossCaps: { Q102: 4_000 }, perSymbolGrossCaps: { BTCUSDT: 2_500 } };
    const config = buildReplayConfig(runnerArgs("C:/fixture", "C:/output"), { manifest: { sourceSha: HASH }, strategyConfigs: [], baselineLedger: [], candidateEvents: [], productionSha: HASH } as never, frozenSet({ stageIds: ["Q102_LONG"], completedStageIds: ["Q102_LONG"], policies: [prior] }), current, HASH);
    assert.deepEqual(config.caps, { totalGross: 9_000, cryptoGross: 7_000, strategyGross: 3_000, perStrategy: { Q102: 4_000, V12_V4: 3_000 }, perSymbol: { BTCUSDT: 2_500 } });
    assert.deepEqual(config.perStrategyCaps, { Q102: 4_000, V12_V4: 3_000 });
    assert.deepEqual(config.perSymbolCaps, { BTCUSDT: 2_500 });
});

test("fails closed when current and frozen cap declarations conflict", () => {
    const current = { ...candidatePolicy("V12_V4_LONG", "V12_V4", "LONG"), aggregateGrossCap: 9_000, totalGrossCap: 9_000, cryptoGrossCap: 7_000, strategyGrossCap: 3_000, perStrategyGrossCaps: { V12_V4: 3_000 }, perSymbolGrossCaps: { BTCUSDT: 2_500 } };
    const prior = { ...candidatePolicy("Q102_LONG", "Q102", "LONG"), aggregateGrossCap: 8_000, totalGrossCap: 8_000, cryptoGrossCap: 7_000, strategyGrossCap: 4_000, perStrategyGrossCaps: { Q102: 4_000 }, perSymbolGrossCaps: { BTCUSDT: 2_500 } };
    assert.throws(() => buildReplayConfig(runnerArgs("C:/fixture", "C:/output"), { manifest: { sourceSha: HASH }, strategyConfigs: [], baselineLedger: [], candidateEvents: [], productionSha: HASH } as never, frozenSet({ stageIds: ["Q102_LONG"], completedStageIds: ["Q102_LONG"], policies: [prior] }), current, HASH), /conflicting aggregate cap declaration/);
    const symbolConflict = { ...prior, aggregateGrossCap: 9_000, totalGrossCap: 9_000, perSymbolGrossCaps: { BTCUSDT: 2_400 } };
    assert.throws(() => buildReplayConfig(runnerArgs("C:/fixture", "C:/output"), { manifest: { sourceSha: HASH }, strategyConfigs: [], baselineLedger: [], candidateEvents: [], productionSha: HASH } as never, frozenSet({ stageIds: ["Q102_LONG"], completedStageIds: ["Q102_LONG"], policies: [symbolConflict] }), current, HASH), /conflicting symbol cap declaration/);
});

test("runner rejects a manual-review candidate fill before its decision", () => {
    assert.throws(() => validateReplayBoundary({ reason: "MANUAL_REVIEW_REQUIRED", decisionLedger: [{ candidateId: "candidate", accepted: true, ts: START, fill: { ts: START - 1 } }] } as never), /CANDIDATE_FILL_BEFORE_DECISION|MANUAL_REVIEW_REQUIRED/);
});

test("runner rejects a candidate fill outside the evaluation window", () => {
    assert.throws(() => validateReplayBoundary({ reason: "REPLAY_COMPLETE", decisionLedger: [{ candidateId: "candidate", accepted: true, ts: START, fill: { ts: END + 1 } }] } as never, START, END), /CANDIDATE_FILL_OUTSIDE_WINDOW/);
});

test("replays a filled candidate only with bound protection-readback evidence", async () => {
    const fixture = await makeFixture({ withBaselineLedger: true, withCandidateFill: true });
    const previousOutputRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = fixture.args.outputRoot;
    try {
        const source = await loadCanonicalSource({
            sourceRoot: fixture.args.sourceRoot, dataRoot: fixture.args.dataRoot, productionSha: fixture.args.productionSha,
            startTs: fixture.args.startTs, endTs: fixture.args.endTs, initialEquity: fixture.args.initialEquity, deposits: fixture.args.deposits,
            feeBps: fixture.args.feeBps, slippageBps: fixture.args.slippageBps, fundingSource: fixture.args.fundingSource,
        });
        const sourceHash = source.manifest!.sourceSha;
        const baselineConfigHash = buildConfigHash(fixture.args, sourceHash);
        const baselineFrozenHash = hashJson({ baseline: true, sourceHash, configHash: baselineConfigHash });
        const baselineReadbackBase: ProtectionReadbackEvidence = {
            sourceHash, configHash: baselineConfigHash, frozenStageHash: baselineFrozenHash, stageId: fixture.args.stage, candidateId: fixture.args.candidate,
            available: true, orders: [{ clientOrderId: fixture.args.candidate, status: "READ_BACK", quantity: 1, price: 100 }], lineageHash: "",
        };
        const baselineReadback = { ...baselineReadbackBase, lineageHash: hashProtectionReadbackEvidence(baselineReadbackBase) };
        const baseline = await runBaseline({ ...fixture.args, protectionReadbackEvidence: baselineReadback });
        assert.equal(baseline.status, "ACCEPTED");
        const initialFrozen = frozenSet({ sourceHash, configHash: baseline.configHash, resultHash: baseline.resultHash, policyHash: baseline.policyHash });
        const initialPath = join(fixture.root, "initial-frozen.json");
        await writeFile(initialPath, JSON.stringify(initialFrozen), "utf8");
        const frozenStageHash = hashFrozenStageSet(initialFrozen);
        const evaluationConfigHash = buildEvaluationConfigHash(fixture.args, sourceHash, frozenStageHash);
        const readbackBase: ProtectionReadbackEvidence = {
            sourceHash, configHash: evaluationConfigHash, frozenStageHash, stageId: fixture.args.stage, candidateId: fixture.args.candidate,
            available: true, orders: [{ clientOrderId: fixture.args.candidate, status: "READ_BACK", quantity: 1, price: 100 }], lineageHash: "",
        };
        const readback = { ...readbackBase, lineageHash: hashProtectionReadbackEvidence(readbackBase) };
        const evidenceBase: EvaluationEvidence = {
            sourceHash, configHash: evaluationConfigHash, frozenStageHash, stageId: fixture.args.stage, candidateId: fixture.args.candidate,
            startTs: START, endTs: END, initialEquity: 10_000, deposits: [], feeBps: 4, slippageBps: 2, fundingSource: "fixture-funding",
            gateHash: buildEvaluationGateHash(sourceHash, evaluationConfigHash, baseline.policyHash, START), lineageHash: "", metrics: {
                normalDdImprovementBps: 100, severeDdImprovementBps: 100, oosDdImprovementBps: 0, walkForwardImprovementBps: 0, profitFactorDeclinePct: 0,
                finalEquityDeclinePct: 0, tradeCountRatio: 1, capacityRegression: 0, safetyRegression: 0, costStressPass: 1, candidateSelectionUsesFuturePnl: 0,
            },
        };
        const accepted = await runStage({ ...fixture.args, frozenStagePath: initialPath, protectionReadbackEvidence: readback, evaluationEvidence: { ...evidenceBase, lineageHash: hashEvaluationEvidence(evidenceBase) } });
        assert.equal(accepted.status, "ACCEPTED");
        await assert.rejects(
            () => runStage({ ...fixture.args, frozenStagePath: initialPath, evaluationEvidence: { ...evidenceBase, lineageHash: hashEvaluationEvidence(evidenceBase) } }),
            /PROTECTION_READBACK_UNAVAILABLE/,
        );
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});

test("same deterministic baseline run has one atomic artifact winner", async () => {
    const fixture = await makeFixture({ withBaselineLedger: true });
    const previousOutputRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = fixture.args.outputRoot;
    try {
        const results = await Promise.allSettled([runBaseline(fixture.args), runBaseline(fixture.args)]);
        const fulfilled = results.filter((entry): entry is PromiseFulfilledResult<StageResult> => entry.status === "fulfilled");
        const rejected = results.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
        assert.equal(fulfilled.length, 1);
        assert.equal(rejected.length, 1);
        assert.match(String(rejected[0]?.reason), /RESEARCH_ARTIFACT_EXISTS/);
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});

test("accepts two sequential stages and reloads the cumulative frozen artifact", async () => {
    const fixture = await makeFixture({ withBaselineLedger: true });
    const previousOutputRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = fixture.args.outputRoot;
    const metrics = {
        normalDdImprovementBps: 100, severeDdImprovementBps: 100, oosDdImprovementBps: 0, walkForwardImprovementBps: 0,
        profitFactorDeclinePct: 0, finalEquityDeclinePct: 0, tradeCountRatio: 1, capacityRegression: 0, safetyRegression: 0,
        costStressPass: 1, candidateSelectionUsesFuturePnl: 0,
    };
    try {
        const baseline0 = await runBaseline(fixture.args);
        const initialFrozen = frozenSet({ sourceHash: baseline0.sourceHash, configHash: baseline0.configHash, resultHash: baseline0.resultHash, policyHash: baseline0.policyHash });
        const initialPath = join(fixture.root, "initial-frozen.json");
        await writeFile(initialPath, JSON.stringify(initialFrozen), "utf8");
        const frozenHash0 = hashFrozenStageSet(initialFrozen);
        const evidence0Base: EvaluationEvidence = {
            sourceHash: baseline0.sourceHash, configHash: buildEvaluationConfigHash(fixture.args, baseline0.sourceHash, frozenHash0), frozenStageHash: frozenHash0,
            stageId: fixture.args.stage, candidateId: fixture.args.candidate, startTs: START, endTs: END, initialEquity: 10_000, deposits: [], feeBps: 4, slippageBps: 2,
            fundingSource: "fixture-funding", gateHash: buildEvaluationGateHash(baseline0.sourceHash, buildEvaluationConfigHash(fixture.args, baseline0.sourceHash, frozenHash0), baseline0.policyHash, START), lineageHash: "", metrics,
        };
        const stage0 = await runStage({ ...fixture.args, frozenStagePath: initialPath, evaluationEvidence: { ...evidence0Base, lineageHash: hashEvaluationEvidence(evidence0Base) } });
        assert.equal(stage0.status, "ACCEPTED");
        const stage0FrozenPath = join(fixture.args.outputRoot, fixture.args.stage, stage0.runId!, "frozen-stage.json");
        const stage1Args: RunnerArgs = { ...fixture.args, stage: "V12_V4_SHORT", candidate: "V12_V4_SHORT:SHORT:initial-stop:250" };
        const baseline1 = await runBaseline(stage1Args);
        const frozen0 = await loadFrozenStageSet(stage0FrozenPath);
        const frozenHash1 = hashFrozenStageSet(frozen0);
        const configHash1 = buildEvaluationConfigHash(stage1Args, baseline1.sourceHash, frozenHash1);
        const evidence1Base: EvaluationEvidence = {
            sourceHash: baseline1.sourceHash, configHash: configHash1, frozenStageHash: frozenHash1, stageId: stage1Args.stage, candidateId: stage1Args.candidate,
            startTs: START, endTs: END, initialEquity: 10_000, deposits: [], feeBps: 4, slippageBps: 2, fundingSource: "fixture-funding",
            gateHash: buildEvaluationGateHash(baseline1.sourceHash, configHash1, baseline1.policyHash, START), lineageHash: "", metrics,
        };
        const stage1 = await runStage({ ...stage1Args, frozenStagePath: stage0FrozenPath, evaluationEvidence: { ...evidence1Base, lineageHash: hashEvaluationEvidence(evidence1Base) } });
        assert.equal(stage1.status, "ACCEPTED");
        const reloaded = await loadFrozenStageSet(join(fixture.args.outputRoot, stage1Args.stage, stage1.runId!, "frozen-stage.json"));
        assert.deepEqual(reloaded.stageIds, ["V12_V4_LONG", "V12_V4_SHORT"]);
        assert.deepEqual(reloaded.completedStageIds, ["V12_V4_LONG", "V12_V4_SHORT"]);
        assertFrozenStageReady(reloaded, "Q102_LONG");
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});

test("persists a rejected attempt and reloads an accepted retry for the same stage", async () => {
    const fixture = await makeFixture({ withBaselineLedger: true });
    const previousOutputRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = fixture.args.outputRoot;
    const metrics = {
        normalDdImprovementBps: 100, severeDdImprovementBps: 100, oosDdImprovementBps: 0, walkForwardImprovementBps: 0,
        profitFactorDeclinePct: 0, finalEquityDeclinePct: 0, tradeCountRatio: 1, capacityRegression: 0, safetyRegression: 0,
        costStressPass: 1, candidateSelectionUsesFuturePnl: 0,
    };
    try {
        const baseline = await runBaseline(fixture.args);
        const initialFrozen = frozenSet({ sourceHash: baseline.sourceHash, configHash: baseline.configHash, resultHash: baseline.resultHash, policyHash: baseline.policyHash });
        const initialPath = join(fixture.root, "initial-frozen.json");
        await writeFile(initialPath, JSON.stringify(initialFrozen), "utf8");
        const rejectedArgs: RunnerArgs = { ...fixture.args, candidate: "V12_V4_LONG:LONG:profit-floor:25" };
        const frozenHash0 = hashFrozenStageSet(initialFrozen);
        const rejectedConfigHash = buildEvaluationConfigHash(rejectedArgs, baseline.sourceHash, frozenHash0);
        const rejectedEvidence: EvaluationEvidence = {
            sourceHash: baseline.sourceHash, configHash: rejectedConfigHash, frozenStageHash: frozenHash0, stageId: rejectedArgs.stage, candidateId: rejectedArgs.candidate,
            startTs: START, endTs: END, initialEquity: 10_000, deposits: [], feeBps: 4, slippageBps: 2, fundingSource: "fixture-funding",
            gateHash: buildEvaluationGateHash(baseline.sourceHash, rejectedConfigHash, baseline.policyHash, START), lineageHash: "", metrics: { ...metrics, normalDdImprovementBps: 0, severeDdImprovementBps: 0 },
        };
        const rejected = await runStage({ ...rejectedArgs, frozenStagePath: initialPath, evaluationEvidence: { ...rejectedEvidence, lineageHash: hashEvaluationEvidence(rejectedEvidence) } });
        assert.equal(rejected.status, "REJECTED");
        const rejectedFrozenPath = join(fixture.args.outputRoot, rejectedArgs.stage, rejected.runId!, "frozen-stage.json");
        const rejectedFrozen = await loadFrozenStageSet(rejectedFrozenPath);
        assert.equal(rejectedFrozen.stageLineages, undefined);
        assert.equal(rejectedFrozen.stageDecisions?.[0]?.status, "REJECTED");

        const retryArgs: RunnerArgs = { ...fixture.args, candidate: "V12_V4_LONG:LONG:initial-stop:250" };
        const retryFrozenHash = hashFrozenStageSet(rejectedFrozen);
        const retryConfigHash = buildEvaluationConfigHash(retryArgs, baseline.sourceHash, retryFrozenHash);
        const retryEvidence: EvaluationEvidence = {
            sourceHash: baseline.sourceHash, configHash: retryConfigHash, frozenStageHash: retryFrozenHash, stageId: retryArgs.stage, candidateId: retryArgs.candidate,
            startTs: START, endTs: END, initialEquity: 10_000, deposits: [], feeBps: 4, slippageBps: 2, fundingSource: "fixture-funding",
            gateHash: buildEvaluationGateHash(baseline.sourceHash, retryConfigHash, baseline.policyHash, START), lineageHash: "", metrics,
        };
        const accepted = await runStage({ ...retryArgs, frozenStagePath: rejectedFrozenPath, evaluationEvidence: { ...retryEvidence, lineageHash: hashEvaluationEvidence(retryEvidence) } });
        assert.equal(accepted.status, "ACCEPTED");
        const reloaded = await loadFrozenStageSet(join(fixture.args.outputRoot, retryArgs.stage, accepted.runId!, "frozen-stage.json"));
        assert.deepEqual(reloaded.stageIds, ["V12_V4_LONG"]);
        assert.equal(reloaded.stageLineages?.[0]?.decisionIndex, 1);
        assert.deepEqual(reloaded.stageDecisions?.map((decision) => decision.status), ["REJECTED", "ACCEPTED"]);
        assertFrozenStageReady(reloaded, "V12_V4_SHORT");
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});

test("rejects non-empty legacy frozen policies whose lineage is not normalized", async () => {
    const root = await mkdtemp(join(tmpdir(), "dd-reduction-legacy-lineage-"));
    try {
        const path = join(root, "legacy.json");
        await writeFile(path, JSON.stringify({ ...frozenSet({ stageIds: ["V12_V4_LONG"], completedStageIds: ["V12_V4_LONG"], policies: [{ ...candidatePolicy("V12_V4_LONG", "V12_V4", "LONG"), sourceHash: "b".repeat(64) }] }) }), "utf8");
        await assert.rejects(() => loadFrozenStageSet(path), /FROZEN_STAGE_LINEAGE_REQUIRED/);
    } finally {
        await cleanup(root);
    }
});

test("accepts a NOT_APPLICABLE first stage followed by an accepted stage after reload", async () => {
    const fixture = await makeFixture({ withBaselineLedger: true, shortOnly: true });
    const previousOutputRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = fixture.args.outputRoot;
    try {
        const baseline0 = await runBaseline(fixture.args);
        const initialFrozen = frozenSet({ sourceHash: baseline0.sourceHash, configHash: baseline0.configHash, resultHash: baseline0.resultHash, policyHash: baseline0.policyHash });
        const initialPath = join(fixture.root, "initial-frozen.json");
        await writeFile(initialPath, JSON.stringify(initialFrozen), "utf8");
        const stage0Args = { ...fixture.args, candidate: "V12_V4_LONG:LONG:NOT_APPLICABLE" };
        const stage0 = await runStage({ ...stage0Args, frozenStagePath: initialPath });
        assert.equal(stage0.status, "NOT_APPLICABLE");
        const frozenPath = join(fixture.args.outputRoot, stage0Args.stage, stage0.runId!, "frozen-stage.json");
        const frozen0 = await loadFrozenStageSet(frozenPath);
        const stage1Args: RunnerArgs = { ...fixture.args, stage: "V12_V4_SHORT", candidate: "V12_V4_SHORT:SHORT:initial-stop:250" };
        const baseline1 = await runBaseline(stage1Args);
        const frozenHash = hashFrozenStageSet(frozen0);
        const configHash = buildEvaluationConfigHash(stage1Args, baseline1.sourceHash, frozenHash);
        const evidence: EvaluationEvidence = {
            sourceHash: baseline1.sourceHash, configHash, frozenStageHash: frozenHash, stageId: stage1Args.stage, candidateId: stage1Args.candidate,
            startTs: START, endTs: END, initialEquity: 10_000, deposits: [], feeBps: 4, slippageBps: 2, fundingSource: "fixture-funding",
            gateHash: buildEvaluationGateHash(baseline1.sourceHash, configHash, baseline1.policyHash, START), lineageHash: "", metrics: {
                normalDdImprovementBps: 100, severeDdImprovementBps: 100, oosDdImprovementBps: 0, walkForwardImprovementBps: 0, profitFactorDeclinePct: 0,
                finalEquityDeclinePct: 0, tradeCountRatio: 1, capacityRegression: 0, safetyRegression: 0, costStressPass: 1, candidateSelectionUsesFuturePnl: 0,
            },
        };
        const stage1 = await runStage({ ...stage1Args, frozenStagePath: frozenPath, evaluationEvidence: { ...evidence, lineageHash: hashEvaluationEvidence(evidence) } });
        const reloaded = await loadFrozenStageSet(join(fixture.args.outputRoot, stage1Args.stage, stage1.runId!, "frozen-stage.json"));
        assert.deepEqual(reloaded.stageIds, ["V12_V4_SHORT"]);
        assert.deepEqual(reloaded.completedStageIds, ["V12_V4_LONG", "V12_V4_SHORT"]);
        assertFrozenStageReady(reloaded, "Q102_LONG");
    } finally {
        if (previousOutputRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousOutputRoot;
        await cleanup(fixture.root);
    }
});
