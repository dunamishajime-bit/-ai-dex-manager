import {
    QUALITY102_CAUSAL_V4_S34_MODEL,
    type Quality102CausalV4Family,
    type Quality102CausalV4Layer,
    type Quality102CausalV4ModelRow,
} from "../config/disdexQuality102CausalV4Model";
import type { Quality102Candle, Quality102Side } from "./disdex-quality102-causal-pipeline";
import {
    evaluateQuality102CausalV4FeatureGate,
    evaluateS34QualityGate,
} from "./disdex-quality102-causal-selector";

const HOUR_MS = 3_600_000;
const RET14_HOURS = 336;

export interface Quality102CausalV4EntryOpen {
    timestampMs: number;
    open: number;
}

export interface Quality102CausalV4S34RawSignal {
    side: Quality102Side;
    strength: number;
    margin: number;
    holdHours: number;
    hardStop: number;
    ret14: number;
}

export interface Quality102CausalV4S34Candidate extends Quality102CausalV4S34RawSignal {
    id: string;
    key: string;
    symbol: string;
    variant: string;
    family: Quality102CausalV4Family;
    layer: Quality102CausalV4Layer;
    entryTs: number;
    dataCutoffTs: number;
    maxHoldHours: number;
    exitPolicy: "FIXED_HOLD_STOP";
}

function finitePositive(value: number, field: string): number {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`QUALITY102_CAUSAL_V4_INVALID_${field}`);
    return value;
}

function sampleStdev(values: readonly number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function familyHardStop(family: Quality102CausalV4Family, holdHours: number): number {
    if (family === "PB" || family === "MR") return holdHours === 12 ? 0.05 : 0.07;
    if (family === "REV") return holdHours === 8 || holdHours === 12 ? 0.045 : 0.06;
    return holdHours >= 48 ? 0.08 : 0.05;
}

function computeRet14(rows: readonly Quality102Candle[], entryOpen: Quality102CausalV4EntryOpen): number {
    if (rows.length < RET14_HOURS) throw new Error("QUALITY102_CAUSAL_V4_RET14_HISTORY_REQUIRED");
    const prior = rows[rows.length - RET14_HOURS];
    return finitePositive(entryOpen.open, "ENTRY_OPEN") / finitePositive(prior.open, "RET14_PRIOR_OPEN") - 1;
}

function parsePb(variant: string): [number, number, number, number, number] | undefined {
    const match = /^PB(72|168)_([0-9.]+)_P(12|24)_([0-9.]+)_H(12|24)$/.exec(variant);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])] : undefined;
}

