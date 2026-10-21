import { PENGU_DUAL_LS_V2 } from "@/config/penguDualLsV2Runtime";
import type { DisDexV35Candle } from "@/lib/disdex-v35-signal-engine";

const HOUR = 3_600_000;

export interface PenguDualLsV2FundingPoint {
    fundingTime: number;
    fundingRate: number;
}

export interface PenguDualLsV2History {
    pengu1h: DisDexV35Candle[];
    btc1h: DisDexV35Candle[];
    penguFunding: PenguDualLsV2FundingPoint[];
}

export interface PenguDualLsV2Position {
    side: -1 | 1;
    entryTs: number;
    entryPrice: number;
    quantity: number;
    gross: number;
    highWaterMark: number;
    lowWaterMark?: number;
}

export interface PenguDualLsV2Features {
    referenceTs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    previousLow: number;
    priorHigh18h: number;
    penguReturn24h: number;
    penguReturn72h: number;
    btcReturn24h: number;
    relativeReturn24h: number;
    ema72: number;
    ema168: number;
    btcEma168Distance: number;
    volumeRatio6OverPrior36: number;
    atr24Ratio: number;
    rsi14: number;
}

export interface PenguDualLsV2Decision {
    side: -1 | 0 | 1;
    longEligible: boolean;
    shortEligible: boolean;
    active: boolean;
    reason: string;
}

export interface PenguDualLsV2ExitDecision {
    side: -1 | 1;
    reason: "LONG_HARD_STOP" | "LONG_TRAILING_STOP" | "LONG_MAX_HOLD" | "SHORT_HARD_STOP" | "SHORT_TRAILING_STOP" | "SHORT_MAX_HOLD" | "SHARED_RISK_FLATTEN";
    stopPrice?: number;
    updatedPosition: PenguDualLsV2Position;
}

export interface PenguDualLsV2Signal {
    strategyId: typeof PENGU_DUAL_LS_V2.id;
    referenceTs: number;
    side: -1 | 0 | 1;
    targetGross: number;
    entryTs?: number;
    reason: string;
    features?: PenguDualLsV2Features;
    decision?: PenguDualLsV2Decision;
    exit?: PenguDualLsV2ExitDecision;
    updatedPosition?: PenguDualLsV2Position;
    diagnostics: {
        evaluatedDecisionBars: number;
        latestCompletedPenguTs?: number;
        latestCompletedBtcTs?: number;
        edgeTriggered: boolean;
        longEligible: boolean;
        shortEligible: boolean;
        shortSetupActive: boolean;
        shortSetupArmed: boolean;
        cooldownBlocked: boolean;
    };
}

export interface PenguDualLsV2EvaluationRow {
    index: number;
    candle: DisDexV35Candle;
    btcCandle: DisDexV35Candle;
    features?: PenguDualLsV2Features;
    longRaw: boolean;
    longSignal: boolean;
    shortSignal: boolean;
    shortSetupActive: boolean;
    shortSetupArmed: boolean;
}

interface ShortSignalState {
    signals: boolean[];
    setupActive: boolean[];
    setupArmed: boolean[];
}

function cleanRows(rows: DisDexV35Candle[], now: number, label: string) {
    const sorted = rows
        .filter((row) => row.openTime > 0 && row.closeTime < now)
        .filter((row) => [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite))
        .filter((row) => row.open > 0 && row.high >= row.low && row.low > 0 && row.close > 0 && row.volume >= 0)
        .sort((left, right) => left.openTime - right.openTime);
    const deduplicated = sorted.filter((row, index) => index === 0 || row.openTime !== sorted[index - 1].openTime);
    if (deduplicated.length !== sorted.length) throw new Error(`${label} contains duplicate H1 timestamps.`);
    for (let index = 1; index < deduplicated.length; index += 1) {
        if (deduplicated[index].openTime - deduplicated[index - 1].openTime !== HOUR) {
            throw new Error(`${label} contains a missing or non-hourly candle at ${deduplicated[index].openTime}.`);
        }
    }
    return deduplicated;
}

