import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

export type V12Side = "LONG" | "SHORT";
export type V12Regime = "LONG" | "SHORT" | "NEUTRAL";

export interface V12H1Candle {
    ts: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closed?: boolean;
}

export interface V12Bar extends V12H1Candle {
    endTs: number;
    sourceCount: 2;
}

export interface V12Candidate {
    symbol: string;
    side: V12Side;
    momentum: number;
    volatility: number;
    atr: number;
    volumeRatio: number;
    score: number;
}

export type V12EntryGateReason =
    | "ALLOW_STANDARD"
    | "ALLOW_HC175"
    | "BLOCK_FALSE_BURST80"
    | "BLOCK_RANK1_FAST_E085_REL10"
    | "BLOCK_FEATURES_INVALID";

export interface V12WinRateGateFeatures {
    ret6h: number;
    ret24h: number;
    btc12h: number;
    btc24h: number;
    btcEr12: number;
    btcEr24: number;
    rel24h: number;
    previousVolumeRatio: number;
}

export interface V12WinRateGateDecision {
    allow: boolean;
    reason: V12EntryGateReason;
    highConfidence: boolean;
    entryGrossMultiplier: number;
    features: V12WinRateGateFeatures;
}

export interface V12Signal extends V12Candidate {
    referenceTs: number;
    entryTs: number;
    regime: V12Regime;
    /** Portfolio slot rank. Rank3 is the lower-priority 0.10x residual slot. */
    rank: 1 | 2 | 3;
    /** Research-validated entry quality metadata used by LIVE sizing/attribution. */
    entryQualityClass?: "HC175" | "STANDARD";
    entryGrossMultiplier?: number;
    entryGateReason?: V12EntryGateReason;
}

export interface V12ObservedCandidate extends V12Candidate {
    rank: number;
    portfolioRank?: 1 | 2 | 3;
    baseEligible?: boolean;
    signalEligible: boolean;
    signalReason: string;
    entryGateReason?: V12EntryGateReason;
    highConfidence?: boolean;
    entryGrossMultiplier?: number;
}

export interface V12GateDiagnostics {
    schema: "v12-gate-diagnostics/v1";
    observedAt: string;
    referenceTs: number;
    referenceAgeMs: number;
    freshness: "fresh" | "stale";
    candidateCount: number;
    baseEligibleCount: number;
    portfolioRankedCount: number;
    gateEvaluatedCount: number;
    standardAcceptedCount: number;
    hc175AcceptedCount: number;
    finalSignalCount: number;
    rejectedCount: number;
    rejectionReasons: Record<string, number>;
}

export interface V12DecisionObservation {
    schema: "v12-decision-observation/v1";
    strategyId: "V12_X1.00_ALL";
    observedAt: string;
    selectedAt: string;
    referenceTs: number;
    entryTs: number;
    regime: V12Regime;
    btcRegime: V12Regime;
    reason: "SIGNAL_AVAILABLE" | "NO_COMPLETED_BAR_SIGNAL";
    symbol?: string;
    side?: V12Side;
    rank?: number;
    score?: number;
    momentum?: number;
    volumeRatio?: number;
    volatility?: number;
    atr?: number;
    candidates: V12ObservedCandidate[];
    gateDiagnostics?: V12GateDiagnostics;
}

export interface V12PositionSizing {
    requestedNotional: number;
    requestedGross: number;
    stopDistance: number;
    riskCapital: number;
    entryPrice: number;
    quantity: number;
}

export function selectV12Top3Candidates(ranked: readonly V12Candidate[], limit: number = V12_X1_ALL.maximumPositions): Array<{ candidate: V12Candidate; rank: 1 | 2 | 3 }> {
    const requestedSlots = Math.max(0, Math.min(V12_X1_ALL.maximumPositions, Math.floor(limit)));
    const selected: Array<{ candidate: V12Candidate; rank: 1 | 2 | 3 }> = [];
    if (requestedSlots >= 1 && ranked[0]) selected.push({ candidate: ranked[0], rank: 1 });
    if (requestedSlots >= 2 && ranked[1]) selected.push({ candidate: ranked[1], rank: 2 });
    if (requestedSlots >= 3) {
        const third = ranked.slice(2).find((candidate) => candidate.score >= V12_X1_ALL.rank3MinimumScore);
        if (third) selected.push({ candidate: third, rank: 3 });
    }
    return selected;
}

