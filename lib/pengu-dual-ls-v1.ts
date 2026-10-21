import { PENGU_DUAL_LS_V1 } from "@/config/penguDualLsV1Runtime";
import type { DisDexV35Candle } from "@/lib/disdex-v35-signal-engine";

const HOUR = 3_600_000;

export type PenguDualLsV1Side = -1 | 0 | 1;

export interface PenguDualLsV1FundingPoint {
    fundingTime: number;
    fundingRate: number;
}

export interface PenguDualLsV1History {
    btc1h: DisDexV35Candle[];
    pengu1h: DisDexV35Candle[];
    penguFunding: PenguDualLsV1FundingPoint[];
}

export interface PenguDualLsV1DecisionFeatures {
    referenceTs: number;
    close: number;
    high: number;
    low: number;
    atr14: number;
    atr24Pct: number;
    atr24MedianPct120: number;
    compressionRatio: number;
    range24Pct: number;
    priorHigh24h: number;
    priorLow24h: number;
    volumeRatio: number;
    penguMomentum24hPct: number;
    btcMomentum24hPct: number;
    btcMomentum72hPct: number;
    btcCloseAboveSma168: boolean;
    rsi14: number;
    fundingRate: number | null;
    shortDropPct: number;
    shortRetracePct: number;
    shortBreakdownConfirmed: boolean;
    shortRecentlyActive: boolean;
}

export interface PenguDualLsV1Decision {
    side: PenguDualLsV1Side;
    longEligible: boolean;
    shortEligible: boolean;
    active: boolean;
    reason: string;
}

export interface PenguDualLsV1Position {
    side: -1 | 1;
    entryTs: number;
    entryPrice: number;
    quantity: number;
    gross: number;
    highWaterMark: number;
}

export interface PenguDualLsV1ExitDecision {
    side: -1 | 1;
    reason: "LONG_INITIAL_STOP" | "LONG_TRAILING_STOP" | "LONG_MAX_HOLD" | "SHORT_MAX_HOLD" | "SHARED_RISK_FLATTEN";
    stopPrice?: number;
    updatedPosition: PenguDualLsV1Position;
}

