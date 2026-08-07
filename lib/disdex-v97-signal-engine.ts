import { DISDEX_V97_CORE, DISDEX_V97_STRATEGY_ID } from "@/config/disdexV97Runtime";

export interface DisDexV97Candle {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
}

export type DisDexV97Symbol = typeof DISDEX_V97_CORE.symbols[number];

export interface DisDexV97FundingPoint {
    fundingTime: number;
    fundingRate: number;
}

export interface DisDexV97History {
    bars4h: Record<DisDexV97Symbol, DisDexV97Candle[]>;
    funding: Record<DisDexV97Symbol, DisDexV97FundingPoint[]>;
}

export interface DisDexV97Position {
    symbol: DisDexV97Symbol;
    side: -1;
    entryTs: number;
    entryPrice: number;
    quantity: number;
    gross: number;
}

export interface DisDexV97Candidate {
    symbol: DisDexV97Symbol;
    score: number;
    movePct: number;
    bouncePct: number;
    current4hPct: number;
    relativePct: number;
    volumeRatio: number;
}

export interface DisDexV97Signal {
    strategyId: typeof DISDEX_V97_STRATEGY_ID;
    referenceTs: number;
    entryTs?: number;
    side: -1 | 0;
    symbol?: DisDexV97Symbol;
    targetGross: number;
    reason: string;
    candidate?: DisDexV97Candidate;
    exit?: {
        symbol: DisDexV97Symbol;
        side: -1;
        reason: "HOLD_84H_COMPLETE" | "SHARED_RISK_FLATTEN";
    };
}

const BAR_MS = 4 * 60 * 60 * 1000;
const LOOKBACK_BARS = DISDEX_V97_CORE.lookbackDays * 24 / 4;
const BOUNCE_BARS = DISDEX_V97_CORE.bounceHours / 4;
const SMA_BARS = DISDEX_V97_CORE.smaDays * 24 / 4;
const HOLD_MS = DISDEX_V97_CORE.holdingHours * 60 * 60 * 1000;

function finite(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function momentum(rows: DisDexV97Candle[], index: number, bars: number) {
    const previous = index - bars;
    if (previous < 0) return undefined;
    const base = finite(rows[previous]?.close);
    const close = finite(rows[index]?.close);
    if (!(base > 0) || !(close > 0)) return undefined;
    return (close / base - 1) * 100;
}

function sma(rows: DisDexV97Candle[], index: number, bars: number) {
    const first = index - bars + 1;
    if (first < 0) return undefined;
    let sum = 0;
    for (let i = first; i <= index; i += 1) {
        const close = finite(rows[i]?.close);
        if (!(close > 0)) return undefined;
        sum += close;
    }
    return sum / bars;
}

function volumeRatio(rows: DisDexV97Candle[], index: number) {
    const recent = DISDEX_V97_CORE.volumeRatio.recentBars;
    const base = DISDEX_V97_CORE.volumeRatio.baseBars;
    const first = index - base + 1;
    const previousEndExclusive = index - recent + 1;
    if (first < 0 || previousEndExclusive <= first) return undefined;
    let recentSum = 0;
    for (let i = index - recent + 1; i <= index; i += 1) recentSum += Math.max(0, finite(rows[i]?.volume));
    let previousSum = 0;
    let previousCount = 0;
    for (let i = first; i < previousEndExclusive; i += 1) {
        previousSum += Math.max(0, finite(rows[i]?.volume));
        previousCount += 1;
    }
    const denominator = previousCount > 0 ? previousSum / previousCount : 0;
    if (!(denominator > 0)) return undefined;
    return (recentSum / recent) / denominator;
}

function latestCommonReference(history: DisDexV97History) {
    const btc = history.bars4h.BTCUSDT;
    const latest = btc[btc.length - 1];
    if (!latest) throw new Error("V97 BTC 4h history is empty.");
    return latest.openTime;
}

function indexAt(rows: DisDexV97Candle[], referenceTs: number) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].openTime === referenceTs) return i;
        if (rows[i].openTime < referenceTs) break;
    }
    return -1;
}

