import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { PENGU_DUAL_LS_V1 } from "../config/penguDualLsV1Runtime";
import {
    buildPenguDualLsV1Signal,
    type PenguDualLsV1FundingPoint,
    type PenguDualLsV1History,
    type PenguDualLsV1Position,
} from "../lib/pengu-dual-ls-v1";

const HOUR = 3_600_000;
const DEFAULT_START = Date.parse("2025-08-13T00:00:00Z");
const HOLDOUT_START = Date.parse("2026-03-11T00:00:00Z");
const ONE_WAY_FEE_BPS = 6;

type RawBar = { ts: number; open: number; high: number; low: number; close: number; volume: number };
type FundingRaw = { fundingTime: number; fundingRate: string | number };

type ReplayTrade = {
    side: -1 | 1;
    signalTs: number;
    entryTs: number;
    exitSignalTs: number;
    exitTs: number;
    entryPrice: number;
    exitPrice: number;
    requestedGross: number;
    rawUnitReturn: number;
    fundingUnitReturn: number;
    feeUnitReturn: number;
    netUnitReturn: number;
    returnAtRequestedGross: number;
    exitReason: string;
};

function parseJson<T>(text: string): T {
    return JSON.parse(text.replace(/^\uFEFF/, "")) as T;
}

function candle(row: RawBar) {
    return {
        openTime: Number(row.ts),
        closeTime: Number(row.ts) + HOUR - 1,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
    };
}

function product(values: number[]) {
    return values.reduce((equity, value) => equity * (1 + value), 1);
}

function metrics(trades: ReplayTrade[], grossField: "returnAtRequestedGross" | "netUnitReturn" = "returnAtRequestedGross") {
    let equity = 1;
    let peak = 1;
    let maxDd = 0;
    let wins = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    for (const trade of trades) {
        const value = trade[grossField];
        equity *= 1 + value;
        peak = Math.max(peak, equity);
        maxDd = Math.min(maxDd, equity / peak - 1);
        if (value > 0) {
            wins += 1;
            grossProfit += value;
        } else if (value < 0) {
            grossLoss += -value;
        }
    }
    return {
        trades: trades.length,
        longs: trades.filter((row) => row.side > 0).length,
        shorts: trades.filter((row) => row.side < 0).length,
        compoundedReturnPct: (equity - 1) * 100,
        winRatePct: trades.length ? wins / trades.length * 100 : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
        maxDrawdownPct: maxDd * 100,
    };
}

function fundingReturn(points: PenguDualLsV1FundingPoint[], side: -1 | 1, start: number, end: number) {
    let value = 0;
    for (const point of points) {
        if (point.fundingTime < start) continue;
        if (point.fundingTime >= end) break;
        value += -side * point.fundingRate;
    }
    return value;
}

