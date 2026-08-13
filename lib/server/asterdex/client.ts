import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_BASE_URL = "https://fapi.asterdex.com";
const DEFAULT_CHAIN_ID = 1666;
const V3_DOMAIN = {
  name: "AsterSignTransaction",
  version: "1",
  chainId: DEFAULT_CHAIN_ID,
  verifyingContract: "0x0000000000000000000000000000000000000000" as const,
};

export type AsterDexClientConfig = {
  apiKey: string;
  apiSecret: string;
  userAddress: string;
  baseUrl: string;
  chainId: number;
};

export type AsterDexOrderRequest = {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: string;
  timeInForce?: "GTC" | "IOC" | "FOK" | "GTX";
  price?: string;
  reduceOnly?: boolean;
  newOrderRespType?: "ACK" | "RESULT";
  positionSide?: "BOTH" | "LONG" | "SHORT";
};

export type AsterDexUserWithdrawRequest = {
  chainId: number;
  asset: string;
  amount: string;
  fee: string;
  receiver: string;
  userNonce: string;
  userSignature: string;
};

export type AsterDexPositionRisk = {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice?: string;
  unRealizedProfit?: string;
  positionSide?: string;
};

export type AsterDexUserTrade = {
  id?: number | string;
  orderId?: number | string;
  symbol?: string;
  price?: string;
  qty?: string;
  quoteQty?: string;
  realizedPnl?: string;
  commission?: string;
  commissionAsset?: string;
  buyer?: boolean;
  maker?: boolean;
  side?: "BUY" | "SELL";
  positionSide?: "BOTH" | "LONG" | "SHORT";
  time?: number;
};

