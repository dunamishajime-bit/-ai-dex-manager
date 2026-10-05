import { FileHypeZecLongRunnerStateStore, type HypeZecLongRunnerState } from "./hype-zec-long-runner-state";
import { HYPE_ZEC_LONG_POLICY, isHypeZecStrategy, type HypeZecStrategy } from "../config/hypeZecLongPolicy";
import { classifyAsterSymbol } from "./disdex-aster-portfolio-classifier";
import type { AccountLockHandle } from "./disdex-account-order-lock";
import type { DirectPosition, DirectTradeExecutor } from "./direct-trade-executor";
import type { StrictPortfolioIntent, StrictPortfolioPosition, StrictStrategy } from "./disdex-strict-portfolio-planner";
import { buildHypeZecProtection } from "./hype-zec-long-sleeves";
import { planHypeZecPreemption } from "./hype-zec-preemption";
import { executeHypeZecPreemption, FileHypeZecPreemptionStateStore, type HypeZecPreemptionExecutionResult } from "./hype-zec-preemption-executor";
import type { V12AsterLiveAdapter } from "./v12-aster-live-adapter";

const EPSILON = 1e-9;
export function ownedHypeProtectionLevels(state:HypeZecLongRunnerState,position:DirectPosition){
 const p=state.positions?.find(p=>p.symbol===position.symbol);
 if(!p||Math.abs(p.quantity-Math.abs(position.quantity))>1e-8||!(p.stopPrice>0)||!(p.takeProfitPrice>0)||state.pending||state.manualReview)throw Error("HYPE_PRIORITY_OWNER_PROOF_REQUIRED");
 return {stopPrice:p.stopPrice,takeProfitPrice:p.takeProfitPrice};
}


export function isHypeZecSoleSharedCapacityCause(input: {
    positions: readonly DirectPosition[];
    equityUsd: number;
    pendingCryptoGross: number;
    pendingTotalGross: number;
    candidateGross: number;
    candidateSymbol: string;
    candidateStrategy: StrictStrategy;
    cryptoEntryCap: number;
    totalEntryCap: number;
}) {
    const equity = Number(input.equityUsd);
    if (!(equity > 0) || !(input.candidateGross > 0)) return false;
    let sidecarCryptoGross = 0;
    let sidecarTotalGross = 0;
    let otherCryptoGross = 0;
    let otherTotalGross = 0;
    for (const position of input.positions.filter((row) => Math.abs(row.quantity) > EPSILON)) {
        const gross = Math.abs(Number(position.notionalUsd) || position.quantity * position.markPrice) / equity;
        const sidecar = position.symbol.toUpperCase() === "HYPEUSDT" || position.symbol.toUpperCase() === "ZECUSDT";
        const classification = classifyAsterSymbol(position.symbol);
        if (classification.assetClass === "UNKNOWN") return false;
        if (sidecar) {
            sidecarTotalGross += gross;
            if (classification.assetClass === "CRYPTO") sidecarCryptoGross += gross;
        } else {
            otherTotalGross += gross;
            if (classification.assetClass === "CRYPTO") otherCryptoGross += gross;
        }
    }
    const requestedSleeve = input.candidateStrategy === "V52"
        ? "V50_POST_OPEN_BASIS"
        : input.candidateStrategy === "V50_POST_OPEN_BASIS" || input.candidateStrategy === "V11_EQ"
            ? input.candidateStrategy
        : undefined;
    const candidateAssetClass = classifyAsterSymbol(input.candidateSymbol, requestedSleeve).assetClass;
    if (candidateAssetClass !== "CRYPTO" && candidateAssetClass !== "STOCK") return false;
    const candidateCryptoGross = candidateAssetClass === "CRYPTO" ? input.candidateGross : 0;
    const withSidecarsCrypto = otherCryptoGross + sidecarCryptoGross + input.pendingCryptoGross + candidateCryptoGross;
    const withSidecarsTotal = otherTotalGross + sidecarTotalGross + input.pendingTotalGross + input.candidateGross;
    const withoutSidecarsCrypto = otherCryptoGross + input.pendingCryptoGross + candidateCryptoGross;
    const withoutSidecarsTotal = otherTotalGross + input.pendingTotalGross + input.candidateGross;
    const overWithSidecars = withSidecarsCrypto > input.cryptoEntryCap + EPSILON
        || withSidecarsTotal > input.totalEntryCap + EPSILON;
    const fitsWithoutSidecars = withoutSidecarsCrypto <= input.cryptoEntryCap + EPSILON
        && withoutSidecarsTotal <= input.totalEntryCap + EPSILON;
    return overWithSidecars && fitsWithoutSidecars && (sidecarCryptoGross > 0 || sidecarTotalGross > 0);
}

function sidecarStrategy(symbol: string): HypeZecStrategy | undefined {
    const normalized = symbol.toUpperCase();
    if (normalized === "HYPEUSDT") return "HYPE_LONG";
    if (normalized === "ZECUSDT") return "ZEC_LONG";
    return undefined;
}

