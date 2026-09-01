import { STRICT_BT33404708902, type StrictBtBaseStrategy } from "../config/disdexStrictBt33404708902Runtime";
import { classifyAsterSymbol } from "./disdex-aster-portfolio-classifier";

export type StrictStrategy = StrictBtBaseStrategy | "QUALITY102";
export type StrictPositionSide = "LONG" | "SHORT";

export interface StrictPortfolioPosition {
    id: string;
    strategy: StrictStrategy;
    symbol: string;
    side: StrictPositionSide;
    quantity: number;
    entryPrice: number;
    markPrice: number;
    entryTs: number;
    updatedAt: number;
    feeBpsPerSide?: number;
    fundingPerDay?: number;
}

export interface StrictPortfolioIntent {
    idempotencyKey: string;
    strategy: StrictStrategy;
    symbol: string;
    side: StrictPositionSide;
    gross: number;
    notionalUsd: number;
    signalTs: number;
}

export interface MarkToMarketReduction {
    strategy: "QUALITY102" | StrictBtBaseStrategy;
    symbol: string;
    side: StrictPositionSide;
    markTs: number;
    markPrice: number;
    reducedQuantity: number;
    remainingQuantity: number;
    remainingEntryPrice: number;
    realizedPnl: number;
    transactionCost: number;
    fundingCost: number;
    remainingNotionalUsd: number;
    remainingPosition?: StrictPortfolioPosition;
    accounting: "MARK_TO_MARKET_REALIZED_PNL";
}

export interface StrictPortfolioPlan {
    status: "planned" | "blocked";
    reason?: string;
    accepted: StrictPortfolioIntent[];
    rejected: Array<{ intent: StrictPortfolioIntent; reason: string }>;
    reductions: MarkToMarketReduction[];
    activePositions: StrictPortfolioPosition[];
    equityAfterReductions: number;
    totals: { totalGross: number; cryptoGross: number; stockGross: number };
}

const EPSILON = 1e-9;

function positive(value: unknown, name: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive.`);
    return number;
}

function nonNegative(value: unknown, name: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be finite and non-negative.`);
    return number;
}

function isCrypto(strategy: StrictStrategy) {
    return strategy === "V12" || strategy === "PENGU_DUAL_LS_V2" || strategy === "QUALITY102";
}

function isStock(strategy: StrictStrategy) {
    return strategy === "V11_EQ" || strategy === "V50_POST_OPEN_BASIS" || strategy === "V52";
}

function grossForNotional(notionalUsd: number, equity: number) {
    return notionalUsd / equity;
}

function positionNotional(position: StrictPortfolioPosition) {
    return Math.abs(position.quantity) * position.markPrice;
}

function strategyCap(strategy: StrictStrategy) {
    if (strategy === "V12") return STRICT_BT33404708902.v12MaximumGross;
    if (strategy === "PENGU_DUAL_LS_V2") return STRICT_BT33404708902.penguMaximumGross;
    if (strategy === "QUALITY102") return STRICT_BT33404708902.quality102PositionCap;
    return STRICT_BT33404708902.stockGrossCap;
}

function strategySymbolMatches(strategy: StrictStrategy, symbol: string) {
    if (strategy === "QUALITY102") return String(symbol).trim().length > 0;
    const requestedSleeve = strategy === "V52" ? "V50_POST_OPEN_BASIS" : strategy;
    const classification = classifyAsterSymbol(symbol, requestedSleeve as Parameters<typeof classifyAsterSymbol>[1]);
    return classification.tradable && (strategy === "V52"
        ? (classification.sleeve === "V50_POST_OPEN_BASIS" || classification.sleeve === "V11_EQ")
        : classification.sleeve === strategy);
}

function sumNotional(rows: StrictPortfolioPosition[], predicate: (row: StrictPortfolioPosition) => boolean) {
    return rows.filter(predicate).reduce((sum, row) => sum + positionNotional(row), 0);
}