function ema(values: number[], span: number) {
    const output = new Array<number>(values.length).fill(Number.NaN);
    if (!values.length) return output;
    const alpha = 2 / (span + 1);
    let current = values[0];
    for (let index = 0; index < values.length; index += 1) {
        current = index === 0 ? values[index] : alpha * values[index] + (1 - alpha) * current;
        if (index + 1 >= span) output[index] = current;
    }
    return output;
}

function rsiWilder(values: number[], length = 14) {
    const output = new Array<number>(values.length).fill(Number.NaN);
    const alpha = 1 / length;
    let averageGain = Number.NaN;
    let averageLoss = Number.NaN;
    for (let index = 1; index < values.length; index += 1) {
        const delta = values[index] - values[index - 1];
        const gain = Math.max(delta, 0);
        const loss = Math.max(-delta, 0);
        averageGain = Number.isFinite(averageGain) ? alpha * gain + (1 - alpha) * averageGain : gain;
        averageLoss = Number.isFinite(averageLoss) ? alpha * loss + (1 - alpha) * averageLoss : loss;
        if (index >= length) output[index] = averageLoss <= 1e-15 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
    }
    return output;
}

function rollingMean(values: number[], endInclusive: number, length: number) {
    const start = endInclusive - length + 1;
    if (start < 0) return Number.NaN;
    const window = values.slice(start, endInclusive + 1);
    return window.every(Number.isFinite) ? window.reduce((sum, value) => sum + value, 0) / length : Number.NaN;
}

function longRaw(features: PenguDualLsV2Features) {
    const rule = PENGU_DUAL_LS_V2.long;
    return features.penguReturn72h >= rule.regimeReturn72hMinimum
        && features.close > features.priorHigh18h
        && features.penguReturn24h >= rule.penguReturn24hMinimum
        && features.relativeReturn24h >= rule.relativeReturn24hMinimum
        && features.btcReturn24h >= rule.btcReturn24hMinimum
        && features.rsi14 >= rule.rsiMinimum
        && features.rsi14 <= rule.rsiMaximum
        && features.volumeRatio6OverPrior36 >= rule.volumeRatioMinimum
        && features.volumeRatio6OverPrior36 <= rule.volumeRatioMaximum
        && features.atr24Ratio <= rule.atr24RatioMaximum
        && features.close > features.ema168;
}

function featureRows(pengu: DisDexV35Candle[], btc: DisDexV35Candle[]) {
    const btcByTs = new Map(btc.map((row) => [row.openTime, row]));
    const aligned = pengu
        .map((candle) => ({ candle, btcCandle: btcByTs.get(candle.openTime) }))
        .filter((row): row is { candle: DisDexV35Candle; btcCandle: DisDexV35Candle } => Boolean(row.btcCandle));
    if (aligned.length !== pengu.length || aligned.length !== btc.length) {
        throw new Error(`PENGU/BTC H1 timestamps are not fully aligned: PENGU=${pengu.length}, BTC=${btc.length}, aligned=${aligned.length}.`);
    }
    const closes = aligned.map((row) => row.candle.close);
    const btcCloses = aligned.map((row) => row.btcCandle.close);
    const volumes = aligned.map((row) => row.candle.volume);
    const ema72 = ema(closes, 72);
    const ema168 = ema(closes, 168);
    const btcEma168 = ema(btcCloses, 168);
    const rsi14 = rsiWilder(closes, 14);
    const trueRanges = aligned.map((row, index) => {
        const previousClose = index > 0 ? closes[index - 1] : row.candle.close;
        return Math.max(
            row.candle.high - row.candle.low,
            Math.abs(row.candle.high - previousClose),
            Math.abs(row.candle.low - previousClose),
        );
    });
    return aligned.map((row, index): Omit<PenguDualLsV2EvaluationRow, "longRaw" | "longSignal" | "shortSignal" | "shortSetupActive" | "shortSetupArmed"> => {
        if (index < 168) return { index, ...row };
        const recentVolume = rollingMean(volumes, index, 6);
        const priorVolume = rollingMean(volumes, index - 6, 36);
        const atr24 = rollingMean(trueRanges, index, 24);
        const prior18 = aligned.slice(index - 18, index);
        const values = [closes[index - 24], closes[index - 72], btcCloses[index - 24], recentVolume, priorVolume, atr24, ema72[index], ema168[index], btcEma168[index], rsi14[index]];
        if (!values.every(Number.isFinite) || priorVolume <= 0 || prior18.length !== 18) return { index, ...row };
        const features: PenguDualLsV2Features = {
            referenceTs: row.candle.openTime,
            open: row.candle.open,
            high: row.candle.high,
            low: row.candle.low,
            close: row.candle.close,
            previousLow: aligned[index - 1].candle.low,
            priorHigh18h: Math.max(...prior18.map((item) => item.candle.high)),
            penguReturn24h: row.candle.close / closes[index - 24] - 1,
            penguReturn72h: row.candle.close / closes[index - 72] - 1,
            btcReturn24h: row.btcCandle.close / btcCloses[index - 24] - 1,
            relativeReturn24h: row.candle.close / closes[index - 24] - row.btcCandle.close / btcCloses[index - 24],
            ema72: ema72[index],
            ema168: ema168[index],
            btcEma168Distance: row.btcCandle.close / btcEma168[index] - 1,
            volumeRatio6OverPrior36: recentVolume / priorVolume,
            atr24Ratio: atr24 / row.candle.close,
            rsi14: rsi14[index],
        };
        return { index, ...row, features };
    });
}

