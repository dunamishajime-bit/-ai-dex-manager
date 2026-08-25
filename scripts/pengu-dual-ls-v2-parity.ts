import assert from "node:assert/strict";

import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import {
    buildPenguDualLsV2EvaluationSeries,
    evaluatePenguDualLsV2PositionBar,
    targetGrossForAtr,
    type PenguDualLsV2History,
    type PenguDualLsV2Position,
} from "../lib/pengu-dual-ls-v2";
import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";

const HOUR = 3_600_000;
const WARM_START = Date.parse("2025-07-20T00:00:00Z");
const EVAL_START = Date.parse("2025-08-10T00:00:00Z");
const EVAL_END = Date.parse("2026-08-10T00:00:00Z");
const FEE_PER_SIDE = 0.0006;
const BASE_URL = "https://api.bitget.com";

const FROZEN = {
    short: { ret72Max: 0, impulse: -0.07, expiry: 24, bounceMin: 0.0125, bounceMax: 0.06, p24Floor: -0.12, btcEmaFloor: -0.04, rsiMin: 30, volMin: 0.25, volMax: 3, relMax: -0.02, btc24Max: 0.04, hold: 72, hard: 0.08, trigger: 0.15, trail: 0.04 },
    long: { ret72Min: 0.15, lookback: 18, p24Min: 0.10, relMin: 0.01, btc24Min: 0, rsiMin: 48, rsiMax: 78, volMin: 0.25, volMax: 3, atrMax: 0.05, hold: 120, hard: 0.08, trigger: 0.10, trail: 0.03 },
    risk: { target: 0.02, multiplier: 0.75, floor: 0.60, cap: 0.75, longMultiplier: 1.25, shortMultiplier: 1.00, cooldown: 6 },
} as const;

interface ReferenceRow extends DisDexV35Candle {
    btcClose: number;
    p24: number;
    p72: number;
    btc24: number;
    rel24: number;
    ema72: number;
    ema168: number;
    btcEmaDistance: number;
    volRatio: number;
    atrRatio: number;
    rsi: number;
    high18: number;
}

