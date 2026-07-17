import { privateKeyToAccount } from "viem/accounts";

export type AsterHttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type AsterOrderSide = "BUY" | "SELL";
export type AsterPositionSide = "BOTH" | "LONG" | "SHORT";

export interface AsterV3ClientOptions {
    baseUrl?: string;
    userAddress?: string;
    privateKey?: `0x${string}`;
    requestTimeoutMs?: number;
    recvWindowMs?: number;
    fetchImpl?: typeof fetch;
    userAgent?: string;
}

export interface AsterExchangeFilter {
    filterType: string;
    minPrice?: string;
    maxPrice?: string;
    tickSize?: string;
    minQty?: string;
    maxQty?: string;
    stepSize?: string;
    notional?: string;
    limit?: number;
}

export interface AsterExchangeSymbol {
    symbol: string;
    pair?: string;
    status?: string;
    contractType?: string;
    baseAsset?: string;
    quoteAsset?: string;
    pricePrecision?: number;
    quantityPrecision?: number;
    filters?: AsterExchangeFilter[];
    orderTypes?: string[];
}

export interface AsterExchangeInfo {
    serverTime?: number;
    timezone?: string;
    symbols: AsterExchangeSymbol[];
}

export interface AsterPriceTicker {
    symbol: string;
    price: string;
    time?: number;
}

export interface AsterBookTicker {
    symbol: string;
    bidPrice: string;
    bidQty: string;
    askPrice: string;
    askQty: string;
    time?: number;
}

export interface Aster24hTicker {
    symbol: string;
    priceChange?: string;
    priceChangePercent?: string;
    lastPrice?: string;
    volume?: string;
    quoteVolume?: string;
    openTime?: number;
    closeTime?: number;
}

export type AsterKline = [
    number,
    string,
    string,
    string,
    string,
    string,
    number,
    string,
    number,
    string,
    string,
    string,
];

export interface AsterBalanceRow {
    asset: string;
    balance?: string;
    crossWalletBalance?: string;
    availableBalance?: string;
    maxWithdrawAmount?: string;
    updateTime?: number;
}

export interface AsterPositionRiskRow {
    symbol: string;
    positionAmt: string;
    entryPrice: string;
    markPrice: string;
    unRealizedProfit?: string;
    unrealizedProfit?: string;
    positionSide?: AsterPositionSide;
    leverage?: string;
    updateTime?: number;
}

export interface AsterOrderResponse {
    symbol: string;
    orderId?: number;
    clientOrderId?: string;
    status?: string;
    side?: AsterOrderSide;
    positionSide?: AsterPositionSide;
    type?: string;
    reduceOnly?: boolean;
    origQty?: string;
    executedQty?: string;
    cumQuote?: string;
    avgPrice?: string;
    updateTime?: number;
    code?: number;
    msg?: string;
}

export interface AsterNewMarketOrder {
    symbol: string;
    side: AsterOrderSide;
    quantity: string;
    positionSide?: AsterPositionSide;
    reduceOnly?: boolean;
    newClientOrderId: string;
    newOrderRespType?: "ACK" | "RESULT";
}

export class AsterApiError extends Error {
    readonly status: number;
    readonly code?: number;
    readonly retryAfterMs?: number;
    readonly executionUnknown: boolean;
    readonly responseBody?: unknown;

    constructor(input: {
        message: string;
        status: number;
        code?: number;
        retryAfterMs?: number;
        executionUnknown?: boolean;
        responseBody?: unknown;
    }) {
        super(input.message);
        this.name = "AsterApiError";
        this.status = input.status;
        this.code = input.code;
        this.retryAfterMs = input.retryAfterMs;
        this.executionUnknown = input.executionUnknown === true;
        this.responseBody = input.responseBody;
    }
}

function normalizeBaseUrl(value?: string) {
    return String(value || "https://fapi3.asterdex.com").replace(/\/+$/, "");
}

