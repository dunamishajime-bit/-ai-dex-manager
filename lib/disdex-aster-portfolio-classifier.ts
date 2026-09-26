import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

export type AsterPortfolioSleeve = "V12" | "PENGU_DUAL_LS_V2" | "FET_RESIDUAL" | "V11_EQ" | "V50_POST_OPEN_BASIS" | "QUALITY102_CAUSAL_V1" | "HYPE_LONG" | "ZEC_LONG" | "UNKNOWN";
export type AsterAssetClass = "CRYPTO" | "STOCK" | "UNKNOWN";

const STOCK_SYMBOLS = new Set(["AMZN", "META", "MSFT", "NVDA", "TSLA"]);
const PENGU = "PENGU";

function normalizeSymbol(symbol: string) {
    const normalized = String(symbol || "").toUpperCase().replace(/[:/_-]/g, "");
    return normalized.endsWith("USDT") ? normalized.slice(0, -4) : normalized;
}

export interface AsterClassification {
    input: string;
    symbol: string;
    assetClass: AsterAssetClass;
    sleeve: AsterPortfolioSleeve;
    tradable: boolean;
    reason: string;
}

/** Generic classifier: every frozen V12 symbol and PENGU are crypto. Unknown
 * non-flat symbols are intentionally rejected rather than guessed. */
export function classifyAsterSymbol(input: string, requestedSleeve?: AsterPortfolioSleeve): AsterClassification {
    const symbol = normalizeSymbol(input);
    if (STOCK_SYMBOLS.has(symbol)) {
        const sleeve = requestedSleeve === "V50_POST_OPEN_BASIS" ? requestedSleeve : "V11_EQ";
        return { input, symbol: `${symbol}USDT`, assetClass: "STOCK", sleeve, tradable: true, reason: "known-stock-universe" };
    }
    if (symbol === PENGU) return { input, symbol: "PENGUUSDT", assetClass: "CRYPTO", sleeve: "PENGU_DUAL_LS_V2", tradable: true, reason: "pengu-v2" };
    if (symbol === "HYPE" && requestedSleeve === "HYPE_LONG") return { input, symbol: "HYPEUSDT", assetClass: "CRYPTO", sleeve: "HYPE_LONG", tradable: true, reason: "hype-long-sidecar" };
    if (symbol === "ZEC" && requestedSleeve === "ZEC_LONG") return { input, symbol: "ZECUSDT", assetClass: "CRYPTO", sleeve: "ZEC_LONG", tradable: true, reason: "zec-long-sidecar" };
    if ((symbol === "HYPE" || symbol === "ZEC") && requestedSleeve !== undefined) return { input, symbol: `${symbol}USDT`, assetClass: "CRYPTO", sleeve: "UNKNOWN", tradable: false, reason: "sidecar-sleeve-mismatch" };
    // HYPE and ZEC are reserved for their explicit long-only sidecar owners.
    // The generic path is needed when reconciling an existing venue position;
    // callers that request another sleeve still fail closed above.
    if (symbol === "HYPE") return { input, symbol: "HYPEUSDT", assetClass: "CRYPTO", sleeve: "HYPE_LONG", tradable: true, reason: "reserved-hype-long-sidecar" };
    if (symbol === "ZEC") return { input, symbol: "ZECUSDT", assetClass: "CRYPTO", sleeve: "ZEC_LONG", tradable: true, reason: "reserved-zec-long-sidecar" };
    if (symbol === "FET" && (requestedSleeve === undefined || requestedSleeve === "FET_RESIDUAL")) return { input, symbol: "FETUSDT", assetClass: "CRYPTO", sleeve: "FET_RESIDUAL", tradable: true, reason: "fet-brk48-residual" };
    if ((V12_X1_ALL.universe as readonly string[]).includes(symbol)) return { input, symbol: `${symbol}USDT`, assetClass: "CRYPTO", sleeve: "V12", tradable: true, reason: "frozen-v12-universe" };
    return { input, symbol: symbol ? `${symbol}USDT` : "", assetClass: "UNKNOWN", sleeve: "UNKNOWN", tradable: false, reason: "unknown-symbol-fail-closed" };
}

export function classifyAsterPortfolio(symbols: string[]) {
    return symbols.map((symbol) => classifyAsterSymbol(symbol));
}

export function assertKnownAsterSymbol(symbol: string, allowFlat = false) {
    const classification = classifyAsterSymbol(symbol);
    if (!classification.tradable && !allowFlat) throw new Error(`ASTER_UNKNOWN_SYMBOL_FAIL_CLOSED:${symbol}`);
    return classification;
}
