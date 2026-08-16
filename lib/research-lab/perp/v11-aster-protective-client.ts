import { privateKeyToAccount } from "viem/accounts";

export interface V11AsterProtectiveClientOptions {
  baseUrl?: string;
  userAddress: string;
  privateKey: `0x${string}`;
  recvWindowMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface V11AsterPositionModeResponse {
  dualSidePosition: boolean;
}

export interface V11AsterProtectiveOrderResponse {
  symbol: string;
  orderId?: number;
  clientOrderId?: string;
  status?: string;
  side?: "BUY" | "SELL";
  positionSide?: "BOTH" | "LONG" | "SHORT";
  type?: string;
  origType?: string;
  reduceOnly?: boolean;
  stopPrice?: string;
  origQty?: string;
  executedQty?: string;
  updateTime?: number;
  code?: number;
  msg?: string;
}

export interface V11AsterStopMarketOrder {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  stopPrice: string;
  newClientOrderId: string;
  workingType?: "CONTRACT_PRICE" | "MARK_PRICE";
  priceProtect?: boolean;
}

export class V11AsterProtectiveApiError extends Error {
  readonly status: number;
  readonly executionUnknown: boolean;
  readonly responseBody?: unknown;

  constructor(message: string, status: number, executionUnknown: boolean, responseBody?: unknown) {
    super(message);
    this.name = "V11AsterProtectiveApiError";
    this.status = status;
    this.executionUnknown = executionUnknown;
    this.responseBody = responseBody;
  }
}

function encode(params: Record<string, unknown>) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    out.append(key, String(value));
  }
  return out.toString();
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text) as unknown; } catch { return text; }
}

function messageFrom(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const msg = (payload as { msg?: unknown; message?: unknown }).msg ?? (payload as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return fallback;
}

class MonotonicNonce {
  private last = 0n;
  next() {
    const now = BigInt(Date.now()) * 1000n;
    this.last = now > this.last ? now : this.last + 1n;
    return this.last.toString();
  }
}

export class V11AsterProtectiveClient {
  readonly baseUrl: string;
  readonly signerAddress: `0x${string}`;
  private readonly userAddress: string;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly recvWindowMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly nonce = new MonotonicNonce();

  constructor(options: V11AsterProtectiveClientOptions) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(options.privateKey)) throw new Error("V11 Aster protective client requires 32-byte hex key.");
    this.baseUrl = String(options.baseUrl || "https://fapi3.asterdex.com").replace(/\/+$/, "");
    this.userAddress = options.userAddress.trim();
    if (!this.userAddress) throw new Error("V11 Aster protective client requires userAddress.");
    this.account = privateKeyToAccount(options.privateKey);
    this.signerAddress = this.account.address;
    this.recvWindowMs = Math.min(5000, Math.max(1000, options.recvWindowMs ?? 5000));
    this.timeoutMs = Math.max(1000, options.requestTimeoutMs ?? 10_000);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async signedRequest<T>(input: { method: "GET" | "POST" | "DELETE"; path: string; params?: Record<string, unknown>; mutation?: boolean }): Promise<T> {
    const params: Record<string, unknown> = {
      ...(input.params || {}),
      recvWindow: this.recvWindowMs,
      nonce: this.nonce.next(),
      user: this.userAddress,
      signer: this.signerAddress,
    };
    const message = encode(params);
    const signature = await this.account.signTypedData({
      domain: {
        name: "AsterSignTransaction",
        version: "1",
        chainId: 1666,
        verifyingContract: "0x0000000000000000000000000000000000000000",
      },
      types: { Message: [{ name: "msg", type: "string" }] },
      primaryType: "Message",
      message: { msg: message },
    });
    const payload = encode({ ...params, signature });
    const query = input.method === "GET" ? `?${payload}` : "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${input.path}${query}`, {
        method: input.method,
        body: input.method === "GET" ? undefined : payload,
        signal: controller.signal,
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "DisDex-V11-Research/1.0" },
        cache: "no-store",
      });
      const text = await response.text();
      const parsed = parseJson(text);
      if (!response.ok) {
        throw new V11AsterProtectiveApiError(messageFrom(parsed, `Aster HTTP ${response.status}`), response.status, input.mutation === true && response.status === 503, parsed);
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof V11AsterProtectiveApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new V11AsterProtectiveApiError(`Aster request timeout after ${this.timeoutMs}ms`, 0, input.mutation === true);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  getPositionMode() {
    return this.signedRequest<V11AsterPositionModeResponse>({ method: "GET", path: "/fapi/v3/positionSide/dual" });
  }

  placeReduceOnlyStopMarket(order: V11AsterStopMarketOrder) {
    return this.signedRequest<V11AsterProtectiveOrderResponse>({
      method: "POST",
      path: "/fapi/v3/order",
      mutation: true,
      params: {
        symbol: order.symbol.toUpperCase(),
        side: order.side,
        positionSide: "BOTH",
        type: "STOP_MARKET",
        quantity: order.quantity,
        reduceOnly: "true",
        stopPrice: order.stopPrice,
        newClientOrderId: order.newClientOrderId,
        workingType: order.workingType || "CONTRACT_PRICE",
        priceProtect: order.priceProtect === true ? "TRUE" : "FALSE",
        newOrderRespType: "ACK",
      },
    });
  }

  cancelOrder(symbol: string, clientOrderId: string) {
    return this.signedRequest<V11AsterProtectiveOrderResponse>({
      method: "DELETE",
      path: "/fapi/v3/order",
      mutation: true,
      params: { symbol: symbol.toUpperCase(), origClientOrderId: clientOrderId },
    });
  }
}