export function buildDisDexV97Candidates(history: DisDexV97History, referenceTs = latestCommonReference(history)) {
    const btcRows = history.bars4h.BTCUSDT;
    const btcIndex = indexAt(btcRows, referenceTs);
    if (btcIndex < 0) throw new Error(`V97 BTC reference bar missing: ${referenceTs}.`);
    const btcMove = momentum(btcRows, btcIndex, LOOKBACK_BARS);
    if (btcMove === undefined) return [];
    const candidates: DisDexV97Candidate[] = [];
    for (const symbol of DISDEX_V97_CORE.symbols) {
        const rows = history.bars4h[symbol];
        const index = indexAt(rows, referenceTs);
        if (index < 0) continue;
        const movePct = momentum(rows, index, LOOKBACK_BARS);
        const bouncePct = momentum(rows, index, BOUNCE_BARS);
        const current4hPct = momentum(rows, index, 1);
        const average = sma(rows, index, SMA_BARS);
        const ratio = volumeRatio(rows, index);
        if (movePct === undefined || bouncePct === undefined || current4hPct === undefined || average === undefined || ratio === undefined) continue;
        const close = rows[index].close;
        const relativePct = movePct - btcMove;
        const eligible = movePct <= -DISDEX_V97_CORE.minimumDeclinePct
            && bouncePct >= DISDEX_V97_CORE.minimumBouncePct
            && close < average
            && relativePct <= DISDEX_V97_CORE.maximumRelativeMoveToBtcPct
            && ratio >= DISDEX_V97_CORE.volumeRatio.minimum;
        if (!eligible) continue;
        const score = -movePct
            + DISDEX_V97_CORE.scoreWeights.relativeWeakness * (-relativePct)
            + DISDEX_V97_CORE.scoreWeights.bounce * bouncePct
            + DISDEX_V97_CORE.scoreWeights.negativeCurrent4h * (current4hPct < 0 ? -current4hPct : 0)
            + DISDEX_V97_CORE.scoreWeights.volumeRatio * ratio;
        candidates.push({ symbol, score, movePct, bouncePct, current4hPct, relativePct, volumeRatio: ratio });
    }
    return candidates.sort((left, right) => (right.score - left.score) || right.symbol.localeCompare(left.symbol));
}

export function buildDisDexV97Signal(
    history: DisDexV97History,
    position: DisDexV97Position | undefined,
    targetGross: number,
    now = Date.now(),
): DisDexV97Signal {
    const referenceTs = latestCommonReference(history);
    if (now < referenceTs + BAR_MS) throw new Error("V97 latest 4h bar is not completed yet.");
    if (position) {
        if (now >= position.entryTs + HOLD_MS) {
            return {
                strategyId: DISDEX_V97_STRATEGY_ID,
                referenceTs,
                side: 0,
                targetGross: 0,
                reason: "V97 fixed 84h holding window completed.",
                exit: { symbol: position.symbol, side: -1, reason: "HOLD_84H_COMPLETE" },
            };
        }
        return {
            strategyId: DISDEX_V97_STRATEGY_ID,
            referenceTs,
            side: 0,
            targetGross: position.gross,
            reason: "V97 existing event position remains inside its 84h holding window.",
        };
    }
    const candidate = buildDisDexV97Candidates(history, referenceTs)[0];
    if (!candidate || targetGross <= 0) {
        return {
            strategyId: DISDEX_V97_STRATEGY_ID,
            referenceTs,
            side: 0,
            targetGross: 0,
            reason: candidate ? "V97 controller blocked this otherwise-valid event entry." : "No V97 A4H short-pullback event qualifies.",
            candidate,
        };
    }
    return {
        strategyId: DISDEX_V97_STRATEGY_ID,
        referenceTs,
        entryTs: referenceTs + BAR_MS,
        side: -1,
        symbol: candidate.symbol,
        targetGross,
        reason: `V97 ${candidate.symbol} 10d decline / 8h bounce event selected.`,
        candidate,
    };
}
