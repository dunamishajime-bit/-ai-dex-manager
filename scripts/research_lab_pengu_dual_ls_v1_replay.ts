import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { PENGU_DUAL_LS_V1 } from "../config/penguDualLsV1Runtime";
import {
    buildPenguDualLsV1Signal,
    type PenguDualLsV1FundingPoint,
    type PenguDualLsV1History,
    type PenguDualLsV1Position,
} from "../lib/pengu-dual-ls-v1";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DATA_START = Date.parse("2025-08-03T00:00:00Z");
const DEFAULT_START = Date.parse("2025-08-13T00:00:00Z");
const HOLDOUT_START = Date.parse("2026-03-11T00:00:00Z");
const ONE_WAY_FEE_BPS = 6;
const ASTER_BASE = "https://fapi.asterdex.com";

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

async function getJson(url: string) {
    let last: unknown;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
            const response = await fetch(url, { headers: { "user-agent": "DisDex-PENGU-Dual-LS-V1-BT/1.0" } });
            if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
            return await response.json();
        } catch (error) {
            last = error;
            await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 1000));
        }
    }
    throw last instanceof Error ? last : new Error(String(last));
}

async function fetchKlines(symbol: string, start: number, endExclusive: number) {
    const rows: Array<{ openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number }> = [];
    let cursor = start;
    while (cursor < endExclusive) {
        const query = new URLSearchParams({
            symbol,
            interval: "1h",
            startTime: String(cursor),
            endTime: String(endExclusive - 1),
            limit: "1500",
        });
        const payload = await getJson(`${ASTER_BASE}/fapi/v1/klines?${query.toString()}`);
        if (!Array.isArray(payload) || payload.length === 0) break;
        for (const item of payload) {
            if (!Array.isArray(item) || item.length < 6) continue;
            const openTime = Number(item[0]);
            if (!(start <= openTime && openTime < endExclusive)) continue;
            rows.push({
                openTime,
                closeTime: Number(item[6] ?? openTime + HOUR - 1),
                open: Number(item[1]), high: Number(item[2]), low: Number(item[3]), close: Number(item[4]), volume: Number(item[5]),
            });
        }
        const next = Number((payload.at(-1) as unknown[])[0]) + HOUR;
        if (!Number.isFinite(next) || next <= cursor) break;
        cursor = next;
        if (payload.length < 1500) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    const dedup = new Map(rows.map((row) => [row.openTime, row]));
    return [...dedup.values()].sort((a, b) => a.openTime - b.openTime);
}

async function fetchFunding(symbol: string, start: number, endExclusive: number): Promise<PenguDualLsV1FundingPoint[]> {
    const rows: PenguDualLsV1FundingPoint[] = [];
    let cursor = start;
    while (cursor < endExclusive) {
        const query = new URLSearchParams({ symbol, startTime: String(cursor), endTime: String(endExclusive - 1), limit: "1000" });
        let payload: unknown;
        try {
            payload = await getJson(`${ASTER_BASE}/fapi/v3/fundingRate?${query.toString()}`);
        } catch {
            payload = await getJson(`${ASTER_BASE}/fapi/v1/fundingRate?${query.toString()}`);
        }
        if (!Array.isArray(payload) || payload.length === 0) break;
        for (const item of payload) {
            if (!item || typeof item !== "object") continue;
            const row = item as Record<string, unknown>;
            const fundingTime = Number(row.fundingTime ?? row.time ?? 0);
            const fundingRate = Number(row.fundingRate ?? row.rate ?? 0);
            if (start <= fundingTime && fundingTime < endExclusive && Number.isFinite(fundingRate)) rows.push({ fundingTime, fundingRate });
        }
        const last = payload.at(-1) as Record<string, unknown>;
        const next = Number(last.fundingTime ?? last.time ?? 0) + 1;
        if (!Number.isFinite(next) || next <= cursor) break;
        cursor = next;
        if (payload.length < 1000) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    const dedup = new Map(rows.map((row) => [row.fundingTime, row]));
    return [...dedup.values()].sort((a, b) => a.fundingTime - b.fundingTime);
}

function metrics(trades: ReplayTrade[]) {
    let equity = 1, peak = 1, maxDd = 0, wins = 0, grossProfit = 0, grossLoss = 0;
    for (const trade of trades) {
        const value = trade.returnAtRequestedGross;
        equity *= 1 + value;
        peak = Math.max(peak, equity);
        maxDd = Math.min(maxDd, equity / peak - 1);
        if (value > 0) { wins += 1; grossProfit += value; }
        else if (value < 0) grossLoss += -value;
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
    return points
        .filter((point) => start <= point.fundingTime && point.fundingTime < end)
        .reduce((sum, point) => sum - side * point.fundingRate, 0);
}

async function main() {
    const output = resolve(process.env.PENGU_REPLAY_OUTPUT || ".research-state/v96-v52-pengu-dual-ls-v1/pengu-replay.json");
    const completedHour = Math.floor(Date.now() / HOUR) * HOUR;
    const requestedEnd = Number(process.env.REPLAY_END_MS || completedHour);
    const endExclusive = Math.min(requestedEnd, completedHour);
    const start = Number(process.env.REPLAY_START_MS || DEFAULT_START);
    const fetchStart = Math.min(DATA_START, start - 10 * DAY);
    const [btcRows, penguRows, funding] = await Promise.all([
        fetchKlines("BTCUSDT", fetchStart, endExclusive),
        fetchKlines("PENGUUSDT", fetchStart, endExclusive),
        fetchFunding("PENGUUSDT", fetchStart - DAY, endExclusive),
    ]);
    if (btcRows.length < 2000 || penguRows.length < 2000) throw new Error(`Insufficient Aster H1 history BTC=${btcRows.length} PENGU=${penguRows.length}`);
    const history: PenguDualLsV1History = { btc1h: btcRows, pengu1h: penguRows, penguFunding: funding };
    const btcTs = new Set(btcRows.map((row) => row.openTime));
    const common = penguRows.filter((row) => btcTs.has(row.openTime));
    const byTs = new Map(penguRows.map((row) => [row.openTime, row]));
    let position: PenguDualLsV1Position | undefined;
    let signalTs = 0;
    const trades: ReplayTrade[] = [];
    const diagnostics = { decisions: 0, entrySignals: 0, exits: 0, missingNextOpen: 0 };

    for (const row of common) {
        const now = row.openTime + HOUR;
        if (now <= fetchStart + 8 * DAY || now > endExclusive) continue;
        const signal = buildPenguDualLsV1Signal(history, position, now);
        diagnostics.decisions += 1;
        if (position && signal.features && position.side > 0 && !signal.exit) {
            position = { ...position, highWaterMark: Math.max(position.highWaterMark, signal.features.high) };
        }
        if (position && signal.exit) {
            const exitTs = row.openTime + HOUR;
            const exitBar = byTs.get(exitTs);
            if (!exitBar || exitTs > endExclusive) { diagnostics.missingNextOpen += 1; continue; }
            const rawUnitReturn = position.side * (exitBar.open / position.entryPrice - 1);
            const fundingUnitReturn = fundingReturn(funding, position.side, position.entryTs, exitTs);
            const feeUnitReturn = -2 * ONE_WAY_FEE_BPS / 10_000;
            const netUnitReturn = rawUnitReturn + fundingUnitReturn + feeUnitReturn;
            trades.push({
                side: position.side,
                signalTs,
                entryTs: position.entryTs,
                exitSignalTs: signal.referenceTs,
                exitTs,
                entryPrice: position.entryPrice,
                exitPrice: exitBar.open,
                requestedGross: position.gross,
                rawUnitReturn,
                fundingUnitReturn,
                feeUnitReturn,
                netUnitReturn,
                returnAtRequestedGross: netUnitReturn * position.gross,
                exitReason: signal.exit.reason,
            });
            diagnostics.exits += 1;
            position = undefined;
            signalTs = 0;
            continue;
        }
        if (!position && signal.side !== 0 && signal.entryTs && signal.entryTs >= start && signal.entryTs < endExclusive) {
            const entryBar = byTs.get(signal.entryTs);
            if (!entryBar) { diagnostics.missingNextOpen += 1; continue; }
            const requestedGross = Math.min(PENGU_DUAL_LS_V1.maximumGross, signal.targetGross);
            position = { side: signal.side as -1 | 1, entryTs: signal.entryTs, entryPrice: entryBar.open, quantity: 1, gross: requestedGross, highWaterMark: entryBar.open };
            signalTs = signal.referenceTs;
            diagnostics.entrySignals += 1;
        }
    }

    const full = trades.filter((row) => row.entryTs >= start && row.exitTs <= endExclusive);
    const holdout = full.filter((row) => row.entryTs >= HOLDOUT_START);
    const payload = {
        version: 2,
        strategyId: PENGU_DUAL_LS_V1.id,
        productionLogicSource: "lib/pengu-dual-ls-v1.ts",
        dataSource: "Aster public USD-M H1 + Aster funding",
        generatedAt: new Date().toISOString(),
        period: { startInclusive: new Date(start).toISOString(), endExclusive: new Date(endExclusive).toISOString(), holdoutStartInclusive: new Date(HOLDOUT_START).toISOString() },
        fixedRules: { requestedGross: PENGU_DUAL_LS_V1.maximumGross, singlePositionSlot: true, simultaneousLongShortAllowed: false, shortPriorityOnSameBar: true, holdHours: PENGU_DUAL_LS_V1.holdHours, nextOpenExecution: true, oneWayFeeBps: ONE_WAY_FEE_BPS, slippageBps: 0 },
        data: { btcH1: btcRows.length, penguH1: penguRows.length, fundingPoints: funding.length, commonH1: common.length },
        diagnostics,
        fullMetrics: metrics(full),
        holdoutMetrics: metrics(holdout),
        trades: full,
        openPositionAtEnd: position || null,
        integrity: { chronological: full.every((trade, index) => index === 0 || trade.entryTs >= full[index - 1].exitTs), noOverlap: full.every((trade, index) => index === 0 || trade.entryTs >= full[index - 1].exitTs), maximumRequestedGross: Math.max(0, ...full.map((trade) => trade.requestedGross)) },
    };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ period: payload.period, data: payload.data, fullMetrics: payload.fullMetrics, holdoutMetrics: payload.holdoutMetrics, integrity: payload.integrity }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
