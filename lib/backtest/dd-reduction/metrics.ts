import type { Direction, ExecutionBar, ExecutionExit, IntegratedReplay, TradePath } from "./types";

export interface TradePathMetrics {
    readonly maePct: number;
    readonly mfePct: number;
    readonly givebackPct: number;
    readonly initialAdversePct: number;
    readonly maxLossPct: number;
    readonly protectionInstallDelayMs: number | null;
    readonly stopSlippageBps: number;
    readonly holdingMs: number;
    readonly realizedNetPnl: number;
    readonly terminalPnlPct: number;
}

export interface EquityPoint {
    readonly ts: number;
    readonly equity: number;
    readonly realizedEquity?: number;
    readonly logic?: string;
    readonly direction?: Direction;
}

export interface DrawdownAttribution {
    readonly key: string;
    readonly drawdown: number;
    readonly drawdownPct: number;
    readonly timeUnderWaterMs: number;
    readonly observations: number;
}

export interface DrawdownEpisode {
    readonly peakTs: number;
    readonly troughTs: number;
    readonly recoveryTs: number | null;
    readonly peakEquity: number;
    readonly troughEquity: number;
    readonly drawdown: number;
    readonly drawdownPct: number;
    readonly timeUnderWaterMs: number;
}

export interface DrawdownSummary {
    readonly peak: EquityPoint;
    readonly trough: EquityPoint;
    readonly recovery: EquityPoint | null;
    readonly maxMtmDrawdown: number;
    readonly maxMtmDrawdownPct: number;
    readonly maxRealizedDrawdown: number;
    readonly maxRealizedDrawdownPct: number;
    readonly timeUnderWaterMs: number;
    readonly episodes: readonly DrawdownEpisode[];
    readonly logicAttribution: readonly DrawdownAttribution[];
    readonly directionAttribution: readonly DrawdownAttribution[];
}

interface TradePathEvidence extends TradePath {
    readonly protectionInstallTs?: number;
    readonly stopPrice?: number;
    readonly protectionEvents?: readonly { readonly kind: string; readonly ts: number }[];
    readonly exits?: readonly ExecutionExit[];
}

function finite(value: number | undefined): value is number {
    return value !== undefined && Number.isFinite(value);
}

function favorablePct(direction: Direction, entryPrice: number, price: number): number {
    return (direction === "LONG" ? price / entryPrice - 1 : 1 - price / entryPrice) * 100;
}

function adversePct(direction: Direction, entryPrice: number, price: number): number {
    return Math.max(0, -favorablePct(direction, entryPrice, price));
}

function pathBars(path: TradePath): readonly ExecutionBar[] {
    if (path.entry === null) return [];
    const endTs = path.exit?.ts ?? Number.POSITIVE_INFINITY;
    return [...path.bars]
        .filter((bar) => bar.ts >= path.entry!.ts && bar.ts <= endTs)
        .sort((left, right) => left.ts - right.ts);
}

export function calculateTradePathMetrics(path: TradePath): TradePathMetrics {
    const evidence = path as TradePathEvidence;
    const entry = path.entry;
    if (entry === null || !(entry.price > 0) || !Number.isFinite(entry.price)) {
        return {
            maePct: 0,
            mfePct: 0,
            givebackPct: 0,
            initialAdversePct: 0,
            maxLossPct: 0,
            protectionInstallDelayMs: null,
            stopSlippageBps: 0,
            holdingMs: 0,
            realizedNetPnl: 0,
            terminalPnlPct: 0,
        };
    }

    const bars = pathBars(path);
    let mfePct = 0;
    let maePct = 0;
    let initialAdversePct = 0;
    let initialPhase = true;
    for (const marketBar of bars) {
        const favorable = favorablePct(path.direction, entry.price, path.direction === "LONG" ? marketBar.high : marketBar.low);
        const adverse = adversePct(path.direction, entry.price, path.direction === "LONG" ? marketBar.low : marketBar.high);
        mfePct = Math.max(mfePct, favorable);
        maePct = Math.max(maePct, adverse);
        if (initialPhase) {
            initialAdversePct = Math.max(initialAdversePct, adverse);
            const closeFavorable = favorablePct(path.direction, entry.price, marketBar.close);
            if (closeFavorable > 0) initialPhase = false;
        }
    }

    const exits = evidence.exits ?? (path.exit === null ? [] : [path.exit]);
    const terminalExit = exits.at(-1) ?? path.exit;
    const terminalPrice = terminalExit?.price ?? bars.at(-1)?.close ?? entry.price;
    const terminalPnlPct = favorablePct(path.direction, entry.price, terminalPrice);
    const givebackPct = mfePct > 0 ? ((mfePct - terminalPnlPct) / mfePct) * 100 : 0;
    const entryGross = entry.gross > 0 ? entry.gross : entry.price * entry.quantity;
    const costPct = entryGross > 0 ? ((path.fee + path.funding + path.slippage) / entryGross) * 100 : 0;
    const maxLossPct = Math.max(0, maePct + costPct);
    const realizedNetPnl = exits.reduce((total, partialExit) => total + partialExit.realizedPnl, 0) - path.fee - path.funding - path.slippage;
    const firstProtectionTs = finite(evidence.protectionInstallTs)
        ? evidence.protectionInstallTs
        : evidence.protectionEvents?.find((event) => event.kind === "STOP_PLACED")?.ts ?? bars[0]?.ts;
    const protectionInstallDelayMs = firstProtectionTs === undefined ? null : Math.max(0, firstProtectionTs - entry.ts);
    const stopSlippageBps = evidence.stopPrice !== undefined && path.exit !== null && evidence.stopPrice > 0
        ? Math.abs(path.exit.price - evidence.stopPrice) / evidence.stopPrice * 10_000
        : entryGross > 0 ? Math.abs(path.slippage) / entryGross * 10_000 : 0;
    const holdingMs = Math.max(0, (terminalExit?.ts ?? bars.at(-1)?.ts ?? entry.ts) - entry.ts);

    return {
        maePct,
        mfePct,
        givebackPct,
        initialAdversePct,
        maxLossPct,
        protectionInstallDelayMs,
        stopSlippageBps,
        holdingMs,
        realizedNetPnl,
        terminalPnlPct,
    };
}

