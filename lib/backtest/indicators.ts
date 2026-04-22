import type { Candle1h, Candle12h, IndicatorBar } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const H12_MS = 12 * HOUR_MS;
const H24_MS = 24 * HOUR_MS;

function average(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function sma(values: number[], period: number) {
    if (period <= 0 || values.length < period) return 0;
    return average(values.slice(-period));
}

function floorTo12h(ts: number) {
    return Math.floor(ts / H12_MS) * H12_MS;
}

function floorToHours(ts: number, hours: number) {
    return Math.floor(ts / (hours * HOUR_MS)) * (hours * HOUR_MS);
}

function floorTo1d(ts: number) {
    return Math.floor(ts / H24_MS) * H24_MS;
}

export function resampleToHours(raw1h: Candle1h[], hours: number) {
    const bucketMs = hours * HOUR_MS;
    const buckets = new Map<number, Candle1h[]>();
    for (const bar of raw1h) {
        const bucketTs = floorToHours(bar.ts, hours);
        const bucket = buckets.get(bucketTs) || [];
        bucket.push(bar);
        buckets.set(bucketTs, bucket);
    }

    return [...buckets.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([bucketTs, bucket]) => {
            const open = bucket[0]?.open || bucket[0]?.close || 0;
            const close = bucket.at(-1)?.close || open;
            const high = Math.max(...bucket.map((bar) => bar.high || bar.close || 0), open, close);
            const low = Math.min(...bucket.map((bar) => bar.low || bar.close || 0), open, close);
            const volume = bucket.reduce((sum, bar) => sum + (bar.volume || 0), 0);
            return {
                ts: bucketTs + bucketMs,
                open,
                high,
                low,
                close,
                volume,
            } satisfies Candle12h;
        });
}

export function resampleTo12h(raw1h: Candle1h[]) {
    const buckets = new Map<number, Candle1h[]>();
    for (const bar of raw1h) {
        const bucketTs = floorTo12h(bar.ts);
        const bucket = buckets.get(bucketTs) || [];
        bucket.push(bar);
        buckets.set(bucketTs, bucket);
    }

    return [...buckets.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([bucketTs, bucket]) => {
            const open = bucket[0]?.open || bucket[0]?.close || 0;
            const close = bucket.at(-1)?.close || open;
            const high = Math.max(...bucket.map((bar) => bar.high || bar.close || 0), open, close);
            const low = Math.min(...bucket.map((bar) => bar.low || bar.close || 0), open, close);
            const volume = bucket.reduce((sum, bar) => sum + (bar.volume || 0), 0);
            return {
                ts: bucketTs + H12_MS,
                open,
                high,
                low,
                close,
                volume,
            } satisfies Candle12h;
        });
}

export function resampleTo1d(raw1h: Candle1h[]) {
    const buckets = new Map<number, Candle1h[]>();
    for (const bar of raw1h) {
        const bucketTs = floorTo1d(bar.ts);
        const bucket = buckets.get(bucketTs) || [];
        bucket.push(bar);
        buckets.set(bucketTs, bucket);
    }

    return [...buckets.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([bucketTs, bucket]) => {
            const open = bucket[0]?.open || bucket[0]?.close || 0;
            const close = bucket.at(-1)?.close || open;
            const high = Math.max(...bucket.map((bar) => bar.high || bar.close || 0), open, close);
            const low = Math.min(...bucket.map((bar) => bar.low || bar.close || 0), open, close);
            const volume = bucket.reduce((sum, bar) => sum + (bar.volume || 0), 0);
            return {
                ts: bucketTs + H24_MS,
                open,
                high,
                low,
                close,
                volume,
            } satisfies Candle12h;
        });
}

function trueRange(high: number, low: number, prevClose: number) {
    return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

function smoothed(values: number[], period: number) {
    if (values.length < period || period <= 0) return [];
    const out: number[] = [];
    const first = values.slice(0, period).reduce((sum, value) => sum + value, 0);
    out.push(first);
    for (let index = period; index < values.length; index += 1) {
        out.push(out[out.length - 1] - (out[out.length - 1] / period) + values[index]);
    }
    return out;
}

function adxForBars(bars: Candle12h[], period: number) {
    if (bars.length <= period + 1) return bars.map(() => 0);

    const plusDm: number[] = [];
    const minusDm: number[] = [];
    const tr: number[] = [];
    for (let index = 1; index < bars.length; index += 1) {
        const current = bars[index];
        const previous = bars[index - 1];
        const upMove = current.high - previous.high;
        const downMove = previous.low - current.low;
        plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
        tr.push(trueRange(current.high, current.low, previous.close));
    }

    const smoothTr = smoothed(tr, period);
    const smoothPlus = smoothed(plusDm, period);
    const smoothMinus = smoothed(minusDm, period);

    const dx: number[] = [];
    for (let index = 0; index < smoothTr.length; index += 1) {
        const trValue = smoothTr[index];
        const plus = smoothPlus[index] || 0;
        const minus = smoothMinus[index] || 0;
        const plusDi = trValue > 0 ? (100 * plus) / trValue : 0;
        const minusDi = trValue > 0 ? (100 * minus) / trValue : 0;
        const denom = plusDi + minusDi;
        dx.push(denom > 0 ? (100 * Math.abs(plusDi - minusDi)) / denom : 0);
    }

    const adx: number[] = [];
    if (dx.length >= period) {
        const first = dx.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
        adx.push(first);
        for (let index = period; index < dx.length; index += 1) {
            adx.push(((adx[adx.length - 1] * (period - 1)) + dx[index]) / period);
        }
    }

    const padded = Array.from({ length: bars.length }, () => 0);
    const startIndex = Math.max(0, bars.length - adx.length);
    adx.forEach((value, offset) => {
        padded[startIndex + offset] = value;
    });
    return padded;
}

export function buildIndicatorBars(bars12h: Candle12h[]) {
    const closes = bars12h.map((bar) => bar.close);
    const volumes = bars12h.map((bar) => bar.volume);
    const adx14 = adxForBars(bars12h, 14);

    return bars12h.map((bar, index) => {
        const mom20 = index >= 20 ? (bar.close / bars12h[index - 20].close) - 1 : 0;
        const mom20Prev = index >= 21 ? (bars12h[index - 1].close / bars12h[index - 21].close) - 1 : 0;
        const volAvg20 = index >= 19 ? average(volumes.slice(index - 19, index + 1)) : 0;
        const sma40 = sma(closes.slice(0, index + 1), 40);
        const sma45 = sma(closes.slice(0, index + 1), 45);
        const sma85 = sma(closes.slice(0, index + 1), 85);
        const sma90 = sma(closes.slice(0, index + 1), 90);
        return {
            ...bar,
            sma40,
            sma45,
            sma85,
            sma90,
            mom20,
            mom20Prev,
            momAccel: mom20 - mom20Prev,
            volAvg20,
            overheatPct: sma45 > 0 ? (bar.close / sma45) - 1 : 0,
            adx14: adx14[index] || 0,
            ready: index >= 90,
        } satisfies IndicatorBar;
    });
}

export function latestIndicatorAtOrBefore(series: IndicatorBar[], ts: number) {
    let lo = 0;
    let hi = series.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (series[mid].ts <= ts) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return best >= 0 ? series[best] : null;
}
