import {
    DISDEX_V11_EQ_CONFIG,
    DISDEX_V13D_V11EQ_V96_ALLOCATION,
    DISDEX_V13D_V11EQ_V96_RUNTIME,
    DISDEX_V13D_CONFIG,
} from "@/config/disdexStockRouterV13DV11EqRuntime";

export type StockSymbol = (typeof DISDEX_V13D_CONFIG.universe)[number];
export type V13DDecision = { eligible: boolean; completedMakerFill: boolean; completedHedge: boolean; symbol?: StockSymbol; reason?: string };
export type V11ExecutionSnapshot = {
    symbol: StockSymbol;
    absoluteBasisBps: number;
    estimatedRoundTripCostBps: number;
    estimatedNetEdgeBps: number;
    dataAgeMs: number;
    sourceClockDifferenceMs: number;
    depthMultiple: number;
    currentSpreadBps: number;
    spreadToThirtySecondMedianMultiple: number;
    adverseTwoSecondMoveBps: number;
    adverseBasisMoveBps: number;
    stillTop1: boolean;
    sourceFallbackUsed: boolean;
    stockSleeveOccupied: boolean;
    dailyLossLocked: boolean;
    killSwitchActive: boolean;
};
export type V11EqGateResult = { accepted: boolean; reasons: string[] };
export type StockRouterDecision =
    | { action: "HOLD_CASH"; strategy: "NONE"; reasons: string[] }
    | { action: "OPEN"; strategy: "V13D"; symbol: StockSymbol; reasons: string[] }
    | { action: "OPEN"; strategy: "V11_EQ"; symbol: StockSymbol; reasons: string[] };
export type LiveOrderSubmissionInput = {
    runnerMode: "paper" | "live";
    environmentLiveExecutionEnabled: boolean;
    acknowledgement?: string;
    credentialsReady: boolean;
    preflightPassed: boolean;
    killSwitchActive: boolean;
};

export function evaluateV11EqGate(snapshot: V11ExecutionSnapshot): V11EqGateResult {
    const reasons: string[] = [];
    const cfg = DISDEX_V11_EQ_CONFIG;
    if (snapshot.stockSleeveOccupied) reasons.push("STOCK_SLEEVE_OCCUPIED");
    if (snapshot.dailyLossLocked) reasons.push("DAILY_LOSS_LOCKED");
    if (snapshot.killSwitchActive) reasons.push("KILL_SWITCH_ACTIVE");
    if (snapshot.sourceFallbackUsed) reasons.push("SOURCE_FALLBACK_USED");
    if (snapshot.absoluteBasisBps < cfg.minimumAbsoluteCashAsterBasisBps) reasons.push("BASIS_BELOW_MINIMUM");
    if (snapshot.dataAgeMs > cfg.maximumDataAgeMs) reasons.push("STALE_MARKET_DATA");
    if (snapshot.sourceClockDifferenceMs > cfg.maximumSourceClockDifferenceMs) reasons.push("SOURCE_CLOCK_MISMATCH");
    if (snapshot.estimatedRoundTripCostBps > cfg.maximumEstimatedRoundTripCostBps) reasons.push("ROUND_TRIP_COST_TOO_HIGH");
    if (snapshot.absoluteBasisBps <= 0 || snapshot.estimatedRoundTripCostBps / snapshot.absoluteBasisBps > cfg.maximumCostToEntryBasisRatio) {
        reasons.push("COST_TO_BASIS_RATIO_TOO_HIGH");
    }
    if (snapshot.estimatedNetEdgeBps < cfg.minimumEstimatedNetEdgeBps) reasons.push("NET_EDGE_TOO_LOW");
    if (snapshot.depthMultiple < cfg.minimumDepthMultiple) reasons.push("INSUFFICIENT_DEPTH");
    if (snapshot.currentSpreadBps > cfg.maximumCurrentSpreadBps) reasons.push("SPREAD_TOO_WIDE");
    if (snapshot.spreadToThirtySecondMedianMultiple > cfg.maximumSpreadToThirtySecondMedianMultiple) reasons.push("SPREAD_EXPANSION_TOO_HIGH");
    if (snapshot.adverseTwoSecondMoveBps > cfg.maximumAdverseTwoSecondMoveBps) reasons.push("ADVERSE_PRICE_MOVE");
    if (snapshot.adverseBasisMoveBps > cfg.maximumAdverseBasisMoveBps) reasons.push("ADVERSE_BASIS_MOVE");
    if (cfg.requireCandidateStillTop1AtEntry && !snapshot.stillTop1) reasons.push("NO_LONGER_TOP1");
    return { accepted: reasons.length === 0, reasons };
}

export function decideStockRoute(v13d: V13DDecision, v11Snapshot?: V11ExecutionSnapshot): StockRouterDecision {
    if (!v11Snapshot) {
        return { action: "HOLD_CASH", strategy: "NONE", reasons: ["V13D_DISABLED", "V11_EQ_SNAPSHOT_MISSING"] };
    }
    const gate = evaluateV11EqGate(v11Snapshot);
    if (!gate.accepted) return { action: "HOLD_CASH", strategy: "NONE", reasons: gate.reasons };
    return { action: "OPEN", strategy: "V11_EQ", symbol: v11Snapshot.symbol, reasons: ["V13D_DISABLED", "V11_EQ_GATE_PASS"] };
}

export function assertPortfolioGross(cryptoGross: number, stockGross: number): void {
    const allocation = DISDEX_V13D_V11EQ_V96_ALLOCATION;
    if (!Number.isFinite(cryptoGross) || !Number.isFinite(stockGross)) throw new Error("Gross values must be finite");
    if (cryptoGross < 0 || stockGross < 0) throw new Error("Gross values cannot be negative");
    if (cryptoGross > allocation.cryptoSleeveGrossCap + 1e-12) throw new Error(`Crypto Gross cap exceeded: ${cryptoGross}`);
    if (typeof allocation.stockSleeveGrossCap === "number" && stockGross > allocation.stockSleeveGrossCap + 1e-12) throw new Error(`Stock Gross cap exceeded: ${stockGross}`);
    if (cryptoGross + stockGross > allocation.portfolioGrossCap + 1e-12) throw new Error(`Portfolio Gross cap exceeded: ${cryptoGross + stockGross}`);
}

export function assertLiveOrderSubmissionEnabled(input: LiveOrderSubmissionInput): void {
    const reasons: string[] = [];
    if (input.runnerMode !== "live") reasons.push("runner mode is not live");
    if (!DISDEX_V13D_V11EQ_V96_RUNTIME.liveTradingEnabled || !DISDEX_V13D_V11EQ_V96_RUNTIME.orderSubmissionAllowed) reasons.push("repository runtime is not LIVE-enabled");
    if (!input.environmentLiveExecutionEnabled) reasons.push("combined live environment switch is disabled");
    if (input.acknowledgement !== DISDEX_V13D_V11EQ_V96_RUNTIME.requiredCombinedLiveAcknowledgement) reasons.push("combined live acknowledgement is invalid");
    if (!input.credentialsReady) reasons.push("venue credentials are not ready");
    if (!input.preflightPassed) reasons.push("combined preflight has not passed");
    if (input.killSwitchActive) reasons.push("Kill Switch is active");
    if (reasons.length) throw new Error(`${DISDEX_V13D_V11EQ_V96_RUNTIME.liveBlockReason} Reasons: ${reasons.join("; ")}`);
}