function strictSidecarPosition(position: DirectPosition, now: number): StrictPortfolioPosition | undefined {
    const strategy = sidecarStrategy(position.symbol);
    if (!strategy || position.quantity <= EPSILON || position.positionSide === "SHORT") return undefined;
    return {
        id: `aster:${position.symbol.toUpperCase()}:${position.positionSide}`,
        strategy,
        symbol: position.symbol.toUpperCase(),
        side: "LONG",
        quantity: Math.abs(position.quantity),
        entryPrice: position.entryPrice,
        markPrice: position.markPrice,
        entryTs: Math.min(Math.max(1, position.updatedAt), now),
        updatedAt: position.updatedAt,
        markSource: "LIVE_MARKET_QUOTE",
        markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: position.updatedAt, price: position.markPrice, crossChecked: true },
    };
}

function grossClass(position: DirectPosition, equity: number) {
    const classification = classifyAsterSymbol(position.symbol);
    return {
        gross: Math.abs(position.notionalUsd) / equity,
        crypto: classification.assetClass === "CRYPTO",
        known: classification.assetClass !== "UNKNOWN",
    };
}

function marginType(value: unknown, isolated: unknown): "cross" | "isolated" | "unknown" {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "cross" || normalized === "crossed") return "cross";
    if (normalized === "isolated" || normalized === "isolate") return "isolated";
    if (isolated === false) return "cross";
    if (isolated === true) return "isolated";
    return "unknown";
}

function lockWithDocument(value: unknown): Pick<AccountLockHandle, "document"> | undefined {
    if (!value || typeof value !== "object" || typeof (value as { document?: unknown }).document !== "function") return undefined;
    return { document: (value as { document: AccountLockHandle["document"] }).document.bind(value) };
}

export type HypeZecPriorityCapacityResult =
    | { status: "not-needed"; message: string; result?: HypeZecPreemptionExecutionResult }
    | { status: "reduced"; message: string; result: HypeZecPreemptionExecutionResult }
    | { status: "blocked"; message: string; result?: HypeZecPreemptionExecutionResult };

/**
 * Shared admission hook for higher-priority entries. It performs no action
 * when a candidate fits. When it does need capacity, it plans and executes
 * only the explicitly-owned HYPE/ZEC reductions under the caller's account
 * lock, then requires a fresh planner pass before the caller may enter.
 */
