import { DISDEX_PENGU_DUAL_ENGINE_V46 } from "@/config/disdexV46Runtime";
import type { DisDexV35Candle, DisDexV35MarketHistory } from "@/lib/disdex-v35-signal-engine";

export interface DisDexPenguFundingPoint {
    fundingTime: number;
    fundingRate: number;
}

export interface DisDexPenguV46History extends DisDexV35MarketHistory {
    penguFunding: DisDexPenguFundingPoint[];
}

export interface DisDexPenguV46DecisionFeatures {
    volumeRatio: number;
    fundingRate: number | null;
    btcCloseAboveSma168: boolean;
    btcMomentum72hPct: number;
    penguCloseAboveSma72: boolean;
    penguCloseAboveSma168: boolean;
    penguSma168Rising48h: boolean;
    penguMomentum6hPct: number;
    penguMomentum6hLag12Pct: number;
    penguMomentum24hPct: number;
    penguMomentum120hPct: number;
    relativeMomentum48hPct: number;
    relativeMomentum120hPct: number;
    rsi14: number;
    priorLow24h: number;
    close: number;
}

export interface DisDexPenguV46Decision {
    side: -1 | 0 | 1;
    reason: string;
    longEligible: boolean;
    shortEligible: boolean;
}

export interface DisDexPenguV46Signal {
    strategyId: typeof DISDEX_PENGU_DUAL_ENGINE_V46.id;
    side: -1 | 0 | 1;
    targetGross: number;
    decisionTs?: number;
    entryTs?: number;
    exitTs?: number;
    reason: string;
    features?: DisDexPenguV46DecisionFeatures;
    diagnostics: {
        evaluatedDecisionBars: number;
        fundingCoverage: boolean;
        latestCompletedPenguTs?: number;
        latestCompletedBtcTs?: number;
    };
}

const HOUR = 3_600_000;