export function evaluatePenguDualLsV2ShortSignals(featuresRows: Array<PenguDualLsV2Features | undefined>, startIndex = 0): ShortSignalState {
    const rule = PENGU_DUAL_LS_V2.short;
    const signals = new Array<boolean>(featuresRows.length).fill(false);
    const setupActive = new Array<boolean>(featuresRows.length).fill(false);
    const setupArmed = new Array<boolean>(featuresRows.length).fill(false);
    let active = false;
    let armed = false;
    let localLow = 0;
    let expiry = -1;
    for (let index = startIndex; index < featuresRows.length; index += 1) {
        const features = featuresRows[index];
        if (!features) continue;
        if (active && index > expiry) {
            active = false;
            armed = false;
            localLow = 0;
        }
        if (features.penguReturn24h <= rule.impulseReturn24hMaximum) {
            if (!active) {
                active = true;
                armed = false;
                localLow = features.low;
                expiry = index + rule.setupExpiryHours;
            } else {
                localLow = Math.min(localLow, features.low);
                expiry = Math.max(expiry, index + 1);
            }
        }
        if (active) {
            localLow = Math.min(localLow, features.low);
            const bounce = features.close / localLow - 1;
            if (bounce > rule.invalidateBounceAbove) {
                active = false;
                armed = false;
                localLow = 0;
                continue;
            }
            if (bounce + 1e-12 >= rule.armBounceMinimum) armed = true;
            if (armed) {
                const eligible = features.penguReturn72h <= rule.regimeReturn72hMaximum
                    && features.close < features.previousLow
                    && features.close < features.ema72
                    && features.ema72 < features.ema168
                    && features.relativeReturn24h <= rule.relativeReturn24hMaximum
                    && features.volumeRatio6OverPrior36 >= rule.volumeRatioMinimum
                    && features.volumeRatio6OverPrior36 <= rule.volumeRatioMaximum
                    && features.btcReturn24h <= rule.btcReturn24hMaximum
                    && features.penguReturn24h >= rule.penguReturn24hMinimum
                    && features.btcEma168Distance >= rule.btcEma168DistanceMinimum
                    && features.rsi14 >= rule.rsiMinimum;
                if (eligible) {
                    signals[index] = true;
                    active = false;
                    armed = false;
                    localLow = 0;
                }
            }
        }
        setupActive[index] = active;
        setupArmed[index] = armed;
    }
    return { signals, setupActive, setupArmed };
}

export function buildPenguDualLsV2EvaluationSeries(history: PenguDualLsV2History, now = Date.now()) {
    const pengu = cleanRows(history.pengu1h, now, "PENGUUSDT");
    const btc = cleanRows(history.btc1h, now, "BTCUSDT");
    const rows = featureRows(pengu, btc);
    const short = evaluatePenguDualLsV2ShortSignals(rows.map((row) => row.features), 180);
    return rows.map((row, index): PenguDualLsV2EvaluationRow => {
        const isLongRaw = row.features ? longRaw(row.features) : false;
        const previousLongRaw = index > 0 && rows[index - 1].features ? longRaw(rows[index - 1].features!) : false;
        return {
            ...row,
            longRaw: isLongRaw,
            longSignal: isLongRaw && !previousLongRaw,
            shortSignal: short.signals[index],
            shortSetupActive: short.setupActive[index],
            shortSetupArmed: short.setupArmed[index],
        };
    });
}