export function summarizeV12GateDiagnostics(
    candidates: readonly V12ObservedCandidate[],
    finalSignalCount: number,
    referenceTs: number,
    observedAt: number,
): V12GateDiagnostics {
    const rejectionReasons: Record<string, number> = {};
    for (const candidate of candidates) {
        if (candidate.signalEligible) continue;
        const reason = candidate.signalReason || "UNKNOWN_REJECTION";
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    }
    const referenceAgeMs = observedAt - referenceTs;
    return {
        schema: "v12-gate-diagnostics/v1",
        observedAt: new Date(observedAt).toISOString(),
        referenceTs,
        referenceAgeMs,
        freshness: referenceAgeMs >= 0 && referenceAgeMs <= 3 * 60 * 60_000 ? "fresh" : "stale",
        candidateCount: candidates.length,
        baseEligibleCount: candidates.filter((candidate) => candidate.baseEligible === true).length,
        portfolioRankedCount: candidates.filter((candidate) => candidate.portfolioRank !== undefined).length,
        gateEvaluatedCount: candidates.filter((candidate) => candidate.entryGateReason !== undefined).length,
        standardAcceptedCount: candidates.filter((candidate) => candidate.signalEligible && candidate.entryGateReason === "ALLOW_STANDARD").length,
        hc175AcceptedCount: candidates.filter((candidate) => candidate.signalEligible && candidate.entryGateReason === "ALLOW_HC175").length,
        finalSignalCount,
        rejectedCount: candidates.filter((candidate) => !candidate.signalEligible).length,
        rejectionReasons,
    };
}

function directionalReturn(bars: V12Bar[], index: number, lookback: number, side: V12Side) {
    if (index < lookback) return NaN;
    const current = bars[index]?.close;
    const base = bars[index - lookback]?.close;
    if (!(current > 0 && base > 0)) return NaN;
    const raw = current / base - 1;
    return side === "LONG" ? raw : -raw;
}

function efficiencyRatio(bars: V12Bar[], index: number, lookback: number) {
    if (index < lookback) return NaN;
    const first = bars[index - lookback]?.close;
    const last = bars[index]?.close;
    if (!(first > 0 && last > 0)) return NaN;
    const net = Math.abs(last - first);
    let path = 0;
    for (let i = index - lookback + 1; i <= index; i += 1) {
        const current = bars[i]?.close;
        const previous = bars[i - 1]?.close;
        if (!(current > 0 && previous > 0)) return NaN;
        path += Math.abs(current - previous);
    }
    return path > 0 ? net / path : 0;
}

function volumeRatioAt(bars: V12Bar[], index: number) {
    if (index < 20 || !bars[index]) return NaN;
    const window = bars.slice(index - 20, index);
    if (window.length !== 20) return NaN;
    const mean = window.reduce((sum, bar) => sum + bar.volume, 0) / window.length;
    return mean > 0 ? bars[index].volume / mean : NaN;
}

export function buildV12WinRateGateFeatures(
    universe: Record<string, V12Bar[]>,
    index: number,
    input: Pick<V12Signal, "symbol" | "side">,
): V12WinRateGateFeatures {
    const symbolBars = universe[input.symbol] || [];
    const btcBars = universe.BTC || [];
    const ret24h = directionalReturn(symbolBars, index, 12, input.side);
    const btc24h = directionalReturn(btcBars, index, 12, input.side);
    return {
        ret6h: directionalReturn(symbolBars, index, 3, input.side),
        ret24h,
        btc12h: directionalReturn(btcBars, index, 6, input.side),
        btc24h,
        btcEr12: efficiencyRatio(btcBars, index, 6),
        btcEr24: efficiencyRatio(btcBars, index, 12),
        rel24h: ret24h - btc24h,
        previousVolumeRatio: volumeRatioAt(symbolBars, index - 1),
    };
}