function aggregateAttribution(values: ReadonlyMap<string, DrawdownAttribution>): readonly DrawdownAttribution[] {
    return [...values.values()].sort((left, right) => right.drawdown - left.drawdown || left.key.localeCompare(right.key));
}

function addAttribution(
    map: Map<string, DrawdownAttribution>,
    key: string,
    drawdown: number,
    drawdownPct: number,
    timeUnderWaterMs: number,
): void {
    const prior = map.get(key);
    map.set(key, {
        key,
        drawdown: (prior?.drawdown ?? 0) + drawdown,
        drawdownPct: (prior?.drawdownPct ?? 0) + drawdownPct,
        timeUnderWaterMs: (prior?.timeUnderWaterMs ?? 0) + timeUnderWaterMs,
        observations: (prior?.observations ?? 0) + 1,
    });
}

function maxDrawdown(values: readonly number[]): { readonly amount: number; readonly pct: number } {
    let highWater = values[0] ?? 0;
    let amount = 0;
    let pct = 0;
    for (const value of values) {
        if (value > highWater) highWater = value;
        if (highWater > 0) {
            amount = Math.max(amount, highWater - value);
            pct = Math.max(pct, (highWater - value) / highWater * 100);
        }
    }
    return { amount, pct };
}

export function summarizeDrawdown(timeline: readonly EquityPoint[]): DrawdownSummary {
    if (timeline.length === 0) throw new Error("DRAWDown_TIMELINE_EMPTY");
    const points = [...timeline].sort((left, right) => left.ts - right.ts);
    let peak = points[0];
    let active: { peak: EquityPoint; trough: EquityPoint } | null = null;
    const episodes: DrawdownEpisode[] = [];
    const logicAttribution = new Map<string, DrawdownAttribution>();
    const directionAttribution = new Map<string, DrawdownAttribution>();
    let timeUnderWaterMs = 0;

    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const point = points[index];
        const delta = point.equity - previous.equity;
        if (delta < 0) {
            addAttribution(logicAttribution, point.logic ?? "UNKNOWN", -delta, previous.equity > 0 ? -delta / previous.equity * 100 : 0, Math.max(0, point.ts - previous.ts));
            addAttribution(directionAttribution, point.direction ?? "UNKNOWN", -delta, previous.equity > 0 ? -delta / previous.equity * 100 : 0, Math.max(0, point.ts - previous.ts));
        }
        if (point.equity >= peak.equity) {
            if (active !== null) {
                const recovery = point;
                const episode = makeEpisode(active.peak, active.trough, recovery);
                episodes.push(episode);
                timeUnderWaterMs += episode.timeUnderWaterMs;
                active = null;
            }
            peak = point;
        } else if (active === null) {
            active = { peak, trough: point };
        } else if (point.equity < active.trough.equity) {
            active.trough = point;
        }
    }
    if (active !== null) {
        const episode = makeEpisode(active.peak, active.trough, null);
        episodes.push(episode);
        timeUnderWaterMs += episode.timeUnderWaterMs;
    }

    const worst = episodes.reduce<DrawdownEpisode | null>((current, episode) => current === null || episode.drawdownPct > current.drawdownPct ? episode : current, null);
    const mtm = maxDrawdown(points.map((point) => point.equity));
    const realized = maxDrawdown(points.map((point) => point.realizedEquity ?? point.equity));
    const worstPeak = worst === null ? points[0] : points.find((point) => point.ts === worst.peakTs) ?? points[0];
    const worstTrough = worst === null ? points[0] : points.find((point) => point.ts === worst.troughTs) ?? points[0];
    const worstRecovery = worst?.recoveryTs === null || worst === null ? null : points.find((point) => point.ts === worst.recoveryTs) ?? null;
    return {
        peak: worstPeak,
        trough: worstTrough,
        recovery: worstRecovery,
        maxMtmDrawdown: mtm.amount,
        maxMtmDrawdownPct: mtm.pct,
        maxRealizedDrawdown: realized.amount,
        maxRealizedDrawdownPct: realized.pct,
        timeUnderWaterMs,
        episodes,
        logicAttribution: aggregateAttribution(logicAttribution),
        directionAttribution: aggregateAttribution(directionAttribution),
    };
}

function makeEpisode(peak: EquityPoint, trough: EquityPoint, recovery: EquityPoint | null): DrawdownEpisode {
    return {
        peakTs: peak.ts,
        troughTs: trough.ts,
        recoveryTs: recovery?.ts ?? null,
        peakEquity: peak.equity,
        troughEquity: trough.equity,
        drawdown: peak.equity - trough.equity,
        drawdownPct: peak.equity > 0 ? (peak.equity - trough.equity) / peak.equity * 100 : 0,
        timeUnderWaterMs: Math.max(0, (recovery?.ts ?? trough.ts) - peak.ts),
    };
}

export type { IntegratedReplay };