export function targetGrossForAtr(atr24Ratio: number, side: -1 | 1 = -1) {
    const sizing = PENGU_DUAL_LS_V2.sizing;
    if (!Number.isFinite(atr24Ratio) || atr24Ratio <= 0) return 0;
    const multiplier = side > 0 ? sizing.longMultiplier : sizing.shortMultiplier;
    return Math.min(
        sizing.grossCap * multiplier,
        Math.max(sizing.grossFloor * multiplier, sizing.grossMultiplier * sizing.targetVolatility / atr24Ratio * multiplier),
    );
}

export function evaluatePenguDualLsV2Decision(features: PenguDualLsV2Features, shortEligible: boolean, previousLongRaw = false): PenguDualLsV2Decision {
    const longEligible = longRaw(features) && !previousLongRaw;
    if (shortEligible) return { side: -1, longEligible, shortEligible: true, active: true, reason: "PENGU V2 Short: 下落Impulse後の戻りが再び崩れ、相対弱気・出来高・BTC安全条件を満たしました。" };
    if (longEligible) return { side: 1, longEligible: true, shortEligible: false, active: true, reason: "PENGU V2 Long: 72時間強気レジームで18時間高値を上抜き、相対強度と出来高条件を満たしました。" };
    return { side: 0, longEligible: false, shortEligible: false, active: false, reason: "PENGU V2の確定1時間足Long/Short条件は未成立です。" };
}

export function evaluatePenguDualLsV2PositionBar(position: PenguDualLsV2Position, features: PenguDualLsV2Features): { exit?: PenguDualLsV2ExitDecision; updatedPosition: PenguDualLsV2Position } {
    if (position.side > 0) {
        const previousBest = Math.max(position.entryPrice, position.highWaterMark);
        const hard = position.entryPrice * (1 - PENGU_DUAL_LS_V2.long.hardStopPct);
        if (features.low <= hard) return { exit: { side: -1, reason: "LONG_HARD_STOP", stopPrice: hard, updatedPosition: position }, updatedPosition: position };
        const trailing = previousBest * (1 - PENGU_DUAL_LS_V2.long.trailingRetracePct);
        if (previousBest / position.entryPrice - 1 >= PENGU_DUAL_LS_V2.long.trailingActivationPct && features.low <= trailing) {
            return { exit: { side: -1, reason: "LONG_TRAILING_STOP", stopPrice: trailing, updatedPosition: position }, updatedPosition: position };
        }
        const updated = { ...position, highWaterMark: Math.max(previousBest, features.high) };
        if (features.referenceTs >= position.entryTs + (PENGU_DUAL_LS_V2.long.maxHoldHours - 1) * HOUR) return { exit: { side: -1, reason: "LONG_MAX_HOLD", updatedPosition: updated }, updatedPosition: updated };
        return { updatedPosition: updated };
    }
    const previousBest = Math.min(position.entryPrice, position.lowWaterMark ?? position.entryPrice);
    const hard = position.entryPrice * (1 + PENGU_DUAL_LS_V2.short.hardStopPct);
    if (features.high >= hard) return { exit: { side: 1, reason: "SHORT_HARD_STOP", stopPrice: hard, updatedPosition: position }, updatedPosition: position };
    const trailing = previousBest * (1 + PENGU_DUAL_LS_V2.short.trailingRetracePct);
    if (position.entryPrice / previousBest - 1 >= PENGU_DUAL_LS_V2.short.trailingActivationPct && features.high >= trailing) {
        return { exit: { side: 1, reason: "SHORT_TRAILING_STOP", stopPrice: trailing, updatedPosition: position }, updatedPosition: position };
    }
    const updated = { ...position, highWaterMark: position.highWaterMark, lowWaterMark: Math.min(previousBest, features.low) };
    if (features.referenceTs >= position.entryTs + (PENGU_DUAL_LS_V2.short.maxHoldHours - 1) * HOUR) return { exit: { side: 1, reason: "SHORT_MAX_HOLD", updatedPosition: updated }, updatedPosition: updated };
    return { updatedPosition: updated };
}