export function evaluateV12WinRateGateFromFeatures(
    features: V12WinRateGateFeatures,
    rank: number,
): V12WinRateGateDecision {
    const values = Object.values(features);
    if (values.some((value) => !Number.isFinite(value))) {
        return { allow: false, reason: "BLOCK_FEATURES_INVALID", highConfidence: false, entryGrossMultiplier: 1, features };
    }
    const highConfidence = features.ret24h >= V12_X1_ALL.highConfidenceRet24hMin
        && features.previousVolumeRatio <= V12_X1_ALL.highConfidencePreviousVolumeRatioMax
        && features.btc24h >= V12_X1_ALL.highConfidenceBtc24hMin;
    if (highConfidence) {
        return {
            allow: true,
            reason: "ALLOW_HC175",
            highConfidence: true,
            entryGrossMultiplier: V12_X1_ALL.highConfidenceGrossMultiplier,
            features,
        };
    }
    const falseBurst80 = features.btcEr24 < V12_X1_ALL.falseBurstBtcEr24Max
        && features.btcEr12 >= V12_X1_ALL.falseBurstBtcEr12Min
        && features.btcEr12 < V12_X1_ALL.falseBurstBtcEr12Max
        && features.ret6h >= V12_X1_ALL.falseBurstSymbol6hMin;
    if (falseBurst80) {
        return { allow: false, reason: "BLOCK_FALSE_BURST80", highConfidence: false, entryGrossMultiplier: 1, features };
    }
    const rank1Fast = rank === 1
        && features.btcEr12 < V12_X1_ALL.rank1FastBtcEr12Max
        && features.btc12h < V12_X1_ALL.rank1FastBtc12hAdverseMax
        && features.rel24h < V12_X1_ALL.rank1FastRelative24hMax;
    if (rank1Fast) {
        return { allow: false, reason: "BLOCK_RANK1_FAST_E085_REL10", highConfidence: false, entryGrossMultiplier: 1, features };
    }
    return { allow: true, reason: "ALLOW_STANDARD", highConfidence: false, entryGrossMultiplier: 1, features };
}

export function evaluateV12WinRateGate(
    universe: Record<string, V12Bar[]>,
    index: number,
    signal: Pick<V12Signal, "symbol" | "side" | "rank">,
): V12WinRateGateDecision {
    return evaluateV12WinRateGateFromFeatures(buildV12WinRateGateFeatures(universe, index, signal), signal.rank);
}

export function buildV12Signals(universe: Record<string, V12Bar[]>, index: number, limit: number = V12_X1_ALL.maximumPositions): V12Signal[] {
    const btc = universe.BTC;
    if (!btc?.[index]) return [];
    const regimeState = computeV12RegimeState(btc, index);
    if (!regimeState) return [];
    const ranked = V12_X1_ALL.universe
        .map((symbol) => candidateFor(symbol, universe[symbol] || [], index, regimeState))
        .filter((candidate): candidate is V12Candidate => Boolean(candidate))
        .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

    return selectV12Top3Candidates(ranked, limit)
        .map(({ candidate, rank }) => {
            const base: V12Signal = {
                ...candidate,
                rank,
                regime: regimeState.regime,
                referenceTs: universe[candidate.symbol][index].endTs,
                entryTs: universe[candidate.symbol][index + 1]?.ts || universe[candidate.symbol][index].endTs,
            };
            const gate = evaluateV12WinRateGate(universe, index, base);
            return { base, gate };
        })
        .filter(({ gate }) => gate.allow)
        .map(({ base, gate }) => ({
            ...base,
            entryQualityClass: gate.highConfidence ? "HC175" as const : "STANDARD" as const,
            entryGrossMultiplier: gate.entryGrossMultiplier,
            entryGateReason: gate.reason,
        }));
}