export type AsterDexKline = [
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

type RequestMethod = "GET" | "POST" | "DELETE" | "PUT";

type RequestParamValue = string | number | boolean | null | undefined;

type RequestParam = readonly [key: string, value: RequestParamValue];

const MESSAGE_TYPES = {
  Message: [{ name: "msg", type: "string" }],
} as const;

export function loadAsterDexClientConfig(): AsterDexClientConfig | null {
  const apiSecret = (
    process.env.ASTER_API_SECRET
    || process.env.ASTER_API_PRIVATE_KEY
    || ""
  ).trim();
  if (!apiSecret) return null;

  // The production environment names the signer key ASTER_API_PRIVATE_KEY.
  // Derive the signer address when the optional API-key alias is absent; the
  // private key itself is never returned to callers or serialized in a response.
  const derivedSigner = privateKeyToAccount(apiSecret as `0x${string}`).address;
  const apiKey = (process.env.ASTER_API_KEY?.trim() || derivedSigner).trim();
  const userAddress = (
    process.env.ASTER_USER_ADDRESS
    || process.env.ASTER_MAIN_ADDRESS
    || process.env.ASTER_MASTER_ADDRESS
    || ""
  ).trim();

  if (!apiKey || !userAddress) return null;

  return {
    apiKey,
    apiSecret,
    userAddress,
    baseUrl: (
      process.env.ASTER_API_BASE_URL
      || process.env.ASTER_FUTURES_BASE_URL
      || DEFAULT_BASE_URL
    ).trim(),
    chainId: Number(process.env.ASTER_CHAIN_ID || DEFAULT_CHAIN_ID),
  };
}

function normalizeBoolean(value: boolean) {
  return value ? "true" : "false";
}

function compactParams(params: RequestParam[]) {
  return params.filter((entry): entry is readonly [string, string | number | boolean] => {
    const [, value] = entry;
    return value !== undefined && value !== null && value !== "";
  });
}

function buildQueryString(params: RequestParam[]) {
  const search = new URLSearchParams();
  for (const [key, value] of compactParams(params)) {
    search.append(key, typeof value === "boolean" ? normalizeBoolean(value) : String(value));
  }
  return search.toString();
}

let lastNonceBase = 0;
let nonceOffset = 0;

function nextNonce() {
  const base = Date.now() * 1000;
  if (base === lastNonceBase) {
    nonceOffset += 1;
  } else {
    lastNonceBase = base;
    nonceOffset = 0;
  }
  return String(base + nonceOffset);
}

export class AsterDexClient {
  private readonly signerAccount;

  constructor(private readonly config: AsterDexClientConfig) {
    this.signerAccount = privateKeyToAccount(this.config.apiSecret as `0x${string}`);
    if (this.signerAccount.address.toLowerCase() !== this.config.apiKey.toLowerCase()) {
      throw new Error("ASTER_API_KEY と ASTER_API_SECRET の組み合わせが一致していません。");
    }
  }

  private async signMessage(message: string) {
    return this.signerAccount.signTypedData({
      domain: {
        ...V3_DOMAIN,
        chainId: this.config.chainId,
      },
      types: MESSAGE_TYPES,
      primaryType: "Message",
      message: { msg: message },
    });
  }

  private async signedRequest<T>(
    method: RequestMethod,
    pathname: string,
    businessParams: RequestParam[] = [],
  ): Promise<T> {
    const nonce = nextNonce();
    const baseParams: RequestParam[] = [
      ["user", this.config.userAddress],
      ["signer", this.config.apiKey],
      ["nonce", nonce],
      ...businessParams,
    ];
    const query = buildQueryString(baseParams);
    const signature = await this.signMessage(query);
    const finalQuery = `${query}&signature=${encodeURIComponent(signature)}`;
    const url = `${this.config.baseUrl}${pathname}?${finalQuery}`;

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`AsterDex ${method} ${pathname} failed: ${response.status} ${text}`.slice(0, 400));
    }

    return response.json() as Promise<T>;
  }

  private async publicRequest<T>(pathname: string, params: RequestParam[] = []): Promise<T> {
    const query = buildQueryString(params);
    const url = `${this.config.baseUrl}${pathname}${query ? `?${query}` : ""}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`AsterDex GET ${pathname} failed: ${response.status} ${text}`.slice(0, 400));
    }
    return response.json() as Promise<T>;
  }

  ping() {
    return this.publicRequest<Record<string, never>>("/fapi/v3/ping");
  }

  getServerTime() {
    return this.publicRequest<{ serverTime: number }>("/fapi/v3/time");
  }

  getExchangeInfo() {
    return this.publicRequest<any>("/fapi/v3/exchangeInfo");
  }

  getPrice(symbol: string) {
    return this.publicRequest<{ symbol: string; price: string; time?: number }>("/fapi/v3/ticker/price", [["symbol", symbol]]);
  }

  getKlines(symbol: string, interval = "1h", limit = 100) {
    return this.publicRequest<AsterDexKline[]>("/fapi/v3/klines", [
      ["symbol", symbol],
      ["interval", interval],
      ["limit", Math.min(1000, Math.max(1, limit))],
    ]);
  }

  getBalance() {
    return this.signedRequest<any[]>("GET", "/fapi/v3/balance");
  }

  getAccount() {
    return this.signedRequest<any>("GET", "/fapi/v3/account");
  }

  getOpenOrders(symbol?: string) {
    return this.signedRequest<any[]>("GET", "/fapi/v3/openOrders", symbol ? [["symbol", symbol]] : []);
  }

  getOrder(symbol: string, orderId: string) {
    return this.signedRequest<any>("GET", "/fapi/v3/order", [
      ["symbol", symbol],
      ["orderId", orderId],
    ]);
  }

  getPositionRisk(symbol?: string) {
    return this.signedRequest<AsterDexPositionRisk[]>("GET", "/fapi/v3/positionRisk", symbol ? [["symbol", symbol]] : []);
  }

  getUserTrades(
    symbol: string,
    options: { limit?: number; startTime?: number; endTime?: number; fromId?: number } = {},
  ) {
    return this.signedRequest<AsterDexUserTrade[]>("GET", "/fapi/v3/userTrades", [
      ["symbol", symbol],
      ["limit", options.limit],
      ["startTime", options.startTime],
      ["endTime", options.endTime],
      ["fromId", options.fromId],
    ]);
  }

  getAgents() {
    return this.signedRequest<any[]>("GET", "/fapi/v3/agent");
  }

  getUserWithdrawInfo() {
    return this.signedRequest<any>("POST", "/fapi/v3/aster/user-withdraw-info");
  }

  getDepositWithdrawHistory() {
    return this.signedRequest<any[]>("POST", "/fapi/v3/aster/deposit-withdraw-history");
  }

  userWithdraw(input: AsterDexUserWithdrawRequest) {
    const params: RequestParam[] = [
      ["chainId", input.chainId],
      ["asset", input.asset],
      ["amount", input.amount],
      ["fee", input.fee],
      ["receiver", input.receiver],
      ["userNonce", input.userNonce],
      ["userSignature", input.userSignature],
    ];
    return this.signedRequest<any>("POST", "/fapi/v3/aster/user-withdraw", params);
  }

  placeOrder(input: AsterDexOrderRequest) {
    const params: RequestParam[] = [
      ["symbol", input.symbol],
      ["side", input.side],
      ["type", input.type],
      ["quantity", input.quantity],
      ["timeInForce", input.timeInForce],
      ["price", input.price],
      ["reduceOnly", input.reduceOnly],
      ["newOrderRespType", input.newOrderRespType || "RESULT"],
      ["positionSide", input.positionSide],
    ];
    return this.signedRequest<any>("POST", "/fapi/v3/order", params);
  }

  cancelOrder(symbol: string, orderId: string) {
    return this.signedRequest<any>("DELETE", "/fapi/v3/order", [
      ["symbol", symbol],
      ["orderId", orderId],
    ]);
  }
}