interface Trade {
    side: "L" | "S";
    entryTime: number;
    exitTime: number;
    entryPrice: number;
    exitPrice: number;
    gross: number;
    pnl: number;
    reason: "hard" | "trail" | "time";
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url: URL) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
            const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "DisDex-PENGU-V2-Parity/1.0" } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json() as { code?: string; data?: unknown[] };
            if (payload.code !== "00000" || !Array.isArray(payload.data)) throw new Error(`Bitget response code=${payload.code}`);
            return payload.data;
        } catch (error) {
            lastError = error;
            await sleep(500 * (attempt + 1));
        }
    }
    throw new Error(`Bitget download failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function download(symbol: string) {
    const records: unknown[][] = [];
    let cursor = WARM_START;
    while (cursor < EVAL_END) {
        const end = Math.min(EVAL_END - 1, cursor + 199 * HOUR);
        const url = new URL("/api/v2/mix/market/history-candles", BASE_URL);
        url.searchParams.set("symbol", symbol);
        url.searchParams.set("productType", "usdt-futures");
        url.searchParams.set("granularity", "1H");
        url.searchParams.set("startTime", String(cursor));
        url.searchParams.set("endTime", String(end));
        url.searchParams.set("limit", "200");
        records.push(...await getJson(url) as unknown[][]);
        cursor = end + 1;
        await sleep(40);
    }
    const byTs = new Map<number, DisDexV35Candle>();
    for (const row of records) {
        const openTime = Number(row[0]);
        const candle: DisDexV35Candle = {
            openTime,
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5]),
            closeTime: openTime + HOUR - 1,
        };
        if (openTime >= WARM_START && openTime < EVAL_END && Object.values(candle).every(Number.isFinite)) byTs.set(openTime, candle);
    }
    return [...byTs.values()].sort((left, right) => left.openTime - right.openTime);
}

function ema(values: number[], span: number) {
    const output = new Array<number>(values.length).fill(Number.NaN);
    const alpha = 2 / (span + 1);
    let current = values[0];
    for (let index = 0; index < values.length; index += 1) {
        current = index === 0 ? values[index] : alpha * values[index] + (1 - alpha) * current;
        if (index + 1 >= span) output[index] = current;
    }
    return output;
}

function rsi(values: number[], period = 14) {
    const output = new Array<number>(values.length).fill(Number.NaN);
    let gain = Number.NaN;
    let loss = Number.NaN;
    for (let index = 1; index < values.length; index += 1) {
        const delta = values[index] - values[index - 1];
        const up = Math.max(delta, 0);
        const down = Math.max(-delta, 0);
        gain = Number.isFinite(gain) ? up / period + gain * (1 - 1 / period) : up;
        loss = Number.isFinite(loss) ? down / period + loss * (1 - 1 / period) : down;
        if (index >= period) output[index] = loss <= 1e-15 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return output;
}

function mean(values: number[], end: number, length: number) {
    const start = end - length + 1;
    if (start < 0) return Number.NaN;
    return values.slice(start, end + 1).reduce((sum, value) => sum + value, 0) / length;
}

function prepareReference(pengu: DisDexV35Candle[], btc: DisDexV35Candle[]) {
    const btcByTs = new Map(btc.map((row) => [row.openTime, row.close]));
    const p = pengu.filter((row) => btcByTs.has(row.openTime));
    assert.equal(p.length, pengu.length, "Reference PENGU/BTC timestamps must align");
    const close = p.map((row) => row.close);
    const btcClose = p.map((row) => btcByTs.get(row.openTime)!);
    const volume = p.map((row) => row.volume);
    const ema72 = ema(close, 72);
    const ema168 = ema(close, 168);
    const btc168 = ema(btcClose, 168);
    const rsi14 = rsi(close);
    const trueRange = p.map((row, index) => Math.max(row.high - row.low, Math.abs(row.high - (close[index - 1] ?? row.close)), Math.abs(row.low - (close[index - 1] ?? row.close))));
    return p.map((row, index): ReferenceRow => ({
        ...row,
        btcClose: btcClose[index],
        p24: row.close / close[index - 24] - 1,
        p72: row.close / close[index - 72] - 1,
        btc24: btcClose[index] / btcClose[index - 24] - 1,
        rel24: row.close / close[index - 24] - btcClose[index] / btcClose[index - 24],
        ema72: ema72[index],
        ema168: ema168[index],
        btcEmaDistance: btcClose[index] / btc168[index] - 1,
        volRatio: mean(volume, index, 6) / mean(volume, index - 6, 36),
        atrRatio: mean(trueRange, index, 24) / row.close,
        rsi: rsi14[index],
        high18: Math.max(...p.slice(index - 18, index).map((item) => item.high)),
    }));
}

function referenceSignals(rows: ReferenceRow[]) {
    const short = new Array<boolean>(rows.length).fill(false);
    let active = false;
    let armed = false;
    let low = 0;
    let expiry = -1;
    for (let index = 180; index < rows.length; index += 1) {
        const row = rows[index];
        if (active && index > expiry) { active = false; armed = false; low = 0; }
        if (Number.isFinite(row.p24) && row.p24 <= FROZEN.short.impulse) {
            if (!active) { active = true; armed = false; low = row.low; expiry = index + FROZEN.short.expiry; }
            else { low = Math.min(low, row.low); expiry = Math.max(expiry, index + 1); }
        }
        if (!active) continue;
        low = Math.min(low, row.low);
        const bounce = row.close / low - 1;
        if (bounce > FROZEN.short.bounceMax) { active = false; armed = false; low = 0; continue; }
        if (bounce >= FROZEN.short.bounceMin) armed = true;
        if (armed && row.p72 <= FROZEN.short.ret72Max && row.close < rows[index - 1].low && row.close < row.ema72 && row.ema72 < row.ema168 && row.rel24 <= FROZEN.short.relMax && row.volRatio >= FROZEN.short.volMin && row.volRatio <= FROZEN.short.volMax && row.btc24 <= FROZEN.short.btc24Max && row.p24 >= FROZEN.short.p24Floor && row.btcEmaDistance >= FROZEN.short.btcEmaFloor && row.rsi >= FROZEN.short.rsiMin) {
            short[index] = true; active = false; armed = false; low = 0;
        }
    }
    const rawLong = rows.map((row) => row.p72 >= FROZEN.long.ret72Min && row.close > row.high18 && row.p24 >= FROZEN.long.p24Min && row.rel24 >= FROZEN.long.relMin && row.btc24 >= FROZEN.long.btc24Min && row.rsi >= FROZEN.long.rsiMin && row.rsi <= FROZEN.long.rsiMax && row.volRatio >= FROZEN.long.volMin && row.volRatio <= FROZEN.long.volMax && row.atrRatio <= FROZEN.long.atrMax && row.close > row.ema168);
    const long = rawLong.map((value, index) => value && !(rawLong[index - 1] ?? false));
    return { short, long };
}

function metrics(trades: Trade[]) {
    let equity = 1;
    let peak = 1;
    let maxDrawdown = 0;
    let profit = 0;
    let loss = 0;
    for (const trade of trades) {
        equity *= 1 + trade.pnl;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
        if (trade.pnl > 0) profit += trade.pnl;
        else loss -= trade.pnl;
    }
    return { trades: trades.length, returnPct: (equity - 1) * 100, profitFactor: profit / loss, maxDrawdownPct: maxDrawdown * 100, winRatePct: trades.filter((trade) => trade.pnl > 0).length / trades.length * 100 };
}

function referenceReplay(rows: ReferenceRow[]) {
    const signals = referenceSignals(rows);
    const trades: Trade[] = [];
    let index = 250;
    let cooldown = -1;
    while (index < rows.length - 2) {
        if (index <= cooldown) { index += 1; continue; }
        const side = signals.short[index] ? "S" : signals.long[index] ? "L" : undefined;
        if (!side) { index += 1; continue; }
        const entryIndex = index + 1;
        const entry = rows[entryIndex];
        const entryPrice = entry.open;
        const multiplier = side === "L" ? FROZEN.risk.longMultiplier : FROZEN.risk.shortMultiplier;
        const gross = Math.min(FROZEN.risk.cap * multiplier, Math.max(FROZEN.risk.floor * multiplier, FROZEN.risk.multiplier * FROZEN.risk.target / rows[index].atrRatio * multiplier));
        const hold = side === "S" ? FROZEN.short.hold : FROZEN.long.hold;
        const hard = side === "S" ? entryPrice * (1 + FROZEN.short.hard) : entryPrice * (1 - FROZEN.long.hard);
        const trigger = side === "S" ? FROZEN.short.trigger : FROZEN.long.trigger;
        const trail = side === "S" ? FROZEN.short.trail : FROZEN.long.trail;
        const last = Math.min(rows.length - 1, entryIndex + hold - 1);
        let best = entryPrice;
        let exitIndex = last;
        let exitPrice = rows[last].close;
        let reason: Trade["reason"] = "time";
        for (let cursor = entryIndex; cursor <= last; cursor += 1) {
            const row = rows[cursor];
            if ((side === "L" && row.low <= hard) || (side === "S" && row.high >= hard)) { exitIndex = cursor; exitPrice = hard; reason = "hard"; break; }
            const favourable = side === "L" ? best / entryPrice - 1 : entryPrice / best - 1;
            const trailingPrice = side === "L" ? best * (1 - trail) : best * (1 + trail);
            if (favourable >= trigger && ((side === "L" && row.low <= trailingPrice) || (side === "S" && row.high >= trailingPrice))) { exitIndex = cursor; exitPrice = trailingPrice; reason = "trail"; break; }
            best = side === "L" ? Math.max(best, row.high) : Math.min(best, row.low);
        }
        const raw = side === "L" ? exitPrice / entryPrice - 1 : entryPrice / exitPrice - 1;
        if (entry.openTime >= EVAL_START && entry.openTime < EVAL_END) trades.push({ side, entryTime: entry.openTime, exitTime: rows[exitIndex].openTime, entryPrice, exitPrice, gross, pnl: gross * raw - 2 * gross * FEE_PER_SIDE, reason });
        cooldown = exitIndex + FROZEN.risk.cooldown;
        index = exitIndex + 1;
    }
    return trades;
}

function productionReplay(history: PenguDualLsV2History) {
    const rows = buildPenguDualLsV2EvaluationSeries(history, EVAL_END + HOUR);
    const trades: Trade[] = [];
    let index = 250;
    let cooldown = -1;
    while (index < rows.length - 2) {
        if (index <= cooldown) { index += 1; continue; }
        const side = rows[index].shortSignal ? "S" : rows[index].longSignal ? "L" : undefined;
        if (!side || !rows[index].features) { index += 1; continue; }
        const entryIndex = index + 1;
        const entry = rows[entryIndex].candle;
        const positionSide = side === "L" ? 1 : -1;
        let position: PenguDualLsV2Position = { side: positionSide, entryTs: entry.openTime, entryPrice: entry.open, quantity: 1, gross: targetGrossForAtr(rows[index].features!.atr24Ratio, positionSide), highWaterMark: entry.open, lowWaterMark: entry.open };
        const hold = side === "L" ? PENGU_DUAL_LS_V2.long.maxHoldHours : PENGU_DUAL_LS_V2.short.maxHoldHours;
        const last = Math.min(rows.length - 1, entryIndex + hold - 1);
        let exitIndex = last;
        let exitPrice = rows[last].candle.close;
        let reason: Trade["reason"] = "time";
        for (let cursor = entryIndex; cursor <= last; cursor += 1) {
            const features = rows[cursor].features;
            assert(features, `Production features missing at ${cursor}`);
            const evaluation = evaluatePenguDualLsV2PositionBar(position, features);
            position = evaluation.updatedPosition;
            if (evaluation.exit) {
                exitIndex = cursor;
                exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;
                reason = evaluation.exit.reason.includes("HARD") ? "hard" : evaluation.exit.reason.includes("TRAILING") ? "trail" : "time";
                break;
            }
        }
        const raw = side === "L" ? exitPrice / entry.open - 1 : entry.open / exitPrice - 1;
        if (entry.openTime >= EVAL_START && entry.openTime < EVAL_END) trades.push({ side, entryTime: entry.openTime, exitTime: rows[exitIndex].candle.openTime, entryPrice: entry.open, exitPrice, gross: position.gross, pnl: position.gross * raw - 2 * position.gross * FEE_PER_SIDE, reason });
        cooldown = exitIndex + PENGU_DUAL_LS_V2.cooldownHours;
        index = exitIndex + 1;
    }
    return trades;
}

function assertTradeParity(reference: Trade[], production: Trade[]) {
    assert.equal(production.length, reference.length, "Trade count differs from frozen reference");
    for (let index = 0; index < reference.length; index += 1) {
        const expected = reference[index];
        const actual = production[index];
        assert.equal(actual.side, expected.side, `side mismatch trade ${index + 1}`);
        assert.equal(actual.entryTime, expected.entryTime, `entry time mismatch trade ${index + 1}`);
        assert.equal(actual.exitTime, expected.exitTime, `exit time mismatch trade ${index + 1}`);
        assert.equal(actual.reason, expected.reason, `exit reason mismatch trade ${index + 1}`);
        for (const key of ["entryPrice", "exitPrice", "gross", "pnl"] as const) assert.ok(Math.abs(actual[key] - expected[key]) <= 1e-10, `${key} mismatch trade ${index + 1}`);
    }
}

function assertFrozenConfig() {
    assert.equal(PENGU_DUAL_LS_V2.id, "PENGU_DUAL_LS_V2_FINAL");
    assert.deepEqual(PENGU_DUAL_LS_V2.short, {
        regimeReturn72hMaximum: 0, impulseReturn24hMaximum: -0.07, setupExpiryHours: 24, armBounceMinimum: 0.0125, invalidateBounceAbove: 0.06, penguReturn24hMinimum: -0.12, btcEma168DistanceMinimum: -0.04, rsiMinimum: 30, volumeRatioMinimum: 0.25, volumeRatioMaximum: 3, relativeReturn24hMaximum: -0.02, btcReturn24hMaximum: 0.04, maxHoldHours: 72, hardStopPct: 0.08, trailingActivationPct: 0.15, trailingRetracePct: 0.04,
    });
    assert.deepEqual(PENGU_DUAL_LS_V2.long, {
        regimeReturn72hMinimum: 0.15, breakoutLookbackHours: 18, penguReturn24hMinimum: 0.10, relativeReturn24hMinimum: 0.01, btcReturn24hMinimum: 0, rsiMinimum: 48, rsiMaximum: 78, volumeRatioMinimum: 0.25, volumeRatioMaximum: 3, atr24RatioMaximum: 0.05, maxHoldHours: 120, hardStopPct: 0.08, trailingActivationPct: 0.10, trailingRetracePct: 0.03,
    });
}

async function main() {
    assertFrozenConfig();
    const [pengu, btc] = await Promise.all([download("PENGUUSDT"), download("BTCUSDT")]);
    assert.ok(pengu.length >= 8_700 && btc.length >= 8_700, `Insufficient Bitget evidence: PENGU=${pengu.length}, BTC=${btc.length}`);
    const history: PenguDualLsV2History = { pengu1h: pengu, btc1h: btc, penguFunding: [] };
    const reference = referenceReplay(prepareReference(pengu, btc));
    const production = productionReplay(history);
    assertTradeParity(reference, production);
    const result = metrics(production);
    assert.equal(result.trades, 33);
    assert.ok(Math.abs(result.returnPct - 150.3231) <= 0.15, `Return mismatch ${result.returnPct}`);
    assert.ok(Math.abs(result.profitFactor - 2.9121) <= 0.01, `PF mismatch ${result.profitFactor}`);
    assert.ok(Math.abs(result.maxDrawdownPct - (-12.7034)) <= 0.05, `DD mismatch ${result.maxDrawdownPct}`);
    console.log("PENGU_DUAL_LS_V2_FINAL_PRODUCTION_RESEARCH_PARITY_PASS");
    console.log(JSON.stringify({ source: "Bitget USDT perpetual untouched external validation", rows: { pengu: pengu.length, btc: btc.length }, ...result, ledgerParity: true, ordersSent: false, cancelSent: false, positionChangesSent: false }));
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});