export function v12EntryGrossCapForRank(rank: number | undefined): number {
    return rank === 3 ? V12_X1_ALL.rank3EntryGrossCap : V12_X1_ALL.perPositionEntryGrossCap;
}

export function v12EntryGrossMultiplierForSignal(signal: Pick<V12Signal, "rank" | "entryGrossMultiplier">): number {
    if (signal.rank === 3) return 1;
    const multiplier = Number(signal.entryGrossMultiplier ?? 1);
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

export function v12EntryGrossCapForSignal(signal: Pick<V12Signal, "rank" | "entryGrossMultiplier">): number {
    return v12EntryGrossCapForRank(signal.rank) * v12EntryGrossMultiplierForSignal(signal);
}

function finite(value: unknown, fallback = NaN) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function validCandle(c: V12H1Candle) {
    return [c.ts, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
        && c.ts > 0 && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0 && c.volume >= 0;
}

/** Resample only complete contiguous H1 pairs. Missing candles are rejected. */
export function resampleV12H1ToH2(input: V12H1Candle[]): V12Bar[] {
    const sorted = [...input].sort((a, b) => a.ts - b.ts);
    for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i].ts === sorted[i - 1].ts) return [];
    }
    // A rolling venue request can return an odd number of completed H1 bars.
    // Align the first pair to the frozen H2 boundary before pairing; otherwise
    // a harmless leading H1 bar would make every pair fail the boundary check.
    const firstAlignedIndex = sorted.findIndex((bar) => bar.ts % 7_200_000 === 0);
    const aligned = firstAlignedIndex >= 0 ? sorted.slice(firstAlignedIndex) : [];
    const output: V12Bar[] = [];
    for (let i = 0; i < aligned.length; i += 2) {
        const first = aligned[i];
        const second = aligned[i + 1];
        if (!first || !second || !validCandle(first) || !validCandle(second)) continue;
        if (first.ts % 7_200_000 !== 0 || second.ts !== first.ts + 3_600_000) continue;
        if (first.closed === false || second.closed === false) continue;
        output.push({
            ts: first.ts,
            endTs: second.ts + 3_600_000,
            open: first.open,
            high: Math.max(first.high, second.high),
            low: Math.min(first.low, second.low),
            close: second.close,
            volume: first.volume + second.volume,
            sourceCount: 2,
        });
    }
    return output;
}

function sampleStd(values: number[]) {
    if (values.length < 2) return NaN;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(Math.max(0, variance));
}

function logReturns(bars: V12Bar[], endExclusive: number, lookback: number) {
    const result: number[] = [];
    const start = Math.max(1, endExclusive - lookback);
    for (let i = start; i < endExclusive; i += 1) {
        const previous = bars[i - 1]?.close;
        const current = bars[i]?.close;
        if (!(previous > 0 && current > 0)) return [];
        result.push(Math.log(current / previous));
    }
    return result;
}