export async function releaseHypeZecCapacityForPriorityEntry(input: {
    adapter: V12AsterLiveAdapter;
    executor: DirectTradeExecutor;
    lock?: unknown;
    positions: DirectPosition[];
    equityUsd: number;
    candidate: StrictPortfolioIntent;
    pendingCryptoGross?: number;
    pendingTotalGross?: number;
    cryptoEntryCap: number;
    totalEntryCap: number;
    causeIdempotencyKey: string;
    expectedRuntimeSha?: string;
    enabled?: boolean;
    statePath?: string;
    maxSlippageBps?: number;
    now?: () => number;
}): Promise<HypeZecPriorityCapacityResult> {
    const now = input.now || Date.now;
    const equity = Number(input.equityUsd);
    if (!(equity > 0)) return { status: "blocked", message: "HYPE_ZEC_PREEMPTION_EQUITY_INVALID" };
    const active = input.positions.filter((position) => Math.abs(position.quantity) > EPSILON);
    const current = active.map((position) => grossClass(position, equity));
    if (current.some((row) => !row.known)) return { status: "blocked", message: "HYPE_ZEC_PREEMPTION_UNKNOWN_ACTIVE_POSITION" };
    const activeSidecars = active.map((position) => strictSidecarPosition(position, now())).filter((value): value is StrictPortfolioPosition => Boolean(value));
    const plan = planHypeZecPreemption({
        equityUsd: equity,
        now: now(),
        currentCryptoGross: current.filter((row) => row.crypto).reduce((sum, row) => sum + row.gross, 0),
        currentTotalGross: current.reduce((sum, row) => sum + row.gross, 0),
        pendingCryptoGross: input.pendingCryptoGross,
        pendingTotalGross: input.pendingTotalGross,
        cryptoEntryCap: input.cryptoEntryCap,
        totalEntryCap: input.totalEntryCap,
        active: activeSidecars,
        candidate: input.candidate,
    });
    if (plan.status === "not-needed") return { status: "not-needed", message: plan.reason };
    if (plan.status !== "planned") return { status: "blocked", message: plan.reason };
    if (input.enabled !== true) return { status: "blocked", message: "HYPE_ZEC_PREEMPTION_OPERATOR_DISABLED" };
    const lock = lockWithDocument(input.lock);
    if (!lock) return { status: "blocked", message: "HYPE_ZEC_PREEMPTION_ACCOUNT_LOCK_REQUIRED" };
    const expectedRuntimeSha = String(input.expectedRuntimeSha || process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA || "").trim();
    if (!/^[0-9a-f]{40}$/i.test(expectedRuntimeSha)) return { status: "blocked", message: "HYPE_ZEC_PREEMPTION_RUNTIME_SHA_REQUIRED" };

    const ownerStore=new FileHypeZecLongRunnerStateStore(process.env.DISDEX_HYPE_ZEC_STATE_PATH,expectedRuntimeSha,"LIVE");
    let ownerState:HypeZecLongRunnerState;
    try{ownerState=await ownerStore.load();for(const position of active.filter(p=>plan.reductions.some(r=>r.symbol===p.symbol)))ownedHypeProtectionLevels(ownerState,position);}catch(error){return {status:"blocked",message:"HYPE_PRIORITY_OWNER_STATE:"+(error instanceof Error?error.message:String(error))};}
    let exchangeInfo;
    try { exchangeInfo = await input.adapter.client.getExchangeInfo(); } catch (error) { return { status: "blocked", message: `HYPE_ZEC_PREEMPTION_EXCHANGE_INFO_UNAVAILABLE:${error instanceof Error ? error.message : String(error)}` }; }
    const protection: Partial<Record<HypeZecStrategy, { stopPrice: number; takeProfitPrice: number; tickSize: number; stepSize: number }>> = {};
    for (const position of active) {
        const strategy = sidecarStrategy(position.symbol);
        if (!strategy || !plan.reductions.some((row) => row.strategy === strategy)) continue;
        const exchangeSymbol = exchangeInfo.symbols.find((row) => row.symbol.toUpperCase() === position.symbol.toUpperCase());
        const priceFilter = exchangeSymbol?.filters?.find((row) => row.filterType === "PRICE_FILTER");
        const quantityFilter = exchangeSymbol?.filters?.find((row) => row.filterType === "LOT_SIZE");
        const tickSize = Number(priceFilter?.tickSize);
        const stepSize = Number(quantityFilter?.stepSize);
        if (!(tickSize > 0) || !(stepSize > 0)) return { status: "blocked", message: `HYPE_ZEC_PREEMPTION_FILTERS_UNAVAILABLE:${position.symbol}` };
        const existing=ownedHypeProtectionLevels(ownerState,position);
        const levels = buildHypeZecProtection({ strategy, entryPrice: position.entryPrice, tickSize, quantity: Math.abs(position.quantity), stepSize, stopPriceOverride:existing.stopPrice,takeProfitPriceOverride:existing.takeProfitPrice });
        protection[strategy] = { stopPrice: levels.stopPrice, takeProfitPrice: levels.takeProfitPrice, tickSize, stepSize };
    }
    const result = await executeHypeZecPreemption({
        plan,
        executor: input.executor,
        adapter: input.adapter,
        lock,
        stateStore: new FileHypeZecPreemptionStateStore(input.statePath, expectedRuntimeSha),
        expectedRuntimeSha,
        causeIdempotencyKey: input.causeIdempotencyKey,
        protection,
        maxSlippageBps: input.maxSlippageBps,
        now,
        readVenueRisk: async (symbol) => {
            const rows = await input.adapter.client.getPositions(symbol.toUpperCase());
            const row = rows.find((candidate) => candidate.symbol.toUpperCase() === symbol.toUpperCase());
            if (!row) return { leverage: 0, marginType: "unknown" as const };
            return { leverage: Number(row.leverage), marginType: marginType(row.marginType, row.isolated) };
        },
    });
    if (result.status === "reduced") {
        try{
            const orders=await input.executor.getOpenOrders();
            for(const r of result.results){const p=ownerState.positions!.find(p=>p.symbol===r.reduction.symbol)!;const legs=orders.filter(o=>o.symbol===p.symbol&&o.reduceOnly&&o.side==="SELL"&&Math.abs(o.quantity-r.remainingQuantity)<=1e-8);const stop=legs.filter(o=>o.type==="STOP_MARKET"),tp=legs.filter(o=>o.type==="TAKE_PROFIT_MARKET");if(stop.length!==1||tp.length!==1||Math.abs(Number(stop[0].stopPrice)-p.stopPrice)>Math.max(1e-8,p.stopPrice*1e-9)||Math.abs(Number(tp[0].stopPrice)-p.takeProfitPrice)>Math.max(1e-8,p.takeProfitPrice*1e-9))throw Error("HYPE_PRIORITY_OWNER_REPLACEMENT_PROOF");p.quantity=r.remainingQuantity;p.stopClientOrderId=stop[0].clientOrderId;p.takeProfitClientOrderId=tp[0].clientOrderId;p.stopOrderId=stop[0].orderId;p.stopReadBackAt=now();p.updatedAt=now();}
            await ownerStore.save(ownerState);
        }catch(error){return {status:"blocked",message:"HYPE_PRIORITY_OWNER_RECONCILIATION:"+(error instanceof Error?error.message:String(error)),result};}
        return {status:"reduced",message:result.message,result};
    }
    return { status: result.status === "not-needed" ? "not-needed" : "blocked", message: result.message, result };
}