function remainingNotionalLimit(input: {
    equity: number;
    oldNotional: number;
    markNetRate: number;
    existingBaseNotional: number;
    cap: number;
}) {
    const old = Math.max(0, input.oldNotional);
    const denominator = 1 + input.cap * input.markNetRate;
    if (old <= EPSILON || denominator <= EPSILON) return 0;
    const limit = (input.cap * (input.equity + old * input.markNetRate) - input.existingBaseNotional) / denominator;
    return Math.max(0, Math.min(old, limit));
}

function markNetRateOnMarkNotional(position: StrictPortfolioPosition, now: number) {
    const feeBpsPerSide = nonNegative(position.feeBpsPerSide ?? 0, "fee bps per side");
    const fundingPerDay = nonNegative(position.fundingPerDay ?? 0, "funding per day");
    const elapsedHours = Math.max(0, now - position.entryTs) / 3_600_000;
    const side = position.side === "LONG" ? 1 : -1;
    const entryToMark = position.entryPrice / position.markPrice;
    const grossReturn = side * (position.markPrice / position.entryPrice - 1);
    const netReturnOnEntryNotional = grossReturn - 2 * feeBpsPerSide / 10_000 - (elapsedHours / 24) * fundingPerDay;
    // Gross capacity is measured at the current mark, while realized PnL is
    // settled on entry-price basis. Convert the exact net return accordingly.
    return entryToMark * netReturnOnEntryNotional;
}

function planTotals(active: StrictPortfolioPosition[], accepted: StrictPortfolioIntent[], equity: number) {
    const cryptoNotional = sumNotional(active, (row) => isCrypto(row.strategy))
        + accepted.filter((intent) => isCrypto(intent.strategy)).reduce((sum, intent) => sum + intent.notionalUsd, 0);
    const stockNotional = sumNotional(active, (row) => isStock(row.strategy))
        + accepted.filter((intent) => isStock(intent.strategy)).reduce((sum, intent) => sum + intent.notionalUsd, 0);
    return {
        totalGross: grossForNotional(cryptoNotional + stockNotional, equity),
        cryptoGross: grossForNotional(cryptoNotional, equity),
        stockGross: grossForNotional(stockNotional, equity),
    };
}

function rejectPlan(reason: string, active: StrictPortfolioPosition[], equity: number): StrictPortfolioPlan {
    const totals = planTotals(active, [], equity);
    return { status: "blocked", reason, accepted: [], rejected: [], reductions: [], activePositions: active, equityAfterReductions: equity, totals };
}

/**
 * Reduce a position at the supplied timestamp mark. The average entry price
 * of the remaining quantity is preserved; only the reduced quantity realizes
 * the side-adjusted PnL, fees, and funding once.
 */