function parseMr(variant: string): [number, number, number] | undefined {
    const match = /^MR(24|48|72)_Z([0-9.]+)_H(12|24)$/.exec(variant);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function parseRev(variant: string): [number, number, number] | undefined {
    const match = /^REV(6|12|24)_T([0-9.]+)_H(8|12|24)$/.exec(variant);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function parseBrk(variant: string): [number, number, number] | undefined {
    const match = /^BRK(24|48|72|168)_H(12|24|48)_V([0-9.]+)$/.exec(variant);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function detectPb(rows: readonly Quality102Candle[], variant: string): Omit<Quality102CausalV4S34RawSignal, "ret14" | "hardStop"> | undefined {
    const parsed = parsePb(variant);
    if (!parsed) return undefined;
    const [lookback, trendThreshold, pullback, pullThreshold, holdHours] = parsed;
    const t = rows.length - 1;
    if (t < Math.max(lookback, pullback)) return undefined;
    const longRet = rows[t].close / rows[t - lookback].close - 1;
    const pullRet = rows[t].close / rows[t - pullback].close - 1;
    const side: Quality102Side | undefined = longRet >= trendThreshold && pullRet <= -pullThreshold
        ? 1
        : longRet <= -trendThreshold && pullRet >= pullThreshold
            ? -1
            : undefined;
    if (side === undefined) return undefined;
    return { side, strength: Math.abs(longRet) + Math.abs(pullRet), margin: Math.min(Math.abs(longRet) / trendThreshold, Math.abs(pullRet) / pullThreshold), holdHours };
}

function detectMr(rows: readonly Quality102Candle[], variant: string): Omit<Quality102CausalV4S34RawSignal, "ret14" | "hardStop"> | undefined {
    const parsed = parseMr(variant);
    if (!parsed) return undefined;
    const [lookback, zThreshold, holdHours] = parsed;
    const t = rows.length - 1;
    if (t - lookback + 1 < 0) return undefined;
    const closes = rows.slice(t - lookback + 1, t + 1).map((row) => row.close);
    const stdev = sampleStdev(closes);
    if (!(stdev > 0)) return undefined;
    const mean = closes.reduce((sum, value) => sum + value, 0) / closes.length;
    const z = (rows[t].close - mean) / stdev;
    const side: Quality102Side | undefined = z >= zThreshold ? -1 : z <= -zThreshold ? 1 : undefined;
    return side === undefined ? undefined : { side, strength: Math.abs(z), margin: Math.abs(z) / zThreshold, holdHours };
}

function detectRev(rows: readonly Quality102Candle[], variant: string): Omit<Quality102CausalV4S34RawSignal, "ret14" | "hardStop"> | undefined {
    const parsed = parseRev(variant);
    if (!parsed) return undefined;
    const [lookback, threshold, holdHours] = parsed;
    const t = rows.length - 1;
    if (t < lookback) return undefined;
    const move = rows[t].close / rows[t - lookback].close - 1;
    const side: Quality102Side | undefined = move >= threshold ? -1 : move <= -threshold ? 1 : undefined;
    return side === undefined ? undefined : { side, strength: Math.abs(move), margin: Math.abs(move) / threshold, holdHours };
}

function baseVolume(row: Quality102Candle): number {
    const value = row.baseVolume;
    if (!Number.isFinite(value) || (value as number) < 0) throw new Error("QUALITY102_CAUSAL_V4_BRK_BASE_VOLUME_REQUIRED");
    return value as number;
}

function detectBrk(rows: readonly Quality102Candle[], variant: string): Omit<Quality102CausalV4S34RawSignal, "ret14" | "hardStop"> | undefined {
    const parsed = parseBrk(variant);
    if (!parsed) return undefined;
    const [lookback, holdHours, volumeThreshold] = parsed;
    const t = rows.length - 1;
    if (t < Math.max(lookback, 72)) return undefined;
    const close = rows[t].close;
    const prior = rows.slice(t - lookback, t);
    const priorHigh = Math.max(...prior.map((row) => row.high));
    const priorLow = Math.min(...prior.map((row) => row.low));
    const side: Quality102Side | undefined = close > priorHigh ? 1 : close < priorLow ? -1 : undefined;
    if (side === undefined) return undefined;
    const medianVolume = median(rows.slice(t - 72, t).map(baseVolume));
    const volumeRatio = medianVolume > 0 ? baseVolume(rows[t]) / medianVolume : 0;
    if (volumeRatio + 1e-12 < volumeThreshold) return undefined;
    const breakout = side === 1 ? close / priorHigh - 1 : priorLow / close - 1;
    const strength = Math.abs(close / rows[t - lookback].close - 1);
    const margin = Math.min(volumeRatio / volumeThreshold, 1 + Math.max(0, breakout) * 100);
    return { side, strength, margin, holdHours };
}

function detectFamily(rows: readonly Quality102Candle[], variant: string): Omit<Quality102CausalV4S34RawSignal, "ret14" | "hardStop"> | undefined {
    if (variant.startsWith("PB")) return detectPb(rows, variant);
    if (variant.startsWith("MR")) return detectMr(rows, variant);
    if (variant.startsWith("REV")) return detectRev(rows, variant);
    if (variant.startsWith("BRK")) return detectBrk(rows, variant);
    return undefined;
}

export function detectQuality102CausalV4S34RawSignal(
    rows: readonly Quality102Candle[],
    entryOpen: Quality102CausalV4EntryOpen,
    variant: string,
): Quality102CausalV4S34RawSignal | undefined {
    if (!rows.length) throw new Error("QUALITY102_CAUSAL_V4_S34_HISTORY_REQUIRED");
    const expectedEntryTs = rows.at(-1)!.timestampMs + HOUR_MS;
    if (entryOpen.timestampMs !== expectedEntryTs) throw new Error("QUALITY102_CAUSAL_V4_ENTRY_OPEN_TIMESTAMP_MISMATCH");
    const signal = detectFamily(rows, variant);
    if (!signal) return undefined;
    const family: Quality102CausalV4Family = variant.startsWith("PB") ? "PB" : variant.startsWith("MR") ? "MR" : variant.startsWith("BRK") ? "BRK" : "REV";
    return {
        ...signal,
        hardStop: familyHardStop(family, signal.holdHours),
        ret14: computeRet14(rows, entryOpen),
    };
}

function modelRowsFor(symbol: string): readonly Quality102CausalV4ModelRow[] {
    const normalized = symbol.trim().toUpperCase();
    return QUALITY102_CAUSAL_V4_S34_MODEL.filter((row) => row.symbol === normalized);
}

export function generateQuality102CausalV4S34Candidates(input: {
    symbol: string;
    rows: readonly Quality102Candle[];
    entryOpen: Quality102CausalV4EntryOpen;
}): Quality102CausalV4S34Candidate[] {
    if (!input.rows.length) throw new Error("QUALITY102_CAUSAL_V4_S34_HISTORY_REQUIRED");
    const expectedEntryTs = input.rows.at(-1)!.timestampMs + HOUR_MS;
    if (input.entryOpen.timestampMs !== expectedEntryTs) throw new Error("QUALITY102_CAUSAL_V4_ENTRY_OPEN_TIMESTAMP_MISMATCH");
    if (new Date(input.entryOpen.timestampMs).getUTCHours() % 4 !== 1) return [];
    const out: Quality102CausalV4S34Candidate[] = [];
    for (const model of modelRowsFor(input.symbol)) {
        const raw = detectQuality102CausalV4S34RawSignal(input.rows, input.entryOpen, model.variant);
        if (!raw) continue;
        const historicalGate = evaluateS34QualityGate({
            family: model.family,
            variant: model.variant,
            side: raw.side,
            strength: raw.strength,
            ret14: raw.ret14,
        });
        if (!historicalGate.accepted) continue;
        const featureGate = evaluateQuality102CausalV4FeatureGate({
            family: model.family,
            symbol: model.symbol.replace(/USDT$/, ""),
            variant: model.variant,
            side: raw.side,
            ret14: raw.ret14,
            margin: raw.margin,
            developmentN: model.developmentN,
            developmentSpf: model.developmentSpf,
            developmentAvg: model.developmentAvg,
        });
        if (!featureGate.accepted) continue;
        out.push({
            ...raw,
            id: `S34:${model.key}:${input.entryOpen.timestampMs}:${raw.side}`,
            key: model.key,
            symbol: model.symbol,
            variant: model.variant,
            family: model.family,
            layer: model.layer,
            entryTs: input.entryOpen.timestampMs,
            dataCutoffTs: input.rows.at(-1)!.timestampMs,
            maxHoldHours: raw.holdHours,
            exitPolicy: "FIXED_HOLD_STOP",
        });
    }
    return out;
}