function atr(bars: V12Bar[], endExclusive: number, lookback: number) {
    const start = Math.max(1, endExclusive - lookback);
    if (endExclusive - start < lookback) return NaN;
    const values: number[] = [];
    for (let i = start; i < endExclusive; i += 1) {
        const current = bars[i];
        const previous = bars[i - 1];
        if (!current || !previous) return NaN;
        values.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
}

interface V12RegimeState {
    regime: V12Regime;
    distance: number;
    momentum: number;
    strongRegime: boolean;
}

function computeV12RegimeState(btcBars: V12Bar[], index: number): V12RegimeState | null {
    if (index < V12_X1_ALL.btcRegimeSmaBars || index < V12_X1_ALL.btcRegimeMomentumBars) return null;
    const current = btcBars[index]?.close;
    if (!(current > 0)) return null;
    const smaSlice = btcBars.slice(index - V12_X1_ALL.btcRegimeSmaBars + 1, index + 1).map((bar) => bar.close);
    if (smaSlice.length !== V12_X1_ALL.btcRegimeSmaBars || smaSlice.some((value) => !(value > 0))) return null;
    const sma = smaSlice.reduce((a, b) => a + b, 0) / smaSlice.length;
    const momentumBase = btcBars[index - V12_X1_ALL.btcRegimeMomentumBars]?.close;
    if (!(momentumBase > 0)) return null;
    const distance = current / sma - 1;
    const momentum = current / momentumBase - 1;
    if (distance >= V12_X1_ALL.regimeThresholdPct && momentum > 0) {
        return { regime: "LONG", distance, momentum, strongRegime: distance >= V12_X1_ALL.strongRegimeThresholdPct };
    }
    if (distance <= -V12_X1_ALL.regimeThresholdPct && momentum < 0) {
        return { regime: "SHORT", distance, momentum, strongRegime: distance <= -V12_X1_ALL.strongRegimeThresholdPct };
    }
    return { regime: "NEUTRAL", distance, momentum, strongRegime: false };
}

export function computeV12Regime(btcBars: V12Bar[], index: number): V12Regime | null {
    return computeV12RegimeState(btcBars, index)?.regime ?? null;
}

export function evaluateV12EntryQuality(input: { regime: V12Regime; strongRegime: boolean; side: V12Side; momentum: number; atrRatio: number; score: number }) {
    if (input.regime === "NEUTRAL") return V12_X1_ALL.allowNeutralRegime && input.score >= V12_X1_ALL.neutralScoreThreshold;
    if (input.regime === "LONG" && input.side !== "LONG") return false;
    if (input.regime === "SHORT" && input.side !== "SHORT") return false;
    if (input.score >= V12_X1_ALL.neutralScoreThreshold) return true;
    if (input.strongRegime) {
        return input.score >= V12_X1_ALL.strongRegimeQualityScoreMinimum
            && input.score <= V12_X1_ALL.strongRegimeQualityScoreMaximum
            && input.atrRatio >= V12_X1_ALL.strongRegimeQualityMinimumAtrRatio;
    }
    const alignedMomentum = input.side === "LONG" ? input.momentum : -input.momentum;
    return alignedMomentum >= V12_X1_ALL.relaxedRegimeMinimumMomentumPct
        && input.atrRatio >= V12_X1_ALL.relaxedRegimeMinimumAtrRatio;
}

function candidateMetricsFor(symbol: string, bars: V12Bar[], index: number): { candidate: V12Candidate; atrRatio: number } | null {
    const current = bars[index];
    const base = bars[index - V12_X1_ALL.momentumBars];
    if (!current || !base || !(current.close > 0 && base.close > 0) || index < V12_X1_ALL.atrBars) return null;
    const momentum = current.close / base.close - 1;
    const returns = logReturns(bars, index + 1, V12_X1_ALL.volatilityLookbackBars);
    const volatility = sampleStd(returns);
    const currentAtr = atr(bars, index + 1, V12_X1_ALL.atrBars);
    const volumeWindow = bars.slice(Math.max(0, index - 20), index).map((bar) => bar.volume);
    const volumeMean = volumeWindow.length ? volumeWindow.reduce((a, b) => a + b, 0) / volumeWindow.length : NaN;
    const volumeRatio = volumeMean > 0 ? current.volume / volumeMean : NaN;
    if (![momentum, volatility, currentAtr, volumeRatio].every(Number.isFinite)) return null;
    const scale = Math.max(0.0001, volatility * Math.sqrt(V12_X1_ALL.momentumBars));
    const raw = momentum / scale;
    const score = raw / (1 + V12_X1_ALL.volatilityPenalty * volatility * 100);
    const side: V12Side = momentum >= 0 ? "LONG" : "SHORT";
    const sideScore = side === "LONG" ? score : -score;
    return {
        candidate: { symbol, side, momentum, volatility, atr: currentAtr, volumeRatio, score: sideScore },
        atrRatio: currentAtr / current.close,
    };
}

function candidateEligibility(candidate: V12Candidate, atrRatio: number, regimeState: V12RegimeState) {
    const edgeThreshold = V12_X1_ALL.minimumEdgeToCostRatio * (V12_X1_ALL.normalRoundTripCostBps / 10_000);
    if (candidate.volumeRatio < V12_X1_ALL.minimumVolumeRatio) return { eligible: false as const, reason: "VOLUME_RATIO_BELOW_MINIMUM" };
    if (Math.abs(candidate.momentum) < edgeThreshold) return { eligible: false as const, reason: "EDGE_TO_COST_BELOW_MINIMUM" };
    if (candidate.side === "LONG" && candidate.momentum < V12_X1_ALL.minimumMomentumPct) return { eligible: false as const, reason: "LONG_MOMENTUM_BELOW_MINIMUM" };
    if (candidate.side === "SHORT" && candidate.momentum > -V12_X1_ALL.minimumMomentumPct) return { eligible: false as const, reason: "SHORT_MOMENTUM_BELOW_MINIMUM" };
    if (!evaluateV12EntryQuality({ regime: regimeState.regime, strongRegime: regimeState.strongRegime, side: candidate.side, momentum: candidate.momentum, atrRatio, score: candidate.score })) {
        return { eligible: false as const, reason: "BTC_REGIME_OR_ENTRY_QUALITY_BLOCKED" };
    }
    return { eligible: true as const, reason: "SIGNAL_ELIGIBLE" };
}

function candidateFor(symbol: string, bars: V12Bar[], index: number, regimeState: V12RegimeState): V12Candidate | null {
    const metrics = candidateMetricsFor(symbol, bars, index);
    if (!metrics) return null;
    return candidateEligibility(metrics.candidate, metrics.atrRatio, regimeState).eligible ? metrics.candidate : null;
}

export function buildV12DecisionObservation(universe: Record<string, V12Bar[]>, index: number, observedAt: number = Date.now()): V12DecisionObservation | null {
    const btc = universe.BTC;
    if (!btc?.[index]) return null;
    const regimeState = computeV12RegimeState(btc, index);
    if (!regimeState) return null;
    const rawRanked = V12_X1_ALL.universe
        .map((symbol) => {
            const metrics = candidateMetricsFor(symbol, universe[symbol] || [], index);
            if (!metrics) return null;
            return { ...metrics.candidate, ...candidateEligibility(metrics.candidate, metrics.atrRatio, regimeState) };
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

    const eligibleCandidates: V12Candidate[] = rawRanked
        .filter((candidate) => candidate.eligible)
        .map((candidate) => ({
            symbol: candidate.symbol,
            side: candidate.side,
            momentum: candidate.momentum,
            volatility: candidate.volatility,
            atr: candidate.atr,
            volumeRatio: candidate.volumeRatio,
            score: candidate.score,
        }));
    const portfolioRanks = new Map(
        selectV12Top3Candidates(eligibleCandidates).map(({ candidate, rank }) => [`${candidate.symbol}|${candidate.side}`, rank] as const),
    );
    const ranked: V12ObservedCandidate[] = rawRanked.map((candidate, rankIndex) => {
        const portfolioRank = portfolioRanks.get(`${candidate.symbol}|${candidate.side}`);
        let signalEligible = candidate.eligible;
        let signalReason = candidate.reason;
        let gate: V12WinRateGateDecision | undefined;
        if (candidate.eligible && portfolioRank) {
            gate = evaluateV12WinRateGate(universe, index, {
                symbol: candidate.symbol,
                side: candidate.side,
                rank: portfolioRank,
            });
            if (!gate.allow) {
                signalEligible = false;
                signalReason = gate.reason;
            }
        }
        return {
            symbol: candidate.symbol,
            side: candidate.side,
            momentum: candidate.momentum,
            volatility: candidate.volatility,
            atr: candidate.atr,
            volumeRatio: candidate.volumeRatio,
            score: candidate.score,
            rank: rankIndex + 1,
            portfolioRank,
            baseEligible: candidate.eligible,
            signalEligible,
            signalReason,
            entryGateReason: gate?.reason,
            highConfidence: gate?.highConfidence,
            entryGrossMultiplier: gate?.entryGrossMultiplier,
        };
    });

    const signals = buildV12Signals(universe, index);
    const selectedSignal = signals[0];
    const selected = selectedSignal
        ? ranked.find((candidate) => candidate.symbol === selectedSignal.symbol && candidate.side === selectedSignal.side)
        : undefined;
    const selectedAt = new Date(observedAt).toISOString();
    const referenceTs = btc[index].endTs;
    const entryTs = btc[index + 1]?.ts || referenceTs;
    return {
        schema: "v12-decision-observation/v1",
        strategyId: "V12_X1.00_ALL",
        observedAt: selectedAt,
        selectedAt,
        referenceTs,
        entryTs,
        regime: regimeState.regime,
        btcRegime: regimeState.regime,
        reason: selectedSignal ? "SIGNAL_AVAILABLE" : "NO_COMPLETED_BAR_SIGNAL",
        symbol: selectedSignal?.symbol,
        side: selectedSignal?.side,
        rank: selectedSignal?.rank,
        score: selectedSignal?.score,
        momentum: selectedSignal?.momentum,
        volumeRatio: selectedSignal?.volumeRatio,
        volatility: selectedSignal?.volatility,
        atr: selectedSignal?.atr,
        candidates: ranked,
        gateDiagnostics: summarizeV12GateDiagnostics(ranked, signals.length, referenceTs, observedAt),
    };
}

export function buildV12Signal(universe: Record<string, V12Bar[]>, index: number): V12Signal | null {
    return buildV12Signals(universe, index, 1)[0] || null;
}

export function sizeV12Position(equity: number, entryPrice: number, candidateAtr: number, side: V12Side): V12PositionSizing {
    if (!(equity > 0 && entryPrice > 0 && candidateAtr > 0)) throw new Error("V12 sizing inputs must be positive");
    const stopDistance = Math.max(candidateAtr * V12_X1_ALL.stopAtr, entryPrice * 0.005);
    const riskCapital = equity * V12_X1_ALL.riskPerTradePct / 100;
    const riskNotional = riskCapital / (stopDistance / entryPrice);
    const marginNotional = equity * V12_X1_ALL.leverage * V12_X1_ALL.maxMarginUsagePct / 100;
    const requestedNotional = Math.min(riskNotional, marginNotional) * V12_X1_ALL.multiplier;
    return { requestedNotional, requestedGross: requestedNotional / equity, stopDistance, riskCapital, entryPrice, quantity: requestedNotional / entryPrice };
}

export function protectiveLevels(entryPrice: number, atrAtEntry: number, side: V12Side) {
    const stopDistance = Math.max(atrAtEntry * V12_X1_ALL.stopAtr, entryPrice * 0.005);
    const takeProfitDistance = atrAtEntry * V12_X1_ALL.takeProfitAtr;
    const initialStop = side === "LONG" ? entryPrice - stopDistance : entryPrice + stopDistance;
    const takeProfit = side === "LONG" ? entryPrice + takeProfitDistance : entryPrice - takeProfitDistance;
    return { initialStop, takeProfit, trailingDistance: atrAtEntry * V12_X1_ALL.trailingAtr };
}

export function nextTrailingStop(side: V12Side, currentStop: number, peakOrTrough: number, trailingDistance: number) {
    const candidate = side === "LONG" ? peakOrTrough - trailingDistance : peakOrTrough + trailingDistance;
    return side === "LONG" ? Math.max(currentStop, candidate) : Math.min(currentStop, candidate);
}