export function markToMarketReducePosition(input: {
    position: StrictPortfolioPosition;
    reduceQuantity: number;
    markPrice: number;
    markTs: number;
    feeBpsPerSide?: number;
    fundingPerDay?: number;
}): MarkToMarketReduction {
    const position = input.position;
    if (!Number.isFinite(position.entryTs) || position.entryTs <= 0) throw new Error("position entry timestamp is invalid.");
    positive(position.quantity, "position quantity");
    positive(position.entryPrice, "position entry price");
    positive(position.markPrice, "position mark price");
    positive(input.reduceQuantity, "reduction quantity");
    positive(input.markPrice, "mark price");
    if (!Number.isFinite(input.markTs) || input.markTs < position.entryTs) throw new Error("mark timestamp is invalid or precedes entry.");
    if (input.reduceQuantity > position.quantity + EPSILON) throw new Error("reduction quantity exceeds the managed position.");
    if (position.side !== "LONG" && position.side !== "SHORT") throw new Error("position side is invalid.");
    const feeBpsPerSide = nonNegative(input.feeBpsPerSide ?? position.feeBpsPerSide ?? 0, "fee bps per side");
    const fundingPerDay = nonNegative(input.fundingPerDay ?? position.fundingPerDay ?? 0, "funding per day");
    const basisNotional = input.reduceQuantity * position.entryPrice;
    const side = position.side === "LONG" ? 1 : -1;
    const priceReturn = side * (input.markPrice / position.entryPrice - 1);
    const elapsedHours = Math.max(0, input.markTs - position.entryTs) / 3_600_000;
    const transactionCost = basisNotional * 2 * feeBpsPerSide / 10_000;
    const fundingCost = basisNotional * (elapsedHours / 24) * fundingPerDay;
    const realizedPnl = basisNotional * priceReturn - transactionCost - fundingCost;
    const remainingQuantity = Math.max(0, position.quantity - input.reduceQuantity);
    const remainingPosition = remainingQuantity > EPSILON
        ? { ...position, quantity: remainingQuantity, markPrice: input.markPrice, updatedAt: input.markTs }
        : undefined;
    return {
        strategy: position.strategy,
        symbol: position.symbol,
        side: position.side,
        markTs: input.markTs,
        markPrice: input.markPrice,
        reducedQuantity: input.reduceQuantity,
        remainingQuantity,
        remainingEntryPrice: position.entryPrice,
        realizedPnl,
        transactionCost,
        fundingCost,
        remainingNotionalUsd: remainingQuantity * input.markPrice,
        remainingPosition,
        accounting: "MARK_TO_MARKET_REALIZED_PNL",
    };
}

function trimQualityToResidual(input: {
    active: StrictPortfolioPosition[];
    quality: StrictPortfolioPosition;
    baseOtherTotalNotional: number;
    baseOtherCryptoNotional: number;
    baseIntent: StrictPortfolioIntent;
    equity: number;
    now: number;
}): { active: StrictPortfolioPosition[]; equity: number; reductions: MarkToMarketReduction[] } {
    let active = input.active;
    let equity = input.equity;
    const reductions: MarkToMarketReduction[] = [];
    const oldQualityNotional = positionNotional(input.quality);
    const markNetRate = markNetRateOnMarkNotional(input.quality, input.now);
    const strategy = input.baseIntent.strategy;
    const baseIsCrypto = isCrypto(strategy);
    const baseOtherTotalNotional = input.baseOtherTotalNotional;
    const baseOtherCryptoNotional = input.baseOtherCryptoNotional;
    const baseAllocationAtEquity = (candidateEquity: number) => {
        const e = Math.max(0.001, candidateEquity);
        const classOther = baseIsCrypto ? baseOtherCryptoNotional : Math.max(0, baseOtherTotalNotional - baseOtherCryptoNotional);
        const classCap = baseIsCrypto ? STRICT_BT33404708902.cryptoGrossCap : STRICT_BT33404708902.stockGrossCap;
        return Math.max(0, Math.min(
            input.baseIntent.gross,
            strategyCap(strategy),
            classCap - classOther / e,
            STRICT_BT33404708902.totalGrossCap - baseOtherTotalNotional / e,
        ));
    };
    let allocation = baseAllocationAtEquity(equity);
    let remainingNotional = oldQualityNotional;
    for (let iteration = 0; iteration < 128; iteration += 1) {
        const effectiveTotalCap = Math.max(0, STRICT_BT33404708902.totalGrossCap - allocation);
        const effectiveCryptoCap = Math.max(0, STRICT_BT33404708902.cryptoGrossCap - (baseIsCrypto ? allocation : 0));
        const totalLimit = remainingNotionalLimit({ equity, oldNotional: oldQualityNotional, markNetRate, existingBaseNotional: baseOtherTotalNotional, cap: effectiveTotalCap });
        const cryptoLimit = remainingNotionalLimit({ equity, oldNotional: oldQualityNotional, markNetRate, existingBaseNotional: baseOtherCryptoNotional, cap: effectiveCryptoCap });
        const nextRemaining = Math.min(oldQualityNotional, totalLimit, cryptoLimit, STRICT_BT33404708902.quality102PositionCap * equity);
        const nextEquity = Math.max(0.001, equity + (oldQualityNotional - nextRemaining) * markNetRate);
        const nextAllocation = baseAllocationAtEquity(nextEquity);
        if (Math.abs(nextRemaining - remainingNotional) <= Math.max(1e-8, oldQualityNotional * 1e-12) && Math.abs(nextAllocation - allocation) <= 1e-12) {
            remainingNotional = nextRemaining;
            allocation = nextAllocation;
            break;
        }
        remainingNotional = nextRemaining;
        allocation = nextAllocation;
    }
    const finalPredictedEquity = Math.max(0.001, equity + (oldQualityNotional - remainingNotional) * markNetRate);
    const finalAllocation = baseAllocationAtEquity(finalPredictedEquity);
    if (Math.abs(finalAllocation - allocation) > 1e-8) throw new Error("QUALITY102_BASE_MTM_SOLVER_DRIFT");
    const trimQuantity = (oldQualityNotional - remainingNotional) / input.quality.markPrice;
    if (trimQuantity <= EPSILON) return { active, equity, reductions };
    const currentQuality = active.find((row) => row.id === input.quality.id);
    if (!currentQuality) return { active, equity, reductions };
    const reduction = markToMarketReducePosition({
        position: currentQuality,
        reduceQuantity: Math.min(currentQuality.quantity, trimQuantity),
        markPrice: currentQuality.markPrice,
        markTs: input.now,
        feeBpsPerSide: currentQuality.feeBpsPerSide,
        fundingPerDay: currentQuality.fundingPerDay,
    });
    reductions.push(reduction);
    equity = Math.max(0.001, equity + reduction.realizedPnl);
    active = active
        .filter((row) => row.id !== currentQuality.id)
        .concat(reduction.remainingPosition ? [reduction.remainingPosition] : []);
    return { active, equity, reductions };
}