async function main() {
    const root = resolve(process.env.PENGU_EVIDENCE_ROOT || ".pengu-evidence/reports/pengu-v46-repro/data");
    const out = resolve(process.env.PENGU_REPLAY_OUTPUT || ".research-state/v96-v52-pengu-dual-ls-v1/pengu-replay.json");
    const [btcRaw, penguRaw, fundingRaw] = await Promise.all([
        readFile(resolve(root, "BTCUSDT-1h-2025-08-03_2026-08-03.json"), "utf8"),
        readFile(resolve(root, "PENGUUSDT-1h-2025-08-03_2026-08-03.json"), "utf8"),
        readFile(resolve(root, "PENGUUSDT-funding-v3-2025-08-02_2026-08-03.json"), "utf8"),
    ]);
    const btcRows = parseJson<RawBar[]>(btcRaw).map(candle).sort((a, b) => a.openTime - b.openTime);
    const penguRows = parseJson<RawBar[]>(penguRaw).map(candle).sort((a, b) => a.openTime - b.openTime);
    const funding: PenguDualLsV1FundingPoint[] = parseJson<FundingRaw[]>(fundingRaw)
        .map((row) => ({ fundingTime: Number(row.fundingTime), fundingRate: Number(row.fundingRate) }))
        .filter((row) => row.fundingTime > 0 && Number.isFinite(row.fundingRate))
        .sort((a, b) => a.fundingTime - b.fundingTime);
    const history: PenguDualLsV1History = { btc1h: btcRows, pengu1h: penguRows, penguFunding: funding };
    const byTs = new Map(penguRows.map((row) => [row.openTime, row]));
    const common = penguRows.filter((row) => btcRows.some((btc) => btc.openTime === row.openTime));
    const evidenceEndExclusive = Math.min(
        (penguRows.at(-1)?.openTime || 0) + HOUR,
        (btcRows.at(-1)?.openTime || 0) + HOUR,
    );
    const start = Number(process.env.REPLAY_START_MS || DEFAULT_START);
    const endExclusive = Math.min(Number(process.env.REPLAY_END_MS || evidenceEndExclusive), evidenceEndExclusive);

    let position: PenguDualLsV1Position | undefined;
    let pendingEntrySignalTs: number | undefined;
    const trades: ReplayTrade[] = [];
    const diagnostics = {
        decisions: 0,
        entrySignals: 0,
        exits: 0,
        missingNextOpen: 0,
        ignoredBeforeStart: 0,
        edgeSignalsWhileCapacityUnknown: 0,
    };

    for (const row of common) {
        const now = row.openTime + HOUR;
        if (now <= start - 10 * 24 * HOUR || now > endExclusive) continue;
        const signal = buildPenguDualLsV1Signal(history, position, now);
        diagnostics.decisions += 1;

        if (position && signal.features && position.side > 0 && !signal.exit) {
            position = { ...position, highWaterMark: Math.max(position.highWaterMark, signal.features.high) };
        }

        if (position && signal.exit) {
            const exitTs = row.openTime + HOUR;
            const exitBar = byTs.get(exitTs);
            if (!exitBar || exitTs > endExclusive) {
                diagnostics.missingNextOpen += 1;
                continue;
            }
            const entryPrice = position.entryPrice;
            const rawUnitReturn = position.side * (exitBar.open / entryPrice - 1);
            const fundingUnitReturn = fundingReturn(funding, position.side, position.entryTs, exitTs);
            const feeUnitReturn = -2 * ONE_WAY_FEE_BPS / 10_000;
            const netUnitReturn = rawUnitReturn + fundingUnitReturn + feeUnitReturn;
            const requestedGross = position.gross;
            trades.push({
                side: position.side,
                signalTs: pendingEntrySignalTs || position.entryTs - HOUR,
                entryTs: position.entryTs,
                exitSignalTs: signal.referenceTs,
                exitTs,
                entryPrice,
                exitPrice: exitBar.open,
                requestedGross,
                rawUnitReturn,
                fundingUnitReturn,
                feeUnitReturn,
                netUnitReturn,
                returnAtRequestedGross: netUnitReturn * requestedGross,
                exitReason: signal.exit.reason,
            });
            diagnostics.exits += 1;
            position = undefined;
            pendingEntrySignalTs = undefined;
            continue;
        }

        if (!position && signal.side !== 0 && signal.entryTs) {
            diagnostics.entrySignals += 1;
            if (signal.entryTs < start) {
                diagnostics.ignoredBeforeStart += 1;
                continue;
            }
            if (signal.entryTs >= endExclusive) continue;
            const entryBar = byTs.get(signal.entryTs);
            if (!entryBar) {
                diagnostics.missingNextOpen += 1;
                continue;
            }
            const requestedGross = Math.min(PENGU_DUAL_LS_V1.maximumGross, signal.targetGross);
            position = {
                side: signal.side as -1 | 1,
                entryTs: signal.entryTs,
                entryPrice: entryBar.open,
                quantity: 1,
                gross: requestedGross,
                highWaterMark: entryBar.open,
            };
            pendingEntrySignalTs = signal.referenceTs;
        }
    }

    const full = trades.filter((row) => row.entryTs >= start && row.exitTs <= endExclusive);
    const holdout = full.filter((row) => row.entryTs >= HOLDOUT_START);
    const payload = {
        version: 1,
        strategyId: PENGU_DUAL_LS_V1.id,
        productionLogicSource: "lib/pengu-dual-ls-v1.ts",
        generatedAt: new Date().toISOString(),
        period: {
            startInclusive: new Date(start).toISOString(),
            endExclusive: new Date(endExclusive).toISOString(),
            holdoutStartInclusive: new Date(HOLDOUT_START).toISOString(),
        },
        fixedRules: {
            requestedGross: PENGU_DUAL_LS_V1.maximumGross,
            singlePositionSlot: true,
            simultaneousLongShortAllowed: false,
            shortPriorityOnSameBar: true,
            holdHours: PENGU_DUAL_LS_V1.holdHours,
            nextOpenExecution: true,
            oneWayFeeBps: ONE_WAY_FEE_BPS,
            funding: "Aster historical funding; long pays positive funding and short receives it",
            slippageBps: 0,
        },
        diagnostics,
        fullMetrics: metrics(full),
        holdoutMetrics: metrics(holdout),
        trades: full,
        openPositionAtEnd: position || null,
        integrity: {
            chronological: full.every((row, index) => index === 0 || row.entryTs >= full[index - 1].exitTs),
            noOverlap: full.every((row, index) => index === 0 || row.entryTs >= full[index - 1].exitTs),
            maximumRequestedGross: Math.max(0, ...full.map((row) => row.requestedGross)),
            compoundedFactorCrossCheck: product(full.map((row) => row.returnAtRequestedGross)),
        },
    };
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ fullMetrics: payload.fullMetrics, holdoutMetrics: payload.holdoutMetrics, integrity: payload.integrity }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
