import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { calculateTradePathMetrics, summarizeDrawdown, type EquityPoint } from "../lib/backtest/dd-reduction/metrics";
import { attributeReplay, writeStageArtifacts } from "../lib/backtest/dd-reduction/reporting";
import type {
    ExecutionBar,
    ExecutionExit,
    ExecutionFill,
    IntegratedReplay,
    LifecycleEvent,
    StageResult,
    TradePath,
    PositionLifecycle,
} from "../lib/backtest/dd-reduction/types";

const HASH = "a".repeat(64);
type TradePathWithExits = TradePath & { readonly exits: readonly ExecutionExit[] };

function assertApprox(actual: number, expected: number, epsilon = 1e-9): void {
    assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function fill(price: number, quantity: number, ts = 1_700_000_000_000, fee = 0, funding = 0, slippage = 0): ExecutionFill {
    return {
        sourceHash: HASH,
        ts,
        price,
        quantity,
        gross: price * quantity,
        fee,
        funding,
        slippage,
        reason: "fixture-entry",
    };
}

function exit(price: number, quantity: number, ts: number, realizedPnl: number, fee = 0, funding = 0, slippage = 0, reason = "NORMAL_EXIT"): ExecutionExit {
    return {
        sourceHash: HASH,
        ts,
        price,
        quantity,
        gross: price * quantity,
        fee,
        funding,
        slippage,
        realizedPnl,
        reason,
    };
}

function bar(ts: number, open: number, high: number, low: number, close: number): ExecutionBar {
    return {
        sourceHash: HASH,
        ts,
        symbol: "BTCUSDT",
        timeframe: "1h",
        open,
        high,
        low,
        close,
        volume: 1,
    };
}

function path(overrides: Partial<TradePath> = {}): TradePath {
    return {
        sourceHash: HASH,
        tradeId: "trade-1",
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        entry: fill(100, 10),
        exit: null,
        reason: "fixture-trade",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        bars: [],
        ...overrides,
    };
}

test("calculates LONG MFE, MAE, initial adverse excursion, and giveback after profit turns into loss", () => {
    const result = calculateTradePathMetrics(path({
        entry: fill(100, 10, 1_700_000_000_000),
        exit: exit(95, 10, 1_700_010_800_000, -50, 2, 1, 0.5, "STOP"),
        fee: 2,
        funding: 1,
        slippage: 0.5,
        bars: [
            bar(1_700_003_600_000, 100, 102, 98, 101),
            bar(1_700_007_200_000, 101, 110, 99, 108),
            bar(1_700_010_800_000, 108, 109, 94, 95),
        ],
    }));

    assertApprox(result.mfePct, 10);
    assertApprox(result.maePct, 6);
    assertApprox(result.initialAdversePct, 2);
    assertApprox(result.givebackPct, 150);
    assertApprox(result.maxLossPct, 6.35);
    assert.equal(result.protectionInstallDelayMs, 3_600_000);
    assertApprox(result.stopSlippageBps, 5);
    assert.equal(result.holdingMs, 10_800_000);
});

test("keeps SHORT MFE after a partial exit and includes fee and funding in net result", () => {
    const result = calculateTradePathMetrics({
        ...path({
            direction: "SHORT",
            entry: fill(100, 10, 1_700_000_000_000, 1, 2),
            exit: exit(92, 6, 1_700_007_200_000, 48, 3, 4, 1, "TAKE_PROFIT"),
            fee: 4,
            funding: 6,
            slippage: 1,
            bars: [
                bar(1_700_003_600_000, 100, 101, 90, 94),
                bar(1_700_007_200_000, 94, 95, 91, 92),
            ],
        }),
        exits: [
            exit(95, 4, 1_700_005_400_000, 20, 1, 1, 0.25, "PARTIAL_EXIT"),
            exit(92, 6, 1_700_007_200_000, 48, 3, 4, 1, "TAKE_PROFIT"),
        ],
    } as TradePathWithExits);

    assertApprox(result.mfePct, 10);
    assertApprox(result.maePct, 1);
    assertApprox(result.givebackPct, 20);
    assertApprox(result.maxLossPct, 2.1);
    assert.equal(result.holdingMs, 7_200_000);
    assert.equal(result.realizedNetPnl, 57);
});

test("summarizes multiple drawdowns, recovery, and an unrecovered final drawdown", () => {
    const timeline: readonly EquityPoint[] = [
        { ts: 0, equity: 100, realizedEquity: 100, logic: "CORE", direction: "LONG" },
        { ts: 10, equity: 95, realizedEquity: 98, logic: "CORE", direction: "LONG" },
        { ts: 20, equity: 100, realizedEquity: 100, logic: "CORE", direction: "LONG" },
        { ts: 30, equity: 110, realizedEquity: 105, logic: "OVERLAY", direction: "SHORT" },
        { ts: 40, equity: 104, realizedEquity: 103, logic: "OVERLAY", direction: "SHORT" },
        { ts: 50, equity: 102, realizedEquity: 101, logic: "CORE", direction: "LONG" },
        { ts: 60, equity: 103, realizedEquity: 102, logic: "CORE", direction: "LONG" },
    ];

    const result = summarizeDrawdown(timeline);

    assertApprox(result.maxMtmDrawdownPct, 7.2727272727272725);
    assertApprox(result.maxRealizedDrawdownPct, 3.8095238095238093);
    assert.equal(result.episodes.length, 2);
    assert.equal(result.episodes[0].recoveryTs, 20);
    assert.equal(result.episodes[1].recoveryTs, null);
    assert.equal(result.timeUnderWaterMs, 50);
    assert.equal(result.peak.ts, 30);
    assert.equal(result.trough.ts, 50);
    assert.equal(result.recovery, null);
    assert.ok(result.logicAttribution.some((item) => item.key === "OVERLAY"));
    assert.ok(result.directionAttribution.some((item) => item.key === "LONG"));
});

test("attributes accepted trades separately from rejected and unfilled candidates without adding them to PnL", () => {
    const replay = {
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        policyHash: HASH,
        reason: "REPLAY_COMPLETE",
        fee: 3,
        funding: 2,
        slippage: 1,
        events: [],
        portfolio: [],
        positions: [],
        decisionLedger: [
            { candidateId: "accepted", accepted: true, fill: fill(100, 1), rejectionReason: null, strategy: "V12_V4", direction: "LONG", symbol: "BTCUSDT", requestedGross: 100, acceptedGross: 100, reservation: null, exit: null, reason: "core", fee: 0, funding: 0, slippage: 0, sourceHash: HASH, ts: 1, policyHash: HASH, configHash: HASH, resultHash: HASH },
            { candidateId: "rejected", accepted: false, fill: fill(100, 1), rejectionReason: "CAP", strategy: "V12_V4", direction: "LONG", symbol: "BTCUSDT", requestedGross: 100, acceptedGross: 0, reservation: null, exit: null, reason: "core", fee: 0, funding: 0, slippage: 0, sourceHash: HASH, ts: 2, policyHash: HASH, configHash: HASH, resultHash: HASH },
            { candidateId: "unfilled", accepted: true, fill: null, rejectionReason: null, strategy: "IDLE", direction: "SHORT", symbol: "ETHUSDT", requestedGross: 100, acceptedGross: 100, reservation: null, exit: null, reason: "overlay", fee: 0, funding: 0, slippage: 0, sourceHash: HASH, ts: 3, policyHash: HASH, configHash: HASH, resultHash: HASH },
        ],
        tradeLedger: [],
        rejectionCount: 1,
        preemption: { supported: false, count: null, reason: "PREEMPTION_UNSUPPORTED_IN_TASK_2" },
    } as IntegratedReplay;

    const result = attributeReplay(replay);

    assert.equal(result.acceptedCandidates, 2);
    assert.equal(result.acceptedTrades, 0);
    assert.equal(result.rejectedCandidates, 1);
    assert.equal(result.unfilledCandidates, 1);
    assert.equal(result.realizedPnl, 0);
    assert.equal(result.lostCorePnl, 0);
    assert.equal(result.preemption.supported, false);
    assert.ok(result.byLogic.some((item) => item.key === "CORE"));
    assert.ok(result.byLogic.some((item) => item.key === "OVERLAY"));
});

test("includes exit-event costs in net attribution while keeping gross realized PnL cost-free", () => {
    const exitEvent: LifecycleEvent = {
        sourceHash: HASH,
        ts: 1_700_007_200_000,
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        fill: null,
        exit: exit(110, 10, 1_700_007_200_000, 100, 2, 3, 4, "NORMAL_EXIT"),
        reason: "fixture-position",
        fee: 2,
        funding: 3,
        slippage: 4,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        eventId: "exit-cost-event",
        eventType: "EXIT",
        positionId: "cost-trade",
    };
    const position: PositionLifecycle = {
        sourceHash: HASH,
        positionId: "cost-trade",
        strategy: "V12_V4",
        direction: "LONG",
        symbol: "BTCUSDT",
        requestedGross: 1_000,
        acceptedGross: 1_000,
        reservation: null,
        entryFill: fill(100, 10),
        exit: exitEvent.exit,
        reason: "fixture-position",
        fee: 1,
        funding: 2,
        slippage: 3,
        policyHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        events: [exitEvent],
    };
    const replay = {
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        policyHash: HASH,
        reason: "REPLAY_COMPLETE",
        fee: 3,
        funding: 5,
        slippage: 7,
        events: [],
        portfolio: [],
        positions: [position],
        tradeLedger: [position],
        decisionLedger: [],
    } as IntegratedReplay;

    const result = attributeReplay(replay);

    assert.equal(result.grossRealizedPnl, 100);
    assert.equal(result.realizedPnl, 85);
    assert.equal(result.netPnl, 85);
    const dimensions = [result.byLogic, result.byStrategy, result.byDirection, result.bySymbol, result.byReason];
    for (const buckets of dimensions) {
        const bucket = buckets[0];
        assert.ok(bucket);
        assert.equal(bucket.realizedPnl, 100);
        assert.equal(bucket.fee, 3);
        assert.equal(bucket.funding, 5);
        assert.equal(bucket.slippage, 7);
        assert.equal(bucket.netPnl, bucket.realizedPnl - bucket.fee - bucket.funding - bucket.slippage);
    }
    const core = result.byLogic.find((item) => item.key === "CORE");
    assert.ok(core);
    assert.equal(core.netPnl, 85);
    assert.equal(core.netPnl, result.realizedPnl);
    assert.equal(core.fee, result.fee);
    assert.equal(core.funding, result.funding);
    assert.equal(core.slippage, result.slippage);
});

test("writes unrounded CSV, JSONL, JSON, and SHA256-indexed stage artifacts", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "dd-reduction-stage-"));
    const result: StageResult = {
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        stageId: "stage-3",
        strategy: "V12_V4",
        direction: "LONG",
        accepted: true,
        reason: "fixture",
        fee: 0.123456789,
        funding: -0.000000123,
        slippage: 0.000000456,
        policyHash: HASH,
        metrics: { maxDrawdownPct: 1.234567891234, givebackPct: 9.876543219876 },
    };

    const previousRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = outDir;
    let index: Awaited<ReturnType<typeof writeStageArtifacts>>;
    try {
        index = await writeStageArtifacts(result, outDir);
    } finally {
        if (previousRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousRoot;
    }
    const names = await readdir(outDir);
    assert.ok(names.includes("stage-result.csv"));
    assert.ok(names.includes("stage-result.jsonl"));
    assert.ok(names.includes("stage-result.json"));
    assert.ok(names.includes("sha256-index.json"));
    assert.equal(index.artifactPaths.length, 4);
    assert.match(await readFile(join(outDir, "stage-result.json"), "utf8"), /1\.234567891234/);
    assert.match(await readFile(join(outDir, "stage-result.csv"), "utf8"), /9\.876543219876/);
    assert.equal(JSON.parse(await readFile(join(outDir, "sha256-index.json"), "utf8")).files.length, 3);
});

test("rejects the Desktop root and arbitrary Desktop descendants while allowing a configured research root", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "dd-reduction-containment-"));
    const result: StageResult = {
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        stageId: "stage-3-containment",
        strategy: "V12_V4",
        direction: "LONG",
        accepted: true,
        reason: "fixture",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: HASH,
        metrics: {},
    };
    const desktopRoot = "C:\\Users\\dis\\Desktop";
    await assert.rejects(() => writeStageArtifacts(result, desktopRoot), /RESEARCH_OUTPUT/);
    await assert.rejects(() => writeStageArtifacts(result, join(desktopRoot, "arbitrary-child")), /RESEARCH_OUTPUT/);

    const previousRoot = process.env.DISDEX_AI_OUTPUT_ROOT;
    process.env.DISDEX_AI_OUTPUT_ROOT = outDir;
    try {
        await writeStageArtifacts(result, join(outDir, "approved-run"));
    } finally {
        if (previousRoot === undefined) delete process.env.DISDEX_AI_OUTPUT_ROOT;
        else process.env.DISDEX_AI_OUTPUT_ROOT = previousRoot;
    }
});