function normalizePrivateKey(value?: string): `0x${string}` | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
        throw new Error("ASTER_API_PRIVATE_KEY must be a 32-byte hex private key.");
    }
    return normalized as `0x${string}`;
}

function valueToString(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
        return String(value);
    }
    return JSON.stringify(value);
}

function encodeParams(params: Record<string, unknown>) {
    const encoded = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        encoded.append(key, valueToString(value));
    }
    return encoded.toString();
}

function parseJsonSafe(text: string): unknown {
    if (!text) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function parseErrorCode(payload: unknown): number | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const value = Number((payload as { code?: unknown }).code);
    return Number.isFinite(value) ? value : undefined;
}

function parseErrorMessage(payload: unknown, fallback: string) {
    if (!payload || typeof payload !== "object") return fallback;
    const value = (payload as { msg?: unknown; message?: unknown }).msg
        ?? (payload as { message?: unknown }).message;
    return typeof value === "string" && value ? value : fallback;
}

function retryAfterFromHeaders(headers: Headers): number | undefined {
    const raw = headers.get("retry-after");
    if (!raw) return undefined;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const timestamp = Date.parse(raw);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

class MonotonicMicrosecondNonce {
    private last = 0n;

    next() {
        const now = BigInt(Date.now()) * 1000n;
        this.last = now > this.last ? now : this.last + 1n;
        return this.last.toString();
    }
}

export class AsterV3Client {
    readonly baseUrl: string;
    readonly signerAddress?: `0x${string}`;
    private readonly userAddress?: string;
    private readonly account?: ReturnType<typeof privateKeyToAccount>;
    private readonly timeoutMs: number;
    private readonly recvWindowMs: number;
    private readonly fetchImpl: typeof fetch;
    private readonly userAgent: string;
    private readonly nonce = new MonotonicMicrosecondNonce();

    constructor(options: AsterV3ClientOptions = {}) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.userAddress = options.userAddress?.trim();
        const privateKey = normalizePrivateKey(options.privateKey);
        this.account = privateKey ? privateKeyToAccount(privateKey) : undefined;
        this.signerAddress = this.account?.address;
        this.timeoutMs = Math.max(1000, options.requestTimeoutMs ?? 10_000);
        this.recvWindowMs = Math.min(5000, Math.max(1000, options.recvWindowMs ?? 5000));
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.userAgent = options.userAgent || "DisDex-Win80-LiveRunner/1.0";
    }

    hasTradingCredentials() {
        return Boolean(this.account && this.signerAddress && this.userAddress);
    }

    private async signParams(params: Record<string, unknown>) {
        if (!this.account || !this.signerAddress || !this.userAddress) {
            throw new Error("Aster V3 signed request requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
        }
        const signedParams: Record<string, unknown> = {
            ...params,
            recvWindow: params.recvWindow ?? this.recvWindowMs,
            nonce: this.nonce.next(),
            user: this.userAddress,
            signer: this.signerAddress,
        };
        const message = encodeParams(signedParams);
        const signature = await this.account.signTypedData({
            domain: {
                name: "AsterSignTransaction",
                version: "1",
                chainId: 1666,
                verifyingContract: "0x0000000000000000000000000000000000000000",
            },
            types: {
                Message: [{ name: "msg", type: "string" }],
            },
            primaryType: "Message",
            message: { msg: message },
        });
        return { signedParams, signature };
    }

    private async request<T>(input: {
        method: AsterHttpMethod;
        path: string;
        params?: Record<string, unknown>;
        signed?: boolean;
        orderMutation?: boolean;
    }): Promise<T> {
        const method = input.method;
        const params = input.params || {};
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), this.timeoutMs);
        try {
            let query = "";
            let body: string | undefined;
            if (input.signed) {
                const signed = await this.signParams(params);
                const payload = encodeParams({ ...signed.signedParams, signature: signed.signature });
                if (method === "GET") query = payload;
                else body = payload;
            } else {
                const payload = encodeParams(params);
                if (method === "GET") query = payload;
                else body = payload;
            }

            const url = `${this.baseUrl}${input.path}${query ? `?${query}` : ""}`;
            const response = await this.fetchImpl(url, {
                method,
                body,
                signal: abort.signal,
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                    "user-agent": this.userAgent,
                },
                cache: "no-store",
            });
            const text = await response.text();
            const payload = parseJsonSafe(text);
            if (!response.ok) {
                const executionUnknown = response.status === 503 && input.orderMutation === true;
                throw new AsterApiError({
                    message: parseErrorMessage(payload, `Aster HTTP ${response.status}`),
                    status: response.status,
                    code: parseErrorCode(payload),
                    retryAfterMs: retryAfterFromHeaders(response.headers),
                    executionUnknown,
                    responseBody: payload,
                });
            }
            return payload as T;
        } catch (error) {
            if (error instanceof AsterApiError) throw error;
            if (error instanceof Error && error.name === "AbortError") {
                throw new AsterApiError({
                    message: `Aster request timeout after ${this.timeoutMs}ms`,
                    status: 0,
                    executionUnknown: input.orderMutation === true,
                });
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    ping() {
        return this.request<Record<string, never>>({ method: "GET", path: "/fapi/v3/ping" });
    }

    getServerTime() {
        return this.request<{ serverTime: number }>({ method: "GET", path: "/fapi/v3/time" });
    }

    getExchangeInfo() {
        return this.request<AsterExchangeInfo>({ method: "GET", path: "/fapi/v3/exchangeInfo" });
    }

    getPriceTickers(symbol?: string) {
        return this.request<AsterPriceTicker | AsterPriceTicker[]>({
            method: "GET",
            path: "/fapi/v3/ticker/price",
            params: symbol ? { symbol } : undefined,
        });
    }

    getBookTickers(symbol?: string) {
        return this.request<AsterBookTicker | AsterBookTicker[]>({
            method: "GET",
            path: "/fapi/v3/ticker/bookTicker",
            params: symbol ? { symbol } : undefined,
        });
    }

    get24hTickers(symbol?: string) {
        return this.request<Aster24hTicker | Aster24hTicker[]>({
            method: "GET",
            path: "/fapi/v3/ticker/24hr",
            params: symbol ? { symbol } : undefined,
        });
    }

    getKlines(symbol: string, interval: string, limit = 200) {
        return this.request<AsterKline[]>({
            method: "GET",
            path: "/fapi/v3/klines",
            params: { symbol, interval, limit },
        });
    }

    getBalances() {
        return this.request<AsterBalanceRow[]>({
            method: "GET",
            path: "/fapi/v3/balance",
            signed: true,
        });
    }

    getPositions(symbol?: string) {
        return this.request<AsterPositionRiskRow[]>({
            method: "GET",
            path: "/fapi/v3/positionRisk",
            params: symbol ? { symbol } : undefined,
            signed: true,
        });
    }

    getOpenOrders(symbol?: string) {
        return this.request<AsterOrderResponse[]>({
            method: "GET",
            path: "/fapi/v3/openOrders",
            params: symbol ? { symbol } : undefined,
            signed: true,
        });
    }

    getOrder(symbol: string, clientOrderId: string) {
        return this.request<AsterOrderResponse>({
            method: "GET",
            path: "/fapi/v3/order",
            params: { symbol, origClientOrderId: clientOrderId },
            signed: true,
        });
    }

    placeMarketOrder(order: AsterNewMarketOrder) {
        return this.request<AsterOrderResponse>({
            method: "POST",
            path: "/fapi/v3/order",
            params: {
                symbol: order.symbol,
                side: order.side,
                type: "MARKET",
                quantity: order.quantity,
                positionSide: order.positionSide || "BOTH",
                reduceOnly: order.reduceOnly === true ? "true" : "false",
                newClientOrderId: order.newClientOrderId,
                newOrderRespType: order.newOrderRespType || "RESULT",
            },
            signed: true,
            orderMutation: true,
        });
    }
}