export function evaluatePenguDualLsV2Exit(position: PenguDualLsV2Position, features: PenguDualLsV2Features) {
    return evaluatePenguDualLsV2PositionBar(position, features).exit;
}

export function buildPenguDualLsV2Signal(history: PenguDualLsV2History, position?: PenguDualLsV2Position, now = Date.now(), cooldownUntilTs = 0): PenguDualLsV2Signal {
    const rows = buildPenguDualLsV2EvaluationSeries(history, now);
    const latest = rows.at(-1);
    const empty = (reason: string): PenguDualLsV2Signal => ({
        strategyId: PENGU_DUAL_LS_V2.id,
        referenceTs: latest?.features?.referenceTs ?? 0,
        side: 0,
        targetGross: 0,
        reason,
        diagnostics: {
            evaluatedDecisionBars: rows.filter((row) => Boolean(row.features)).length,
            latestCompletedPenguTs: rows.at(-1)?.candle.openTime,
            latestCompletedBtcTs: rows.at(-1)?.btcCandle.openTime,
            edgeTriggered: false,
            longEligible: false,
            shortEligible: false,
            shortSetupActive: false,
            shortSetupArmed: false,
            cooldownBlocked: false,
        },
    });
    if (!latest?.features) return empty("PENGU/BTCの確定1時間足履歴が不足しているためFail Closedです。");
    const decision = evaluatePenguDualLsV2Decision(latest.features, latest.shortSignal, latest.longRaw && !latest.longSignal);
    const cooldownBlocked = latest.features.referenceTs < cooldownUntilTs;
    const diagnostics = {
        evaluatedDecisionBars: rows.filter((row) => Boolean(row.features)).length,
        latestCompletedPenguTs: latest.candle.openTime,
        latestCompletedBtcTs: latest.btcCandle.openTime,
        edgeTriggered: decision.active,
        longEligible: decision.longEligible,
        shortEligible: decision.shortEligible,
        shortSetupActive: latest.shortSetupActive,
        shortSetupArmed: latest.shortSetupArmed,
        cooldownBlocked,
    };
    const positionEvaluation = position ? evaluatePenguDualLsV2PositionBar(position, latest.features) : undefined;
    const exit = positionEvaluation?.exit;
    if (exit) return { strategyId: PENGU_DUAL_LS_V2.id, referenceTs: latest.features.referenceTs, side: 0, targetGross: 0, reason: `PENGU V2 exit: ${exit.reason}`, features: latest.features, decision, exit, updatedPosition: positionEvaluation.updatedPosition, diagnostics };
    if (position) return { strategyId: PENGU_DUAL_LS_V2.id, referenceTs: latest.features.referenceTs, side: 0, targetGross: 0, reason: "PENGU V2保有中の新規Long/Shortはblocked signalとして記録し、追加発注・反転を行いません。", features: latest.features, decision, updatedPosition: positionEvaluation?.updatedPosition, diagnostics };
    if (cooldownBlocked) return { strategyId: PENGU_DUAL_LS_V2.id, referenceTs: latest.features.referenceTs, side: 0, targetGross: 0, reason: "PENGU V2決済後6時間のcooldown中です。", features: latest.features, decision, diagnostics };
    if (!decision.active) return { strategyId: PENGU_DUAL_LS_V2.id, referenceTs: latest.features.referenceTs, side: 0, targetGross: 0, reason: decision.reason, features: latest.features, decision, diagnostics };
    return {
        strategyId: PENGU_DUAL_LS_V2.id,
        referenceTs: latest.features.referenceTs,
        side: decision.side,
        targetGross: targetGrossForAtr(latest.features.atr24Ratio, decision.side === 1 ? 1 : -1),
        entryTs: latest.features.referenceTs + HOUR,
        reason: decision.reason,
        features: latest.features,
        decision,
        diagnostics,
    };
}