function mean(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function cleanRows(rows: DisDexV35Candle[], now: number) {
    return [...rows]
        .filter((row) => row.openTime > 0
            && row.closeTime > row.openTime
            && row.closeTime < now
            && row.close > 0
            && row.volume >= 0)
        .sort((left, right) => left.openTime - right.openTime)
        .filter((row, index, source) => index === 0 || row.openTime !== source[index - 1].openTime);
}

function sma(rows: DisDexV35Candle[], end: number, length: number): number | undefined {
    if (length <= 0 || end - length + 1 < 0) return undefined;
    return mean(rows.slice(end - length + 1, end + 1).map((row) => row.close));
}

function momentum(rows: DisDexV35Candle[], end: number, length: number): number | undefined {
    const prior = end - length;
    if (prior < 0 || rows[prior].close <= 0) return undefined;
    return (rows[end].close / rows[prior].close - 1) * 100;
}

function volumeRatio(rows: DisDexV35Candle[], end: number, recent: number, base: number): number | undefined {
    if (end - base + 1 < 0 || recent >= base) return undefined;
    const recentAverage = mean(rows.slice(end - recent + 1, end + 1).map((row) => row.volume));
    const baseAverage = mean(rows.slice(end - base + 1, end - recent + 1).map((row) => row.volume));
    return baseAverage > 0 ? recentAverage / baseAverage : undefined;
}

function rsi(rows: DisDexV35Candle[], end: number, length: number): number | undefined {
    if (end - length < 0) return undefined;
    let gains = 0;
    let losses = 0;
    for (let index = end - length + 1; index <= end; index += 1) {
        const change = rows[index].close - rows[index - 1].close;
        gains += Math.max(0, change);
        losses += Math.max(0, -change);
    }
    if (losses <= 0) return gains > 0 ? 100 : 50;
    const relativeStrength = gains / losses;
    return 100 - 100 / (1 + relativeStrength);
}

function latestFunding(points: DisDexPenguFundingPoint[], ts: number): number | null {
    let latest: DisDexPenguFundingPoint | undefined;
    for (const point of points) {
        if (point.fundingTime > ts) break;
        latest = point;
    }
    return latest && Number.isFinite(latest.fundingRate) ? latest.fundingRate : null;
}

function btcRiskAllowsLong(features: DisDexPenguV46DecisionFeatures) {
    const config = DISDEX_PENGU_DUAL_ENGINE_V46.btcRisk;
    return !(features.btcCloseAboveSma168 === false && features.btcMomentum72hPct < config.blockLongBelowMomentumPct);
}

function btcRiskAllowsShort(features: DisDexPenguV46DecisionFeatures) {
    const config = DISDEX_PENGU_DUAL_ENGINE_V46.btcRisk;
    return !(features.btcCloseAboveSma168 && features.btcMomentum72hPct > config.blockShortAboveMomentumPct);
}

export function evaluateDisDexPenguV46Decision(features: DisDexPenguV46DecisionFeatures): DisDexPenguV46Decision {
    const config = DISDEX_PENGU_DUAL_ENGINE_V46;
    const fundingAllowed = features.fundingRate !== null && features.fundingRate <= config.fundingCap;
    const commonLong = features.volumeRatio >= config.volumeFloor
        && fundingAllowed
        && btcRiskAllowsLong(features);
    const longEligible = commonLong
        && features.penguCloseAboveSma72
        && features.penguCloseAboveSma168
        && features.penguSma168Rising48h
        && features.penguMomentum6hPct > config.long.momentum6hThresholdPct
        && features.penguMomentum6hLag12Pct <= 0
        && features.penguMomentum24hPct > config.long.momentum24hThresholdPct
        && features.penguMomentum120hPct > config.long.momentum120hThresholdPct
        && features.relativeMomentum48hPct > config.long.relative48hThresholdPct
        && features.relativeMomentum120hPct > config.long.relative120hThresholdPct
        && features.rsi14 >= config.long.rsiMinimum
        && features.rsi14 <= config.long.rsiMaximum;

    const shortEligible = features.volumeRatio >= config.volumeFloor
        && btcRiskAllowsShort(features)
        && features.close < features.priorLow24h
        && features.penguMomentum6hPct < config.short.confirmationThresholdPct;

    if (shortEligible) {
        return { side: -1, reason: "PENGU V46 confirmed 24-hour breakdown Short.", longEligible, shortEligible };
    }
    if (longEligible) {
        return { side: 1, reason: "PENGU V46 regime-confirmed Trend Resume Long.", longEligible, shortEligible };
    }
    return {
        side: 0,
        reason: features.fundingRate === null
            ? "PENGU V46 Long is fail-closed because funding coverage is unavailable; no Short trigger is active."
            : "PENGU V46 has no active Long or Short trigger.",
        longEligible,
        shortEligible,
    };
}

function buildFeatures(input: {
    pengu: DisDexV35Candle[];
    penguIndex: number;
    btc: DisDexV35Candle[];
    btcIndex: number;
    funding: DisDexPenguFundingPoint[];
}): DisDexPenguV46DecisionFeatures | undefined {
    const config = DISDEX_PENGU_DUAL_ENGINE_V46;
    const { pengu, penguIndex, btc, btcIndex, funding } = input;
    const penguSma72 = sma(pengu, penguIndex, config.long.entryTrendSmaHours);
    const penguSma168 = sma(pengu, penguIndex, config.long.regimeSmaHours);
    const slopeIndex = penguIndex - config.long.regimeSlopeHours;
    const penguSma168Then = slopeIndex >= 0 ? sma(pengu, slopeIndex, config.long.regimeSmaHours) : undefined;
    const btcSma168 = sma(btc, btcIndex, config.btcRisk.smaHours);
    const mom6 = momentum(pengu, penguIndex, 6);
    const mom6LagIndex = penguIndex - config.long.crossoverLagHours;
    const mom6Lag = mom6LagIndex >= 6 ? momentum(pengu, mom6LagIndex, 6) : undefined;
    const mom24 = momentum(pengu, penguIndex, 24);
    const mom48 = momentum(pengu, penguIndex, 48);
    const mom120 = momentum(pengu, penguIndex, 120);
    const btcMom48 = momentum(btc, btcIndex, 48);
    const btcMom72 = momentum(btc, btcIndex, config.btcRisk.momentumHours);
    const btcMom120 = momentum(btc, btcIndex, 120);
    const volume = volumeRatio(pengu, penguIndex, config.volumeRecentHours, config.volumeBaseHours);
    const rsi14 = rsi(pengu, penguIndex, config.long.rsiLengthHours);
    if (
        penguSma72 === undefined || penguSma168 === undefined || penguSma168Then === undefined
        || btcSma168 === undefined || mom6 === undefined || mom6Lag === undefined || mom24 === undefined
        || mom48 === undefined || mom120 === undefined || btcMom48 === undefined || btcMom72 === undefined
        || btcMom120 === undefined || volume === undefined || rsi14 === undefined || penguIndex < 24
    ) return undefined;
    const priorLow24h = Math.min(...pengu.slice(penguIndex - 24, penguIndex).map((row) => row.low));
    return {
        volumeRatio: volume,
        fundingRate: latestFunding(funding, pengu[penguIndex].closeTime),
        btcCloseAboveSma168: btc[btcIndex].close > btcSma168,
        btcMomentum72hPct: btcMom72,
        penguCloseAboveSma72: pengu[penguIndex].close > penguSma72,
        penguCloseAboveSma168: pengu[penguIndex].close > penguSma168,
        penguSma168Rising48h: penguSma168 > penguSma168Then,
        penguMomentum6hPct: mom6,
        penguMomentum6hLag12Pct: mom6Lag,
        penguMomentum24hPct: mom24,
        penguMomentum120hPct: mom120,
        relativeMomentum48hPct: mom48 - btcMom48,
        relativeMomentum120hPct: mom120 - btcMom120,
        rsi14,
        priorLow24h,
        close: pengu[penguIndex].close,
    };
}

export function buildDisDexPenguV46Signal(
    history: DisDexPenguV46History,
    now = Date.now(),
): DisDexPenguV46Signal {
    const config = DISDEX_PENGU_DUAL_ENGINE_V46;
    // The provider already supplies completed candles, but the signal layer repeats
    // the guard so alternate callers cannot accidentally introduce an open candle.
    const pengu = cleanRows(history.pengu1h, now);
    const btc = cleanRows(history.btc1h, now);
    const funding = [...history.penguFunding]
        .filter((point) => point.fundingTime > 0 && Number.isFinite(point.fundingRate))
        .sort((left, right) => left.fundingTime - right.fundingTime);
    const penguIndexes = new Map(pengu.map((row, index) => [row.openTime, index]));
    const btcIndexes = new Map(btc.map((row, index) => [row.openTime, index]));
    const common = [...penguIndexes.keys()].filter((ts) => btcIndexes.has(ts)).sort((a, b) => a - b);
    const latestPengu = pengu.at(-1);
    const latestBtc = btc.at(-1);
    const latestFundingCoverage = latestPengu
        ? latestFunding(funding, latestPengu.closeTime) !== null
        : false;
    let active: DisDexPenguV46Signal | undefined;
    let evaluatedDecisionBars = 0;
    let nextFreeTs = 0;

    for (const ts of common) {
        if (ts < nextFreeTs || Math.floor(ts / HOUR) % config.decisionHours !== 0) continue;
        const penguIndex = penguIndexes.get(ts);
        const btcIndex = btcIndexes.get(ts);
        if (penguIndex === undefined || btcIndex === undefined) continue;
        const features = buildFeatures({ pengu, penguIndex, btc, btcIndex, funding });
        if (!features) continue;
        evaluatedDecisionBars += 1;
        const decision = evaluateDisDexPenguV46Decision(features);
        if (decision.side === 0) continue;
        // The signal becomes actionable immediately after the completed decision
        // candle closes, matching the backtest's next-open execution convention.
        const entryTs = pengu[penguIndex].openTime + HOUR;
        const exitTs = entryTs + config.holdHours * HOUR;
        nextFreeTs = exitTs;
        if (entryTs <= now && now < exitTs) {
            active = {
                strategyId: config.id,
                side: decision.side,
                targetGross: decision.side > 0 ? config.longGross : config.shortGross,
                decisionTs: ts,
                entryTs,
                exitTs,
                reason: decision.reason,
                features,
                diagnostics: {
                    evaluatedDecisionBars,
                    fundingCoverage: features.fundingRate !== null,
                    latestCompletedPenguTs: latestPengu?.openTime,
                    latestCompletedBtcTs: latestBtc?.openTime,
                },
            };
        }
    }

    return active ?? {
        strategyId: config.id,
        side: 0,
        targetGross: 0,
        reason: "PENGU V46 has no active 24-hour position window.",
        diagnostics: {
            evaluatedDecisionBars,
            fundingCoverage: latestFundingCoverage,
            latestCompletedPenguTs: latestPengu?.openTime,
            latestCompletedBtcTs: latestBtc?.openTime,
        },
    };
}