/**
 * Build an order plan only. It does not call an exchange client or mutate
 * state. Base strategies are admitted before Quality102; Quality102 intents
 * are rejected until a live selector manifest proves parity.
 */
export function planStrictPortfolio(input: {
    equity: number;
    now: number;
    active: StrictPortfolioPosition[];
    intents: StrictPortfolioIntent[];
    maxDataAgeMs?: number;
}): StrictPortfolioPlan {
    const equity = positive(input.equity, "portfolio equity");
    if (!Number.isFinite(input.now) || input.now <= 0) return rejectPlan("INVALID_DECISION_TIMESTAMP", input.active, equity);
    const maxDataAgeMs = nonNegative(input.maxDataAgeMs ?? 5 * 60_000, "maximum data age");
    const ids = new Set<string>();
    for (const row of input.active) {
        if (!row.id || !row.id.trim()) return rejectPlan("MISSING_MANAGED_POSITION_ID", input.active, equity);
        if (ids.has(row.id)) return rejectPlan("DUPLICATE_MANAGED_POSITION", input.active, equity);
        ids.add(row.id);
        if (!Number.isFinite(row.entryTs) || row.entryTs <= 0 || row.entryTs > input.now) return rejectPlan("INVALID_ENTRY_TIMESTAMP", input.active, equity);
        if (!Number.isFinite(row.updatedAt) || row.updatedAt > input.now || input.now - row.updatedAt > maxDataAgeMs) return rejectPlan("STALE_MARK_PRICE", input.active, equity);
        if (!row.symbol || !Number.isFinite(row.quantity) || row.quantity <= 0 || !Number.isFinite(row.entryPrice) || row.entryPrice <= 0 || !Number.isFinite(row.markPrice) || row.markPrice <= 0) return rejectPlan("INVALID_MANAGED_POSITION", input.active, equity);
        if (row.side !== "LONG" && row.side !== "SHORT") return rejectPlan("INVALID_POSITION_SIDE", input.active, equity);
        if (!isCrypto(row.strategy) && !isStock(row.strategy)) return rejectPlan("UNKNOWN_STRATEGY_OWNERSHIP", input.active, equity);
        if (!strategySymbolMatches(row.strategy, row.symbol)) return rejectPlan("SYMBOL_STRATEGY_MISMATCH", input.active, equity);
    }
    const activeQuality = input.active.filter((row) => row.strategy === "QUALITY102");
    if (activeQuality.length > 1) return rejectPlan("QUALITY102_ONE_SLOT_VIOLATION", input.active, equity);
    if (input.active.filter((row) => row.strategy === "V12").length > STRICT_BT33404708902.v12MaximumPositions) {
        return rejectPlan("V12_SLOT_OCCUPIED_NO_PREEMPTION", input.active, equity);
    }
    if (activeQuality.some((row) => grossForNotional(positionNotional(row), equity) > STRICT_BT33404708902.quality102PositionCap + EPSILON)) {
        return rejectPlan("QUALITY102_GROSS_OVER_CAP", input.active, equity);
    }
    const initialTotals = planTotals(input.active, [], equity);
    if (grossForNotional(sumNotional(input.active, (row) => row.strategy === "V12"), equity) > STRICT_BT33404708902.v12MaximumGross + EPSILON) return rejectPlan("V12_GROSS_OVER_CAP", input.active, equity);
    if (grossForNotional(sumNotional(input.active, (row) => row.strategy === "PENGU_DUAL_LS_V2"), equity) > STRICT_BT33404708902.penguMaximumGross + EPSILON) return rejectPlan("PENGU_GROSS_OVER_CAP", input.active, equity);
    if (initialTotals.cryptoGross > STRICT_BT33404708902.cryptoGrossCap + EPSILON) return rejectPlan("CRYPTO_GROSS_OVER_CAP", input.active, equity);
    if (initialTotals.totalGross > STRICT_BT33404708902.totalGrossCap + EPSILON) return rejectPlan("TOTAL_GROSS_OVER_CAP", input.active, equity);
    if (initialTotals.stockGross > STRICT_BT33404708902.stockGrossCap + EPSILON) return rejectPlan("STOCK_GROSS_OVER_CAP", input.active, equity);

    const accepted: StrictPortfolioIntent[] = [];
    const rejected: Array<{ intent: StrictPortfolioIntent; reason: string }> = [];
    const reductions: MarkToMarketReduction[] = [];
    let active = [...input.active];
    let workingEquity = equity;
    const seenIntentKeys = new Set<string>();
    const ordered = [...input.intents].sort((a, b) => {
        const baseRank = (strategy: StrictStrategy) => strategy === "QUALITY102" ? 4 : strategy === "V52" ? 1 : strategy === "PENGU_DUAL_LS_V2" ? 2 : 3;
        return baseRank(a.strategy) - baseRank(b.strategy) || a.signalTs - b.signalTs || a.idempotencyKey.localeCompare(b.idempotencyKey);
    });
    for (const intent of ordered) {
        if (seenIntentKeys.has(intent.idempotencyKey)) { rejected.push({ intent, reason: "DUPLICATE_INTENT" }); continue; }
        seenIntentKeys.add(intent.idempotencyKey);
        if (intent.strategy === "QUALITY102") { rejected.push({ intent, reason: "QUALITY102_LIVE_BLOCKED_FAIL_CLOSED" }); continue; }
        if (!strategySymbolMatches(intent.strategy, intent.symbol)) { rejected.push({ intent, reason: "UNKNOWN_OR_SLEEVE_MISMATCH" }); continue; }
        if (!intent.idempotencyKey.trim() || !intent.symbol.trim() || (intent.side !== "LONG" && intent.side !== "SHORT") || !Number.isFinite(intent.signalTs) || intent.signalTs <= 0 || intent.signalTs > input.now || !Number.isFinite(intent.gross) || intent.gross <= 0 || !Number.isFinite(intent.notionalUsd) || intent.notionalUsd <= 0) { rejected.push({ intent, reason: "INVALID_INTENT" }); continue; }
        const baseOtherTotalNotional = sumNotional(active, (row) => row.strategy !== "QUALITY102") + accepted.reduce((sum, row) => sum + row.notionalUsd, 0);
        const baseOtherCryptoNotional = sumNotional(active, (row) => row.strategy !== "QUALITY102" && isCrypto(row.strategy)) + accepted.filter((row) => isCrypto(row.strategy)).reduce((sum, row) => sum + row.notionalUsd, 0);
        const baseOtherStockNotional = sumNotional(active, (row) => row.strategy !== "QUALITY102" && isStock(row.strategy)) + accepted.filter((row) => isStock(row.strategy)).reduce((sum, row) => sum + row.notionalUsd, 0);
        const perStrategyGross = strategyCap(intent.strategy);
        const classResidual = isCrypto(intent.strategy)
            ? STRICT_BT33404708902.cryptoGrossCap - baseOtherCryptoNotional / workingEquity
            : STRICT_BT33404708902.stockGrossCap - baseOtherStockNotional / workingEquity;
        const totalResidual = STRICT_BT33404708902.totalGrossCap - baseOtherTotalNotional / workingEquity;
        const targetGross = Math.max(0, Math.min(intent.gross, perStrategyGross, classResidual, totalResidual));
        if (targetGross <= EPSILON) { rejected.push({ intent, reason: "CAPACITY_BLOCKED" }); continue; }
        const currentQuality = active.find((row) => row.strategy === "QUALITY102");
        if (currentQuality) {
            const trim = trimQualityToResidual({
                active,
                quality: currentQuality,
                baseOtherTotalNotional,
                baseOtherCryptoNotional,
                baseIntent: intent,
                equity: workingEquity,
                now: input.now,
            });
            active = trim.active;
            workingEquity = trim.equity;
            reductions.push(...trim.reductions);
        }
        const finalClassOther = isCrypto(intent.strategy) ? baseOtherCryptoNotional : baseOtherStockNotional;
        const finalClassCap = isCrypto(intent.strategy) ? STRICT_BT33404708902.cryptoGrossCap : STRICT_BT33404708902.stockGrossCap;
        const finalGross = Math.max(0, Math.min(
            intent.gross,
            perStrategyGross,
            finalClassCap - finalClassOther / workingEquity,
            STRICT_BT33404708902.totalGrossCap - baseOtherTotalNotional / workingEquity,
        ));
        if (finalGross <= EPSILON) {
            rejected.push({ intent, reason: "CAPACITY_BLOCKED_AFTER_MTM" });
            continue;
        }
        accepted.push({ ...intent, gross: finalGross, notionalUsd: finalGross * workingEquity });
        if (intent.strategy === "V12" && active.filter((row) => row.strategy === "V12").length + accepted.filter((row) => row.strategy === "V12").length > STRICT_BT33404708902.v12MaximumPositions) {
            accepted.pop();
            rejected.push({ intent, reason: "V12_SLOT_OCCUPIED_NO_PREEMPTION" });
        }
    }
    const totals = planTotals(active, accepted, workingEquity);
    if (totals.cryptoGross > STRICT_BT33404708902.cryptoGrossCap + EPSILON) return rejectPlan("CRYPTO_GROSS_OVER_CAP_AFTER_PLANNING", active, workingEquity);
    if (totals.totalGross > STRICT_BT33404708902.totalGrossCap + EPSILON) return rejectPlan("TOTAL_GROSS_OVER_CAP_AFTER_PLANNING", active, workingEquity);
    if (totals.stockGross > STRICT_BT33404708902.stockGrossCap + EPSILON) return rejectPlan("STOCK_GROSS_OVER_CAP_AFTER_PLANNING", active, workingEquity);
    return { status: "planned", accepted, rejected, reductions, activePositions: active, equityAfterReductions: workingEquity, totals };
}