export interface PenguDualLsV1Signal {
    strategyId: typeof PENGU_DUAL_LS_V1.id;
    referenceTs: number;
    side: PenguDualLsV1Side;
    targetGross: number;
    entryTs?: number;
    reason: string;
    features?: PenguDualLsV1DecisionFeatures;
    decision?: PenguDualLsV1Decision;
    exit?: PenguDualLsV1ExitDecision;
    diagnostics: {
        evaluatedDecisionBars: number;
        latestCompletedPenguTs?: number;
        latestCompletedBtcTs?: number;
        fundingCoverage: boolean;
        edgeTriggered: boolean;
        longEligible: boolean;
        shortEligible: boolean;
        shortRecentlyActive: boolean;
    };
}

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function mean(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function cleanRows(rows: DisDexV35Candle[], now: number) {
    return [...rows]
        .filter((row) => row.openTime > 0
            && row.closeTime > row.openTime
            && row.closeTime < now
            && row.open > 0
            && row.high >= row.low
            && row.low > 0
            && row.close > 0
            && row.volume >= 0)
        .sort((left, right) => left.openTime - right.openTime)
        .filter((row, index, source) => index === 0 || row.openTime !== source[index - 1].openTime);
}

function sma(rows: DisDexV35Candle[], end: number, length: number) {
    if (length <= 0 || end - length + 1 < 0) return undefined;
    return mean(rows.slice(end - length + 1, end + 1).map((row) => row.close));
}

function momentum(rows: DisDexV35Candle[], end: number, length: number) {
    const prior = end - length;
    if (prior < 0 || rows[prior].close <= 0) return undefined;
    return (rows[end].close / rows[prior].close - 1) * 100;
}

function trueRange(rows: DisDexV35Candle[], index: number) {
    if (index <= 0) return rows[index].high - rows[index].low;
    const previousClose = rows[index - 1].close;
    return Math.max(rows[index].high - rows[index].low, Math.abs(rows[index].high - previousClose), Math.abs(rows[index].low - previousClose));
}

function atr(rows: DisDexV35Candle[], end: number, length: number) {
    if (end - length + 1 < 0) return undefined;
    return mean(rows.slice(end - length + 1, end + 1).map((_, offset) => trueRange(rows, end - length + 1 + offset)));
}

function rsi(rows: DisDexV35Candle[], end: number, length: number) {
    if (end - length < 0) return undefined;
    let gains = 0;
    let losses = 0;
    for (let index = end - length + 1; index <= end; index += 1) {
        const change = rows[index].close - rows[index - 1].close;
        gains += Math.max(0, change);
        losses += Math.max(0, -change);
    }
    if (losses <= 0) return gains > 0 ? 100 : 50;
    return 100 - 100 / (1 + gains / losses);
}

function volumeRatio(rows: DisDexV35Candle[], end: number, recent: number, base: number) {
    if (end - base + 1 < 0 || recent >= base) return undefined;
    const recentAverage = mean(rows.slice(end - recent + 1, end + 1).map((row) => row.volume));
    const baseAverage = mean(rows.slice(end - base + 1, end - recent + 1).map((row) => row.volume));
    return baseAverage > 0 ? recentAverage / baseAverage : undefined;
}

function latestFunding(points: PenguDualLsV1FundingPoint[], timestamp: number) {
    let latest: PenguDualLsV1FundingPoint | undefined;
    for (const point of points) {
        if (point.fundingTime > timestamp) break;
        latest = point;
    }
    return latest && Number.isFinite(latest.fundingRate) ? latest.fundingRate : null;
}

function atrCompressionRatio(rows: DisDexV35Candle[], index: number) {
    const currentAtr = atr(rows, index, 24);
    const currentClose = rows[index]?.close;
    if (currentAtr === undefined || currentClose <= 0) return undefined;
    const currentPct = currentAtr / currentClose * 100;
    const window: number[] = [];
    const start = Math.max(0, index - 119);
    for (let cursor = start; cursor <= index; cursor += 1) {
        const value = atr(rows, cursor, 24);
        if (value !== undefined && rows[cursor].close > 0) window.push(value / rows[cursor].close * 100);
    }
    const baseline = median(window);
    return baseline > 0 ? { currentPct, baseline, ratio: currentPct / baseline } : undefined;
}

function shortRawEligible(features: Pick<PenguDualLsV1DecisionFeatures, "shortDropPct" | "shortRetracePct" | "shortBreakdownConfirmed" | "volumeRatio" | "rsi14" | "btcCloseAboveSma168" | "btcMomentum72hPct">) {
    const config = PENGU_DUAL_LS_V1.short;
    return features.shortDropPct >= config.minimumDropPct
        && features.shortRetracePct >= config.minimumRetracePct
        && features.shortRetracePct <= config.maximumRetracePct
        && features.shortBreakdownConfirmed
        && features.volumeRatio >= config.volumeFloor
        && features.rsi14 >= config.rsiMinimum
        && features.rsi14 <= config.rsiMaximum
        && !(features.btcCloseAboveSma168 && features.btcMomentum72hPct > config.btcStrongMomentumPct);
}

function buildFeaturesAt(
    pengu: DisDexV35Candle[],
    penguIndex: number,
    btc: DisDexV35Candle[],
    btcIndex: number,
    funding: PenguDualLsV1FundingPoint[],
): PenguDualLsV1FeatureBuild | undefined {
    const config = PENGU_DUAL_LS_V1;
    const prior24 = pengu.slice(penguIndex - config.long.rangeLookbackHours, penguIndex);
    const previousClose = pengu[penguIndex - config.short.breakdownLookbackHours]?.close;
    if (prior24.length !== config.long.rangeLookbackHours || previousClose === undefined) return undefined;
    const atr14 = atr(pengu, penguIndex, config.long.breakoutAtrLength);
    const compression = atrCompressionRatio(pengu, penguIndex);
    const volumeLong = volumeRatio(pengu, penguIndex, config.long.volumeRecentHours, config.long.volumeBaseHours);
    const volumeShort = volumeRatio(pengu, penguIndex, config.short.volumeRecentHours, config.short.volumeBaseHours);
    const penguMomentum24hPct = momentum(pengu, penguIndex, config.long.relativeMomentumHours);
    const btcMomentum24hPct = momentum(btc, btcIndex, config.long.relativeMomentumHours);
    const btcMomentum72hPct = momentum(btc, btcIndex, config.short.btcMomentumHours);
    const btcSma168 = sma(btc, btcIndex, config.short.btcSmaLength);
    const rsi14 = rsi(pengu, penguIndex, config.long.rsiLength);
    if (atr14 === undefined || compression === undefined || volumeLong === undefined || volumeShort === undefined
        || penguMomentum24hPct === undefined || btcMomentum24hPct === undefined || btcMomentum72hPct === undefined
        || btcSma168 === undefined || rsi14 === undefined) return undefined;
    const priorLow = Math.min(...prior24.map((row) => row.low));
    const priorHigh = Math.max(...prior24.map((row) => row.high));
    const denominator = previousClose - priorLow;
    const shortDropPct = previousClose > 0 ? (previousClose - priorLow) / previousClose * 100 : 0;
    const shortRetracePct = denominator > 0 ? (pengu[penguIndex].close - priorLow) / denominator * 100 : 0;
    const compressionValues: number[] = [];
    for (let cursor = Math.max(0, penguIndex - 5); cursor < penguIndex; cursor += 1) {
        const value = atrCompressionRatio(pengu, cursor);
        if (value) compressionValues.push(value.ratio);
    }
    const compressionRatio = compressionValues.length ? Math.min(...compressionValues) : compression.ratio;
    const previousLow = pengu[penguIndex - 1]?.low;
    return {
        features: {
            referenceTs: pengu[penguIndex].openTime,
            close: pengu[penguIndex].close,
            high: pengu[penguIndex].high,
            low: pengu[penguIndex].low,
            atr14,
            atr24Pct: compression.currentPct,
            atr24MedianPct120: compression.baseline,
            compressionRatio,
            range24Pct: pengu[penguIndex].close > 0 ? (priorHigh - priorLow) / pengu[penguIndex].close * 100 : Number.POSITIVE_INFINITY,
            priorHigh24h: priorHigh,
            priorLow24h: priorLow,
            volumeRatio: volumeLong,
            penguMomentum24hPct,
            btcMomentum24hPct,
            btcMomentum72hPct,
            btcCloseAboveSma168: btc[btcIndex].close > btcSma168,
            rsi14,
            fundingRate: latestFunding(funding, pengu[penguIndex].closeTime),
            shortDropPct,
            shortRetracePct,
            shortBreakdownConfirmed: previousLow !== undefined && pengu[penguIndex].close < previousLow,
            shortRecentlyActive: false,
        },
        shortVolumeRatio: volumeShort,
        index: penguIndex,
    };
}

interface PenguDualLsV1FeatureBuild {
    features: PenguDualLsV1DecisionFeatures;
    shortVolumeRatio: number;
    index: number;
}

function decisionAt(features: PenguDualLsV1DecisionFeatures, shortVolumeRatio = features.volumeRatio): PenguDualLsV1Decision {
    const config = PENGU_DUAL_LS_V1;
    const fundingAllowed = features.fundingRate !== null && features.fundingRate <= config.long.fundingMaximum;
    const longEligible = features.compressionRatio <= config.long.compressionMaxRatio
        && features.range24Pct <= config.long.rangeMaxPct
        && features.close > features.priorHigh24h + features.atr14 * config.long.breakoutAtrMultiplier
        && features.volumeRatio >= config.long.volumeFloor
        && features.penguMomentum24hPct - features.btcMomentum24hPct >= 0
        && features.btcMomentum24hPct >= config.long.btcMomentumFloorPct
        && features.rsi14 <= config.long.rsiMaximum
        && fundingAllowed
        && !features.shortRecentlyActive;
    const shortEligible = shortRawEligible({ ...features, volumeRatio: shortVolumeRatio });
    if (shortEligible) return { side: -1, longEligible, shortEligible, active: true, reason: "PENGU Dual LS Short: 24h下落後の戻り25-55%から再下落。" };
    if (longEligible) return { side: 1, longEligible, shortEligible, active: true, reason: "PENGU Dual LS Long: 圧縮後の24h高値上抜け。" };
    return {
        side: 0,
        longEligible,
        shortEligible,
        active: false,
        reason: features.fundingRate === null
            ? "LongはFunding未取得のためFail Closed。Shortの条件も未成立。"
            : "PENGU Dual LSのLong/Short条件は未成立。",
    };
}

function edgeDecision(
    rows: DisDexV35Candle[],
    btcRows: DisDexV35Candle[],
    funding: PenguDualLsV1FundingPoint[],
    penguIndex: number,
    btcIndex: number,
): { decision: PenguDualLsV1FeatureBuild; priorDecision: PenguDualLsV1Decision | undefined } | undefined {
    const current = buildFeaturesAt(rows, penguIndex, btcRows, btcIndex, funding);
    if (!current) return undefined;
    const prior = penguIndex > 0 && btcIndex > 0
        ? buildFeaturesAt(rows, penguIndex - 1, btcRows, btcIndex - 1, funding)
        : undefined;
    const priorDecision = prior ? decisionAt(prior.features, prior.shortVolumeRatio) : undefined;
    let shortRecentlyActive = false;
    for (let cursor = Math.max(0, penguIndex - PENGU_DUAL_LS_V1.long.shortBlockLookbackHours); cursor <= penguIndex; cursor += 1) {
        const btcCursor = btcRows.findIndex((row) => row.openTime === rows[cursor].openTime);
        if (btcCursor < 0) continue;
        const candidate = buildFeaturesAt(rows, cursor, btcRows, btcCursor, funding);
        if (candidate && shortRawEligible({ ...candidate.features, volumeRatio: candidate.shortVolumeRatio })) shortRecentlyActive = true;
    }
    current.features.shortRecentlyActive = shortRecentlyActive;
    return { decision: current, priorDecision };
}

function managePosition(position: PenguDualLsV1Position, features: PenguDualLsV1FeatureBuild["features"]): PenguDualLsV1ExitDecision | undefined {
    const highWaterMark = position.side > 0 ? Math.max(position.highWaterMark, features.high) : position.highWaterMark;
    const updatedPosition = { ...position, highWaterMark };
    if (position.side > 0) {
        const initialStop = position.entryPrice * (1 - PENGU_DUAL_LS_V1.long.initialStopPct / 100);
        const trailingActive = highWaterMark >= position.entryPrice * (1 + PENGU_DUAL_LS_V1.long.trailingActivationPct / 100);
        const stopPrice = trailingActive
            ? Math.max(initialStop, highWaterMark * (1 - PENGU_DUAL_LS_V1.long.trailingRetracePct / 100))
            : initialStop;
        if (features.low <= stopPrice) {
            return { side: -1, reason: trailingActive ? "LONG_TRAILING_STOP" : "LONG_INITIAL_STOP", stopPrice, updatedPosition };
        }
        if (features.referenceTs >= position.entryTs + PENGU_DUAL_LS_V1.holdHours * HOUR) {
            return { side: -1, reason: "LONG_MAX_HOLD", updatedPosition };
        }
    } else if (features.referenceTs >= position.entryTs + PENGU_DUAL_LS_V1.holdHours * HOUR) {
        return { side: 1, reason: "SHORT_MAX_HOLD", updatedPosition };
    }
    return undefined;
}

export function evaluatePenguDualLsV1Decision(features: PenguDualLsV1FeatureBuild["features"], shortVolumeRatio = features.volumeRatio) {
    return decisionAt(features, shortVolumeRatio);
}

export function buildPenguDualLsV1Signal(
    history: PenguDualLsV1History,
    position?: PenguDualLsV1Position,
    now = Date.now(),
): PenguDualLsV1Signal {
    const pengu = cleanRows(history.pengu1h, now);
    const btc = cleanRows(history.btc1h, now);
    const funding = [...history.penguFunding]
        .filter((point) => point.fundingTime > 0 && Number.isFinite(point.fundingRate))
        .sort((left, right) => left.fundingTime - right.fundingTime);
    const btcIndexes = new Map(btc.map((row, index) => [row.openTime, index]));
    const common = pengu.map((row, index) => ({ row, index, btcIndex: btcIndexes.get(row.openTime) }))
        .filter((item): item is { row: DisDexV35Candle; index: number; btcIndex: number } => item.btcIndex !== undefined);
    const latest = common.at(-1);
    if (!latest) {
        return {
            strategyId: PENGU_DUAL_LS_V1.id,
            referenceTs: 0,
            side: 0,
            targetGross: 0,
            reason: "PENGU/BTCの共通確定足がありません。",
            diagnostics: { evaluatedDecisionBars: 0, fundingCoverage: false, edgeTriggered: false, longEligible: false, shortEligible: false, shortRecentlyActive: false },
        };
    }
    const edge = edgeDecision(pengu, btc, funding, latest.index, latest.btcIndex);
    if (!edge) {
        return {
            strategyId: PENGU_DUAL_LS_V1.id,
            referenceTs: latest.row.openTime,
            side: 0,
            targetGross: 0,
            reason: "PENGU Dual LSの計算に必要な履歴が不足しています。",
            diagnostics: { evaluatedDecisionBars: 0, latestCompletedPenguTs: latest.row.openTime, latestCompletedBtcTs: btc[latest.btcIndex].openTime, fundingCoverage: latest.row.closeTime >= 0 && latest.row.closeTime >= (funding.at(-1)?.fundingTime || 0), edgeTriggered: false, longEligible: false, shortEligible: false, shortRecentlyActive: false },
        };
    }
    const currentDecision = decisionAt(edge.decision.features, edge.decision.shortVolumeRatio);
    const edgeTriggered = currentDecision.active && !edge.priorDecision?.active;
    const exit = position ? managePosition(position, edge.decision.features) : undefined;
    const evaluatedDecisionBars = Math.max(0, common.length - 1);
    if (exit) {
        return {
            strategyId: PENGU_DUAL_LS_V1.id,
            referenceTs: latest.row.openTime,
            side: 0,
            targetGross: 0,
            reason: `PENGU Dual LS exit: ${exit.reason}`,
            features: edge.decision.features,
            decision: currentDecision,
            exit,
            diagnostics: {
                evaluatedDecisionBars,
                latestCompletedPenguTs: latest.row.openTime,
                latestCompletedBtcTs: btc[latest.btcIndex].openTime,
                fundingCoverage: edge.decision.features.fundingRate !== null,
                edgeTriggered,
                longEligible: currentDecision.longEligible,
                shortEligible: currentDecision.shortEligible,
                shortRecentlyActive: edge.decision.features.shortRecentlyActive,
            },
        };
    }
    if (position) {
        return {
            strategyId: PENGU_DUAL_LS_V1.id,
            referenceTs: latest.row.openTime,
            side: 0,
            targetGross: 0,
            reason: "PENGU Dual LS: 保有中は新しいLong/Shortシグナルを無視します。",
            features: edge.decision.features,
            decision: currentDecision,
            diagnostics: {
                evaluatedDecisionBars,
                latestCompletedPenguTs: latest.row.openTime,
                latestCompletedBtcTs: btc[latest.btcIndex].openTime,
                fundingCoverage: edge.decision.features.fundingRate !== null,
                edgeTriggered,
                longEligible: currentDecision.longEligible,
                shortEligible: currentDecision.shortEligible,
                shortRecentlyActive: edge.decision.features.shortRecentlyActive,
            },
        };
    }
    if (!edgeTriggered) {
        return {
            strategyId: PENGU_DUAL_LS_V1.id,
            referenceTs: latest.row.openTime,
            side: 0,
            targetGross: 0,
            reason: currentDecision.active ? "PENGU Dual LS: 条件継続中のため重複Entryを抑制します。" : currentDecision.reason,
            features: edge.decision.features,
            decision: currentDecision,
            diagnostics: {
                evaluatedDecisionBars,
                latestCompletedPenguTs: latest.row.openTime,
                latestCompletedBtcTs: btc[latest.btcIndex].openTime,
                fundingCoverage: edge.decision.features.fundingRate !== null,
                edgeTriggered: false,
                longEligible: currentDecision.longEligible,
                shortEligible: currentDecision.shortEligible,
                shortRecentlyActive: edge.decision.features.shortRecentlyActive,
            },
        };
    }
    return {
        strategyId: PENGU_DUAL_LS_V1.id,
        referenceTs: latest.row.openTime,
        side: currentDecision.side,
        targetGross: currentDecision.side > 0 ? PENGU_DUAL_LS_V1.longGross : PENGU_DUAL_LS_V1.shortGross,
        entryTs: latest.row.openTime + HOUR,
        reason: currentDecision.reason,
        features: edge.decision.features,
        decision: currentDecision,
        diagnostics: {
            evaluatedDecisionBars,
            latestCompletedPenguTs: latest.row.openTime,
            latestCompletedBtcTs: btc[latest.btcIndex].openTime,
            fundingCoverage: edge.decision.features.fundingRate !== null,
            edgeTriggered: true,
            longEligible: currentDecision.longEligible,
            shortEligible: currentDecision.shortEligible,
            shortRecentlyActive: edge.decision.features.shortRecentlyActive,
        },
    };
}
